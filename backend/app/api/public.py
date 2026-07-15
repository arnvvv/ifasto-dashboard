"""Public guest endpoints — the QR free-lane flow.

No auth: guests scan the door QR and join the queue from their phone.
Tenancy comes from the unguessable venue qr_token; entry status uses the
entry UUID itself as the capability (122 random bits).

Abuse controls: per-IP join limit, party-size bounds, a per-venue waiting
cap, and staff can walk-away anything that looks fake. Guest joins run the
SAME create_entry path as staff joins: identical capture, tickets, engine
sync, and live board broadcast.
"""

from __future__ import annotations

import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.queue import (
    _broadcast,
    compute_queue_state,
    create_entry,
)
from app.database import get_session
from app.models.operations import QueueEntry, QueueEntryStatus, QueueEntryType
from app.models.restaurant import Restaurant
from app.schemas.queue import QueueEntryCreate
from app.services.engine_events import notify_engine

router = APIRouter()

JOIN_WINDOW_S = 600
JOIN_MAX_PER_WINDOW = 3
# Refuse public joins beyond this many waiting parties — flood guard and an
# honest signal (a 60-party line should talk to the host anyway).
PUBLIC_JOIN_QUEUE_CAP = 60

_joins: dict[str, deque] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() or (request.client.host if request.client else "unknown")


async def _venue_by_token(session: AsyncSession, qr_token: str) -> Restaurant:
    if not qr_token or len(qr_token) > 48:
        raise HTTPException(status_code=404, detail="Unknown venue.")
    venue = (await session.execute(
        select(Restaurant).where(Restaurant.qr_token == qr_token)
    )).scalar_one_or_none()
    if venue is None:
        raise HTTPException(status_code=404, detail="Unknown venue.")
    return venue


class PublicJoin(BaseModel):
    party_size: int = Field(ge=1, le=8)


def _entry_public_view(entry: QueueEntry, parties_ahead: int, venue: Restaurant) -> dict:
    # Honest remaining estimate: join-time prediction minus elapsed, floored.
    # The p10/p90 band counts down the same way (it is a band on the same
    # wall-clock event, so elapsed time shifts all three identically).
    remaining = None
    remaining_p10 = None
    remaining_p90 = None
    if entry.predicted_wait_at_join is not None and entry.status == QueueEntryStatus.waiting:
        joined = entry.joined_at if entry.joined_at.tzinfo else entry.joined_at.replace(tzinfo=timezone.utc)
        elapsed = (datetime.now(timezone.utc) - joined).total_seconds() / 60.0
        remaining = max(0.0, round(entry.predicted_wait_at_join - elapsed, 1))
        if entry.predicted_wait_p10_at_join is not None and entry.predicted_wait_p90_at_join is not None:
            remaining_p10 = max(0.0, round(entry.predicted_wait_p10_at_join - elapsed, 1))
            remaining_p90 = max(0.0, round(entry.predicted_wait_p90_at_join - elapsed, 1))
    return {
        "entry_id": str(entry.id),
        "ticket_no": entry.ticket_no,
        "status": entry.status.value,
        "party_size": entry.party_size,
        "parties_ahead": parties_ahead,
        "called": entry.called_at is not None and entry.status == QueueEntryStatus.waiting,
        "est_remaining_mins": remaining,
        "est_remaining_p10": remaining_p10,
        "est_remaining_p90": remaining_p90,
        "venue_name": venue.name,
        "venue_name_ja": venue.name_ja,
        # Receipt fields: staff-sold fast passes surface as purchase proof on
        # the guest ticket page (Model B — the restaurant collected the money).
        "entry_type": entry.entry_type.value,
        "paid_amount": entry.skip_price if entry.entry_type == QueueEntryType.premium else None,
    }


@router.get("/venue/{qr_token}")
async def venue_info(
    qr_token: str,
    session: AsyncSession = Depends(get_session),
) -> dict:
    venue = await _venue_by_token(session, qr_token)
    state = await compute_queue_state(session, venue.id)
    return {
        "venue_name": venue.name,
        "venue_name_ja": venue.name_ja,
        "waiting": state.total_waiting,
        "accepting": state.total_waiting < PUBLIC_JOIN_QUEUE_CAP,
    }


@router.post("/venue/{qr_token}/join", status_code=201)
async def public_join(
    qr_token: str,
    body: PublicJoin,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    venue = await _venue_by_token(session, qr_token)

    ip = _client_ip(request)
    now = time.monotonic()
    bucket = _joins[ip]
    while bucket and now - bucket[0] > JOIN_WINDOW_S:
        bucket.popleft()
    if len(bucket) >= JOIN_MAX_PER_WINDOW:
        raise HTTPException(status_code=429, detail="Too many joins from this device.")
    bucket.append(now)
    if len(_joins) > 10_000:
        _joins.clear()

    state = await compute_queue_state(session, venue.id)
    if state.total_waiting >= PUBLIC_JOIN_QUEUE_CAP:
        raise HTTPException(status_code=409, detail="Queue is full; please see the host.")

    entry = await create_entry(session, venue.id, QueueEntryCreate(
        party_size=body.party_size,
        entry_type=QueueEntryType.regular,
    ))
    ahead = await _parties_ahead(session, entry)
    return _entry_public_view(entry, ahead, venue)


async def _parties_ahead(session: AsyncSession, entry: QueueEntry) -> int:
    stmt = select(QueueEntry).where(
        QueueEntry.restaurant_id == entry.restaurant_id,
        QueueEntry.status == QueueEntryStatus.waiting,
        QueueEntry.joined_at < entry.joined_at,
    )
    return len(list((await session.execute(stmt)).scalars().all()))


@router.get("/entry/{entry_id}")
async def entry_status(
    entry_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> dict:
    entry = await session.get(QueueEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Not found.")
    venue = await session.get(Restaurant, entry.restaurant_id)
    if venue is None:
        raise HTTPException(status_code=404, detail="Not found.")
    ahead = await _parties_ahead(session, entry) if entry.status == QueueEntryStatus.waiting else 0
    return _entry_public_view(entry, ahead, venue)


@router.post("/entry/{entry_id}/leave")
async def entry_leave(
    entry_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Guest-initiated cancel. Recorded as walked_away — and unlike a staff
    walk-away, we KNOW this one is a true abandonment (better labels)."""
    entry = await session.get(QueueEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Not found.")
    if entry.status != QueueEntryStatus.waiting:
        raise HTTPException(status_code=409, detail="No longer waiting.")
    entry.status = QueueEntryStatus.walked_away
    entry.walked_away_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(entry)
    if entry.entry_type == QueueEntryType.premium:
        notify_engine(entry.restaurant_id, [("premium_release", entry.party_size)])
    else:
        notify_engine(entry.restaurant_id, [("queue_leave", entry.party_size)])
    await _broadcast(session, entry.restaurant_id, "walked_away", entry)
    venue = await session.get(Restaurant, entry.restaurant_id)
    return _entry_public_view(entry, 0, venue)
