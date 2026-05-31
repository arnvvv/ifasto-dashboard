"""User model — built on FastAPI-Users' UUID base table."""

from __future__ import annotations

import enum
import uuid
from typing import TYPE_CHECKING

from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID
from sqlalchemy import Enum, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.restaurant import Restaurant


class UserRole(str, enum.Enum):
    owner = "owner"      # full access — all 4 sections, all settings, invoices
    manager = "manager"  # live ops + revenue + limited settings; can pause
    staff = "staff"      # live ops view ONLY (the seat-next screen)


class LanguagePref(str, enum.Enum):
    ja = "ja"
    en = "en"


class User(SQLAlchemyBaseUserTableUUID, Base):
    """Inherits id (uuid pk), email, hashed_password, is_active, is_superuser,
    is_verified from SQLAlchemyBaseUserTableUUID. We layer name + role +
    restaurant_id + language preference on top."""

    __tablename__ = "users"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.staff, nullable=False)
    language_pref: Mapped[LanguagePref] = mapped_column(
        Enum(LanguagePref), default=LanguagePref.ja, nullable=False
    )
    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False
    )

    restaurant: Mapped["Restaurant"] = relationship(back_populates="users")
