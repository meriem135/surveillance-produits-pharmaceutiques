import asyncio
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from contextlib import asynccontextmanager

from app.core.config import settings
from app.core.paths import SEASONAL_STREAM_CSV, ensure_dirs
from app.db.seed import seed_defaults
from app.db.session import init_db, close_db
from app.api.v1 import devices, risks, analyst, auth, transmission, overview, etude, parametres
from app.services.mqtt_service import mqtt_service
from app.services.modbus_service import modbus_service
from app.domains.intelligence import ml_service  # noqa: F401 – import for side-effects

async def _charger_etude():
    import sys
    from app.core import paths as _paths
    scripts = str(_paths.BACKEND_DIR / "scripts")
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    try:
        import charger_base
        await charger_base.load(only_if_needed=True)
        # Pré-calcul du flux « Temps réel » (features du jeu de données en base, modèle sauvegardé)
        from app.db.session import AsyncSessionLocal
        from app.domains.transmission import live
        async with AsyncSessionLocal() as session:
            await live.stream_source(session)
    except Exception:  # noqa: BLE001 — l'application démarre même sans étude en base
        import logging
        logging.getLogger(__name__).exception("Chargement de l'étude de référence en base impossible")


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

    # Étude de référence : chargée en base au démarrage si la version en place est différente
    # (pages Jeu de données, Résultats, SHAP, Détection vs réalité, Temps réel).
    if os.environ.get("VIGILO_SKIP_CHARGER_BASE") != "1":
        asyncio.create_task(_charger_etude())

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


class ImmutableStaticFiles(StaticFiles):
    """Fichiers du build Vite : leur nom contient un hachage du contenu, ils peuvent être gardés un an."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


if os.path.exists(STATIC_DIR):
    app.mount("/assets", ImmutableStaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

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
        # index.html change à chaque build (noms des fichiers hachés) : toujours revalidé
        return FileResponse(index_path, headers={"Cache-Control": "no-cache"})
    return JSONResponse(
        {"detail": "Dashboard index.html not found in static directory."},
        status_code=404,
    )

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
app.include_router(auth.router, prefix=settings.API_V1_STR, tags=["auth"])
app.include_router(transmission.router, prefix=settings.API_V1_STR, tags=["transmission"])
app.include_router(overview.router, prefix=settings.API_V1_STR, tags=["overview"])
app.include_router(etude.router, prefix=settings.API_V1_STR, tags=["etude"])
app.include_router(parametres.router, prefix=settings.API_V1_STR, tags=["parametres"])

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
