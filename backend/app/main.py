import asyncio
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from contextlib import asynccontextmanager
from sqlmodel import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.paths import SEASONAL_STREAM_CSV, ensure_dirs
from app.db.seed import seed_defaults
from app.db.session import init_db, close_db, get_session
from app.api.v1 import devices, risks, phase2, phase2_timeline, analyst, auth, shap_analysis, dataset_analytics, fusion_insights, pharma_impact, advanced_analytics, transmission, overview
from app.services.mqtt_service import mqtt_service
from app.services.modbus_service import modbus_service
from app.services.realtime_service import manager
from app.domains.devices.models import Telemetry
from app.domains.intelligence import ml_service  # noqa: F401 – import for side-effects
from app.domains.auth.service import require_any_role

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler"""
    ensure_dirs()
    await init_db()
    await seed_defaults()

    # Ingestion terrain : chaque service est désactivable (.env) quand le
    # broker ou l'automate n'existe pas sur le poste.
    if settings.ENABLE_MQTT:
        asyncio.create_task(mqtt_service.start())
    if settings.ENABLE_MODBUS:
        asyncio.create_task(modbus_service.start())
    edge_simulator = None
    if settings.ENABLE_MQTT and settings.ENABLE_EDGE_SIMULATOR:
        from app.services.mqtt_simulator import MqttSimulator

        edge_simulator = MqttSimulator(
            settings.MQTT_BROKER_URL, settings.MQTT_BROKER_PORT, SEASONAL_STREAM_CSV,
            settings.MQTT_USERNAME, settings.MQTT_PASSWORD,
        )
        asyncio.create_task(edge_simulator.start())
    # La simulation backend tourne en continu : c'est le frontend qui démarre/arrête
    # sa propre réception (connexion WebSocket) via le bouton "COMMENCER".
    manager.set_simulation(True)

    yield

    if edge_simulator is not None:
        await edge_simulator.stop()
    if settings.ENABLE_MQTT:
        await mqtt_service.stop()
    if settings.ENABLE_MODBUS:
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
    return JSONResponse(
        {"detail": "Dashboard index.html not found in static directory."},
        status_code=404,
    )

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

# /api/shap/latest est gere par shap_analysis.router (pre-calcule, dataset reel).

# WebSocket endpoint pour le streaming temps réel
@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.post("/api/simulation/toggle")
async def toggle_simulation(
    _user=Depends(require_any_role("operator")),
):
    active = not manager.get_simulation()
    manager.set_simulation(active)
    return {"simulation_active": active}

@app.get("/api/simulation/status")
async def simulation_status():
    return {"simulation_active": manager.get_simulation()}

# CORS : origines explicites (jamais "*" avec allow_credentials=True).
# Configurable via CORS_ORIGINS="http://localhost:5173,https://mon-domaine.fr"
_cors_origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyst.router, prefix=f"{settings.API_V1_STR}/analyst", tags=["analyst-llm-rag"])
app.include_router(devices.router, prefix=settings.API_V1_STR, tags=["devices"])
app.include_router(risks.router, prefix=settings.API_V1_STR, tags=["risks"])
app.include_router(phase2.router, prefix=settings.API_V1_STR, tags=["phase2"])
app.include_router(phase2_timeline.router, prefix=settings.API_V1_STR, tags=["phase2"])
app.include_router(auth.router, prefix=settings.API_V1_STR, tags=["auth"])
app.include_router(shap_analysis.router)
app.include_router(dataset_analytics.router, prefix=settings.API_V1_STR, tags=["dataset"])
app.include_router(fusion_insights.router, prefix=settings.API_V1_STR, tags=["fusion"])
app.include_router(pharma_impact.router, prefix=settings.API_V1_STR, tags=["pharma"])
app.include_router(advanced_analytics.router, prefix=settings.API_V1_STR, tags=["advanced-analytics"])
app.include_router(transmission.router, prefix=settings.API_V1_STR, tags=["transmission"])
app.include_router(overview.router, prefix=settings.API_V1_STR, tags=["overview"])

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
