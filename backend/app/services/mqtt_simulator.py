# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/services/mqtt_simulator.py
#   SIMULATEUR DE CAPTEURS : publie le flux de démo sur MQTT comme de vrais capteurs (option
#   ENABLE_EDGE_SIMULATOR).
# ══════════════════════════════════════════════════════════════════════════
"""
Simulateur de capteurs edge (Industrie 4.0) — publication MQTT
===============================================================
Rejoue le CSV saisonnier multi-capteurs en publiant chaque capteur
sur son propre topic MQTT, comme dans une usine réelle :

    factory/weather-01/telemetry      → température extérieure
    factory/fridge-01/telemetry       → chaîne du froid
    factory/thermostat-01/telemetry   → chauffage

Chaque "capteur" n'émet QUE sa propre mesure (et ses métadonnées) ;
c'est le broker Mosquitto qui centralise, et le backend qui agrège
les 3 lectures du même pas de temps.

Le format de chaque message :
    {
      "device": "weather-01" | "fridge-01" | "thermostat-01",
      "value": <mesure brute °C>,
      "step": <pas de temps> (identifiant commun des 3 capteurs),
      "month": <1..12>,
      "season": <nom de saison>,
      "timestamp": <horodatage ISO>
    }
"""

import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path

from gmqtt import Client as MQTTClient

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent.parent

SEASON_NAMES = {1: "Hiver", 2: "Printemps", 3: "Été", 4: "Automne"}
_SEASON_OF_MONTH = {1: 1, 2: 1, 3: 2, 4: 2, 5: 2, 6: 3, 7: 3, 8: 3, 9: 4, 10: 4, 11: 4, 12: 1}

# Capteurs publiés par le simulateur edge (3 machines d'usine).
# key = sous-topic (device id), csv_key = colonne température du CSV.
EDGE_SENSORS = [
    {"device": "weather-01",    "csv_key": "weather_temp",    "csv_key_deriv": "weather_diff_1"},
    {"device": "fridge-01",     "csv_key": "fridge_temp",     "csv_key_deriv": "fridge_diff_1"},
    {"device": "thermostat-01", "csv_key": "thermostat_temp", "csv_key_deriv": "thermostat_diff_1"},
]


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _num
#   Rôle   : Convertit une valeur en nombre (valeur par défaut si vide).
#   Entrée : val ; default
#   Sortie : float
# ──────────────────────────────────────────────────────────────────────
def _num(val, default=None):
    try:
        if val is None or str(val).strip() in ("", "nan"):
            return default
        return float(val)
    except (ValueError, TypeError):
        return default


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _season_of
#   Rôle   : Nom de la saison d'un mois.
#   Entrée : month
#   Sortie : texte
# ──────────────────────────────────────────────────────────────────────
def _season_of(month):
    return SEASON_NAMES.get(_SEASON_OF_MONTH.get(month, 1), "Inconnu")


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] MqttSimulator
#   Rôle   : SIMULATEUR DE CAPTEURS : publie le flux de démo sur MQTT, comme de vrais capteurs.
# ──────────────────────────────────────────────────────────────────────
class MqttSimulator:
    """Publie le flux saisonnier multi-capteurs vers le broker Mosquitto."""

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] MqttSimulator.__init__
    #   Rôle   : Retient l'adresse du broker et le fichier CSV à rejouer.
    #   Entrée : host, port, csv_path…
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    def __init__(self, host: str, port: int, csv_path: Path, username: str = "", password: str = ""):
        self.host = host
        self.port = port
        self.csv_path = csv_path
        self.username = username
        self.password = password
        self.client: MQTTClient | None = None
        self.running = False

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] MqttSimulator.connect
    #   Rôle   : Se connecte au broker.
    #   Entrée : rien
    #   Sortie : vrai si connecté
    # ──────────────────────────────────────────────────────────────────────
    async def connect(self) -> bool:
        """Se connecte au broker. Retourne True si la connexion aboutit."""
        self.client = MQTTClient("edge-simulator")
        try:
            if self.username:
                self.client.set_auth_credentials(self.username, self.password)
            await asyncio.wait_for(
                self.client.connect(self.host, self.port, keepalive=30),
                timeout=5.0,
            )
            logger.info("Edge simulator connected to MQTT at %s:%s", self.host, self.port)
            return True
        except Exception as e:  # noqa: BLE001
            logger.warning("Edge simulator: MQTT connection failed: %s", e)
            return False

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] MqttSimulator._topic
    #   Rôle   : Topic MQTT d'un capteur.
    #   Entrée : device
    #   Sortie : factory/<capteur>/telemetry
    # ──────────────────────────────────────────────────────────────────────
    def _topic(self, device: str):
        return f"factory/{device}/telemetry"

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] MqttSimulator.stream
    #   Rôle   : Lit le CSV et publie les 3 capteurs, une ligne par pas de temps.
    #   Entrée : step_delay : pause entre deux pas
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    async def stream(self, step_delay: float = 0.35) -> None:
        """Lit le CSV et publie chaque ligne (3 capteurs) sur MQTT, une fois par pas."""
        if self.client is None:
            return
        import csv as _csv

        step = 0
        while self.running:
            try:
                with open(self.csv_path, "r", encoding="utf-8") as f:
                    reader = _csv.DictReader(f)
                    for row in reader:
                        if not self.running:
                            return
                        month = int(float(row["month"])) if str(row.get("month", "")).strip() not in ("", "nan") else None
                        season = _season_of(month)
                        ts = datetime.now().isoformat()
                        step += 1
                        for s in EDGE_SENSORS:
                            value = _num(row.get(s["csv_key"]))
                            if value is None:
                                continue
                            msg = {
                                "device": s["device"],
                                "value": value,
                                "step": step,
                                "month": month,
                                "season": season,
                                "timestamp": ts,
                            }
                            self.client.publish(
                                self._topic(s["device"]),
                                json.dumps(msg),
                                qos=1,
                            )
                        await asyncio.sleep(step_delay)
                # Fin de fichier → boucle à nouveau au démarrage
                if not self.running:
                    return
            except FileNotFoundError:
                logger.warning("Edge simulator: CSV introuvable (%s)", self.csv_path)
                return
            except Exception as e:  # noqa: BLE001
                logger.error("Edge simulator: erreur de lecture CSV: %s", e)
                return

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] MqttSimulator.start
    #   Rôle   : Se connecte puis lance la publication en arrière-plan.
    #   Entrée : step_delay
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    async def start(self, step_delay: float = 0.35) -> None:
        if not await self.connect():
            return
        self.running = True
        # Démarrer le flux en arrière-plan
        asyncio.create_task(self.stream(step_delay))

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] MqttSimulator.stop
    #   Rôle   : Arrête la publication et se déconnecte.
    #   Entrée : rien
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    async def stop(self) -> None:
        self.running = False
        if self.client is not None:
            try:
                await self.client.disconnect()
            except Exception:  # noqa: BLE001
                pass
            self.client = None
