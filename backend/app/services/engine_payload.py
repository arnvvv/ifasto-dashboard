"""Shared builder for ML-engine payloads (venue_config + queue_state).

Single source of truth used by BOTH the pricing bridge (/api/pricing/quote)
and the join-time snapshot in the queue API, so the features the model sees
at quote time and the features snapshotted onto a QueueEntry at join time
can never drift apart.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.restaurant import Restaurant, VenueSettings

logger = logging.getLogger(__name__)

JST = ZoneInfo("Asia/Tokyo")


def default_service_id(restaurant_id: uuid.UUID | str) -> str:
    """Date-scoped engine service key: {restaurant_id}:{JST date}.

    The engine's Redis counters live under this key. A static ':default'
    would accumulate state forever; scoping by JST date means any drift from
    dropped events self-heals at the daily rollover, which is also the
    natural service boundary for a restaurant."""
    return f"{restaurant_id}:{datetime.now(JST).date().isoformat()}"

# Until tourist density becomes a per-venue column, all pilot venues are
# Tokyo and inherit a single sensible default.
DEFAULT_TOURIST_DENSITY = 0.7

# Best-effort calls (join snapshot) must never block operations on a slow
# engine; the interactive quote path uses the longer timeout.
SNAPSHOT_TIMEOUT_S = 2.0
QUOTE_TIMEOUT_S = 4.0

# Python-side column defaults (default=...) are applied at FLUSH, not at
# instantiation — a transient VenueSettings() has None in every guardrail
# field, which silently skips the paused check and crashes _category().
# Materialize the real defaults from the table definition instead.
_VS_DEFAULTS = {
    c.name: c.default.arg
    for c in VenueSettings.__table__.columns
    if c.default is not None and not callable(c.default.arg)
}


async def get_venue_settings(session: AsyncSession, restaurant_id: uuid.UUID) -> VenueSettings:
    """VenueSettings row, or a defaults-populated transient instance when the
    venue has no row yet. The transient is NOT added to the session — it only
    feeds guardrail checks and payload building."""
    vs = await session.get(VenueSettings, restaurant_id)
    if vs is None:
        vs = VenueSettings(restaurant_id=restaurant_id, **_VS_DEFAULTS)
    return vs


def build_engine_payload(
    restaurant: Restaurant,
    vs: VenueSettings,
    regular_waiting: int,
    premium_waiting: int,
    party_size: int,
    service_id: str | None = None,
) -> tuple[dict, dict]:
    """Return (venue_config, queue_state) for the ML engine.

    venue_config carries pricing-engine anchors AND wait-predictor structural
    features (schemas: pricing_engine._validate_venue_config and
    ml_server.predict_tokyo_wait). queue_state is keyed for the Tokyo L1
    predictor.

    Deliberately NOT sent: current_occupancy_pct. The dashboard has no table
    state, and queue/seat_count is queue pressure, not dining occupancy —
    sending it fabricated an occupancy feature at inference. The engine falls
    back to its training-consistent default until real table tracking exists.
    """
    total_queue = regular_waiting + premium_waiting
    venue_config = {
        # Identity + currency
        "venue_id": str(restaurant.id),
        "service_id": service_id or default_service_id(restaurant.id),
        "currency": restaurant.currency,
        "minor_units": 0 if restaurant.currency == "JPY" else 2,
        # Pricing anchors — engine derives base/floor/ceiling from these:
        "avg_check_size_minor": restaurant.avg_check_size,
        "tourist_density_pct": DEFAULT_TOURIST_DENSITY,
        "max_premium_cap_minor": vs.price_ceiling,
        "max_premium_share": vs.max_premium_share,
        # Wait predictor structural features (rest have engine-side defaults):
        "capacity": restaurant.seat_count,
        "avg_dining_min": restaurant.avg_turn_minutes,
    }
    queue_state = {
        "queue_length": total_queue,
        "party_size": party_size,
    }
    return venue_config, queue_state


def queue_pressure(regular_waiting: int, premium_waiting: int, seat_count: int) -> float:
    """Waiting parties relative to capacity. Honest name for what was
    previously mislabeled 'occupancy' — it is a queue-side load signal, not
    dining-room occupancy."""
    return min(1.0, (regular_waiting + premium_waiting) / max(1, seat_count))


async def predict_wait_best_effort(
    venue_config: dict, queue_state: dict
) -> tuple[float | None, str | None]:
    """POST /v2/predict_tokyo with a tight timeout.

    Returns (predicted_wait_mins, request_id). The request_id is echoed into
    the engine's prediction JSONL, making the log row exactly joinable to the
    QueueEntry that stores it. Both are None on ANY failure or when the
    engine reports out_of_service_hours — a sentinel value must never be
    stored as a real prediction, and engine downtime must never block a join.
    """
    url = settings.pricing_engine_url.rstrip("/") + "/v2/predict_tokyo"
    request_id = str(uuid.uuid4())
    try:
        async with httpx.AsyncClient(timeout=SNAPSHOT_TIMEOUT_S) as client:
            resp = await client.post(url, json={
                "venue_config": venue_config,
                "queue_state": queue_state,
                "source": "join_snapshot",
                "request_id": request_id,
            })
            resp.raise_for_status()
            data = resp.json()
            if data.get("out_of_service_hours"):
                return None, None
            wait = data.get("predicted_wait_mins")
            if wait is None:
                return None, None
            return float(wait), request_id
    except Exception as e:
        # repr, not str — httpx.ReadTimeout stringifies to ''.
        logger.warning(f"join-snapshot wait prediction failed (non-fatal): {e!r}")
        return None, None
