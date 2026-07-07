"""Schemas for the WTP intercept survey."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class SurveyCreate(BaseModel):
    venue_label: str = Field(min_length=1, max_length=120)
    observed_wait_mins: Optional[int] = Field(default=None, ge=0, le=600)
    party_size: int = Field(ge=1, le=20)
    respondent: Literal["tourist", "local"]
    would_skip: bool
    max_fee_yen: Optional[int] = Field(default=None, ge=0, le=50_000)
    reason: Optional[str] = Field(default=None, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=500)


class SurveyRead(SurveyCreate):
    id: uuid.UUID
    restaurant_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}
