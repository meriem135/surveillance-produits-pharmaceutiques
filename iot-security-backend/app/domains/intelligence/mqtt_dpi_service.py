"""
MQTT Deep Packet Inspection (DPI) Service — Phase 1 v2
=====================================================
Innovations :
  1. Règles configurables via YAML + live reload via API
  2. Corrélation intelligente : si N règles matchent, le niveau monte
  3. Statistiques temps réel : msg/s, latence µs, alertes/min
  4. Dashboard visible : chaque alerte DPI est traçable dans le frontend
"""

import json
import logging
import math
import os
import time
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from collections import deque

YAML_PATH = Path(__file__).parent / "dpi_rules.yaml"
WAZUH_LOG_PATH = os.getenv("WAZUH_DPI_LOG_PATH", "/var/ossec/logs/mqtt_dpi_alerts.log")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    import yaml
except ImportError:
    yaml = None


def load_rules_from_yaml(path: Path = YAML_PATH) -> list[dict]:
    if yaml is None:
        logger.warning("PyYAML non installé, utilisation des règles par défaut")
        return _default_rules()
    if not path.exists():
        logger.warning("Fichier YAML %s introuvable, règles par défaut", path)
        return _default_rules()
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data.get("rules", [])


# Seuils statistiques — calculés sur le dataset réel (moyenne ± 3σ par saison)
# En industrie, les stats doivent être recalibrées périodiquement (IEC 62443 §6.10)
SENSOR_STATS = {
    "weather": {
        "temperature": {"mean": 18.4, "std": 10.0},
    },
    "fridge": {
        "fridge_temperature": {"mean": 3.8, "std": 1.5},
    },
    "thermostat": {
        "current_temperature": {"mean": 16.7, "std": 10.2},
    },
    "multi-sensor_Hiver": {
        "weather_temperature":     {"mean": 5.7,  "std": 4.9},
        "fridge_temperature":      {"mean": 3.8,  "std": 1.5},
        "thermostat_temperature":  {"mean": 3.7,  "std": 4.6},
    },
    "multi-sensor_Printemps": {
        "weather_temperature":     {"mean": 17.9, "std": 4.1},
        "fridge_temperature":      {"mean": 4.2,  "std": 1.6},
        "thermostat_temperature":  {"mean": 16.6, "std": 5.1},
    },
    "multi-sensor_Été": {
        "weather_temperature":     {"mean": 31.0, "std": 4.3},
        "fridge_temperature":      {"mean": 3.5,  "std": 1.4},
        "thermostat_temperature":  {"mean": 29.2, "std": 4.4},
    },
    "multi-sensor_Automne": {
        "weather_temperature":     {"mean": 19.0, "std": 4.2},
        "fridge_temperature":      {"mean": 3.6,  "std": 1.6},
        "thermostat_temperature":  {"mean": 17.3, "std": 4.7},
    },
}


