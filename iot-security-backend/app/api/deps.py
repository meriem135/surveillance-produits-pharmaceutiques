from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_session
from app.domains.devices.repository import DeviceRepository, TelemetryRepository
from app.domains.devices.service import DeviceService
from app.domains.intelligence.service import IntelligenceService
from app.domains.intelligence.risk_service import RiskScoringEngine, risk_engine
from app.domains.ml_models.repository import MLModelRepository, ModelMetricRepository
from app.domains.ml_models.service import MLModelService

# Singleton instances for services that don't need a DB session per call
_intelligence_service = IntelligenceService()

def get_intelligence_service() -> IntelligenceService:
    return _intelligence_service

async def get_device_service(
    session: AsyncSession = Depends(get_session),
    intelligence_service: IntelligenceService = Depends(get_intelligence_service)
) -> DeviceService:
    device_repo = DeviceRepository(session)
    telemetry_repo = TelemetryRepository(session)
    return DeviceService(device_repo, telemetry_repo, intelligence_service)

async def get_ml_model_service(
    session: AsyncSession = Depends(get_session)
) -> MLModelService:
    model_repo = MLModelRepository(session)
    metric_repo = ModelMetricRepository(session)
    return MLModelService(model_repo, metric_repo)
