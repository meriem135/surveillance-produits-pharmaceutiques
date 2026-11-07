# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/domains/auth/audit.py
#   TABLE DU JOURNAL D'AUDIT (audit_logs) : trace de chaque action d'un administrateur.
# ══════════════════════════════════════════════════════════════════════════
from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] AuditLog
#   Rôle   : TABLE audit_logs : une ligne par action d'administrateur (qui, quoi, sur quel compte, quand).
# ──────────────────────────────────────────────────────────────────────
class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_logs"

    id: int = Field(default=None, primary_key=True)
    admin_id: int
    admin_username: str
    action: str
    target_user_id: Optional[int] = None
    target_username: Optional[str] = None
    details: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
