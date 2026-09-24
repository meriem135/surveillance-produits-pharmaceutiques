"""
Service de streaming temps reel — Phase 1 v5
============================================
- Lit le CSV d'extraits saisonniers (genere depuis dataset_fusionne.csv) SEQUENTIELLEMENT
  (saison par saison : Hiver -> Printemps -> Ete -> Automne, ordre chronologique)
- Applique UNIQUEMENT les regles DPI pour decider si chaque point est normal ou anomalie
  (aucune utilisation du label d'attaque du dataset, aucun score de modele ML)
- Diffuse les resultats (telemetrie + alertes DPI) via WebSocket

Le flux est genere en amont par :
    Code/generation_extraits_saisonniers.py
qui lit Data/Processed/dataset_fusionne.csv (le dataset annuel d'entrainement)
et produit data/generated/extraits_saisonniers_fusionne.csv.
"""

import asyncio
import csv
import random
import pandas as pd
from datetime import datetime, timezone
from pathlib import Path
from fastapi import WebSocket, WebSocketDisconnect

from app.domains.intelligence.mqtt_dpi_service import dpi_service, compute_risk_score, _risk_level

from app.db.session import AsyncSessionLocal
from app.domains.devices.models import Telemetry
from app.domains.devices.repository import TelemetryRepository

BASE_DIR = Path(__file__).resolve().parent.parent.parent
# Flux saisonnier genere depuis dataset_fusionne.csv (voir Code/generation_extraits_saisonniers.py)
CSV_PATH = BASE_DIR.parent / "data" / "generated" / "extraits_saisonniers_fusionne.csv"


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
    # Le label d'attaque du dataset n'est AUCUNE influence sur la decision :
    # la decision anomalie/normale est confiee uniquement aux regles DPI.
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

    def _num(key, default=None):
        try:
            v = row.get(key)
            if v is None or str(v).strip() in ("", "nan"):
                return default
            return float(v)
        except (ValueError, TypeError):
            return default

    payload = {
        "timestamp": datetime.now().isoformat(),
        "dataset_datetime": str(row.get("datetime", "")),
        "device_type": "multi-sensor",
        "weather_temperature": temp_w,
        "fridge_temperature": temp_f,
        "thermostat_temperature": temp_t,
        # Champs de derivee utilises par les regles DPI (variation, instabilite)
        # — lus depuis le dataset mais sans jamais utiliser le label d'attaque.
        "fridge_diff_1": _num("fridge_diff_1"),
        "thermostat_diff_1": _num("thermostat_diff_1"),
        "weather_roll_std_10": _num("weather_roll_std_10"),
        "season": season_name,
        "month": month,
        "is_anomaly": False,
    }
    # NB: le verdict anomalie/normale est determine dans la boucle de streaming
    # par dpi_service.inspect_payload(payload) (regles DPI uniquement).
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
        self.simulation_started_at: str | None = None
        self._tasks: dict[WebSocket, asyncio.Task] = {}

    def set_attack(self, active: bool):
        self._attack_active = active

    def get_attack(self) -> bool:
        return self._attack_active

    def set_simulation(self, active: bool):
        self._simulation_active = active
        if active:
            self.simulation_started_at = datetime.now(timezone.utc).isoformat()
        else:
            self.simulation_started_at = None

    def get_simulation(self) -> bool:
        return self._simulation_active

    def get_simulation_session(self) -> dict:
        """Heure de début de la session de simulation en cours."""
        return {
            "active": self._simulation_active,
            "started_at": self.simulation_started_at,
        }

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
        csv_generator = read_csv_sequential(CSV_PATH)
        # État DPI isolé pour cette connexion (chaque client repart de l'Hiver)
        saved_prev = dict(dpi_service._prev_payloads)
        dpi_service._prev_payloads = {}
        # Persistance : compteur de répétitions consécutives par règle (pour la composante persistance du risque)
        consecutive: dict[str, int] = {}
        try:
            while True:
                if not self._simulation_active:
                    # Simulation éteinte : on attend, puis on relit depuis le début
                    csv_generator = read_csv_sequential(CSV_PATH)
                    dpi_service._prev_payloads = {}
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
                    dpi_service._prev_payloads = {}
                    consecutive.clear()
                    await asyncio.sleep(0.5)
                    continue

                payload = await build_payload(row)

                # Verdict DPI : règles/gestion de seuils seules, aucun modèle ML, aucun label du dataset
                dpi_alert = dpi_service.inspect_payload(payload)

                attack_active = bool(dpi_alert)
                payload["is_anomaly"] = attack_active
                payload["normality_score"] = 30 if attack_active else 100
                payload["attack_active"] = attack_active

                risk_score = 0
                if attack_active:
                    rule_id = dpi_alert.get("rule", {}).get("id", "")
                    consecutive[rule_id] = consecutive.get(rule_id, 0) + 1
                    recurrences = max(0, consecutive[rule_id] - 1)
                    risk_score = compute_risk_score(dpi_alert, payload, recurrences)
                else:
                    consecutive.clear()
                payload["risk_score"] = risk_score
                payload["risk_label"] = _risk_level(risk_score)

                if dpi_alert:
                    dpi_service.send_to_wazuh(dpi_alert)

                if attack_active:
                    rule_id = dpi_alert.get("rule", {}).get("id", "")
                    info = DPI_ATTACK_INFO.get(rule_id, {})
                    payload["attack_info"] = {
                        "type": info.get("type", rule_id),
                        "explanation": info.get("explanation", dpi_alert.get("rule", {}).get("description", "")),
                    }
                    payload["match_detail"] = dpi_alert.get("data", {}).get("match_detail", {})
                    payload["recommendation"] = dpi_alert.get("data", {}).get("recommendation", {})
                elif "attack_info" in payload:
                    del payload["attack_info"]
                    payload.pop("match_detail", None)
                    payload.pop("recommendation", None)

                point = {
                    **payload,
                    "dpi_alert": dpi_alert,
                    "dpi_stats": dpi_service.stats.snapshot(),
                }
                await websocket.send_json(point)
                asyncio.create_task(_persist_behavioral_twin(point))
                await asyncio.sleep(random.uniform(0.3, 0.8))

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Stream client error: %s", e)
        finally:
            dpi_service._prev_payloads = saved_prev

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
        """Conservé pour compatibilité (déprécié : remplacé par le streaming par client)."""
        await asyncio.sleep(1)


