"""Schemas for operator venue settings (pause + caps)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class VenueSettingsRead(BaseModel):
    restaurant_id: uuid.UUID
    max_premium_share: float
    price_floor: int
    price_ceiling: int
    max_party_size_eligible: int
    large_party_cap_per_service: int
    premium_paused: bool
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class VenueSettingsUpdate(BaseModel):
    """Partial update — only supplied fields change. Bounds keep an operator
    typo from wedging the pricing engine (share is a fraction, not a %)."""

    max_premium_share: Optional[float] = Field(default=None, ge=0.01, le=0.5)
    price_floor: Optional[int] = Field(default=None, ge=0, le=100_000)
    price_ceiling: Optional[int] = Field(default=None, ge=100, le=1_000_000)
    max_party_size_eligible: Optional[int] = Field(default=None, ge=1, le=20)
    large_party_cap_per_service: Optional[int] = Field(default=None, ge=0, le=50)
    premium_paused: Optional[bool] = None
