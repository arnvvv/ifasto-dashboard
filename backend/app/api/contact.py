"""Public contact endpoint for the marketing site's pilot form.

No auth (prospects have no accounts). Abuse controls: strict field bounds,
5 submissions per IP per hour, honeypot field. Rows land in Postgres; the
founder reads them via SQL until the admin surface exists.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.operations import ContactInquiry

router = APIRouter()

WINDOW_S = 3600
MAX_PER_WINDOW = 5
_submissions: dict[str, deque] = defaultdict(deque)


class ContactCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    venue_name: Optional[str] = Field(default=None, max_length=160)
    area: Optional[str] = Field(default=None, max_length=120)
    contact: str = Field(min_length=3, max_length=200)
    message: Optional[str] = Field(default=None, max_length=2000)
    locale: Optional[Literal["ja", "en"]] = None
    # Honeypot: real users never fill this; bots do.
    website: Optional[str] = Field(default=None, max_length=200)


@router.post("", status_code=201)
async def create_inquiry(
    body: ContactCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    # Honeypot trips → pretend success, store nothing.
    if body.website:
        return {"ok": True}

    fwd = request.headers.get("x-forwarded-for", "")
    ip = fwd.split(",")[0].strip() or (request.client.host if request.client else "unknown")
    now = time.monotonic()
    bucket = _submissions[ip]
    while bucket and now - bucket[0] > WINDOW_S:
        bucket.popleft()
    if len(bucket) >= MAX_PER_WINDOW:
        raise HTTPException(status_code=429, detail="Too many submissions. Try later.")
    bucket.append(now)
    if len(_submissions) > 10_000:
        _submissions.clear()

    session.add(ContactInquiry(
        name=body.name.strip(),
        venue_name=(body.venue_name or "").strip() or None,
        area=(body.area or "").strip() or None,
        contact=body.contact.strip(),
        message=(body.message or "").strip() or None,
        locale=body.locale,
    ))
    await session.commit()
    return {"ok": True}