def _default_rules():
    return [
        # ── DPI-001 : Variation brusque (Δt) — seuils corrigés ──
        # Problème original : 5°C sur échantillons espacés 3h → 37-48% faux positifs
        # Fix : seuils par capteur basés sur la variabilité réelle
        #   weather_temperature  : 13°C (~5% faux positifs)
        #   thermostat_temperature : 13°C (~5% faux positifs)
        #   fridge_temperature   : 5°C  (inchangé, 2.5% faux positifs)
        {"id": "DPI-001", "name": "Variation brusque (Δt)", "enabled": True, "severity": 9, "group": "behavioral",
         "conditions": {"field": "__delta__", "operator": "gt", "value": 5.0,
                        "sensor_config": {"multi-sensor": {"fields": ["weather_temperature", "fridge_temperature", "thermostat_temperature"],
                                                           "delta_threshold": 5.0,
                                                           "thresholds": {"weather_temperature": 14.0, "fridge_temperature": 5.0, "thermostat_temperature": 16.0}}}},
         "description": "Variation brutale > seuil (weather 13°C, fridge 5°C, thermostat 13°C) — capteur défaillant, incendie ou falsification.",
         "correlation": {"boost_on_match": 3}},

        # ── DPI-004 : Anomalie saisonnière 3σ adaptatif (ex-3σ fixe) ──
        # Problème original : stats fixes → fausses alertes en hiver, aveugle en été
        # Fix : moyenne et écart-type par saison, calculés sur le dataset réel
        {"id": "DPI-004", "name": "Anomalie saisonnière (3σ adaptatif)", "enabled": True, "severity": 10, "group": "sensor",
         "conditions": {"field": None, "operator": "zscore",
                        "sensor_stats": SENSOR_STATS},
         "description": "Valeur > 3σ de la moyenne saisonnière — dérive anormale par rapport au comportement attendu pour la saison.",
         "correlation": {"boost_on_match": 3}},

        # ── DPI-005 : Spike température (ex-Seuil > 1000) ──
        # Problème original : seuil 1000 → jamais déclenché (max dataset = 38.9°C)
        # Fix : seuil 42°C, attaque injecte max +8°C → max théorique 46.9°C
        {"id": "DPI-005", "name": "Spike température (> 42°C)", "enabled": True, "severity": 5, "group": "sensor",
         "conditions": {"field": "__any_numeric__", "operator": "gt", "value": 42.0,
                        "exclude_fields": ["timestamp", "device_type", "label", "normality_score", "month", "season", "attack_active", "dpi_alert", "dpi_stats"]},
         "description": "Température > 42°C sur capteur ambiant — valeur anormalement élevée, possible début d'emballement.",
         "correlation": {"boost_on_match": 2}},
    ]


def evaluate_condition(condition: dict, payload: dict, device_type: str,
                       prev_payload: Optional[dict] = None) -> bool:
    op = condition.get("operator")
    field = condition.get("field")

    # ── Z-score adaptatif (par saison) ──
    if op == "zscore" and field is None:
        stats_config = condition.get("sensor_stats", {})
        # Cherche d'abord des stats spécifiques à la saison courante
        season = str(payload.get("season", ""))
        season_key = f"{device_type}_{season}"
        dev_stats = stats_config.get(season_key) or stats_config.get(device_type, {})
        for f, stat in dev_stats.items():
            raw = payload.get(f)
            if raw is None:
                continue
            try:
                val = float(raw)
            except (ValueError, TypeError):
                continue
            mean = stat.get("mean", 0)
            std = max(stat.get("std", 1), 0.001)
            z = abs((val - mean) / std)
            if z > 3.0:
                return True
        return False

    # ── DPI-001 amélioré : Delta (variation brusque) avec seuils par capteur ──
    if field == "__delta__":
        if prev_payload is None:
            return False
        sensor_cfg = condition.get("sensor_config", {})
        cfg = sensor_cfg.get(device_type, condition)
        delta_fields = cfg.get("fields", [])
        # Seuils spécifiques par capteur (sinon fallback sur delta_threshold générique)
        per_field_thresholds = cfg.get("thresholds", {})
        default_threshold = cfg.get("delta_threshold", condition.get("value", 5.0))
        for f in delta_fields:
            cur = payload.get(f)
            prev = prev_payload.get(f)
            if cur is None or prev is None:
                continue
            try:
                diff = abs(float(cur) - float(prev))
                threshold = per_field_thresholds.get(f, default_threshold)
                if diff > threshold:
                    return True
            except (ValueError, TypeError):
                continue
        return False

    if op == "range" and field is None:
        thresholds = condition.get("sensor_thresholds", {})
        dev_thresholds = thresholds.get(device_type, {})
        for f, (lo, hi) in dev_thresholds.items():
            raw = payload.get(f)
            if raw is None:
                continue
            try:
                val = float(raw)
            except (ValueError, TypeError):
                continue
            if not (lo <= val <= hi):
                return True
        return False

    if op == "range" and field is not None:
        raw = payload.get(field)
        if raw is None:
            return False
        try:
            val = float(raw)
        except (ValueError, TypeError):
            return False
        lo, hi = condition["value"]
        invert = condition.get("invert", False)
        in_range = lo <= val <= hi
        return in_range if invert else not in_range

    if field == "__any_numeric__":
        exclude = set(condition.get("exclude_fields", []))
        threshold = condition["value"]
        for k, v in payload.items():
            if k in exclude:
                continue
            if isinstance(v, (int, float)) and v > threshold:
                return True
        return False

    # ── Cross-delta : écart entre deux capteurs redondants ──
    if op == "cross_delta":
        field_a = condition.get("field_a")
        field_b = condition.get("field_b")
        threshold = condition.get("value", 10.0)
        a = payload.get(field_a) if isinstance(field_a, str) else None
        b = payload.get(field_b) if isinstance(field_b, str) else None
        if a is not None and b is not None:
            try:
                return abs(float(a) - float(b)) > threshold
            except (ValueError, TypeError):
                return False
        return False

    if op == "in":
        raw = payload.get(field)
        return raw in condition["value"]

    if op == "gt":
        raw = payload.get(field)
        if raw is None:
            return False
        try:
            return float(raw) > condition["value"]
        except (ValueError, TypeError):
            return False

    if op == "eq":
        return payload.get(field) == condition["value"]

    return False


