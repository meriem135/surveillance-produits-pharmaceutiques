from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_session
from app.domains.auth.models import User
from app.domains.auth.audit import AuditLog
from app.domains.auth.repository import UserRepository
from app.domains.auth.schemas import (
    UserCreate, UserLogin, UserRead, UserUpdate,
    ResetPassword, ChangePassword, AuditLogRead, Token,
)
from app.domains.auth.service import (
    verify_password, create_access_token, get_current_user,
    hash_password, require_any_role,
)

router = APIRouter()

VALID_ROLES = {"admin", "operator"}
PUBLIC_ROLES = {"operator"}


async def _log(session: AsyncSession, admin: User, action: str,
              target_id: int | None = None, target_username: str | None = None,
              details: str | None = None):
    session.add(AuditLog(
        admin_id=admin.id, admin_username=admin.username,
        action=action, target_user_id=target_id,
        target_username=target_username, details=details,
    ))


# ── Public ────────────────────────────────────────────────────────────────────

@router.post("/auth/register", response_model=UserRead, status_code=201,
             summary="Créer un compte (public)")
async def register(data: UserCreate, session: AsyncSession = Depends(get_session)):
    repo = UserRepository(session)
    if data.role not in PUBLIC_ROLES:
        raise HTTPException(400, f"Rôle invalide. Valeurs autorisées : {', '.join(sorted(PUBLIC_ROLES))}")
    if await repo.get_by_username(data.username):
        raise HTTPException(409, "Ce nom d'utilisateur existe déjà")
    if await repo.get_by_email(data.email):
        raise HTTPException(409, "Cet email est déjà utilisé")
    user = User(
        email=data.email, username=data.username,
        hashed_password=hash_password(data.password),
        full_name=data.full_name, role=data.role,
    )
    await repo.create(user)
    await session.commit()
    return UserRead.model_validate(user)


@router.post("/auth/login", response_model=Token)
async def login(data: UserLogin, session: AsyncSession = Depends(get_session)):
    repo = UserRepository(session)
    user = await repo.get_by_username(data.username)
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Identifiants incorrects")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Compte désactivé")
    access_token = create_access_token({"sub": str(user.id), "role": user.role})
    return Token(access_token=access_token, user=UserRead.model_validate(user))


# ── Profile (all roles) ───────────────────────────────────────────────────────

