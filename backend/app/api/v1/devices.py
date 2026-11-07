# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/api/v1/devices.py
#   ROUTES ÉQUIPEMENTS (/api/v1/devices). Liste des équipements IoT avec leur score de risque.
# ══════════════════════════════════════════════════════════════════════════
from fastapi import APIRouter, Depends
from typing import List, Optional
from app.api.deps import get_device_service
from app.domains.devices.service import DeviceService
from app.domains.devices.schemas import DeviceRead

router = APIRouter()

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] get_devices
#   Rôle   : route API GET /devices : liste des équipements IoT avec leur score de risque.
#   Entrée : status, device_type : filtres
#   Sortie : liste d'équipements
# ──────────────────────────────────────────────────────────────────────
@router.get("/devices", response_model=List[DeviceRead])
async def get_devices(
    status: Optional[str] = None,
    device_type: Optional[str] = None,
    service: DeviceService = Depends(get_device_service)
):
    """Get all registered IoT devices with live scores"""
    return await service.get_all_with_risk(status, device_type)