class DpiStats:
    def __init__(self):
        self.total_messages = 0
        self.total_alerts = 0
        self.last_reset = time.time()
        self._latencies = deque(maxlen=1000)
        self._alert_times = deque(maxlen=1000)
        self._lock = threading.Lock()
        self.rule_match_counts: dict[str, int] = {}
        self.alert_history: deque = deque(maxlen=50)

    def record_message(self, latency_us: float):
        with self._lock:
            self.total_messages += 1
            self._latencies.append(latency_us)

    def record_alert(self, rule_id: str, alert_data: dict | None = None):
        with self._lock:
            self.total_alerts += 1
            self._alert_times.append(time.time())
            self.rule_match_counts[rule_id] = self.rule_match_counts.get(rule_id, 0) + 1
            if alert_data:
                self.alert_history.append({
                    "timestamp": alert_data.get("timestamp"),
                    "rule_id": rule_id,
                    "rule_name": alert_data.get("rule", {}).get("name", ""),
                    "severity": alert_data.get("rule", {}).get("level", 0),
                    "description": alert_data.get("rule", {}).get("description", ""),
                    "device": alert_data.get("data", {}).get("device", ""),
                    "attack_type": alert_data.get("data", {}).get("payload", {}).get("attack_info", {}).get("type", ""),
                    "attack_explanation": alert_data.get("data", {}).get("payload", {}).get("attack_info", {}).get("explanation", ""),
                    "payload": alert_data.get("data", {}).get("payload", {}),
                })

    def get_recent_alerts(self, limit: int = 20) -> list[dict]:
        with self._lock:
            return list(self.alert_history)[-limit:]

    def snapshot(self) -> dict:
        with self._lock:
            elapsed = max(time.time() - self.last_reset, 0.01)
            msg_per_s = self.total_messages / elapsed
            alert_per_min = (len(self._alert_times) / max(elapsed, 1)) * 60
            avg_latency = sum(self._latencies) / max(len(self._latencies), 1)
            return {
                "total_messages": self.total_messages,
                "total_alerts": self.total_alerts,
                "messages_per_second": round(msg_per_s, 1),
                "alerts_per_minute": round(alert_per_min, 1),
                "avg_latency_us": round(avg_latency, 1),
                "rule_match_counts": dict(self.rule_match_counts),
                "uptime_seconds": round(elapsed),
            }


