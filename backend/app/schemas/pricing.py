"""Schemas for the pricing bridge. PriceQuote mirrors pricing_engine.PriceResult
so the engine's JSON validates straight through. The browser sends a small
input (party_size + optional session_id / service_id); the server builds the
venue_config from the operator's own Restaurant + VenueSettings."""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class PriceQuoteRequest(BaseModel):
    party_size: int = Field(ge=1, le=20)
    service_id: Optional[str] = None
    session_id: Optional[str] = None  # pass to lock the price for 5 min


class PriceQuote(BaseModel):
    status: str
    venue_id: str
    party_size: int
    party_size_category: str
    currency: str
    minor_units: int
    price_minor: Optional[int] = None
    price_major: Optional[float] = None
    base_minor: Optional[int] = None
    floor_minor: Optional[int] = None
    ceiling_minor: Optional[int] = None
    raw_minor: Optional[int] = None
    multipliers: dict[str, Any] = {}
    predicted_wait_mins: Optional[float] = None
    premium_share_pct: Optional[float] = None
    queue_count: Optional[int] = None
    premium_count_in_category: Optional[int] = None
    hard_cap_for_category: Optional[int] = None
    session_id: Optional[str] = None
    valid_until_ts: Optional[float] = None
    valid_for_seconds: Optional[int] = None
    message: Optional[str] = None
