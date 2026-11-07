# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/domains/auth/repository.py
#   ACCÈS À LA TABLE users : chercher un compte par email ou par nom.
# ══════════════════════════════════════════════════════════════════════════
from typing import Optional
from sqlalchemy import select
from app.db.base_repository import BaseRepository
from app.domains.auth.models import User


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] UserRepository
#   Rôle   : Accès à la table users.
# ──────────────────────────────────────────────────────────────────────
class UserRepository(BaseRepository[User]):
    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] UserRepository.__init__
    #   Rôle   : Branche le repository sur la table users.
    #   Entrée : session
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    def __init__(self, session):
        super().__init__(User, session)

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] UserRepository.get_by_email
    #   Rôle   : Cherche un compte par email.
    #   Entrée : email
    #   Sortie : User ou None
    # ──────────────────────────────────────────────────────────────────────
    async def get_by_email(self, email: str) -> Optional[User]:
        result = await self.session.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] UserRepository.get_by_username
    #   Rôle   : Cherche un compte par nom d'utilisateur.
    #   Entrée : username
    #   Sortie : User ou None
    # ──────────────────────────────────────────────────────────────────────
    async def get_by_username(self, username: str) -> Optional[User]:
        result = await self.session.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()
