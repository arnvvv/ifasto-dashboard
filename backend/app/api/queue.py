"""Queue management API — add, list, seat, walk-away, state.

All endpoints are scoped to the authenticated user's restaurant.
Every state-changing endpoint also fires an event over the WebSocket
broadcaster so connected live-ops boards update in real time.
"""

from __future__ import annotations

import uuid
from datetime import datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.broadcast import broadcaster
from app.auth.users import current_active_user
from app.database import get_session
from app.models.operations import (
    QueueEntry,
    QueueEntryStatus,
    QueueEntryType,
    Transaction,
)
from app.models.restaurant import Restaurant
from app.models.user import User
from app.schemas.queue import QueueEntryCreate, QueueEntryRead, QueueState
from app.services.engine_events import notify_engine
from app.services.engine_payload import (
    build_engine_payload,
    get_venue_settings,
    predict_wait_best_effort,
    queue_pressure,
)

router = APIRouter()

# Pilot is Tokyo-only; Japan has no DST, fixed +09:00. Per-restaurant tz when
# we expand outside Japan.
JST = timezone(timedelta(hours=9))


def _today_start_utc() -> datetime:
    """JST midnight today, expressed in UTC for DB comparison."""
    jst_now = datetime.now(JST)
    jst_midnight = datetime.combine(jst_now.date(), time.min, tzinfo=JST)
    return jst_midnight.astimezone(timezone.utc)