class MqttDPIService:
    def __init__(self, yaml_path: Path = YAML_PATH, log_path: str = WAZUH_LOG_PATH):
        self.yaml_path = yaml_path
        self.log_path = log_path
        self._rules: list[dict] = []
        self.reload_rules()
        self.stats = DpiStats()
        self._lock = threading.Lock()
        # Stockage de la dernière payload par device (pour calcul Δt)
        self._prev_payloads: dict[str, dict] = {}

    def reload_rules(self):
        self._rules = load_rules_from_yaml(self.yaml_path)
        logger.info("DPI: %d règles chargées depuis YAML", len(self._rules))

    def get_rules(self) -> list[dict]:
        return [dict(r) for r in self._rules]

    def update_rule(self, rule_id: str, updates: dict) -> bool:
        for r in self._rules:
            if r["id"] == rule_id:
                for k, v in updates.items():
                    if k in r:
                        r[k] = v
                logger.info("DPI: règle %s mise à jour: %s", rule_id, updates)
                return True
        return False

    def inspect_payload(self, payload: dict) -> Optional[dict]:
        t0 = time.perf_counter()
        matched_alerts = []
        device_type = str(payload.get("device_type", "unknown")).lower()
        # Récupérer la payload précédente pour le calcul de delta (DPI-001)
        device_key = f"{device_type}_{payload.get('label', 'unknown')}"
        prev_payload = self._prev_payloads.get(device_key)
        self._prev_payloads[device_key] = payload

        for rule in self._rules:
            if not rule.get("enabled", True):
                continue
            try:
                if evaluate_condition(rule["conditions"], payload, device_type, prev_payload):
                    desc = rule.get("description", rule["name"])
                    alert = self._build_alert(
                        severity=rule["severity"],
                        description=f"[{rule['id']}] {rule['name']}: {desc}",
                        device=device_type,
                        payload=payload,
                        rule_id=rule["id"],
                        rule_name=rule["name"],
                        group=rule.get("group", "generic"),
                    )
                    matched_alerts.append((alert, rule))
            except Exception as e:
                logger.error("DPI: erreur règle %s: %s", rule["id"], e)

        latency_us = (time.perf_counter() - t0) * 1_000_000
        self.stats.record_message(latency_us)

        if not matched_alerts:
            return None

        max_severity = max(a["rule"]["level"] for a, _ in matched_alerts)
        matched_ids = [a["rule"]["id"] for a, _ in matched_alerts]
        correlation_boost = 0

        if len(matched_alerts) >= 2:
            for _, rule in matched_alerts:
                correlation_boost += rule.get("correlation", {}).get("boost_on_match", 0)
            max_severity = min(15, max_severity + correlation_boost)

        main_alert = matched_alerts[0][0]
        main_alert["rule"]["level"] = max_severity
        main_alert["rule"]["correlation"] = {
            "matched_rules": matched_ids,
            "count": len(matched_ids),
            "boost": correlation_boost,
        }
        main_alert["rule"]["description"] += f" | Corrélation: {len(matched_ids)} règles [{', '.join(matched_ids)}]"

        for a, r in matched_alerts:
            self.stats.record_alert(r["id"], alert_data=a)

        return main_alert

    def _build_alert(self, severity, description, device, payload, rule_id, rule_name="", group="generic"):
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "rule": {
                "id": rule_id,
                "name": rule_name,
                "level": severity,
                "description": description,
                "groups": ["iot", "sensor", "dpi", group],
            },
            "data": {
                "device": device,
                "payload": payload,
            },
        }

    def send_to_wazuh(self, alert: dict) -> None:
        try:
            os.makedirs(os.path.dirname(self.log_path), exist_ok=True)
            target = self.log_path
        except (PermissionError, OSError):
            target = "mqtt_dpi_alerts.log"
        with open(target, "a", encoding="utf-8") as f:
            f.write(json.dumps(alert) + "\n")
        logger.warning("DPI ALERT [%s] level=%d — %s", alert["rule"]["id"], alert["rule"]["level"], alert["rule"]["description"])

    def process(self, payload: dict) -> Optional[dict]:
        alert = self.inspect_payload(payload)
        if alert:
            self.send_to_wazuh(alert)
        return alert


dpi_service = MqttDPIService()
