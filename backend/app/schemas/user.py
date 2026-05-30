"""Pydantic schemas for User — read/create/update DTOs that FastAPI-Users uses."""

import uuid

from fastapi_users import schemas

from app.models.user import LanguagePref, UserRole


class UserRead(schemas.BaseUser[uuid.UUID]):
    """Shape returned by /users/me and similar."""

    name: str
    role: UserRole
    language_pref: LanguagePref
    restaurant_id: uuid.UUID


class UserCreate(schemas.BaseUserCreate):
    """Used by the admin CLI (no public signup in pilot phase)."""

    name: str
    role: UserRole = UserRole.staff
    language_pref: LanguagePref = LanguagePref.ja
    restaurant_id: uuid.UUID


class UserUpdate(schemas.BaseUserUpdate):
    """Allowed mutations — name + language pref. Role + restaurant change via
    admin CLI only (avoid privilege escalation by self-update)."""

    name: str | None = None
    language_pref: LanguagePref | None = None
