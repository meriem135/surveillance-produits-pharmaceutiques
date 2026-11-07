# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/domains/auth/schemas.py
#   FORMATS DES DONNÉES ÉCHANGÉES (Pydantic) : ce que l'API reçoit et renvoie pour les comptes,
#   la connexion et l'audit.
# ══════════════════════════════════════════════════════════════════════════
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] UserCreate
#   Rôle   : Données reçues pour créer un compte (mot de passe ≥ 6 caractères).
# ──────────────────────────────────────────────────────────────────────
class UserCreate(BaseModel):
    email: str
    username: str
    password: str = Field(min_length=6)
    full_name: Optional[str] = None
    role: str = "operator"


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] UserLogin
#   Rôle   : Données reçues pour se connecter.
# ──────────────────────────────────────────────────────────────────────
class UserLogin(BaseModel):
    username: str
    password: str


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] UserRead
#   Rôle   : Ce que l'API renvoie d'un compte (jamais le mot de passe).
# ──────────────────────────────────────────────────────────────────────
class UserRead(BaseModel):
    id: int
    email: str
    username: str
    full_name: Optional[str] = None
    role: str
    is_active: bool
    created_at: datetime
    avatar_url: Optional[str] = None

    class Config:
        from_attributes = True


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] Token
#   Rôle   : Réponse de connexion : jeton JWT + utilisateur.
# ──────────────────────────────────────────────────────────────────────
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] UserUpdate
#   Rôle   : Champs modifiables d'un compte.
# ──────────────────────────────────────────────────────────────────────
class UserUpdate(BaseModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] ResetPassword
#   Rôle   : Nouveau mot de passe (réinitialisation par l'admin).
# ──────────────────────────────────────────────────────────────────────
class ResetPassword(BaseModel):
    new_password: str = Field(min_length=6)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] ChangePassword
#   Rôle   : Ancien et nouveau mot de passe.
# ──────────────────────────────────────────────────────────────────────
class ChangePassword(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] AuditLogRead
#   Rôle   : Ce que l'API renvoie d'une ligne du journal d'audit.
# ──────────────────────────────────────────────────────────────────────
class AuditLogRead(BaseModel):
    id: int
    admin_id: int
    admin_username: str
    action: str
    target_user_id: Optional[int] = None
    target_username: Optional[str] = None
    details: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] TokenRefresh
#   Rôle   : Réponse avec un nouveau jeton.
# ──────────────────────────────────────────────────────────────────────
class TokenRefresh(BaseModel):
    access_token: str
    token_type: str = "bearer"
