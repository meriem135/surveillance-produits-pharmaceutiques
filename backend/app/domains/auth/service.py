# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/domains/auth/service.py
#   SÉCURITÉ. Chiffrement des mots de passe (bcrypt), création et lecture des jetons JWT,
#   protection des routes par rôle (admin / opérateur).
# ══════════════════════════════════════════════════════════════════════════
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt as _bcrypt
from jose import jwt, JWTError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_session
from app.domains.auth.models import User
from app.domains.auth.repository import UserRepository
from app.domains.auth.schemas import UserCreate, UserRead

logger = logging.getLogger(__name__)

SECRET_KEY = os.getenv("JWT_SECRET_KEY") or getattr(settings, "JWT_SECRET_KEY", None)
if not SECRET_KEY:
    # Aucun secret configure : on genere une cle ephemere (les tokens sont
    # invalides apres redemarrage) au lieu d'un secret connu publiquement.
    SECRET_KEY = secrets.token_urlsafe(48)
    logger.warning(
        "JWT_SECRET_KEY n'est pas défini — une clé éphémère a été générée. "
        "Définissez JWT_SECRET_KEY dans votre .env pour conserver les sessions."
    )
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480

security = HTTPBearer()


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] hash_password
#   Rôle   : CHIFFRE un mot de passe avec bcrypt (on ne stocke jamais le mot de passe en clair).
#   Entrée : password
#   Sortie : empreinte bcrypt
# ──────────────────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] verify_password
#   Rôle   : Vérifie qu'un mot de passe correspond à son empreinte.
#   Entrée : plain ; hashed
#   Sortie : vrai/faux
# ──────────────────────────────────────────────────────────────────────
def verify_password(plain: str, hashed: str) -> bool:
    return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] create_access_token
#   Rôle   : CRÉE UN JETON JWT signé, avec une date d'expiration.
#   Entrée : data : contenu (id utilisateur) ; durée
#   Sortie : jeton (texte)
# ──────────────────────────────────────────────────────────────────────
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] decode_access_token
#   Rôle   : Lit et vérifie un jeton JWT.
#   Entrée : token
#   Sortie : contenu ou None si invalide
# ──────────────────────────────────────────────────────────────────────
def decode_access_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] get_current_user
#   Rôle   : Retrouve l'utilisateur connecté à partir du jeton de la requête (sinon erreur 401).
#   Entrée : en-tête Authorization
#   Sortie : User
# ──────────────────────────────────────────────────────────────────────
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    session: AsyncSession = Depends(get_session),
) -> User:
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalide")
    user_id_str: str = payload.get("sub")
    if user_id_str is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalide")
    repo = UserRepository(session)
    user = await repo.get(int(user_id_str))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilisateur introuvable ou inactif")
    return user


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] require_role
#   Rôle   : Protège une route : seul ce rôle (ou l'admin) passe.
#   Entrée : required_role
#   Sortie : vérificateur FastAPI
# ──────────────────────────────────────────────────────────────────────
def require_role(required_role: str):
    async def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role != required_role and current_user.role != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé")
        return current_user
    return role_checker


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] require_any_role
#   Rôle   : PROTÈGE UNE ROUTE : seuls les rôles listés + l'admin passent (sinon erreur 403).
#   Entrée : allowed_roles
#   Sortie : vérificateur FastAPI
# ──────────────────────────────────────────────────────────────────────
def require_any_role(*allowed_roles: str):
    """Dependency qui autorise uniquement les rôles listés + le rôle admin.

    Utilisation :
      require_any_role("operator")                → operator ou admin
      require_any_role()                           → admin uniquement
    """
    async def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role != "admin" and current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Accès refusé pour votre rôle",
            )
        return current_user
    return role_checker
