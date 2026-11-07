# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/db/seed.py
#   DONNÉES DE DÉPART. Au premier démarrage : crée les équipements de l'usine et le compte
#   administrateur.
# ══════════════════════════════════════════════════════════════════════════
"""Données de départ idempotentes : équipements de l'usine + compte admin."""

import logging

from sqlalchemy import select

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.domains.auth.models import User
from app.domains.devices.models import Device

logger = logging.getLogger(__name__)

# Les 3 capteurs edge (un topic MQTT chacun : factory/<id>/telemetry) et le
# jumeau numérique qui porte le flux fusionné (télémétrie « behavioral_twin »).
DEFAULT_DEVICES = [
    {"id": "weather-01", "name": "Station météo extérieure", "device_type": "weather",
     "location": "outdoor"},
    {"id": "fridge-01", "name": "Chambre froide (frigo)", "device_type": "fridge",
     "location": "storage"},
    {"id": "thermostat-01", "name": "Thermostat salle de production", "device_type": "thermostat",
     "location": "production"},
    {"id": "multi-sensor", "name": "Jumeau numérique (fusion 3 capteurs)", "device_type": "gateway",
     "location": "control_room"},
]


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] seed_defaults
#   Rôle   : DONNÉES DE DÉPART : ajoute les équipements de l'usine et crée le compte administrateur s'ils
#            n'existent pas encore.
#   Entrée : rien
#   Sortie : rien
# ──────────────────────────────────────────────────────────────────────
async def seed_defaults() -> None:
    async with AsyncSessionLocal() as session:
        existing = set((await session.execute(select(Device.id))).scalars().all())
        for spec in DEFAULT_DEVICES:
            if spec["id"] not in existing:
                session.add(Device(**spec))

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
