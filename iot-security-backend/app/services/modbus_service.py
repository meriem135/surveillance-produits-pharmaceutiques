import asyncio
import os
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pymodbus.client import AsyncModbusTcpClient
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.domains.devices.repository import DeviceRepository, TelemetryRepository
from app.domains.devices.models import Telemetry

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ModbusService:
    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.polling_interval = settings.MODBUS_POLLING_INTERVAL
        # Default simulator mapping for Day 6/7
        self.devices_to_poll = [
            {
                "id": "dev-weather-01",
                "host": settings.MODBUS_HOST,
                "port": settings.MODBUS_PORT,
                "unit": 1
            }
        ]

    async def _poll_device(self, device_config: Dict[str, Any]):
        """
        Poll a single Modbus device and process its registers.
        """
        device_id = device_config["id"]
        host = device_config["host"]
        port = device_config["port"]
        unit = device_config["unit"]

        logger.debug(f"🔍 Polling Modbus device '{device_id}' at {host}:{port} (unit {unit})...")
        
        client = AsyncModbusTcpClient(host, port=port)
        try:
            connected = await client.connect()
            if not connected:
                logger.error(f"❌ Failed to connect to Modbus device '{device_id}' at {host}:{port}")
                return

            # Read holding registers 0-2 (Temp, Pressure, Status)
            rr = await client.read_holding_registers(0, 3, slave=unit)
            if rr.isError():
                logger.error(f"❌ Modbus error reading registers from '{device_id}': {rr}")
                return

            registers = rr.registers
            # Register 0: Temp (0.1 units)
            temperature = registers[0] / 10.0
            # Register 1: Pressure
            pressure = registers[1]
            # Register 2: Status
            status_code = registers[2]
            status_map = {0: "ok", 1: "warning", 2: "error"}
            status = status_map.get(status_code, "unknown")

            logger.info(f"📊 Polled '{device_id}': Temp={temperature}, Press={pressure}, Status={status}")

            # Process and persist
            await self._process_modbus_data(device_id, {
                "temperature": temperature,
                "pressure": pressure,
                "status": status
            })

        except Exception as e:
            logger.error(f"❌ Error polling Modbus device '{device_id}': {e}")
        finally:
            client.close()

    async def _process_modbus_data(self, device_id: str, data: Dict[str, Any]):
        """
        Normalize and persist Modbus data, update Digital Twin.
        """
        timestamp = datetime.utcnow()
        
        metrics = []
        for key, value in data.items():
            if key != "status": # Status is handled differently in twin state
                metrics.append({
                    "metric_key": key,
                    "metric_value": {"value": value}
                })

        async with AsyncSessionLocal() as session:
            device_repo = DeviceRepository(session)
            tele_repo = TelemetryRepository(session)
            try:
                # 1. Store Telemetry
                for metric in metrics:
                    telemetry = Telemetry(
                        device_id=device_id,
                        timestamp=timestamp,
                        metric_key=metric["metric_key"],
                        metric_value=metric["metric_value"],
                    )
                    await tele_repo.create(telemetry)

                # 2. Update Digital Twin
                device = await device_repo.get(device_id)
                
                if device:
                    device.last_seen = timestamp
                    new_state = {**device.digital_twin_state}
                    for metric in metrics:
                        new_state[metric["metric_key"]] = metric["metric_value"]["value"]
                    
                    new_state["status"] = data["status"]
                    update_data = {
                        "digital_twin_state": new_state,
                        "status": "online",
                        "last_seen": timestamp
                    }
                    await device_repo.update(device, update_data)
                    logger.debug(f"🔄 Updated Digital Twin for Modbus device '{device_id}'")
                else:
                    logger.warning(f"⚠️ Received Modbus data for unknown device '{device_id}'")

                await session.commit()
            except Exception as e:
                await session.rollback()
                logger.error(f"❌ Failed to persist Modbus data for '{device_id}': {e}")

    async def start(self):
        """
        Start the Modbus polling scheduler.
        """
        logger.info(f"⏱️ Starting Modbus service (polling every {self.polling_interval}s)...")
        
        for device_config in self.devices_to_poll:
            self.scheduler.add_job(
                self._poll_device,
                'interval',
                seconds=self.polling_interval,
                args=[device_config],
                id=f"poll_{device_config['id']}",
                replace_existing=True
            )
        
        self.scheduler.start()

    async def stop(self):
        """
        Stop the Modbus polling scheduler.
        """
        logger.info("🛑 Stopping Modbus service...")
        self.scheduler.shutdown()

# Singleton instance
modbus_service = ModbusService()
