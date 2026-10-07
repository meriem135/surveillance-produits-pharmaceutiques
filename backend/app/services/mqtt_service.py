import asyncio
import json
import logging
import statistics
from collections import OrderedDict, deque
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from gmqtt import Client as MQTTClient

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.domains.devices.repository import DeviceRepository, TelemetryRepository
from app.domains.devices.models import Telemetry

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Champ de la payload multi-capteurs par capteur edge
_EDGE_FIELDS = {
    "weather": "weather_temperature",
    "fridge": "fridge_temperature",
    "thermostat": "thermostat_temperature",
}


class StepAggregator:
    """Regroupe les 3 mesures publiées séparément (un topic par capteur) pour
    un même pas de temps, puis construit la payload multi-capteurs
    (températures + dérivées + écart-type glissant météo).

    Les pas incomplets sont abandonnés après `max_pending` pas plus récents
    (message perdu), pour ne pas fuir de mémoire.
    """

    def __init__(self, max_pending: int = 50, window: int = 10):
        self._pending: "OrderedDict[str, dict]" = OrderedDict()
        self._max_pending = max_pending
        self._prev: dict | None = None
        self._weather_window: deque = deque(maxlen=window)

    @staticmethod
    def sensor_of(device: str) -> str | None:
        name = str(device).lower()
        return next((s for s in _EDGE_FIELDS if name.startswith(s)), None)

    def add(self, message: dict) -> dict | None:
        sensor = self.sensor_of(message.get("device", ""))
        if sensor is None or message.get("value") is None:
            return None
        key = str(message.get("step", message.get("timestamp", "")))
        step = self._pending.setdefault(key, {"meta": message})
        try:
            step[sensor] = float(message["value"])
        except (TypeError, ValueError):
            return None
        while len(self._pending) > self._max_pending:
            self._pending.popitem(last=False)
        if not all(s in step for s in _EDGE_FIELDS):
            return None
        del self._pending[key]
        return self._build(step)

    def _build(self, step: dict) -> dict:
        meta = step["meta"]
        self._weather_window.append(step["weather"])
        payload = {
            "timestamp": meta.get("timestamp") or datetime.now(timezone.utc).isoformat(),
            "device_type": "multi-sensor",
            "season": meta.get("season"),
            "month": meta.get("month"),
            **{field: step[s] for s, field in _EDGE_FIELDS.items()},
            "weather_roll_std_10": (statistics.pstdev(self._weather_window)
                                    if len(self._weather_window) > 1 else 0.0),
        }
        prev = self._prev
        payload["fridge_diff_1"] = step["fridge"] - prev["fridge_temperature"] if prev else 0.0
        payload["thermostat_diff_1"] = step["thermostat"] - prev["thermostat_temperature"] if prev else 0.0
        self._prev = payload
        return payload


