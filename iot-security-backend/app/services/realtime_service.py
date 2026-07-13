"""
Service de streaming temps réel — Phase 1 v3
============================================
- Lit le CSV (normal + attaque par saison) SÉQUENTIELLEMENT
- Injecte chaque point dans le moteur DPI
- Diffuse les résultats (télémétrie + alertes DPI) via WebSocket
"""

import asyncio
import json
import os
import time
import csv
import random
from datetime import datetime
from pathlib import Path
from fastapi import WebSocket, WebSocketDisconnect

from app.domains.intelligence.mqtt_dpi_service import dpi_service

BASE_DIR = Path(__file__).resolve().parent.parent.parent
CSV_PATH = BASE_DIR / "Data" / "Generated" / "extraits_saisonniers.csv"
if not CSV_PATH.exists():
    alt = Path.cwd().parent / "Data" / "Generated" / "generated_yearly_merged.csv"
    if alt.exists():
        CSV_PATH = alt.resolve()

SENSOR_MAP = {
    "temperature": "weather",
    "fridge_temperature": "fridge",
    "current_temperature": "thermostat",
}


def read_csv_sequential(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        yield from reader


SEASON_NAMES = {1: "Hiver", 2: "Printemps", 3: "Été", 4: "Automne"}

def build_payload(row: dict) -> dict:
    temp_w = float(row.get("temperature", 25))
    temp_f = float(row.get("fridge_temperature", 5))
    temp_t = float(row.get("current_temperature", 25))
    label = int(row.get("label", 0))
    season_num = int(row.get("season", 1))
    month = int(row.get("month", 1))
    attack = label == 1

    normality = max(20, min(100, 97 - (label * 35) + random.gauss(0, 3)))
    is_anomaly = normality < 50 or attack

    return {
        "timestamp": datetime.now().isoformat(),
        "device_type": "multi-sensor",
        "label": label,
        "attack_active": False,  # Sera mis à True si DPI détecte
        "weather_temperature": round(temp_w, 1),
        "fridge_temperature": round(temp_f, 1),
        "thermostat_temperature": round(temp_t, 1),
        "normality_score": round(normality, 1),
        "is_anomaly": is_anomaly,
        "season": SEASON_NAMES.get(season_num, "Inconnu"),
        "month": month,
    }


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self._attack_active = False

    def set_attack(self, active: bool):
        self._attack_active = active

    def get_attack(self) -> bool:
        return self._attack_active

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        dead = []
        for conn in self.active_connections:
            try:
                await conn.send_json(message)
            except WebSocketDisconnect:
                dead.append(conn)
            except Exception:
                dead.append(conn)
        for d in dead:
            self.disconnect(d)

    async def stream_loop(self):
        csv_generator = None
        while True:
            try:
                if csv_generator is None:
                    csv_generator = read_csv_sequential(CSV_PATH)
                    logger.info("=== Nouveau cycle CSV ===")
                    await asyncio.sleep(0.5)
                    continue

                row = next(csv_generator)
                payload = build_payload(row)

                dpi_alert = dpi_service.inspect_payload(payload)

                # DPI filtre les attaques : attack_active et attack_info
                # définis UNIQUEMENT si label=1 ET une règle DPI déclenche
                attack_active = bool(dpi_alert) and payload.get("label") == 1
                payload["attack_active"] = attack_active
                if attack_active:
                    rule_id = dpi_alert.get("rule", {}).get("id", "")
                    info = DPI_ATTACK_INFO.get(rule_id, {})
                    payload["attack_info"] = {
                        "type": info.get("type", rule_id),
                        "explanation": info.get("explanation", dpi_alert.get("rule", {}).get("description", "")),
                    }
                elif "attack_info" in payload:
                    del payload["attack_info"]

                point = {
                    **payload,
                    "dpi_alert": dpi_alert,
                    "dpi_stats": dpi_service.stats.snapshot(),
                }
                await self.broadcast(point)
                await asyncio.sleep(random.uniform(0.3, 0.8))

            except StopIteration:
                csv_generator = None
                await self.broadcast({"type": "reset", "message": "Fin du cycle CSV, redémarrage..."})
                await asyncio.sleep(1)
            except Exception as e:
                logger.error("Stream error: %s", e)
                await asyncio.sleep(1)


import logging
logger = logging.getLogger(__name__)

DPI_ATTACK_INFO = {
    "DPI-001": {
        "type": "Variation brutale de température",
        "explanation": "🌡️ La température d'un capteur a changé brutalement entre deux mesures. "
                       "Seuil adapté à chaque capteur : weather (14°C), frigo (5°C), thermostat (16°C). "
                       "Cela peut indiquer un capteur défaillant, un incendie naissant, ou un attaquant qui modifie les données."
    },
    "DPI-004": {
        "type": "Anomalie saisonnière (3σ)",
        "explanation": "📊 La valeur mesurée est anormale par rapport à la moyenne de la saison en cours. "
                       "En hiver (moyenne 5°C) comme en été (moyenne 31°C), le système adapte ses seuils automatiquement. "
                       "Une valeur hors plage 3σ trahit une panne, un emballement, ou une intrusion."
    },
    "DPI-005": {
        "type": "Spike température",
        "explanation": "📈 Un capteur ambiant dépasse 42°C — température physiquement anormale. "
                       "Dans l'usine, personne ne devrait voir 45°C sur un thermostat d'ambiance. "
                       "Cause probable : capteur en court-circuit, incendie localisé, ou saturation volontaire par un attaquant."
    },
}

manager = ConnectionManager()
