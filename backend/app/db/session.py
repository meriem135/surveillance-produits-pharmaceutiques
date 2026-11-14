# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/db/session.py
#   CONNEXION À LA BASE DE DONNÉES (PostgreSQL uniquement, voir DATABASE_URL) ;
#   création des tables au démarrage.
# ══════════════════════════════════════════════════════════════════════════
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlmodel import SQLModel
from app.core.config import settings

database_url = settings.DATABASE_URL

# Moteur asynchrone avec pool de connexions (la connexion réelle n'est ouverte qu'à la première requête)
engine = create_async_engine(
    database_url,
    echo=False,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600,
)

# Create async session factory
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] get_session
#   Rôle   : Fournit une connexion à la base à chaque requête API (FastAPI Depends).
#   Entrée : rien
#   Sortie : session de base de données
# ──────────────────────────────────────────────────────────────────────
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for getting async database sessions"""
    async with AsyncSessionLocal() as session:
        yield session

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _ensure_ml_metrics_columns
#   Rôle   : Ajoute les colonnes manquantes aux tables déjà créées (mise à jour du schéma).
#   Entrée : rien
#   Sortie : rien
# ──────────────────────────────────────────────────────────────────────
async def _ensure_ml_metrics_columns():
    """Ajoute de manière idempotente les colonnes manquantes aux tables existantes.

    create_all() ne modifie pas les tables existantes, on complète donc le schéma
    en PostgreSQL.
    """
    add_col = {
        # source : « web » (entraînement du dashboard) ou « reference » (étude chargée par charger_base.py)
        "transmission_runs": {"source": "varchar NOT NULL DEFAULT 'web'"},
    }
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


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] init_db
#   Rôle   : Crée toutes les tables au démarrage.
#   Entrée : rien
#   Sortie : rien
# ──────────────────────────────────────────────────────────────────────
async def init_db():
    """Initialize database tables"""
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    await _ensure_ml_metrics_columns()

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] close_db
#   Rôle   : Ferme les connexions à la base à l'arrêt.
#   Entrée : rien
#   Sortie : rien
# ──────────────────────────────────────────────────────────────────────
async def close_db():
    """Close database connections"""
    await engine.dispose()
