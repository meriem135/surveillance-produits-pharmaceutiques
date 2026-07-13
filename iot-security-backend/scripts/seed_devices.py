"""
Seed script: create 3 IoT sensor devices (Weather, Fridge, Thermostat)
with firmware versions for Phase 3 CVE matching.

Run: python scripts/seed_devices.py
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import asyncio
import uuid
from datetime import datetime
from sqlalchemy import text
from app.db.session import AsyncSessionLocal, init_db
from app.domains.devices.models import Device

DEVICES = [
    {
        "id": "dev-weather-01",
        "name": "Station Meteo - Paris",
        "device_type": "weather",
        "ip_address": "192.168.10.10",
        "mac_address": "AA:BB:CC:DD:01:01",
        "manufacturer": "PeakSoft Sensors",
        "firmware_version": "v1.3.2",
        "status": "online",
        "location": "Paris-Factory-01",
        "digital_twin_state": {"temperature": 36.4, "humidity": 45.2, "pressure": 1013.0},
    },
    {
        "id": "dev-fridge-01",
        "name": "Chambre Froide - Stockage A",
        "device_type": "fridge",
        "ip_address": "192.168.10.20",
        "mac_address": "AA:BB:CC:DD:02:02",
        "manufacturer": "PeakSoft Sensors",
        "firmware_version": "v2.0.1",
        "status": "online",
        "location": "Paris-Factory-01",
        "digital_twin_state": {"fridge_temperature": 7.0, "temp_condition": "high"},
    },
    {
        "id": "dev-thermostat-01",
        "name": "Thermostat - Atelier A",
        "device_type": "thermostat",
        "ip_address": "192.168.10.30",
        "mac_address": "AA:BB:CC:DD:03:03",
        "manufacturer": "PeakSoft Sensors",
        "firmware_version": "v3.1.0",
        "status": "online",
        "location": "Paris-Factory-01",
        "digital_twin_state": {"current_temperature": 28.9, "thermostat_status": True},
    },
]


async def seed():
    await init_db()
    async with AsyncSessionLocal() as session:
        for d in DEVICES:
            existing = await session.get(Device, d["id"])
            if existing:
                print(f"[~] Device {d['id']} existe deja, mise a jour...")
                for key, val in d.items():
                    setattr(existing, key, val)
                existing.last_seen = datetime.utcnow()
            else:
                device = Device(
                    id=d["id"],
                    name=d["name"],
                    device_type=d["device_type"],
                    ip_address=d["ip_address"],
                    mac_address=d["mac_address"],
                    manufacturer=d["manufacturer"],
                    firmware_version=d["firmware_version"],
                    status=d["status"],
                    location=d["location"],
                    last_seen=datetime.utcnow(),
                    registered_at=datetime.utcnow(),
                    risk_score=0,
                    compliance_score=100,
                    compliance_status="compliant",
                    digital_twin_state=d["digital_twin_state"],
                )
                session.add(device)
                print(f"[+] Device cree: {d['id']} ({d['name']}) - firmware {d['firmware_version']}")

        await session.commit()
    print("\n[OK] 3 devices ajoutes avec firmware !")
    print("  - Weather  : dev-weather-01  | firmware v1.3.2")
    print("  - Fridge   : dev-fridge-01   | firmware v2.0.1")
    print("  - Thermostat: dev-thermostat-01 | firmware v3.1.0")
    print("\nTu peux maintenant tester Phase 3 :")
    print("  curl http://localhost:8000/api/v1/risks/dev-weather-01")
    print("  curl http://localhost:8000/api/v1/cves/weather?firmware=v1.3.2")


if __name__ == "__main__":
    asyncio.run(seed())