class MqttService:
    def __init__(self):
        self.client = None
        # Configuration centralisée (core/config.py) — mêmes variables
        # que docker-compose et .env : MQTT_BROKER_URL / MQTT_BROKER_PORT
        self.host = settings.MQTT_BROKER_URL
        self.port = settings.MQTT_BROKER_PORT
        self.username = settings.MQTT_USERNAME
        self.password = settings.MQTT_PASSWORD
        self.keepalive = 60
        self.reconnect_delay = 5
        self.aggregator = StepAggregator()
        self.connected = False

    @staticmethod
    def _extract_device_id(topic: str) -> Optional[str]:
        """
        Extract device_id from topics following the pattern:
        factory/{device_id}/telemetry
        """
        parts = topic.split("/")
        if len(parts) != 3 or parts[0] != "factory" or parts[2] != "telemetry":
            logger.warning(f"⚠️ Topic '{topic}' does not match expected pattern 'factory/{{device_id}}/telemetry'")
            return None
        return parts[1]

    @staticmethod
    def _extract_metrics(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Turn a JSON payload into a list of metric dicts suitable for Telemetry rows.

        Example input:
            {"temperature": 22.5, "pressure": 1013, "timestamp": "..."}

        Output:
            [
                {"metric_key": "temperature", "metric_value": {"value": 22.5}},
                {"metric_key": "pressure", "metric_value": {"value": 1013}},
            ]
        """
        metrics: List[Dict[str, Any]] = []
        for key, value in payload.items():
            if key == "timestamp":
                # Timestamp is handled separately
                continue

            metric_value: Dict[str, Any]
            if isinstance(value, dict):
                metric_value = value
            else:
                metric_value = {"value": value}

            metrics.append(
                {
                    "metric_key": key,
                    "metric_value": metric_value,
                }
            )

        return metrics

    def on_connect(self, client, flags, rc, properties):
        self.connected = True
        logger.info(f"✅ Connected to MQTT broker at {self.host}:{self.port}")
        # Subscribe to telemetry topics
        client.subscribe("factory/+/telemetry", qos=1)
        logger.info("📡 Subscribed to factory/+/telemetry")

    def on_message(self, client, topic, payload, qos, properties):
        logger.debug(f"📩 Received MQTT message on {topic}")
        try:
            data = json.loads(payload.decode())
            logger.debug(f"📄 Payload: {data}")

            # Capteur edge (une mesure par topic) : les 3 capteurs du même pas
            # sont regroupés en une payload multi-capteurs.
            if "device" in data and "value" in data:
                step = self.aggregator.add(data)
                if step:
                    logger.debug("📦 Pas complet (3 capteurs) : %s", step)

            # Schedule async processing to avoid blocking the MQTT callback
            asyncio.create_task(self._process_telemetry_message(topic, data))
        except Exception as e:
            logger.error(f"❌ Failed to parse MQTT payload: {e}")

    async def _process_telemetry_message(self, topic: str, data: Dict[str, Any]) -> None:
        """
        Async handler for parsed MQTT telemetry messages.
        - Extracts device_id from topic.
        - Normalizes timestamp.
        - Breaks payload into Telemetry rows and persists them.
        """
        device_id = self._extract_device_id(topic)
        if not device_id:
            logger.warning(f"⚠️ Skipping telemetry persistence for topic '{topic}' (no device_id)")
            return

        # Determine timestamp: prefer payload-provided, fallback to server time (UTC, naive)
        timestamp = datetime.now(timezone.utc).replace(tzinfo=None)
        raw_ts = data.get("timestamp")
        if isinstance(raw_ts, str):
            try:
                # Support ISO 8601 with optional 'Z'
                ts_normalized = raw_ts.replace("Z", "+00:00")
                parsed_ts = datetime.fromisoformat(ts_normalized)
                # Convert to UTC and drop tzinfo so it matches TIMESTAMP WITHOUT TIME ZONE
                if parsed_ts.tzinfo is not None:
                    timestamp = parsed_ts.astimezone(timezone.utc).replace(tzinfo=None)
                else:
                    timestamp = parsed_ts
            except Exception:
                logger.warning(
                    f"⚠️ Invalid timestamp '{raw_ts}' for device '{device_id}', "
                    "using server receive time instead"
                )

        if "device" in data and "value" in data:
            # Message d'un capteur edge : une seule mesure de température
            metrics = [{
                "metric_key": "temperature",
                "metric_value": {k: data.get(k) for k in ("value", "step", "month", "season")},
            }]
        else:
            metrics = self._extract_metrics(data)
        if not metrics:
            logger.warning(f"⚠️ No metric fields found in payload for device '{device_id}', nothing to store")
            return

        # Persist telemetry metrics and update Digital Twin state
        async with AsyncSessionLocal() as session:
            device_repo = DeviceRepository(session)
            tele_repo = TelemetryRepository(session)
            try:
                # 1. Store individual metric rows
                for metric in metrics:
                    telemetry = Telemetry(
                        device_id=device_id,
                        timestamp=timestamp,
                        metric_key=metric["metric_key"],
                        metric_value=metric["metric_value"],
                    )
                    await tele_repo.create(telemetry)

                # 2. Update the Device (Digital Twin) state
                device = await device_repo.get(device_id)
                
                if device:
                    # Update last seen
                    device.last_seen = timestamp
                    
                    # Update digital twin state (merge new metrics)
                    new_state = {**device.digital_twin_state}
                    for metric in metrics:
                        key = metric["metric_key"]
                        val = metric["metric_value"].get("value")
                        if val is not None:
                            new_state[key] = val
                    
                    # Also record the latest overall status if present
                    if "status" in data:
                        new_state["status"] = data["status"]
                        
                    await device_repo.update(device, {"digital_twin_state": new_state, "last_seen": timestamp})
                    logger.debug(f"🔄 Synced Digital Twin state for device '{device_id}'")
                else:
                    logger.warning(f"⚠️ Received telemetry for unknown device '{device_id}'")

                await session.commit()
                logger.debug(
                    f"💾 Stored {len(metrics)} telemetry metric(s) for device '{device_id}' "
                    f"from topic '{topic}'"
                )
            except Exception as e:
                await session.rollback()
                logger.error(f"❌ Failed to process telemetry for device '{device_id}': {e}")

    def on_disconnect(self, client, packet, exc=None):
        self.connected = False
        logger.warning("⚠️ Disconnected from MQTT broker")

    def on_subscribe(self, client, mid, qos, properties):
        logger.info("✅ Successfully subscribed to topic")

    async def start(self):
        """Initialize and start the MQTT client"""
        self.client = MQTTClient("iot-backend-subscriber")
        
        # Callbacks
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.client.on_disconnect = self.on_disconnect
        self.client.on_subscribe = self.on_subscribe
        
        # Authentication
        # Note: Day 1 setup currently uses allow_anonymous true, 
        # but we prepare for credentials here.
        if self.username and self.password:
            self.client.set_auth_credentials(self.username, self.password)

        logger.info(f"🔌 Connecting to MQTT broker at {self.host}...")
        
        try:
            await asyncio.wait_for(
                self.client.connect(self.host, self.port, keepalive=self.keepalive),
                timeout=5.0
            )
        except asyncio.TimeoutError:
            logger.error("❌ MQTT Connection timed out after 5s")
        except Exception as e:
            logger.error(f"❌ MQTT Connection failed: {e}")
            # In a real app, we might want to implement a reconnect loop here
            # but gmqtt handles base reconnections if connected once.
            return

    async def stop(self):
        """Gracefully stop the MQTT client"""
        if self.client and self.connected:
            try:
                await asyncio.wait_for(self.client.disconnect(), timeout=3.0)
                logger.info("🔌 MQTT client disconnected")
            except Exception as e:  # noqa: BLE001
                logger.warning(f"MQTT disconnect: {e}")

# Singleton instance
mqtt_service = MqttService()
