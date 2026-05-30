"""Restaurant + service windows + venue-level settings."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime, time
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Time,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.operations import QueueEntry, Transaction, Invoice


class VenueType(str, enum.Enum):
    ramen = "ramen"
    sushi = "sushi"
    tempura = "tempura"
    tonkatsu = "tonkatsu"
    yakiniku = "yakiniku"
    kaiseki = "kaiseki"
    cafe = "cafe"
    other = "other"


class Restaurant(Base):
    __tablename__ = "restaurants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    name_ja: Mapped[str | None] = mapped_column(String(255), nullable=True)
    venue_type: Mapped[VenueType] = mapped_column(Enum(VenueType), default=VenueType.other)
    avg_check_size: Mapped[int] = mapped_column(Integer, nullable=False)  # in yen (or minor unit of currency)
    currency: Mapped[str] = mapped_column(String(3), default="JPY")
    seat_count: Mapped[int] = mapped_column(Integer, default=20)
    avg_turn_minutes: Mapped[int] = mapped_column(Integer, default=60)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    users: Mapped[list["User"]] = relationship(back_populates="restaurant", cascade="all, delete-orphan")
    service_windows: Mapped[list["ServiceWindow"]] = relationship(
        back_populates="restaurant", cascade="all, delete-orphan"
    )
    settings: Mapped["VenueSettings | None"] = relationship(
        back_populates="restaurant", uselist=False, cascade="all, delete-orphan"
    )
    queue_entries: Mapped[list["QueueEntry"]] = relationship(back_populates="restaurant")
    transactions: Mapped[list["Transaction"]] = relationship(back_populates="restaurant")
    invoices: Mapped[list["Invoice"]] = relationship(back_populates="restaurant")


class ServiceWindow(Base):
    __tablename__ = "service_windows"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(50), nullable=False)  # e.g. "lunch", "dinner"
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    # 0=Mon … 6=Sun. Postgres array makes per-day toggling cheap.
    days_of_week: Mapped[list[int]] = mapped_column(ARRAY(Integer), nullable=False)

    restaurant: Mapped["Restaurant"] = relationship(back_populates="service_windows")


class VenueSettings(Base):
    """Operator-tunable guardrails. The dashboard backend reads these on every
    /v2/price call and refuses to forward to the pricing engine when paused or
    when caps would be breached. Mirrors the spec's Section 3 venue_settings."""

    __tablename__ = "venue_settings"

    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), primary_key=True
    )
    max_premium_share: Mapped[float] = mapped_column(Float, default=0.13)  # 12-15% target band
    price_floor: Mapped[int] = mapped_column(Integer, default=500)
    price_ceiling: Mapped[int] = mapped_column(Integer, default=15000)
    max_party_size_eligible: Mapped[int] = mapped_column(Integer, default=4)
    large_party_cap_per_service: Mapped[int] = mapped_column(Integer, default=1)
    premium_paused: Mapped[bool] = mapped_column(Boolean, default=False)  # the big pause button
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    restaurant: Mapped["Restaurant"] = relationship(back_populates="settings")
