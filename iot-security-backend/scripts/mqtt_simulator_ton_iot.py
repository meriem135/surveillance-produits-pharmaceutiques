"""
Simulateur de streaming temps réel — Dataset Annuel Généré (Phase 3)
====================================================================
Lit le fichier generated_yearly_merged.csv et publie en continu sur MQTT
des extraits aléatoires normaux/attaques pour chaque saison.

Architecture :
  - Un coroutine asyncio par device
  - Chaque device pioche aléatoirement dans le pool saisonnier correspondant
  - Mode attack : injection d'anomalies réalistes sur les données normales
  - TimeController : accélération temporelle pour simuler 5 jours ou 1 année

Topics publiés :
  factory/{device_name}/telemetry

Usage :
  python scripts/mqtt_simulator_ton_iot.py
  python scripts/mqtt_simulator_ton_iot.py --host localhost --port 1883
  python scripts/mqtt_simulator_ton_iot.py --mode normal
  python scripts/mqtt_simulator_ton_iot.py --mode attack
  python scripts/mqtt_simulator_ton_iot.py --mode mixed
  python scripts/mqtt_simulator_ton_iot.py --duration 1y --speed 8760
"""

import argparse
import asyncio
import json
import logging
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import pandas as pd
import paho.mqtt.client as mqtt

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

YEARLY_CSV = Path(
    os.getenv(
        "YEARLY_CSV_PATH",
        r"C:\peaksoft-security-platform-main\peaksoft-security-platform-main"
        r"\iot-security-backend\Data\Generated\generated_yearly_merged.csv",
    )
)

DEVICES = ["weather", "fridge", "thermostat"]

SENSOR_COLUMNS = {
    "weather":    "temperature",
    "fridge":     "fridge_temperature",
    "thermostat": "current_temperature",
}

ATTACK_TYPES = [
    "backdoor", "DDoS", "DoS", "Injection",
    "MITM", "password", "runsomware", "scanning", "XSS",
]

ATTACK_EXPLANATIONS = {
    "backdoor":   "Backdoor détectée : communication sortante vers IP suspecte.",
    "DDoS":       "DDoS détecté : rafale anormale de requêtes (> 50 msg/s).",
    "DoS":        "DoS détecté : saturation du broker par paquets volumineux.",
    "Injection":  "Injection de payload détectée : séquences d'échappement dans le message.",
    "MITM":       "Man-in-the-Middle détecté : certificat TLS modifié.",
    "password":   "Force brute détectée : > 10 échecs d'authentification en 1 min.",
    "runsomware": "Ransomware détecté : valeurs aberrantes monotones dans les registres.",
    "scanning":   "Scan réseau détecté : balayage de topics MQTT inexistants.",
    "XSS":        "XSS détecté : balises HTML/JavaScript dans le payload.",
}


def inject_anomaly(base_value: float, attack_type: str, noise: float = 0.0) -> float:
    if base_value is None or pd.isna(base_value):
        return base_value
    if attack_type in ("DDoS", "DoS"):
        return base_value * random.uniform(1.5, 3.0) + random.uniform(-2, 2)
    elif attack_type == "backdoor":
        return base_value + random.uniform(-0.5, 0.5)
    elif attack_type == "Injection":
        return base_value * random.uniform(0.1, 0.3) + random.uniform(5, 15)
    elif attack_type == "MITM":
        return base_value + random.uniform(-1.0, 1.0) + noise
    elif attack_type == "runsomware":
        return base_value + random.uniform(2.0, 5.0)
    elif attack_type == "scanning":
        return base_value * random.uniform(0.8, 1.2)
    elif attack_type == "XSS":
        return base_value + random.uniform(-0.3, 0.3)
    elif attack_type == "password":
        return base_value + random.uniform(-0.2, 0.2)
    return base_value


