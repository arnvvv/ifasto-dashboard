"""Pricing API — server-side bridge to the ML pricing engine (/v2/price).

The dashboard never calls the pricing engine directly from the browser. This
router is the single trusted path: it is auth- and tenant-scoped, it builds the
venue_config from the operator's own Restaurant + VenueSettings (so the browser
can't spoof anchors/caps), it pulls the live QueueState, and it enforces the
operator guardrails BEFORE forwarding:

  - refuses (409) when VenueSettings.premium_paused is True
  - refuses (409) when the per-service large-party cap is already met for a
    party that exceeds max_party_size_eligible

Every call — refusals included — writes a PriceQuoteLog row. That log is the
conversion dataset: price shown vs price accepted at a known queue state.
The payload itself comes from app/services/engine_payload.py, shared with the
queue API's join-time snapshot so quote features and training features can't
drift apart.

Mirrors the conventions in app/api/queue.py:
  - Depends(current_active_user) + get_session on every route
  - every query filters on user.restaurant_id
  - no state change visible to other clients, so no WS broadcast
"""

from __future__ import annotations

import uuid
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.queue import compute_queue_state
from app.auth.users import current_active_user
from app.config import settings
from app.database import get_session
from app.models.operations import (
    PriceQuoteLog,
    QueueEntry,
    QueueEntryStatus,
    QueueEntryType,
)
from app.models.restaurant import Restaurant
from app.models.user import User
from app.schemas.pricing import PriceQuote, PriceQuoteRequest
from app.schemas.queue import QueueState
from app.services.engine_payload import (
    QUOTE_TIMEOUT_S,
    build_engine_payload,
    get_venue_settings,
)

router = APIRouter()


# Engine's category split: parties > max_party_size_eligible are "large".
# Mirroring it locally so we can short-circuit the per-category cap before
# paying the round-trip to the engine.
def _category(party_size: int, max_eligible: int) -> str:
    return "small" if party_size <= max_eligible else "large"


async def _count_premium_in_category(
    session: AsyncSession,
    restaurant_id: uuid.UUID,
    category: str,
    max_eligible: int,
) -> int:
    """How many *premium* parties of this size-category are currently waiting.
    Used to enforce large_party_cap_per_service before forwarding to the engine."""
    stmt = select(QueueEntry).where(
        QueueEntry.restaurant_id == restaurant_id,
        QueueEntry.status == QueueEntryStatus.waiting,
        QueueEntry.entry_type == QueueEntryType.premium,
    )
    rows = list((await session.execute(stmt)).scalars().all())
    return sum(1 for e in rows if _category(e.party_size, max_eligible) == category)


async def _log_quote(
    session: AsyncSession,
    restaurant_id: uuid.UUID,
    body: PriceQuoteRequest,
    outcome: str,
    qstate: QueueState | None,
    result: dict | None = None,
    request_id: str | None = None,
) -> None:
    """Persist one PriceQuoteLog row. Committed immediately so a subsequent
    HTTPException (whose handler rolls the session back) can't erase it."""
    r = result or {}
    session.add(PriceQuoteLog(
        restaurant_id=restaurant_id,
        source=body.source,
        party_size=body.party_size,
        outcome=outcome,
        price_minor=r.get("price_minor"),
        currency=r.get("currency"),
        predicted_wait_mins=r.get("predicted_wait_mins"),
        premium_share_pct=r.get("premium_share_pct"),
        multipliers=r.get("multipliers"),
        queue_regular=qstate.regular_waiting if qstate else 0,
        queue_premium=qstate.premium_waiting if qstate else 0,
        session_id=r.get("session_id") or body.session_id,
        request_id=request_id,
    ))
    await session.commit()


@router.post("/quote", response_model=PriceQuote)
async def quote_price(
    body: PriceQuoteRequest,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> PriceQuote:
    restaurant_id = user.restaurant_id

    restaurant = await session.get(Restaurant, restaurant_id)
    if restaurant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Restaurant not found")

    vs = await get_venue_settings(session, restaurant_id)

    # Live queue state up front so refusal logs still carry queue context.
    qstate = await compute_queue_state(session, restaurant_id)

    # ---- Operator guardrails, enforced BEFORE we forward to the engine ----
    if vs.premium_paused:
        await _log_quote(session, restaurant_id, body, "premium_paused", qstate)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "reason": "premium_paused",
                "message": "Skip pricing is paused for this venue.",
            },
        )

    category = _category(body.party_size, vs.max_party_size_eligible)
    if category == "large":
        in_cat = await _count_premium_in_category(
            session, restaurant_id, "large", vs.max_party_size_eligible
        )
        if in_cat >= vs.large_party_cap_per_service:
            await _log_quote(session, restaurant_id, body, "large_party_cap_reached", qstate)
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail={
                    "reason": "large_party_cap_reached",
                    "message": "Large-party skip cap reached for this service.",
                },
            )

    venue_config, queue_state = build_engine_payload(
        restaurant,
        vs,
        qstate.regular_waiting,
        qstate.premium_waiting,
        body.party_size,
        service_id=body.service_id,
    )

    request_id = str(uuid4())
    payload: dict = {
        "venue_config": venue_config,
        "queue_state": queue_state,
        "party_size": body.party_size,
        "source": body.source,
        "request_id": request_id,
    }
    if body.session_id:
        payload["session_id"] = body.session_id

    # Release the read transaction BEFORE the HTTP call — a slow engine must
    # not hold this connection idle-in-transaction for up to 4s.
    await session.commit()

    url = settings.pricing_engine_url.rstrip("/") + "/v2/price"
    try:
        async with httpx.AsyncClient(timeout=QUOTE_TIMEOUT_S) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            result = resp.json()
    except httpx.HTTPError as exc:
        # Engine down / slow → don't 500 the dashboard. Surface a clean
        # "no quote available" the operator UI can render as a dash.
        await _log_quote(session, restaurant_id, body, "engine_unavailable", qstate,
                         request_id=request_id)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "reason": "engine_unavailable",
                "message": "Pricing engine did not respond.",
            },
        ) from exc

    # Off-hours the L1 wait is a guard sentinel, not a prediction — a price
    # computed from it would be systematically wrong AND pollute the
    # conversion dataset as a legitimate quote. The public marketing demo
    # keeps working (it calls the engine directly and ignores this flag).
    if result.pop("out_of_service_hours", False):
        await _log_quote(session, restaurant_id, body, "out_of_service_hours",
                         qstate, result, request_id=request_id)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "reason": "out_of_service_hours",
                "message": "Outside service hours (11:00-23:00 JST); no live quote.",
            },
        )

    # The engine itself may decline (e.g. its own per-category hard cap).
    if result.get("status") != "ok":
        await _log_quote(
            session, restaurant_id, body,
            result.get("status", "engine_declined"), qstate, result,
            request_id=request_id,
        )
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "reason": result.get("status", "unavailable"),
                "message": result.get("message") or "Price unavailable.",
            },
        )

    await _log_quote(session, restaurant_id, body, "ok", qstate, result,
                     request_id=request_id)
    return PriceQuote(**result)
