"""Shared quote path — used by the staff pricing API and the public guest
fast-pass endpoints so both run IDENTICAL guardrails (pause, pass-count cap,
large-party cap, service hours) and both feed the PriceQuoteLog conversion
dataset. Raises QuoteRefused instead of HTTPException so each caller maps
refusals to its own transport."""

from __future__ import annotations

import uuid
from uuid import uuid4

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.queue import compute_queue_state
from app.config import settings
from app.models.operations import (
    PriceQuoteLog,
    QueueEntry,
    QueueEntryStatus,
    QueueEntryType,
)
from app.models.restaurant import Restaurant
from app.schemas.queue import QueueState
from app.services.caps import allowed_passes
from app.services.engine_payload import (
    QUOTE_TIMEOUT_S,
    build_engine_payload,
    get_venue_settings,
)


class QuoteRefused(Exception):
    def __init__(self, reason: str, message: str):
        self.reason = reason
        self.message = message
        super().__init__(message)


def _category(party_size: int, max_eligible: int) -> str:
    return "small" if party_size <= max_eligible else "large"


async def _count_premium_in_category(
    session: AsyncSession, restaurant_id: uuid.UUID, category: str, max_eligible: int
) -> int:
    from sqlalchemy import select

    stmt = select(QueueEntry).where(
        QueueEntry.restaurant_id == restaurant_id,
        QueueEntry.status == QueueEntryStatus.waiting,
        QueueEntry.entry_type == QueueEntryType.premium,
    )
    rows = list((await session.execute(stmt)).scalars().all())
    return sum(1 for e in rows if _category(e.party_size, max_eligible) == category)


async def log_quote(
    session: AsyncSession,
    restaurant_id: uuid.UUID,
    source: str,
    party_size: int,
    outcome: str,
    qstate: QueueState | None,
    result: dict | None = None,
    request_id: str | None = None,
    session_id: str | None = None,
) -> None:
    r = result or {}
    session.add(PriceQuoteLog(
        restaurant_id=restaurant_id,
        source=source,
        party_size=party_size,
        outcome=outcome,
        price_minor=r.get("price_minor"),
        currency=r.get("currency"),
        predicted_wait_mins=r.get("predicted_wait_mins"),
        premium_share_pct=r.get("premium_share_pct"),
        multipliers=r.get("multipliers"),
        queue_regular=qstate.regular_waiting if qstate else 0,
        queue_premium=qstate.premium_waiting if qstate else 0,
        session_id=r.get("session_id") or session_id,
        request_id=request_id,
    ))
    await session.commit()


async def get_quote(
    session: AsyncSession,
    restaurant_id: uuid.UUID,
    party_size: int,
    source: str,
    service_id: str | None = None,
    session_id: str | None = None,
) -> dict:
    """Guardrails -> engine -> logged quote dict. Raises QuoteRefused on any
    refusal (also logged). NOTE: commits the session (releases the read txn
    before the engine HTTP call), same as the original staff path."""
    restaurant = await session.get(Restaurant, restaurant_id)
    if restaurant is None:
        raise QuoteRefused("venue_not_found", "Restaurant not found.")

    vs = await get_venue_settings(session, restaurant_id)
    qstate = await compute_queue_state(session, restaurant_id)

    if vs.premium_paused:
        await log_quote(session, restaurant_id, source, party_size, "premium_paused", qstate)
        raise QuoteRefused("premium_paused", "Skip pricing is paused for this venue.")

    allowed = allowed_passes(qstate.total_waiting)
    if qstate.premium_waiting >= allowed:
        await log_quote(session, restaurant_id, source, party_size, "pass_cap_reached", qstate)
        raise QuoteRefused(
            "pass_cap_reached",
            f"Fast-pass limit reached: {qstate.premium_waiting}/{allowed} "
            f"for a queue of {qstate.total_waiting}.",
        )

    category = _category(party_size, vs.max_party_size_eligible)
    if category == "large":
        in_cat = await _count_premium_in_category(
            session, restaurant_id, "large", vs.max_party_size_eligible
        )
        if in_cat >= vs.large_party_cap_per_service:
            await log_quote(session, restaurant_id, source, party_size, "large_party_cap_reached", qstate)
            raise QuoteRefused("large_party_cap_reached", "Large-party skip cap reached for this service.")

    venue_config, queue_state = build_engine_payload(
        restaurant, vs, qstate.regular_waiting, qstate.premium_waiting,
        party_size, service_id=service_id,
    )

    request_id = str(uuid4())
    payload: dict = {
        "venue_config": venue_config,
        "queue_state": queue_state,
        "party_size": party_size,
        "source": source,
        "request_id": request_id,
    }
    if session_id:
        payload["session_id"] = session_id

    await session.commit()

    url = settings.pricing_engine_url.rstrip("/") + "/v2/price"
    try:
        async with httpx.AsyncClient(timeout=QUOTE_TIMEOUT_S) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            result = resp.json()
    except httpx.HTTPError:
        await log_quote(session, restaurant_id, source, party_size, "engine_unavailable",
                        qstate, request_id=request_id)
        raise QuoteRefused("engine_unavailable", "Pricing engine did not respond.")

    if result.pop("out_of_service_hours", False):
        await log_quote(session, restaurant_id, source, party_size, "out_of_service_hours",
                        qstate, result, request_id=request_id)
        raise QuoteRefused("out_of_service_hours",
                           "Outside service hours (11:00-23:00 JST); no live quote.")

    if result.get("status") != "ok":
        await log_quote(session, restaurant_id, source, party_size,
                        result.get("status", "engine_declined"), qstate, result,
                        request_id=request_id)
        raise QuoteRefused(result.get("status", "unavailable"),
                           result.get("message") or "Price unavailable.")

    await log_quote(session, restaurant_id, source, party_size, "ok", qstate, result,
                    request_id=request_id)
    return result