import logging
logger = logging.getLogger(__name__)

DPI_ATTACK_INFO = {
    "DPI-001": {
        "type": "Variation brutale de temperature",
        "explanation": "La temperature d'un capteur a change brutalement entre deux mesures. "
                       "Seuil adapte a chaque capteur : weather (14C), frigo (5C), thermostat (16C). "
                       "Cela peut indiquer un capteur defaillant, un incendie naissant, ou un attaquant qui modifie les donnees."
    },
    "DPI-002": {
        "type": "Derive du frigo (chaine du froid)",
        "explanation": "La temperature du frigo depasse 9.5°C alors qu'il doit rester stable autour de 7°C (σ≈0.5). "
                       "Une sonde defaillante, une coupure du froid, ou une falsification massive de la mesure."
    },
    "DPI-003": {
        "type": "Saut brutal du thermostat",
        "explanation": "Le thermostat a effectue un saut superieur a 2.5°C en un pas (σ reel ≈0.6°C). "
                       "Rampe d'attaque violente, cycle force du chauffage, ou injection de donnees."
    },
    "DPI-004": {
        "type": "Instabilite meteo extreme",
        "explanation": "L'ecart-type glissant (10 mesures) de la meteo depasse 2.2 alors qu'il vaut ~0.47 en normal. "
                       "Dérive extremement brutale de la mesure exterieure, injection de valeurs aberrantes."
    },
}

manager = ConnectionManager()
