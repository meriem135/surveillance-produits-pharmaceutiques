import asyncio
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from sqlmodel import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import init_db, close_db, get_session
from app.api.v1 import devices, alerts, ml_models, yearly, dpi, risks, phase2, phase2_timeline, mlops, analyst
from app.services.mqtt_service import mqtt_service
from app.services.modbus_service import modbus_service
from app.services.realtime_service import manager
from app.domains.devices.models import Telemetry, Device
from app.domains.intelligence.ml_service import ml_anomaly
from app.domains.mlops.mlops_service import mlops_service

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler"""
    await init_db()
    
    # Start background services
    asyncio.create_task(mqtt_service.start())
    asyncio.create_task(modbus_service.start())
    asyncio.create_task(manager.stream_loop())

    # [DRIFT DESACTIVE] Le drift detectait 100% de faux positifs (ks_p_value=0.0 systematique)
    # car la reference entrainement (std=0.035) est trop etroite vs production (std~0.14).
    # A reactiver seulement si une degradation des performances modele est observee.
    # asyncio.create_task(mlops_service.start_scheduler(interval=3600))
    
    yield
    
    await mqtt_service.stop()
    await modbus_service.stop()
    await close_db()

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
    redirect_slashes=False
)

# Servir le Dashboard React (build) et les fichiers statiques
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
if os.path.exists(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

@app.get("/favicon.svg")
def serve_favicon():
    return FileResponse(os.path.join(STATIC_DIR, "favicon.svg"))

@app.get("/icons.svg")
def serve_icons():
    return FileResponse(os.path.join(STATIC_DIR, "icons.svg"))

@app.get("/dashboard/{full_path:path}")
@app.get("/dashboard")
def serve_dashboard(full_path: str = ""):
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"detail": "Dashboard index.html not found in static directory."}

# Endpoints requis pour le Jumeau Numérique / Dashboard
@app.get("/api/telemetry")
async def get_dashboard_telemetry(db: AsyncSession = Depends(get_session)):
    """Récupère les 150 derniers points de télémétrie du jumeau numérique"""
    statement = (
        select(Telemetry)
        .where(Telemetry.metric_key == "behavioral_twin")
        .order_by(Telemetry.timestamp.desc())
        .limit(150)
    )
    result = await db.execute(statement)
    records = result.scalars().all()
    return list(reversed(records))

@app.get("/api/shap/latest")
async def get_shap_latest(db: AsyncSession = Depends(get_session)):
    """Analyse la derniere telemetrie et retourne l'explication SHAP"""
    statement = (
        select(Telemetry)
        .where(Telemetry.metric_key == "behavioral_twin")
        .order_by(Telemetry.timestamp.desc())
        .limit(1)
    )
    result = await db.execute(statement)
    record = result.scalar_one_or_none()
    if not record:
        return {"error": "Aucune telemetrie disponible"}

    metric = record.metric_value
    telemetry = metric.get("registers", {})
    analysis = ml_anomaly.analyze(telemetry)
    return {
        "timestamp": record.timestamp.isoformat(),
        "registers": telemetry,
        "is_anomaly": analysis["is_anomaly"],
        "anomaly_score": analysis["anomaly_score"],
        "top_causes": analysis.get("top_causes", []),
    }

@app.get("/api/devices")
async def get_dashboard_devices(db: AsyncSession = Depends(get_session)):
    """Récupère la liste complète des équipements connectés"""
    statement = select(Device)
    result = await db.execute(statement)
    return result.scalars().all()

# WebSocket endpoint pour le streaming temps réel
@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Endpoint pour basculer le mode attaque (appelé par le simulateur frontend)
@app.post("/api/attack/toggle")
async def toggle_attack(active: bool = True):
    manager.set_attack(active)
    return {"attack_active": manager.get_attack()}

@app.post("/api/attack/purge")
async def purge_attack():
    manager.set_attack(False)
    return {"attack_active": False, "purged": True}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyst.router, prefix=f"{settings.API_V1_STR}/analyst", tags=["analyst-llm-rag"])
app.include_router(devices.router, prefix=settings.API_V1_STR, tags=["devices"])
app.include_router(alerts.router, prefix=settings.API_V1_STR, tags=["alerts"])
app.include_router(ml_models.router, prefix=f"{settings.API_V1_STR}/models", tags=["ml-models"])
app.include_router(yearly.router)
app.include_router(dpi.router)
app.include_router(risks.router, prefix=settings.API_V1_STR, tags=["risks"])
app.include_router(phase2.router, prefix=settings.API_V1_STR, tags=["phase2"])
app.include_router(phase2_timeline.router, prefix=settings.API_V1_STR, tags=["phase2"])
app.include_router(mlops.router, prefix=f"{settings.API_V1_STR}/mlops", tags=["mlops"])

@app.get("/")
def root():
    return {
        "message": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "dashboard": "/dashboard"
    }

@app.get("/health")
def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