@router.get("/auth/me", response_model=UserRead)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/auth/me", response_model=UserRead, summary="Modifier mon profil")
async def update_me(
    data: UserUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    repo = UserRepository(session)
    if data.email and data.email != current_user.email:
        existing = await repo.get_by_email(data.email)
        if existing:
            raise HTTPException(409, "Cet email est déjà utilisé")
        current_user.email = data.email
    if data.full_name is not None:
        current_user.full_name = data.full_name
    if data.role and data.role != current_user.role:
        raise HTTPException(400, "Vous ne pouvez pas changer votre propre rôle")
    await repo.update(current_user, {})
    await session.commit()
    return UserRead.model_validate(current_user)


@router.post("/auth/me/password", status_code=204, summary="Changer mon mot de passe")
async def change_my_password(
    data: ChangePassword,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if not verify_password(data.current_password, current_user.hashed_password):
        raise HTTPException(400, "Mot de passe actuel incorrect")
    current_user.hashed_password = hash_password(data.new_password)
    repo = UserRepository(session)
    await repo.update(current_user, {})
    await session.commit()


# ── Admin user management ─────────────────────────────────────────────────────

@router.get("/auth/users", response_model=list[UserRead],
            summary="Lister tous les comptes (admin)")
async def list_users(
    _admin: User = Depends(require_any_role()),
    session: AsyncSession = Depends(get_session),
):
    repo = UserRepository(session)
    users = await repo.get_multi(limit=200)
    return [UserRead.model_validate(u) for u in users]


@router.post("/auth/users", response_model=UserRead, status_code=201,
             summary="Créer un compte (admin)")
async def create_user(
    data: UserCreate,
    admin: User = Depends(require_any_role()),
    session: AsyncSession = Depends(get_session),
):
    repo = UserRepository(session)
    if data.role not in VALID_ROLES:
        raise HTTPException(400, f"Rôle invalide. Valeurs autorisées : {', '.join(sorted(VALID_ROLES))}")
    if await repo.get_by_username(data.username):
        raise HTTPException(409, "Ce nom d'utilisateur existe déjà")
    if await repo.get_by_email(data.email):
        raise HTTPException(409, "Cet email est déjà utilisé")
    user = User(
        email=data.email, username=data.username,
        hashed_password=hash_password(data.password),
        full_name=data.full_name, role=data.role,
    )
    await repo.create(user)
    await _log(session, admin, "create", user.id, user.username, f"role={data.role}")
    await session.commit()
    return UserRead.model_validate(user)


@router.patch("/auth/users/{user_id}", response_model=UserRead,
              summary="Modifier un compte (admin)")
async def update_user(
    user_id: int,
    data: UserUpdate,
    admin: User = Depends(require_any_role()),
    session: AsyncSession = Depends(get_session),
):
    repo = UserRepository(session)
    user = await repo.get(user_id)
    if not user:
        raise HTTPException(404, "Utilisateur introuvable")
    if user.role == "admin" and user.id != admin.id:
        raise HTTPException(400, "Impossible de modifier un autre administrateur")
    if data.email and data.email != user.email:
        existing = await repo.get_by_email(data.email)
        if existing:
            raise HTTPException(409, "Cet email est déjà utilisé")
        user.email = data.email
    if data.full_name is not None:
        user.full_name = data.full_name
    if data.role and data.role != user.role:
        if data.role not in VALID_ROLES:
            raise HTTPException(400, f"Rôle invalide")
        if user.role == "admin":
            raise HTTPException(400, "Impossible de changer le rôle d'un administrateur")
        user.role = data.role
    await repo.update(user, {})
    await _log(session, admin, "update", user.id, user.username)
    await session.commit()
    return UserRead.model_validate(user)


@router.patch("/auth/users/{user_id}/toggle-active",
              summary="Activer/Désactiver un compte (admin)")
async def toggle_active(
    user_id: int,
    admin: User = Depends(require_any_role()),
    session: AsyncSession = Depends(get_session),
):
    repo = UserRepository(session)
    user = await repo.get(user_id)
    if not user:
        raise HTTPException(404, "Utilisateur introuvable")
    if user.id == admin.id:
        raise HTTPException(400, "Vous ne pouvez pas désactiver votre propre compte")
    if user.role == "admin":
        raise HTTPException(400, "Impossible de désactiver un administrateur")
    user.is_active = not user.is_active
    await repo.update(user, {})
    action = "activate" if user.is_active else "deactivate"
    await _log(session, admin, action, user.id, user.username)
    await session.commit()
    return UserRead.model_validate(user)


@router.post("/auth/users/{user_id}/reset-password",
             summary="Réinitialiser le mot de passe (admin)")
async def reset_password(
    user_id: int,
    data: ResetPassword,
    admin: User = Depends(require_any_role()),
    session: AsyncSession = Depends(get_session),
):
    repo = UserRepository(session)
    user = await repo.get(user_id)
    if not user:
        raise HTTPException(404, "Utilisateur introuvable")
    user.hashed_password = hash_password(data.new_password)
    await repo.update(user, {})
    await _log(session, admin, "reset_password", user.id, user.username)
    await session.commit()
    return {"status": "ok"}


@router.delete("/auth/users/{user_id}", status_code=204,
               summary="Supprimer un compte (admin)")
async def delete_user(
    user_id: int,
    admin: User = Depends(require_any_role()),
    session: AsyncSession = Depends(get_session),
):
    repo = UserRepository(session)
    if user_id == admin.id:
        raise HTTPException(400, "Vous ne pouvez pas supprimer votre propre compte")
    user = await repo.get(user_id)
    if not user:
        raise HTTPException(404, "Utilisateur introuvable")
    if user.role == "admin":
        raise HTTPException(400, "Impossible de supprimer un autre administrateur")
    await _log(session, admin, "delete", user.id, user.username)
    await repo.delete(user_id)
    await session.commit()


# ── Audit log ─────────────────────────────────────────────────────────────────

@router.get("/auth/audit-logs", response_model=list[AuditLogRead],
            summary="Historique des actions (admin)")
async def get_audit_logs(
    _admin: User = Depends(require_any_role()),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(AuditLog).order_by(AuditLog.created_at.desc()).limit(100)
    )
    return [AuditLogRead.model_validate(r) for r in result.scalars().all()]


@router.delete("/auth/audit-logs", status_code=204,
               summary="Supprimer l'historique des actions (admin)")
async def delete_audit_logs(
    admin: User = Depends(require_any_role()),
    session: AsyncSession = Depends(get_session),
):
    await session.execute(AuditLog.__table__.delete())
    await session.commit()
