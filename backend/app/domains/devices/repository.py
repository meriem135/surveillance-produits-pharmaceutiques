# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/domains/devices/repository.py
#   ACCÈS AUX TABLES devices ET telemetry : filtres, statistiques, dernières mesures.
# ══════════════════════════════════════════════════════════════════════════
from typing import List, Optional, Any
from sqlalchemy import select, func
from app.db.base_repository import BaseRepository
from app.domains.devices.models import Device, Telemetry

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] DeviceRepository
#   Rôle   : Accès à la table devices.
# ──────────────────────────────────────────────────────────────────────
class DeviceRepository(BaseRepository[Device]):
    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] DeviceRepository.__init__
    #   Rôle   : Branche le repository sur la table devices.
    #   Entrée : session
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    def __init__(self, session):
        super().__init__(Device, session)

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] DeviceRepository.get_with_filters
    #   Rôle   : Liste les équipements, filtrés par état ou par type.
    #   Entrée : status ; device_type
    #   Sortie : liste
    # ──────────────────────────────────────────────────────────────────────
    async def get_with_filters(self, status: Optional[str] = None, device_type: Optional[str] = None) -> List[Device]:
        query = select(Device)
        if status:
            query = query.where(Device.status == status)
        if device_type:
            query = query.where(Device.device_type == device_type)
        result = await self.session.execute(query)
        return result.scalars().all()

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] DeviceRepository.get_stats
    #   Rôle   : Statistiques : nombre d'équipements, en ligne, par type, risque moyen.
    #   Entrée : rien
    #   Sortie : dictionnaire
    # ──────────────────────────────────────────────────────────────────────
    async def get_stats(self) -> dict:
        result = await self.session.execute(select(Device))
        devices = result.scalars().all()
        
        total = len(devices)
        online = sum(1 for d in devices if d.status == "online")
        offline = total - online
        
        types = {}
        for d in devices:
            types[d.device_type] = types.get(d.device_type, 0) + 1
            
        avg_risk = sum(d.risk_score for d in devices) / total if total > 0 else 0
        
        risk_dist = {
            "high": sum(1 for d in devices if d.risk_score >= 70),
            "medium": sum(1 for d in devices if 30 <= d.risk_score < 70),
            "low": sum(1 for d in devices if d.risk_score < 30)
        }
        
        return {
            "total_devices": total,
            "online_devices": online,
            "offline_devices": offline,
            "device_types": types,
            "average_risk_score": round(avg_risk, 2),
            "risk_distribution": risk_dist
        }

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] TelemetryRepository
#   Rôle   : Accès à la table telemetry.
# ──────────────────────────────────────────────────────────────────────
class TelemetryRepository(BaseRepository[Telemetry]):
    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] TelemetryRepository.__init__
    #   Rôle   : Branche le repository sur la table telemetry.
    #   Entrée : session
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    def __init__(self, session):
        super().__init__(Telemetry, session)

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] TelemetryRepository.get_by_device
    #   Rôle   : Dernières mesures d'un équipement.
    #   Entrée : device_id ; limit
    #   Sortie : liste
    # ──────────────────────────────────────────────────────────────────────
    async def get_by_device(self, device_id: str, limit: int = 50) -> List[Telemetry]:
        query = select(Telemetry).where(
            Telemetry.device_id == device_id
        ).order_by(Telemetry.timestamp.desc()).limit(limit)
        result = await self.session.execute(query)
        return result.scalars().all()
