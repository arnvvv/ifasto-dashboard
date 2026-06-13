"""Pricing API — server-side bridge to the ML pricing engine (/v2/price).

The dashboard never calls the pricing engine directly from the browser. This
router is the single trusted path: it is auth- and tenant-scoped, it builds the
venue_config from the operator's own Restaurant + VenueSettings (so the browser
can't spoof anchors/caps), it pulls the live QueueState, and it enforces the
operator guardrails BEFORE forwarding:

  - refuses (409) when VenueSettings.premium_paused is True
  - refuses (409) when the per-service large-party cap is already met for a
    party that exceeds max_party_size_eligible

Mirrors the conventions in app/api/queue.py:
  - Depends(current_active_user) + get_session on every route
  - every query filters on user.restaurant_id
  - no state change here, so no WS broadcast

Known follow-ups (post-this-PR):
  - tourist_density_pct is hard-coded to 0.7 because there is no column for it
    yet on Restaurant/VenueSettings. When we add one, swap it in here.
  - The pricing engine keeps its OWN Redis-backed premium-share counter,
    populated by /v2/event. The dashboard doesn't fire /v2/event yet, so the
    engine's pressure multiplier may not reflect the dashboard's queue. The
    engine still returns a usable quote (anchored to avg check); pressure
    accuracy is the follow-up.
"""

from __future__ import annotations

import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.queue import compute_queue_state
from app.auth.users import current_active_user
from app.config import settings
from app.database import get_session
from app.models.operations import (
    QueueEntry,
    QueueEntryStatus,
    QueueEntryType,
)
from app.models.restaurant import Restaurant, VenueSettings
from app.models.user import User
from app.schemas.pricing import PriceQuote, PriceQuoteRequest

router = APIRouter()

# Until tourist density becomes a per-venue column, all pilot venues are
# Tokyo and inherit a single sensible default.
_DEFAULT_TOURIST_DENSITY = 0.7

# Engine's category split: parties > max_party_size_eligible are "large".
# Mirroring it locally so we can short-circuit the per-category cap before
# paying the round-trip to the engine.
def _category(party_size: int, max_eligible: int) -> str:
    return "small" if party_size <= max_eligible else "large"


async def _get_settings(session: AsyncSession, restaurant_id: uuid.UUID) -> VenueSettings:
    vs = await session.get(VenueSettings, restaurant_id)
    if vs is None:
        # No row yet → fall back to model defaults so a freshly-minted venue
        # still quotes. (Defaults match the column server-defaults.)
        vs = VenueSettings(restaurant_id=restaurant_id)
    return vs


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

    vs = await _get_settings(session, restaurant_id)

    # ---- Operator guardrails, enforced BEFORE we forward to the engine ----
    if vs.premium_paused:
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
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail={
                    "reason": "large_party_cap_reached",
                    "message": "Large-party skip cap reached for this service.",
                },
            )

    # ---- Live queue state drives the Tokyo L1 wait predictor ----
    qstate = await compute_queue_state(session, restaurant_id)
    total_queue = qstate.regular_waiting + qstate.premium_waiting

    # venue_config carries both pricing-engine anchors AND wait-predictor
    # structural features. The engine schema is documented in
    # pricing_engine._validate_venue_config; the predictor schema in
    # ml_server.predict_tokyo_wait.
    venue_config: dict = {
        # Identity + currency
        "venue_id": str(restaurant_id),
        "service_id": body.service_id or f"{restaurant_id}:default",
        "currency": restaurant.currency,
        "minor_units": 0 if restaurant.currency == "JPY" else 2,
        # Pricing anchors — engine derives base/floor/ceiling from these:
        "avg_check_size_minor": restaurant.avg_check_size,
        "tourist_density_pct": _DEFAULT_TOURIST_DENSITY,
        "max_premium_cap_minor": vs.price_ceiling,
        "max_premium_share": vs.max_premium_share,
        # Wait predictor structural features (rest have engine-side defaults):
        "capacity": restaurant.seat_count,
        "avg_dining_min": restaurant.avg_turn_minutes,
    }
    queue_state: dict = {
        "queue_length": total_queue,
        "current_occupancy_pct": min(1.0, total_queue / max(1, restaurant.seat_count)),
        "party_size": body.party_size,
    }

    payload: dict = {
        "venue_config": venue_config,
        "queue_state": queue_state,
        "party_size": body.party_size,
    }
    if body.session_id:
        payload["session_id"] = body.session_id

    url = settings.pricing_engine_url.rstrip("/") + "/v2/price"
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            result = resp.json()
    except httpx.HTTPError as exc:
        # Engine down / slow → don't 500 the dashboard. Surface a clean
        # "no quote available" the operator UI can render as a dash.
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "reason": "engine_unavailable",
                "message": "Pricing engine did not respond.",
            },
        ) from exc

    # The engine itself may decline (e.g. its own per-category hard cap).
    if result.get("status") != "ok":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "reason": result.get("status", "unavailable"),
                "message": result.get("message") or "Price unavailable.",
            },
        )

    return PriceQuote(**result)
