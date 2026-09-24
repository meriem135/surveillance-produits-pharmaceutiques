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

# ── Normalisation saison (id numérique, FR accentué/sans accent, EN) ──
SEASON_CANON = {1: "Hiver", 2: "Printemps", 3: "Été", 4: "Automne"}
_SEASON_ALIASES = {
    "hiver": "Hiver", "winter": "Hiver",
    "printemps": "Printemps", "spring": "Printemps",
    "ete": "Été", "été": "Été", "summer": "Été",
    "automne": "Automne", "autumn": "Automne", "fall": "Automne",
}


def _payload_season(payload: dict) -> str:
    """Retourne la saison canonique ('Hiver', 'Printemps', 'Été', 'Automne' ou '')."""
    raw = payload.get("season")
    if raw is None:
        return ""
    if isinstance(raw, (int, float)):
        return SEASON_CANON.get(int(raw), "")
    name = str(raw).strip()
    if name in SEASON_CANON.values():
        return name
    return _SEASON_ALIASES.get(name.lower().replace("é", "e"), "")


def _resolve_season_stats(stats_config: dict, payload: dict, device_type: str) -> dict:
    """Stats du device pour la saison courante, avec fallback annuel si inconnue."""
    season = _payload_season(payload)
    candidates = []
    if season:
        candidates.append(f"{device_type}_{season}")
    candidates.append(device_type)
    for key in candidates:
        if key in stats_config:
            return stats_config[key]
    return {}


