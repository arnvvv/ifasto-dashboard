"""Queue entries, transactions, and invoices — operational + billing records."""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.restaurant import Restaurant, ServiceWindow


class QueueEntryType(str, enum.Enum):
    regular = "regular"
    premium = "premium"


class QueueEntryStatus(str, enum.Enum):
    waiting = "waiting"
    seated = "seated"
    walked_away = "walked_away"


class InvoiceStatus(str, enum.Enum):
    draft = "draft"
    sent = "sent"
    paid = "paid"


class QueueEntry(Base):
    __tablename__ = "queue_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False, index=True
    )
    party_size: Mapped[int] = mapped_column(Integer, nullable=False)
    entry_type: Mapped[QueueEntryType] = mapped_column(
        Enum(QueueEntryType), default=QueueEntryType.regular, nullable=False
    )
    # Optional contact for the seat-next host (call out by name, or SMS later).
    party_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    seated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[QueueEntryStatus] = mapped_column(
        Enum(QueueEntryStatus), default=QueueEntryStatus.waiting, nullable=False
    )
    skip_price: Mapped[int | None] = mapped_column(Integer, nullable=True)  # yen, if premium

    restaurant: Mapped["Restaurant"] = relationship(back_populates="queue_entries")
    transaction: Mapped["Transaction | None"] = relationship(
        back_populates="queue_entry", uselist=False
    )


class Transaction(Base):
    """One row per premium skip-pass sold. The dashboard does NOT collect
    customer money (Model B) — restaurant collects directly. This row is the
    record of what happened + the 70/30 split for invoicing."""

    __tablename__ = "transactions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False, index=True
    )
    queue_entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("queue_entries.id"), nullable=False, unique=True
    )
    gross_amount: Mapped[int] = mapped_column(Integer, nullable=False)  # yen — what customer paid
    restaurant_share: Mapped[int] = mapped_column(Integer, nullable=False)  # 70%
    ifasto_fee: Mapped[int] = mapped_column(Integer, nullable=False)  # 30%
    service_window_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("service_windows.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    restaurant: Mapped["Restaurant"] = relationship(back_populates="transactions")
    queue_entry: Mapped["QueueEntry"] = relationship(back_populates="transaction")
    service_window: Mapped["ServiceWindow | None"] = relationship()


class Invoice(Base):
    """Monthly billing of ifasto's 30% fee to the restaurant.
    Owes-direction: restaurant pays ifasto (Model B)."""

    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False, index=True
    )
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    total_gross: Mapped[int] = mapped_column(Integer, nullable=False)  # sum of transactions in period
    total_ifasto_fee: Mapped[int] = mapped_column(Integer, nullable=False)  # what restaurant owes ifasto
    status: Mapped[InvoiceStatus] = mapped_column(
        Enum(InvoiceStatus), default=InvoiceStatus.draft, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    restaurant: Mapped["Restaurant"] = relationship(back_populates="invoices")