class SeasonalPool:
    def __init__(self, csv_path: Path):
        logger.info("Chargement du dataset annuel : %s", csv_path)
        self.df = pd.read_csv(csv_path)
        self.df["timestamp"] = pd.to_datetime(self.df["timestamp"])
        logger.info("  %d lignes chargées", len(self.df))

        self._by_season = {}
        for season_id in sorted(self.df["season"].unique()):
            subset = self.df[self.df["season"] == season_id]
            season_name = {1: "hiver", 2: "printemps", 3: "ete", 4: "automne"}.get(season_id, season_id)
            logger.info("  Saison %d (%s) : %d lignes", season_id, season_name, len(subset))
            self._by_season[season_id] = subset.reset_index(drop=True)

    def get_season(self, simulated_date: datetime) -> int:
        month = simulated_date.month
        if month in (12, 1, 2):
            return 1
        elif month in (3, 4, 5):
            return 2
        elif month in (6, 7, 8):
            return 3
        else:
            return 4

    def sample(self, season_id: int, device: str, label: str, attack_type: str = "") -> dict:
        pool = self._by_season.get(season_id, self.df)
        if len(pool) == 0:
            pool = self.df
        row = pool.sample(n=1).iloc[0]

        sensor_col = SENSOR_COLUMNS[device]
        base_temp = row[sensor_col]

        if label == "attack":
            sensor_value = inject_anomaly(base_temp, attack_type)
        else:
            sensor_value = float(base_temp) + random.uniform(-0.3, 0.3)

        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "device_type": device,
            sensor_col: round(sensor_value, 2),
            "temperature": float(row["temperature"]),
            "fridge_temperature": float(row["fridge_temperature"]),
            "current_temperature": float(row["current_temperature"]),
            "season": int(row["season"]),
            "month": int(row["month"]),
            "day": int(row["day"]),
            "hour": int(row["hour"]),
            "day_type": row["day_type"],
            "label": label,
            "attack_type": attack_type,
            "attack_explanation": ATTACK_EXPLANATIONS.get(attack_type, ""),
            "noise_factor": round(random.uniform(0.0, 0.06), 4),
            "packet_loss_sim": random.choices([0, 1], weights=[95, 5])[0],
        }
        return payload


class TimeController:
    def __init__(self, duration: str = None, speed: float = 1.0):
        self.speed = speed
        self.start_real = time.time()
        self.start_simulated = datetime.now(timezone.utc)

        if duration:
            unit = duration[-1]
            val = int(duration[:-1])
            if unit == "d":
                self.max_duration_real = val * 24 * 3600 / speed
            elif unit == "y":
                self.max_duration_real = val * 365 * 24 * 3600 / speed
            elif unit == "h":
                self.max_duration_real = val * 3600 / speed
            else:
                self.max_duration_real = None
        else:
            self.max_duration_real = None

    @property
    def simulated_elapsed(self) -> float:
        return (time.time() - self.start_real) * self.speed

    @property
    def simulated_now(self) -> datetime:
        return self.start_simulated + __import__("datetime").timedelta(seconds=self.simulated_elapsed)

    @property
    def is_expired(self) -> bool:
        if self.max_duration_real is None:
            return False
        return (time.time() - self.start_real) >= self.max_duration_real

    @property
    def progress_pct(self) -> float:
        if self.max_duration_real is None:
            return 0
        return min(100, (time.time() - self.start_real) / self.max_duration_real * 100)

    def get_delay(self, base_min: float, base_max: float) -> float:
        return random.uniform(base_min, base_max) / self.speed


def connect_mqtt(host: str, port: int) -> mqtt.Client:
    client = mqtt.Client(client_id="ton-iot-simulator-annual")

    def on_connect(c, userdata, flags, rc):
        if rc == 0:
            logger.info("Connecte au broker MQTT %s:%d", host, port)
        else:
            logger.error("Connexion MQTT echouee (rc=%d)", rc)

    def on_disconnect(c, userdata, rc):
        logger.warning("Deconnecte du broker MQTT (rc=%d)", rc)

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect

    try:
        client.connect(host, port, keepalive=60)
    except Exception as e:
        logger.error("Impossible de se connecter a %s:%d — %s", host, port, e)
        sys.exit(1)

    client.loop_start()
    return client


