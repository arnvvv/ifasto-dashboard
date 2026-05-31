"""Queue management API — add, list, seat, walk-away, state.

All endpoints are scoped to the authenticated user's restaurant.
Every state-changing endpoint also fires an event over the WebSocket
broadcaster so connected live-ops boards update in real time.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.broadcast import broadcaster
from app.auth.users import current_active_user
from app.database import get_session
from app.models.operations import QueueEntry, QueueEntryStatus, QueueEntryType
from app.models.user import User
from app.schemas.queue import QueueEntryCreate, QueueEntryRead, QueueState

router = APIRouter()


async def _broadcast(restaurant_id: uuid.UUID, event_type: str, entry: QueueEntry) -> None:
    """Fan an event out to all connected live-ops clients for this restaurant."""
    payload = {
        "event": event_type,
        "entry": QueueEntryRead.model_validate(entry).model_dump(mode="json"),
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    await broadcaster.broadcast(restaurant_id, payload)


# ---------------------------------------------------------------------------
# Read endpoints
# ---------------------------------------------------------------------------

@router.get("/entries", response_model=list[QueueEntryRead])
async def list_active_queue(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> list[QueueEntry]:
    """Active (waiting) entries for the current user's restaurant, in join order."""
    stmt = (
        select(QueueEntry)
        .where(
            QueueEntry.restaurant_id == user.restaurant_id,
            QueueEntry.status == QueueEntryStatus.waiting,
        )
        .order_by(QueueEntry.joined_at.asc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


@router.get("/state", response_model=QueueState)
async def queue_state(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> QueueState:
    """Header summary for the live-ops view."""
    stmt = select(QueueEntry).where(
        QueueEntry.restaurant_id == user.restaurant_id,
        QueueEntry.status == QueueEntryStatus.waiting,
    )
    result = await session.execute(stmt)
    entries = list(result.scalars().all())

    regular = sum(1 for e in entries if e.entry_type == QueueEntryType.regular)
    premium = sum(1 for e in entries if e.entry_type == QueueEntryType.premium)

    # Naive wait estimate: avg time the currently-waiting parties have been
    # waiting so far. (A real implementation calls the L1 model; v1 keeps it
    # simple — better than nothing on the header.)
    now = datetime.now(timezone.utc)
    waits = [
        max(0.0, (now - e.joined_at.replace(tzinfo=e.joined_at.tzinfo or timezone.utc)).total_seconds() / 60.0)
        for e in entries
    ]
    avg_wait = sum(waits) / len(waits) if waits else None

    return QueueState(
        regular_waiting=regular,
        premium_waiting=premium,
        total_waiting=regular + premium,
        avg_wait_minutes=round(avg_wait, 1) if avg_wait is not None else None,
    )


# ---------------------------------------------------------------------------
# Write endpoints
# ---------------------------------------------------------------------------

@router.post("/entries", response_model=QueueEntryRead, status_code=201)
async def add_to_queue(
    body: QueueEntryCreate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> QueueEntry:
    entry = QueueEntry(
        restaurant_id=user.restaurant_id,
        party_size=body.party_size,
        entry_type=body.entry_type,
        party_name=body.party_name,
        phone=body.phone,
        notes=body.notes,
        skip_price=body.skip_price,
        status=QueueEntryStatus.waiting,
    )
    session.add(entry)
    await session.commit()
    await session.refresh(entry)
    await _broadcast(user.restaurant_id, "joined", entry)
    return entry


@router.patch("/entries/{entry_id}/seat", response_model=QueueEntryRead)
async def seat_entry(
    entry_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> QueueEntry:
    entry = await _get_entry_scoped(session, entry_id, user.restaurant_id)
    if entry.status != QueueEntryStatus.waiting:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Entry is already {entry.status.value}, cannot seat.",
        )
    entry.status = QueueEntryStatus.seated
    entry.seated_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(entry)
    await _broadcast(user.restaurant_id, "seated", entry)
    return entry


@router.patch("/entries/{entry_id}/walk-away", response_model=QueueEntryRead)
async def walk_away(
    entry_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> QueueEntry:
    entry = await _get_entry_scoped(session, entry_id, user.restaurant_id)
    if entry.status != QueueEntryStatus.waiting:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Entry is already {entry.status.value}, cannot mark walked-away.",
        )
    entry.status = QueueEntryStatus.walked_away
    await session.commit()
    await session.refresh(entry)
    await _broadcast(user.restaurant_id, "walked_away", entry)
    return entry


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_entry_scoped(
    session: AsyncSession, entry_id: uuid.UUID, restaurant_id: uuid.UUID
) -> QueueEntry:
    """Fetch an entry but only if it belongs to the caller's restaurant.
    Prevents cross-tenant access via guessed UUIDs."""
    stmt = select(QueueEntry).where(
        QueueEntry.id == entry_id,
        QueueEntry.restaurant_id == restaurant_id,
    )
    result = await session.execute(stmt)
    entry = result.scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Queue entry not found.")
    return entry
