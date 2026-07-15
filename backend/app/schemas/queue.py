"""Pydantic schemas for queue endpoints."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.operations import QueueEntryStatus, QueueEntryType


class QueueEntryCreate(BaseModel):
    party_size: int = Field(ge=1, le=20)
    entry_type: QueueEntryType = QueueEntryType.regular
    party_name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=500)
    skip_price: int | None = None  # yen — set when entry_type=premium
    # Offer-to-sale linkage: the quote session this party accepted (joins to
    # price_quote_logs) and the engine's quoted price at acceptance time.
    pricing_session_id: str | None = Field(default=None, max_length=64)
    quoted_price: int | None = None


class QueueEntryRead(BaseModel):
    id: uuid.UUID
    restaurant_id: uuid.UUID
    ticket_no: int | None = None
    party_size: int
    entry_type: QueueEntryType
    party_name: str | None
    phone: str | None
    notes: str | None
    joined_at: datetime
    seated_at: datetime | None
    walked_away_at: datetime | None = None
    status: QueueEntryStatus
    skip_price: int | None
    quoted_price: int | None = None
    predicted_wait_at_join: float | None = None

    model_config = {"from_attributes": True}


class QueueState(BaseModel):
    """Summary snapshot for the live ops header."""

    regular_waiting: int
    premium_waiting: int
    total_waiting: int
    avg_wait_minutes: float | None = None

    # "Today" = JST midnight → now. Counts/sums of seated parties only.
    seated_today: int = 0
    premium_revenue_today: int = 0  # in venue currency minor units (yen)
    # Median of COMPLETED waits today (seated_at - joined_at). Unlike the
    # elapsed-time average of still-waiting parties, this can't understate.
    median_wait_today_mins: float | None = None
