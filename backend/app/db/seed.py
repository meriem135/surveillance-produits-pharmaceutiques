# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/db/seed.py
#   DONNÉES DE DÉPART. Au premier démarrage : crée le compte administrateur.
# ══════════════════════════════════════════════════════════════════════════
"""Données de départ idempotentes : compte admin."""

import logging

from sqlalchemy import select

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.domains.auth.models import User

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] seed_defaults
#   Rôle   : DONNÉES DE DÉPART : crée le compte administrateur s'il n'existe pas encore.
#   Entrée : rien
#   Sortie : rien
# ──────────────────────────────────────────────────────────────────────
async def seed_defaults() -> None:
    async with AsyncSessionLocal() as session:
        if settings.ADMIN_PASSWORD:
            has_admin = (await session.execute(
                select(User.id).where(User.role == "admin").limit(1)
            )).first()
            if not has_admin:
                from app.domains.auth.service import hash_password

                session.add(User(
                    email=settings.ADMIN_EMAIL, username=settings.ADMIN_USERNAME,
                    hashed_password=hash_password(settings.ADMIN_PASSWORD),
                    full_name="Administrateur", role="admin",
                ))
                logger.info("Compte administrateur '%s' créé", settings.ADMIN_USERNAME)
        await session.commit()
