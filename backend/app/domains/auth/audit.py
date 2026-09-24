from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


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