async def stream_device(
    mqtt_client: mqtt.Client,
    pool: SeasonalPool,
    device_name: str,
    label: str,
    delay_min: float,
    delay_max: float,
    time_ctrl: Optional[TimeController] = None,
    attack_type: str = "",
) -> None:
    topic = f"factory/{device_name}/telemetry"
    logger.info("Streaming demarre : %s → %s [label=%s, attack=%s]", device_name, topic, label, attack_type or "none")

    while True:
        if time_ctrl and time_ctrl.is_expired:
            logger.info("Duree atteinte, arret du device %s", device_name)
            break

        season_id = pool.get_season(time_ctrl.simulated_now) if time_ctrl else random.randint(1, 4)
        row = pool.sample(season_id, device_name, label, attack_type=attack_type)

        if time_ctrl:
            row["simulated_timestamp"] = time_ctrl.simulated_now.isoformat()
            row["simulation_progress"] = round(time_ctrl.progress_pct, 1)

        payload_json = json.dumps(row, default=str)
        result = mqtt_client.publish(topic, payload_json, qos=1)

        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            logger.debug(" %s → %s", device_name, label)
        else:
            logger.warning("Echec publication %s (rc=%d)", topic, result.rc)

        delay = time_ctrl.get_delay(delay_min, delay_max) if time_ctrl else random.uniform(delay_min, delay_max)
        await asyncio.sleep(delay)


async def run(args: argparse.Namespace) -> None:
    client = connect_mqtt(args.host, args.port)
    pool = SeasonalPool(YEARLY_CSV)
    time_ctrl = TimeController(duration=args.duration, speed=args.speed) if args.duration else None

    await asyncio.sleep(1.0)

    tasks = []

    if args.mode in ("normal", "mixed"):
        for device_name in DEVICES:
            tasks.append(
                asyncio.create_task(
                    stream_device(client, pool, device_name, "normal",
                                  args.delay_min, args.delay_max, time_ctrl)
                )
            )

    if args.mode in ("attack", "mixed"):
        for device_name in DEVICES:
            attack_type = random.choice(ATTACK_TYPES)
            tasks.append(
                asyncio.create_task(
                    stream_device(client, pool, f"{device_name}_attack", "attack",
                                  args.delay_min, args.delay_max, time_ctrl,
                                  attack_type=attack_type)
                )
            )

    if not tasks:
        logger.error("Aucun device a simuler. Verifiez --mode.")
        return

    duration_str = f"duree={args.duration}, speed={args.speed}x" if args.duration else "infini"
    logger.info(
        "Simulateur annuel demarre — %d devices [mode=%s, %s]",
        len(tasks), args.mode, duration_str,
    )

    try:
        await asyncio.gather(*tasks)
        logger.info("Simulation terminee")
    except asyncio.CancelledError:
        logger.info("Simulateur arrete.")
    finally:
        client.loop_stop()
        client.disconnect()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Simulateur streaming temps reel depuis le dataset annuel genere"
    )
    parser.add_argument("--host", default=os.getenv("MQTT_HOST", "localhost"),
                        help="Adresse du broker MQTT (defaut: localhost)")
    parser.add_argument("--port", type=int, default=int(os.getenv("MQTT_PORT", "1883")),
                        help="Port du broker MQTT (defaut: 1883)")
    parser.add_argument("--delay-min", type=float, default=0.3, dest="delay_min",
                        help="Delai minimum entre messages (defaut: 0.3)")
    parser.add_argument("--delay-max", type=float, default=1.5, dest="delay_max",
                        help="Delai maximum entre messages (defaut: 1.5)")
    parser.add_argument("--mode", choices=["normal", "attack", "mixed"], default="mixed",
                        help="Mode de simulation (defaut: mixed)")
    parser.add_argument("--duration", type=str, default=None,
                        help="Duree a simuler (ex: 5d, 1y, 24h). Defaut: infini")
    parser.add_argument("--speed", type=float, default=1.0,
                        help="Facteur d'acceleration (defaut: 1.0)")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        logger.info("Simulateur interrompu par l'utilisateur.")
