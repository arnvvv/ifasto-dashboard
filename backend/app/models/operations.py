"""Queue entries, transactions, and invoices — operational + billing records."""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
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
    # Daily per-venue ticket number (整理券番号) — what staff call out. Resets
    # implicitly: computed as max(today's tickets)+1 at join time.
    ticket_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
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
    walked_away_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[QueueEntryStatus] = mapped_column(
        Enum(QueueEntryStatus), default=QueueEntryStatus.waiting, nullable=False
    )
    skip_price: Mapped[int | None] = mapped_column(Integer, nullable=True)  # yen, if premium

    # --- Join-time snapshot (training-data capture) ---
    # State of the world the moment this party joined. Together with the
    # outcome (seated_at - joined_at, or walked_away_at) each row becomes a
    # complete (features, prediction, label) triple. Cannot be backfilled.
    queue_ahead_regular: Mapped[int | None] = mapped_column(Integer, nullable=True)
    queue_ahead_premium: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Waiting parties / seat_count at join — queue-side load, NOT dining-room
    # occupancy (the dashboard has no table state to know that).
    queue_pressure_at_join: Mapped[float | None] = mapped_column(Float, nullable=True)
    predicted_wait_at_join: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Echoed into the ML server's prediction JSONL — exact join key between
    # this row and the logged feature vector that produced the prediction.
    prediction_request_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    # --- Offer-to-sale linkage (premium entries) ---
    # session_id used to fetch/lock the quote this party accepted; joins to
    # price_quote_logs.session_id. quoted_price = what the engine quoted;
    # skip_price = what the operator actually charged (override is signal).
    pricing_session_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    quoted_price: Mapped[int | None] = mapped_column(Integer, nullable=True)

    restaurant: Mapped["Restaurant"] = relationship(back_populates="queue_entries")
    transaction: Mapped["Transaction | None"] = relationship(
        back_populates="queue_entry", uselist=False
    )


class PriceQuoteLog(Base):
    """One row per /api/pricing/quote call, INCLUDING refusals.

    This is the conversion dataset: joined against premium QueueEntries it
    yields price-shown vs price-accepted at a known queue state, which is the
    input to elasticity estimation. `source` separates the ops-header tile's
    15s polling ('tile_poll') from real operator-initiated quotes ('offer')
    so polls never pollute the conversion denominator."""

    __tablename__ = "price_quote_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False, index=True
    )
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="offer")
    party_size: Mapped[int] = mapped_column(Integer, nullable=False)
    # "ok" | "premium_paused" | "large_party_cap_reached" | "engine_unavailable"
    # | engine-declined statuses (e.g. "unavailable_hard_cap")
    outcome: Mapped[str] = mapped_column(String(40), nullable=False)
    price_minor: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    predicted_wait_mins: Mapped[float | None] = mapped_column(Float, nullable=True)
    premium_share_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    multipliers: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    queue_regular: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    queue_premium: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    session_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Echoed into the ML server's prediction JSONL for exact log joins.
    request_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class WtpSurvey(Base):
    """Field intercept survey: stated willingness-to-pay, collected standing
    in real queues. Column names mirror queue_entries/price_quote_logs so
    rows stack in analysis (UNION in the elasticity script); deliberately a
    SEPARATE table so stated preference never contaminates the model's
    label source or the conversion denominator."""

    __tablename__ = "wtp_surveys"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Null for field venues that aren't in the system (most of them).
    restaurant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=True
    )
    venue_label: Mapped[str] = mapped_column(String(120), nullable=False)
    observed_wait_mins: Mapped[int | None] = mapped_column(Integer, nullable=True)
    party_size: Mapped[int] = mapped_column(Integer, nullable=False)
    respondent: Mapped[str] = mapped_column(String(10), nullable=False)  # tourist | local
    would_skip: Mapped[bool] = mapped_column(Boolean, nullable=False)
    max_fee_yen: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reason: Mapped[str | None] = mapped_column(String(80), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
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
