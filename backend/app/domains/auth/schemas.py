from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


class UserCreate(BaseModel):
    email: str
    username: str
    password: str = Field(min_length=6)
    full_name: Optional[str] = None
    role: str = "operator"


class UserLogin(BaseModel):
    username: str
    password: str


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


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


class UserUpdate(BaseModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None


class ResetPassword(BaseModel):
    new_password: str = Field(min_length=6)


class ChangePassword(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


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


class TokenRefresh(BaseModel):
    access_token: str
    token_type: str = "bearer"
