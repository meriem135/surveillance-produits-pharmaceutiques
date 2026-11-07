# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/domains/devices/service.py
#   LOGIQUE DES ÉQUIPEMENTS : liste avec score de risque et de conformité, création,
#   modification, suppression.
# ══════════════════════════════════════════════════════════════════════════
import uuid
from datetime import datetime
from typing import List, Optional
from app.domains.devices.models import Device, Telemetry
from app.domains.devices.repository import DeviceRepository, TelemetryRepository
from app.domains.devices.schemas import DeviceCreate, DeviceUpdate
from app.domains.intelligence.service import IntelligenceService
from app.domains.intelligence.risk_service import risk_engine

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] DeviceService
#   Rôle   : LOGIQUE DES ÉQUIPEMENTS : liste avec score de risque, création, modification, suppression,
#            mesures.
# ──────────────────────────────────────────────────────────────────────
class DeviceService:
    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] DeviceService.__init__
    #   Rôle   : Retient les accès à la base et le service de risque.
    #   Entrée : device_repo, telemetry_repo, intelligence_service
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    def __init__(
        self, 
        device_repo: DeviceRepository, 
        telemetry_repo: TelemetryRepository,
        intelligence_service: IntelligenceService
    ):
        self.device_repo = device_repo
        self.telemetry_repo = telemetry_repo
        self.intelligence_service = intelligence_service

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] DeviceService.get_all_with_risk
    #   Rôle   : Liste les équipements et met à jour leur score de risque et de conformité.
    #   Entrée : status ; device_type
    #   Sortie : liste
    # ──────────────────────────────────────────────────────────────────────
    async def get_all_with_risk(self, status: Optional[str] = None, device_type: Optional[str] = None) -> List[Device]:
        devices = await self.device_repo.get_with_filters(status, device_type)
        
        for device in devices:
            if device.ip_address:
                try:
                    risk = await risk_engine.compute_risk(
                        device_id=device.id,
                        device_type=device.device_type,
                        location=device.location,
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

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] DeviceService.register
    #   Rôle   : Enregistre un nouvel équipement.
    #   Entrée : data
    #   Sortie : Device
    # ──────────────────────────────────────────────────────────────────────
    async def register(self, data: DeviceCreate) -> Device:
        new_device = Device(
            id=f"dev-{str(uuid.uuid4())[:8]}",
            **data.model_dump(),
            status="online"
        )
        return await self.device_repo.create(new_device)

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] DeviceService.get_by_id
    #   Rôle   : Lit un équipement.
    #   Entrée : device_id
    #   Sortie : Device ou None
    # ──────────────────────────────────────────────────────────────────────
    async def get_by_id(self, device_id: str) -> Optional[Device]:
        return await self.device_repo.get(device_id)

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] DeviceService.get_telemetry
    #   Rôle   : Dernières mesures d'un équipement.
    #   Entrée : device_id ; limit
    #   Sortie : liste
    # ──────────────────────────────────────────────────────────────────────
    async def get_telemetry(self, device_id: str, limit: int = 50) -> List[Telemetry]:
        return await self.telemetry_repo.get_by_device(device_id, limit)

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] DeviceService.update
    #   Rôle   : Modifie un équipement.
    #   Entrée : device_id ; data
    #   Sortie : Device ou None
    # ──────────────────────────────────────────────────────────────────────
    async def update(self, device_id: str, data: DeviceUpdate) -> Optional[Device]:
        device = await self.device_repo.get(device_id)
        if not device:
            return None
        
        update_data = data.model_dump(exclude_unset=True)
        device.last_seen = datetime.utcnow()
        return await self.device_repo.update(device, update_data)

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] DeviceService.delete
    #   Rôle   : Supprime un équipement.
    #   Entrée : device_id
    #   Sortie : vrai/faux
    # ──────────────────────────────────────────────────────────────────────
    async def delete(self, device_id: str) -> bool:
        doc = await self.device_repo.delete(device_id)
        return doc is not None

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] DeviceService.get_summary
    #   Rôle   : Statistiques des équipements.
    #   Entrée : rien
    #   Sortie : dictionnaire
    # ──────────────────────────────────────────────────────────────────────
    async def get_summary(self) -> dict:
        return await self.device_repo.get_stats()