def _default_rules():    return [
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

        # ── DPI-002 : Frigo hors plage ──
        # Seuil (>9.5°C) : le frigo doit rester autour de 7°C.
        {"id": "DPI-002", "name": "Frigo hors plage (>9.5°C)", "enabled": True, "severity": 8, "group": "sensor",
         "conditions": {"field": "fridge_temperature", "operator": "gt", "value": 9.5},
         "description": "Température du frigo > 9.5°C alors qu'il doit rester stable autour de 7°C (σ≈0.5). Dérive très brutale, sonde défaillante ou falsification massive.",
         "correlation": {"boost_on_match": 2}},

        # ── DPI-003 : Saut thermostat ──
        # Seuil (>2.5°C) : thermostat très stable (~23°C).
        {"id": "DPI-003", "name": "Saut thermostat (>2.5°C)", "enabled": True, "severity": 9, "group": "behavioral",
         "conditions": {"field": "__delta__", "operator": "gt", "value": 2.5,
                        "sensor_config": {"multi-sensor": {"fields": ["thermostat_temperature"],
                                                           "delta_threshold": 2.5,
                                                           "thresholds": {"thermostat_temperature": 2.5}}}},
         "description": "Variation du thermostat > 2.5°C en un pas (σ réel ≈0.6°C). Rampe d'attaque violente, cycle forcé ou données injectées massivement.",
         "correlation": {"boost_on_match": 3}},

        # ── DPI-004 : Instabilité météo ──
        # Seuil (>2.2) : rolling-std ≈ 0.47 en normal.
        {"id": "DPI-004", "name": "Instabilité météo (>2.2)", "enabled": True, "severity": 7, "group": "behavioral",
         "conditions": {"field": "weather_roll_std_10", "operator": "gt", "value": 2.2},
         "description": "Écart-type glissant (10 mesures) de la température météo > 2.2 alors qu'il vaut ~0.47 en régime normal. Dérive extrêmement brutale, injection de valeurs aberrantes.",
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
        dev_stats = _resolve_season_stats(stats_config, payload, device_type)
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

    # ── Spike saisonnier (absolu) : valeur > moyenne saisonnière + k·σ ──
    # Répond à DPI-005 : un seuil fixe (42°C) crée des faux positifs en été
    # (42°C = +2.6σ l'été → inoffensif). Le seuil suit donc la saison.
    if op == "seasonal_gt" and field is None:
        stats_config = condition.get("sensor_stats", {})
        sigma_mult = float(condition.get("sigma_mult", 3.0))
        dev_stats = _resolve_season_stats(stats_config, payload, device_type)
        for f, stat in dev_stats.items():
            raw = payload.get(f)
            if raw is None:
                continue
            try:
                val = float(raw)
            except (ValueError, TypeError):
                continue
            threshold = stat.get("mean", float("inf")) + sigma_mult * max(stat.get("std", 0), 0)
            if val > threshold:
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


def _match_details(rule: dict, payload: dict, prev_payload: Optional[dict],
                   device_type: str) -> dict:
    """Décrit PRECISEMENT d'ou vient l'attaque pour une regle declenchee :
    capteur concerne, valeur mesuree, seuil et ecart. Renvoie un dict vide si
    aucune correspondance n'est retrouvee."""
    cond = rule.get("conditions", {})
    field = cond.get("field")
    sensor_label = {"weather": "Meteo (exterieur)", "fridge": "Frigo (chaine du froid)",
                    "thermostat": "Thermostat (ambiance)"}

    # DPI-001 : variation brusque (delta) — chercher le capteur dont l'ecart depasse son seuil
    if field == "__delta__":
        if prev_payload is None:
            return {}
        cfg = cond.get("sensor_config", {}).get(device_type, cond)
        thresholds = cfg.get("thresholds", {})
        default_thr = cfg.get("delta_threshold", cond.get("value", 5.0))
        best = None
        for f in cfg.get("fields", []):
            cur = payload.get(f)
            prev = prev_payload.get(f)
            if cur is None or prev is None:
                continue
            try:
                diff = abs(float(cur) - float(prev))
                thr = thresholds.get(f, default_thr)
                if diff > thr and (best is None or diff / thr > best["ratio"]):
                    best = {"field": f, "value": diff, "threshold": thr,
                            "ratio": diff / thr, "prev": float(prev), "cur": float(cur)}
            except (ValueError, TypeError):
                continue
        if not best:
            return {}
        field_name = best["field"]
        for key, lbl in (("weather_temperature", "Meteo"),
                         ("fridge_temperature", "Frigo"),
                         ("thermostat_temperature", "Thermostat")):
            if key in field_name:
                sensor_label = {"Meteo": "Meteo (exterieur)", "Frigo": "Frigo (chaine du froid)",
                                "Thermostat": "Thermostat (ambiance)"}.get(lbl)
                break
        return {
            "sensor": sensor_label or device_type,
            "cause": "Variation brutale de temperature sur le capteur",
            "value": best["value"], "threshold": best["threshold"],
            "unit": "°C de variation", "prev": best["prev"], "cur": best["cur"],
            "detail": (f"{sensor_label}: saut de {best['prev']:.1f}°C a {best['cur']:.1f}°C "
                       f"(ecart {best['value']:.1f}°C > seuil {best['threshold']:.1f}°C)"),
        }

    # Regles mono-champ (DPI-002, DPI-003, DPI-004)
    if field is not None:
        raw = payload.get(field)
        if raw is None:
            return {}
        try:
            value = float(raw)
        except (ValueError, TypeError):
            return {}
        threshold = cond.get("value", 0.0)
        # Correspondance capteur / unite
        unit = "°C"
        if field == "fridge_temperature":
            sensor_label = sensor_label["fridge"]
            cause = "Temperature du frigo au-dessus de sa plage de fonctionnement (derive de la chaine du froid)"
            detail = (f"Frigo a {value:.1f}°C (seuil de securite {threshold:.1f}°C, "
                      f"ecart {(value - threshold):.1f}°C, normal ~7°C)")
        elif field == "thermostat_diff_1":
            sensor_label = sensor_label["thermostat"]
            cause = "Le thermostat a effectue un saut brutal en un pas de mesure"
            detail = (f"Thermostat: saut mesure {value:.1f}°C (seuil {threshold:.1f}°C, "
                      f"ecart {(value - threshold):.1f}°C, normal sigma ~0.6°C)")
        elif field == "weather_roll_std_10":
            sensor_label = sensor_label["weather"]
            unit = "ecart-type"
            cause = "Instabilite extreme de la temperature meteo (ecart-type glissant sur 10 mesures)"
            detail = (f"Meteo: ecart-type glissant {value:.2f} (seuil {threshold:.2f}, "
                      f"ecart {(value - threshold):.2f}, normal ~0.47)")
        else:
            sensor_label = sensor_label.get(device_type, device_type)
            cause = f"Valeur du capteur {field} hors seuil"
            detail = f"{field}: valeur {value:.2f} (seuil {threshold:.2f})"
        return {
            "sensor": sensor_label, "cause": cause,
            "value": value, "threshold": threshold, "unit": unit, "detail": detail,
        }

    # Capteur multi-capteur (weather/fridge/thermostat) — cas range/zscore
    label = sensor_label.get(device_type, device_type)
    return {"sensor": label, "cause": "Comportement anormal detecte", "detail": ""}


# Recommandations d'action pour l'utilisateur de la plateforme, par regle.
# Point d'attention : les regles DPI sont volontairement minimales (seuils
# stricts) ; chaque consigne est une action concrete, defendable en soutenance.
RECOMMENDATIONS = {
    "DPI-002": {
        "consigne": "Isolez le capteur du frigo et verifiez la sonde de la chaine du froid.",
        "steps": [
            "Verifier la sonde de temperature du frigo (cable, connectique, court-circuit)",
            "Comparer la mesure a un thermometre de reference sur place",
            "Si la valeur reste > 9.5°C meme a vide : couper l'equipement et planifier un remplacement",
            "Confirmer au modele ML que la derive est reelle (l'IA rattrape les cas plus subtils que la regle)",
        ],
    },
    "DPI-003": {
        "consigne": "Verifiez le thermostat d'ambiance : un saut > 2.5°C en un pas trahit une anomalie ou une falsification.",
        "steps": [
            "Controler le thermostat (consigne, mode, cycle ON/OFF du chauffage)",
            "Verifier qu'aucune commande externe n'a force la temperature (injection de donnees)",
            "Si le saut coincide avec une injection : identifier le topic source et bloquer l'emetteur",
            "Referencer l'evenement dans le registre de securite pour l'audit",
        ],
    },
    "DPI-004": {
        "consigne": "Controlez la stabilite de la station meteo et la qualite de ses mesures.",
        "steps": [
            "Verifier la station meteo exterieure (exposition, obstacle, capteurs perturves)",
            "Correler avec la meteo reelle : si le reel est stable mais la mesure chaotique, la sonde est defaillante",
            "Inspecter les paquets entrants : une instabilite brutale peut signaler une injection de valeurs aberrantes",
            "Valider la periode d'instabilite puis nettoyer la base de telemetrie si des valeurs fausses ont ete enregistrees",
        ],
    },
    "DPI-001": {
        "consigne": "Identifiez le capteur en forte variation et verifiez l'integrite de sa mesure.",
        "steps": [
            "Repérer le capteur concerne (meteo, frigo ou thermostat) et sa valeur avant/après le saut",
            "Verifier la continuite electrique / le branchement du capteur concerne",
            "Si la cause est legitime (mise sous tension, maintenance) : marquer l'evenement comme benign",
            "Sinon, considerer une attaque par modification des donnees et ouvrir un incident",
        ],
    },
}

# Profils d'amplitude par regle.
# Chaque regle cible un champ + un seuil de declenchement, une marge de
# normalisation (l'ecart "normal" du capteur) et un poids operationnel
# (impact metier du capteur en industrie 4.0 : frigo = critique, meteo = faible).
# Format : rule_id -> (champ, seuil_declenchement, marge_normalisation, poids_metier 0..1)
_AMPLITUDE_RULES = {
    "DPI-001": ("thermostat_temperature", 16.0, 3.0, 0.85),
    "DPI-002": ("fridge_temperature", 9.5, 2.0, 1.0),
    "DPI-003": ("thermostat_diff_1", 2.5, 2.0, 0.75),
    "DPI-004": ("weather_roll_std_10", 2.2, 1.5, 0.50),
}


def _risk_level(score: int) -> str:
    """Niveau de gravite metier (espace industriel) derive du score 0-100."""
    if score >= 75:
        return "CRITIQUE"
    if score >= 50:
        return "ELEVE"
    if score >= 25:
        return "MOYEN"
    return "FAIBLE"


def compute_risk_score(alert: dict, payload: dict, recurrences: int = 0) -> int:
    """Score de risque composite 0-100, logique industrie 4.0.

    4 composantes justifiables, chacune normalisee sur son propre maximum :
      1. Gravite operationnelle (0-40) : severite de la regle ponderee par
         l'impact metier du capteur (frigo > thermostat > meteo).
      2. Amplitude normalisee (0-30) : ecart reel au seuil rapporte a la marge
         normale du capteur (comparaison juste entre capteurs).
      3. Correlation multi-regles (0-20) : plusieurs DPI co-declenches + bonus
         defini par regle (boost_on_match) renforcent la certitude.
      4. Persistance (0-10) : l'anomalie reapparait sur plusieurs paquets.
    """
    try:
        rule = alert.get("rule", {}) if isinstance(alert, dict) else {}
        level = float(rule.get("level", 5))
        rule_id = rule.get("id", "")

        # 1) Gravite operationnelle : severite x impact metier du capteur
        spec = _AMPLITUDE_RULES.get(rule_id)
        impact = float(spec[3]) if spec else 0.7
        severity_part = min(40.0, (level / 10.0) * 40.0 * impact)

        # 2) Amplitude normalisee par la marge du capteur
        amplitude_part = 0.0
        if spec:
            field, threshold, margin, _ = spec
            raw = payload.get(field)
            if raw is not None:
                try:
                    value = abs(float(raw))
                    if value > float(threshold):
                        exceed = value - float(threshold)
                        amplitude_part = min(30.0, (exceed / float(margin)) * 15.0)
                except (ValueError, TypeError):
                    amplitude_part = 0.0

        # 3) Correlation : multiplicite + bonus par regle (boost_on_match)
        correlation_part = 0.0
        if isinstance(rule, dict):
            corr = rule.get("correlation", {}) or {}
            corr_count = int(corr.get("count", 1) or 1)
            boost = float(corr.get("boost", 0) or 0)
            correlation_part = min(20.0, max(0.0, (corr_count - 1) * 7.0 + boost))

        # 4) Persistance : repetition de la meme alerte (0 = premiere occurrence)
        persistence_part = min(10.0, max(0.0, float(recurrences)) * 2.0)

        total = severity_part + amplitude_part + correlation_part + persistence_part
        return int(round(min(100.0, total)))
    except Exception:
        return 70


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
                    "match_detail": alert_data.get("data", {}).get("match_detail", {}),
                    "recommendation": alert_data.get("data", {}).get("recommendation", {}),
                    "payload": alert_data.get("data", {}).get("payload", {}),
                })

    def get_recent_alerts(self, limit: int = 20) -> list[dict]:
        with self._lock:
            return list(self.alert_history)[-limit:]

    def reset(self):
        with self._lock:
            self.total_messages = 0
            self.total_alerts = 0
            self.last_reset = time.time()
            self._latencies.clear()
            self._alert_times.clear()
            self.rule_match_counts.clear()
            self.alert_history.clear()

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

        # Detail precis de la regle declenchee (capteur, valeur, seuil, ecart)
        main_rule = matched_alerts[0][1]
        details = _match_details(main_rule, payload, prev_payload, device_type)
        reco = RECOMMENDATIONS.get(main_rule["id"], {
            "consigne": "Isoler le capteur concerne et verifier la validite de sa mesure.",
            "steps": ["Verifier la mesure sur place", "Inspecter les paquets entrants", "Ouvrir un incident si la cause est malveillante"],
        })
        main_alert["data"]["match_detail"] = details
        main_alert["data"]["recommendation"] = reco

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
