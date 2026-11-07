# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/api/deps.py
#   DÉPENDANCES DES ROUTES. Fabrique les services (équipements, renseignement) injectés dans les
#   routes avec FastAPI Depends.
# ══════════════════════════════════════════════════════════════════════════
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_session
from app.domains.devices.repository import DeviceRepository, TelemetryRepository
from app.domains.devices.service import DeviceService
from app.domains.intelligence.service import IntelligenceService
from app.domains.intelligence.risk_service import RiskScoringEngine, risk_engine
from app.domains.auth.service import get_current_user, require_role
from app.domains.auth.models import User

# Singleton instances for services that don't need a DB session per call
_intelligence_service = IntelligenceService()

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] get_intelligence_service
#   Rôle   : Donne le service de renseignement (score de risque), partagé par toutes les requêtes.
#   Entrée : rien
#   Sortie : IntelligenceService
# ──────────────────────────────────────────────────────────────────────
def get_intelligence_service() -> IntelligenceService:
    return _intelligence_service

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] get_device_service
#   Rôle   : Fabrique le service des équipements avec ses accès à la base.
#   Entrée : session ; intelligence_service
#   Sortie : DeviceService
# ──────────────────────────────────────────────────────────────────────
async def get_device_service(
    session: AsyncSession = Depends(get_session),
    intelligence_service: IntelligenceService = Depends(get_intelligence_service)
) -> DeviceService:
    device_repo = DeviceRepository(session)
    telemetry_repo = TelemetryRepository(session)
    return DeviceService(device_repo, telemetry_repo, intelligence_service)
