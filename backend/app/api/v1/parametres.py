"""
Paramètres de la plateforme
  GET /api/v1/parametres   lecture (opérateur ou administrateur)
  PUT /api/v1/parametres   modification (administrateur seulement), tracée dans le journal d'audit
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.domains import parametres
from app.domains.auth.audit import AuditLog
from app.domains.auth.service import require_any_role

router = APIRouter()


@router.get("/parametres")
async def read_settings(_u=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    return {"valeurs": await parametres.get_all(session), "defauts": parametres.DEFAULTS,
            "bornes": parametres.BOUNDS, "libelles": parametres.LABELS}


@router.put("/parametres")
async def update_settings(values: dict, admin=Depends(require_any_role()), session: AsyncSession = Depends(get_session)):
    try:
        out = await parametres.update(session, values, admin.username)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    session.add(AuditLog(admin_id=admin.id, admin_username=admin.username, action="update_settings",
                         details=", ".join(f"{k}={v}" for k, v in values.items())))
    await session.commit()
    return {"valeurs": out}
