"""
Service de streaming temps reel — Phase 1 v5
============================================
- Lit le CSV d'extraits saisonniers (genere depuis dataset_fusionne.csv) SEQUENTIELLEMENT
  (saison par saison : Hiver -> Printemps -> Ete -> Automne, ordre chronologique)
- Diffuse la telemetrie des 3 capteurs (meteo, frigo, thermostat) via WebSocket

Le flux est genere en amont par :
    backend/scripts/build_dataset.py
qui construit data/processed/dataset_fusionne.csv (le dataset annuel d'entrainement)
et en extrait data/generated/extraits_saisonniers_fusionne.csv.
"""

import asyncio
import csv
import logging
import random
import pandas as pd
from datetime import datetime, timezone
from pathlib import Path
from fastapi import WebSocket, WebSocketDisconnect

from app.core.paths import SEASONAL_STREAM_CSV

from app.db.session import AsyncSessionLocal
from app.domains.devices.models import Telemetry
from app.domains.devices.repository import TelemetryRepository

logger = logging.getLogger(__name__)

# Flux saisonnier genere depuis dataset_fusionne.csv (voir backend/scripts/build_dataset.py)
CSV_PATH: Path = SEASONAL_STREAM_CSV


def read_csv_sequential(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        yield from reader


SEASON_NAMES = {1: "Hiver", 2: "Printemps", 3: "Été", 4: "Automne"}

# Mois -> numero de saison meteorologique (utilise en secours si le CSV n'a pas de colonne season)
_SEASON_OF_MONTH = {1: 1, 2: 1, 3: 2, 4: 2, 5: 2, 6: 3, 7: 3, 8: 3, 9: 4, 10: 4, 11: 4, 12: 1}


def _row_season(row: dict) -> int:
    """Numero de saison (1-4) de la ligne CSV : utilise la colonne `season` si presente,
    sinon la derive depuis `month` / `datetime`."""
    raw_season = row.get("season")
    if raw_season is not None and str(raw_season).strip() not in ("", "nan"):
        try:
            s = int(float(raw_season))
            if 1 <= s <= 4:
                return s
        except (ValueError, TypeError):
            pass
    month = None
    raw_month = row.get("month")
    if raw_month is not None and str(raw_month).strip() not in ("", "nan"):
        try:
            month = int(float(raw_month))
        except (ValueError, TypeError):
            month = None
    if month is None:
        raw_dt = row.get("datetime")
        if raw_dt:
            try:
                month = pd.to_datetime(raw_dt).month
            except Exception:
                month = None
    return _SEASON_OF_MONTH.get(month, 1)



async def build_payload(row: dict) -> dict:
    # Lecture sur le nouveau dataset fusionne (colonnes d'entrainement des 4 modeles)
    temp_w = float(row.get("weather_temp", row.get("temperature", 25)))
    temp_f = float(row.get("fridge_temp", row.get("fridge_temperature", 5)))
    temp_t = float(row.get("thermostat_temp", row.get("current_temperature", 25)))
    season_num = _row_season(row)
    season_name = SEASON_NAMES.get(season_num, "Inconnu")
    month = None
    raw_month = row.get("month")
    if raw_month is not None and str(raw_month).strip() not in ("", "nan"):
        try:
            month = int(float(raw_month))
        except (ValueError, TypeError):
            month = None
    if month is None:
        raw_dt = row.get("datetime")
        if raw_dt:
            try:
                month = pd.to_datetime(raw_dt).month
            except Exception:
                month = None

    payload = {
        "timestamp": datetime.now().isoformat(),
        "dataset_datetime": str(row.get("datetime", "")),
        "device_type": "multi-sensor",
        "weather_temperature": temp_w,
        "fridge_temperature": temp_f,
        "thermostat_temperature": temp_t,
        "season": season_name,
        "month": month,
    }
    return payload


async def _persist_behavioral_twin(payload: dict):
    """Persiste un snapshot complet du jumeau numerique pour /api/shap/latest."""
    try:
        async with AsyncSessionLocal() as session:
            repo = TelemetryRepository(session)
            try:
                ts = datetime.fromisoformat(payload["timestamp"])
            except Exception:
                ts = datetime.now(timezone.utc).replace(tzinfo=None)
            telemetry = Telemetry(
                device_id="multi-sensor",
                timestamp=ts,
                metric_key="behavioral_twin",
                metric_value={"registers": {
                    "temperature": payload.get("weather_temperature", 25),
                    "fridge_temperature": payload.get("fridge_temperature", 5),
                    "current_temperature": payload.get("thermostat_temperature", 25),
                }},
            )
            await repo.create(telemetry)
            await session.commit()
    except Exception:
        pass


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self._attack_active = False
        self._simulation_active = False
        self._tasks: dict[WebSocket, asyncio.Task] = {}

    def set_attack(self, active: bool):
        self._attack_active = active

    def get_attack(self) -> bool:
        return self._attack_active

    def set_simulation(self, active: bool):
        self._simulation_active = active

    def get_simulation(self) -> bool:
        return self._simulation_active

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # Chaque connexion démarre sa propre lecture du CSV depuis le début (Hiver).
        self._tasks[websocket] = asyncio.create_task(self._stream_client(websocket))

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        task = self._tasks.pop(websocket, None)
        if task:
            task.cancel()

    async def _stream_client(self, websocket: WebSocket):
        """Diffuse le flux saisonnier à UN client, en partant toujours de l'Hiver."""
        if not CSV_PATH.exists():
            logger.error("Flux de demo introuvable : %s (lancez backend/scripts/build_dataset.py)", CSV_PATH)
            try:
                await websocket.send_json({
                    "type": "error",
                    "message": "Flux de démonstration introuvable : exécutez backend/scripts/build_dataset.py",
                })
            except Exception:
                pass
            return
        csv_generator = read_csv_sequential(CSV_PATH)
        try:
            while True:
                if not self._simulation_active:
                    # Simulation éteinte : on attend, puis on relit depuis le début
                    csv_generator = read_csv_sequential(CSV_PATH)
                    try:
                        await websocket.send_json({"type": "paused", "message": "Simulation en pause"})
                    except Exception:
                        return
                    while not self._simulation_active:
                        await asyncio.sleep(0.5)
                    continue

                try:
                    row = next(csv_generator)
                except StopIteration:
                    # Fin du cycle : reprise depuis l'Hiver (le début du fichier)
                    await websocket.send_json({"type": "reset", "message": "Nouveau cycle — retour à l'Hiver"})
                    csv_generator = read_csv_sequential(CSV_PATH)
                    await asyncio.sleep(0.5)
                    continue

                payload = await build_payload(row)
                await websocket.send_json(payload)
                asyncio.create_task(_persist_behavioral_twin(payload))
                await asyncio.sleep(random.uniform(0.3, 0.8))

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Stream client error: %s", e)

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


manager = ConnectionManager()
