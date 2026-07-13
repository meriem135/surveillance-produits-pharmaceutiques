import uuid
from datetime import datetime
from typing import List, Optional
from app.domains.devices.models import Device, Telemetry
from app.domains.devices.repository import DeviceRepository, TelemetryRepository
from app.domains.devices.schemas import DeviceCreate, DeviceUpdate
from app.domains.intelligence.service import IntelligenceService
from app.domains.intelligence.risk_service import risk_engine

class DeviceService:
    def __init__(
        self, 
        device_repo: DeviceRepository, 
        telemetry_repo: TelemetryRepository,
        intelligence_service: IntelligenceService
    ):
        self.device_repo = device_repo
        self.telemetry_repo = telemetry_repo
        self.intelligence_service = intelligence_service

    async def get_all_with_risk(self, status: Optional[str] = None, device_type: Optional[str] = None) -> List[Device]:
        devices = await self.device_repo.get_with_filters(status, device_type)
        
        for device in devices:
            if device.ip_address:
                try:
                    risk = await risk_engine.compute_risk(
                        device_id=device.id,
                        device_type=device.device_type,
                        firmware_version=device.firmware_version,
                        location=device.location,
                        ml_telemetry=device.digital_twin_state,
                    )
                    device.risk_score = min(100, max(0, int(risk.score)))
                except Exception:
                    risk_score = 0
                    try:
                        risk_score = await self.intelligence_service.get_risk_score(device.ip_address)
                    except Exception:
                        pass
                    device.risk_score = risk_score

                try:
                    comp_score, comp_status = await self.intelligence_service.get_compliance_data(device.ip_address)
                    device.compliance_score = comp_score
                    device.compliance_status = comp_status
                except Exception:
                    device.compliance_score = 50
                    device.compliance_status = "unknown"
        
        await self.device_repo.session.commit()
        return devices

    async def register(self, data: DeviceCreate) -> Device:
        new_device = Device(
            id=f"dev-{str(uuid.uuid4())[:8]}",
            **data.model_dump(),
            status="online"
        )
        return await self.device_repo.create(new_device)

    async def get_by_id(self, device_id: str) -> Optional[Device]:
        return await self.device_repo.get(device_id)

    async def get_telemetry(self, device_id: str, limit: int = 50) -> List[Telemetry]:
        return await self.telemetry_repo.get_by_device(device_id, limit)

    async def update(self, device_id: str, data: DeviceUpdate) -> Optional[Device]:
        device = await self.device_repo.get(device_id)
        if not device:
            return None
        
        update_data = data.model_dump(exclude_unset=True)
        device.last_seen = datetime.utcnow()
        return await self.device_repo.update(device, update_data)

    async def delete(self, device_id: str) -> bool:
        doc = await self.device_repo.delete(device_id)
        return doc is not None

    async def get_summary(self) -> dict:
        return await self.device_repo.get_stats()
