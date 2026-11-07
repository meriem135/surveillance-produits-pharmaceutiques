# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/domains/auth/models.py
#   TABLE DES UTILISATEURS (users) : email, nom, mot de passe chiffré, rôle admin / opérateur.
# ══════════════════════════════════════════════════════════════════════════
from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] User
#   Rôle   : TABLE users : un compte (email, nom, mot de passe chiffré, rôle admin / opérateur, actif ou
#            non).
# ──────────────────────────────────────────────────────────────────────
class User(SQLModel, table=True):
    __tablename__ = "users"

    id: int = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    username: str = Field(unique=True, index=True)
    hashed_password: str
    full_name: Optional[str] = Field(default=None)
    role: str = Field(default="operator")
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    avatar_url: Optional[str] = Field(default=None)