async def compute_queue_state(
    session: AsyncSession, restaurant_id: uuid.UUID
) -> QueueState:
    """Header snapshot — waiting counts + today's seated/revenue totals."""
    waiting_stmt = select(QueueEntry).where(
        QueueEntry.restaurant_id == restaurant_id,
        QueueEntry.status == QueueEntryStatus.waiting,
    )
    waiting = list((await session.execute(waiting_stmt)).scalars().all())

    regular = sum(1 for e in waiting if e.entry_type == QueueEntryType.regular)
    premium = sum(1 for e in waiting if e.entry_type == QueueEntryType.premium)

    now = datetime.now(timezone.utc)
    waits = [
        max(0.0, (now - e.joined_at.replace(tzinfo=e.joined_at.tzinfo or timezone.utc)).total_seconds() / 60.0)
        for e in waiting
    ]
    avg_wait = sum(waits) / len(waits) if waits else None

    today_start = _today_start_utc()
    today_stmt = select(
        func.count(QueueEntry.id),
        func.coalesce(func.sum(QueueEntry.skip_price), 0),
    ).where(
        QueueEntry.restaurant_id == restaurant_id,
        QueueEntry.status == QueueEntryStatus.seated,
        QueueEntry.seated_at >= today_start,
    )
    seated_today, premium_revenue_today = (await session.execute(today_stmt)).one()

    # Median COMPLETED wait today — the honest tile number (elapsed-time
    # averages of still-waiting parties systematically understate).
    dur_stmt = select(QueueEntry.joined_at, QueueEntry.seated_at).where(
        QueueEntry.restaurant_id == restaurant_id,
        QueueEntry.status == QueueEntryStatus.seated,
        QueueEntry.seated_at >= today_start,
    )
    durations = sorted(
        (se - jo).total_seconds() / 60.0
        for jo, se in (await session.execute(dur_stmt)).all()
        if jo is not None and se is not None
    )
    median_wait_today = (
        round(durations[len(durations) // 2], 1) if durations else None
    )

    return QueueState(
        regular_waiting=regular,
        premium_waiting=premium,
        total_waiting=regular + premium,
        avg_wait_minutes=round(avg_wait, 1) if avg_wait is not None else None,
        seated_today=int(seated_today or 0),
        premium_revenue_today=int(premium_revenue_today or 0),
        median_wait_today_mins=median_wait_today,
    )


async def _broadcast(
    session: AsyncSession,
    restaurant_id: uuid.UUID,
    event_type: str,
    entry: QueueEntry,
) -> None:
    """Fan an event + a fresh state snapshot out to all live-ops clients."""
    state = await compute_queue_state(session, restaurant_id)
    payload = {
        "event": event_type,
        "entry": QueueEntryRead.model_validate(entry).model_dump(mode="json"),
        "state": state.model_dump(mode="json"),
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
    return await compute_queue_state(session, user.restaurant_id)


# ---------------------------------------------------------------------------
# Write endpoints
# ---------------------------------------------------------------------------

@router.post("/entries", response_model=QueueEntryRead, status_code=201)
async def add_to_queue(
    body: QueueEntryCreate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> QueueEntry:
    # --- Join-time snapshot, computed BEFORE the new entry exists so the
    # party doesn't count itself (and before session.add so autoflush can't
    # sneak it into the waiting query). Every field here is a training
    # feature that cannot be reconstructed later.
    pre_state = await compute_queue_state(session, user.restaurant_id)
    restaurant = await session.get(Restaurant, user.restaurant_id)

    pressure_at_join: float | None = None
    predicted_wait: float | None = None
    prediction_request_id: str | None = None
    if restaurant is not None:
        pressure_at_join = queue_pressure(
            pre_state.regular_waiting, pre_state.premium_waiting, restaurant.seat_count
        )
        vs = await get_venue_settings(session, user.restaurant_id)
        venue_config, queue_state = build_engine_payload(
            restaurant,
            vs,
            pre_state.regular_waiting,
            pre_state.premium_waiting,
            body.party_size,
        )
        # Release the read transaction BEFORE the HTTP call — a slow engine
        # must not hold this connection idle-in-transaction for up to 2s.
        await session.commit()
        # Best-effort L1 prediction (2s timeout, NULL on failure) — engine
        # downtime must never block a join.
        predicted_wait, prediction_request_id = await predict_wait_best_effort(
            venue_config, queue_state
        )

    entry = QueueEntry(
        restaurant_id=user.restaurant_id,
        party_size=body.party_size,
        entry_type=body.entry_type,
        party_name=body.party_name,
        phone=body.phone,
        notes=body.notes,
        skip_price=body.skip_price,
        status=QueueEntryStatus.waiting,
        queue_ahead_regular=pre_state.regular_waiting,
        queue_ahead_premium=pre_state.premium_waiting,
        queue_pressure_at_join=pressure_at_join,
        predicted_wait_at_join=predicted_wait,
        prediction_request_id=prediction_request_id,
        pricing_session_id=body.pricing_session_id,
        quoted_price=body.quoted_price,
    )
    session.add(entry)
    await session.commit()
    await session.refresh(entry)
    # Keep the pricing engine's Redis counters in sync. Premium joins are a
    # queue_join + premium_purchase pair (purchase decrements the queue).
    if body.entry_type == QueueEntryType.premium:
        notify_engine(user.restaurant_id, [
            ("queue_join", body.party_size),
            ("premium_purchase", body.party_size),
        ])
    else:
        notify_engine(user.restaurant_id, [("queue_join", body.party_size)])
    await _broadcast(session, user.restaurant_id, "joined", entry)
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

    # Premium seat = the sale actually happened. Write the Transaction row
    # (70/30 split) that invoicing reads. gross = what was charged
    # (skip_price, falling back to the engine quote). select-first keeps a
    # concurrent double-tap from tripping the unique(queue_entry_id).
    if entry.entry_type == QueueEntryType.premium:
        gross = entry.skip_price or entry.quoted_price
        if gross and gross > 0:
            existing = (await session.execute(
                select(Transaction).where(Transaction.queue_entry_id == entry.id)
            )).scalar_one_or_none()
            if existing is None:
                restaurant_share = round(gross * 0.70)
                session.add(Transaction(
                    restaurant_id=user.restaurant_id,
                    queue_entry_id=entry.id,
                    gross_amount=gross,
                    restaurant_share=restaurant_share,
                    ifasto_fee=gross - restaurant_share,
                ))

    await session.commit()
    await session.refresh(entry)
    # Engine sync: a REGULAR seat leaves the engine's queue count; a premium
    # party already left it at purchase time (premium_purchase decrements).
    if entry.entry_type == QueueEntryType.regular:
        notify_engine(user.restaurant_id, [("queue_leave", entry.party_size)])
    await _broadcast(session, user.restaurant_id, "seated", entry)
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
    entry.walked_away_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(entry)
    # Engine sync: regular walk-away leaves the queue; premium walk-away
    # releases the premium slot (frees the per-category cap).
    if entry.entry_type == QueueEntryType.premium:
        notify_engine(user.restaurant_id, [("premium_release", entry.party_size)])
    else:
        notify_engine(user.restaurant_id, [("queue_leave", entry.party_size)])
    await _broadcast(session, user.restaurant_id, "walked_away", entry)
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
