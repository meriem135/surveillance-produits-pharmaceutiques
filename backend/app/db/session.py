import asyncio
import logging
import socket
import threading
from typing import AsyncGenerator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlmodel import SQLModel
from app.core.config import settings
from app.core.paths import SQLITE_DB

logger = logging.getLogger(__name__)


def is_postgres_running(host="localhost", port=5432):
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


def _postgres_usable(url: str, timeout: float = 4.0) -> tuple[bool, str]:
    """Vérifie qu'on peut réellement se connecter (port ouvert ET identifiants /
    base valides). Exécuté dans un thread dédié : fonctionne même si l'import
    a lieu alors qu'une boucle asyncio tourne déjà (uvicorn)."""
    outcome = {"ok": False, "err": "timeout"}

    def probe():
        async def _check():
            eng = create_async_engine(url)
            try:
                async with eng.connect() as conn:
                    await conn.execute(text("SELECT 1"))
            finally:
                await eng.dispose()
        try:
            asyncio.run(asyncio.wait_for(_check(), timeout))
            outcome.update(ok=True, err="")
        except Exception as e:  # noqa: BLE001
            outcome["err"] = f"{type(e).__name__}: {e}"

    t = threading.Thread(target=probe, daemon=True)
    t.start()
    t.join(timeout + 1)
    return outcome["ok"], outcome["err"]


database_url = settings.DATABASE_URL
engine_kwargs = {}

# Parse host and port from postgres url
db_host = "localhost"
db_port = 5432
if "@" in database_url:
    try:
        host_port = database_url.split("@")[1].split("/")[0]
        if ":" in host_port:
            db_host, db_port = host_port.split(":")
            db_port = int(db_port)
        else:
            db_host = host_port
    except Exception:
        pass

# PostgreSQL demandé mais injoignable (port fermé, identifiants ou base
# invalides) -> base SQLite locale, pour que le projet démarre partout.
if "postgresql" in database_url:
    reason = ""
    if not is_postgres_running(db_host, db_port):
        reason = f"aucun serveur sur {db_host}:{db_port}"
    else:
        ok, err = _postgres_usable(database_url)
        if not ok:
            reason = err
    if reason:
        SQLITE_DB.parent.mkdir(parents=True, exist_ok=True)
        database_url = f"sqlite+aiosqlite:///{SQLITE_DB}"
        logger.warning("PostgreSQL indisponible (%s) -> SQLite %s", reason, SQLITE_DB)
        print(f"[!] PostgreSQL indisponible ({reason}) -> SQLite : {SQLITE_DB}")
    else:
        engine_kwargs = {
            "pool_size": 10,
            "max_overflow": 20,
            "pool_pre_ping": True,
            "pool_recycle": 3600,
        }

# Create async engine with connection pooling or SQLite connection
engine = create_async_engine(
    database_url,
    echo=False,
    **engine_kwargs
)

# Create async session factory
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for getting async database sessions"""
    async with AsyncSessionLocal() as session:
        yield session

async def _ensure_ml_metrics_columns():
    """Ajoute de manière idempotente les colonnes de métriques globales à MLModel.

    create_all() ne modifie pas les tables existantes, on complète donc le schéma
    pour persister les métriques globales (precision, recall, f1, ...) en PostgreSQL.
    """
    driver = str(database_url).split(":", 1)[0]
    add_col = {
        "ml_models": {
            "precision": "float", "recall": "float", "f1": "float",
            "roc_auc": "float", "ap": "float", "fpr": "float",
            "tp": "integer", "fp": "integer", "fn": "integer", "tn": "integer",
            "result_json": "jsonb",
        },
        # source : « web » (entraînement du dashboard) ou « reference » (étude chargée par charger_base.py)
        "transmission_runs": {"source": "varchar NOT NULL DEFAULT 'web'"},
    }
    if driver == "sqlite":
        return  # les colonnes seront créées/ignorées par create_all sur une table fraîche
    import sqlalchemy as sa
    async with engine.begin() as conn:
        for table, columns in add_col.items():
            for col, ctype in columns.items():
                try:
                    await conn.execute(sa.text(
                        f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {ctype}"
                    ))
                except Exception:
                    # Table absente ou colonne déjà présente : on ignore
                    pass


async def init_db():
    """Initialize database tables"""
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    await _ensure_ml_metrics_columns()

async def close_db():
    """Close database connections"""
    await engine.dispose()
