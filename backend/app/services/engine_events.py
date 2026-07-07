"""Fire-and-forget /v2/event notifier — keeps the pricing engine's Redis
state in sync with real dashboard queue mutations.

Without this the engine's premium-pressure multiplier is blind: it sits at
the zero-share tier forever, or slams to the defensive tier after one sale
with no recorded joins. Events are best-effort (2s timeout, log-and-swallow,
detached task) — a slow engine must never delay a queue mutation, and any
drift from dropped events self-heals at the daily service_id rollover.

Event mapping (see ml_server v2_event / pricing_engine.record_event):
  regular add        -> queue_join
  premium add        -> queue_join THEN premium_purchase (required pair:
                        premium_purchase decrements the regular queue count)
  regular seat       -> queue_leave
  regular walk-away  -> queue_leave
  premium walk-away  -> premium_release
  premium seat       -> nothing (already out of the engine's queue count)
"""

from __future__ import annotations

import asyncio
import logging
import uuid

import httpx

from app.config import settings
from app.services.engine_payload import default_service_id

logger = logging.getLogger(__name__)

_TIMEOUT_S = 2.0

# Hold refs so fire-and-forget tasks aren't garbage-collected mid-flight.
_pending: set[asyncio.Task] = set()


async def _post_events(service_id: str, events: list[tuple[str, int]]) -> None:
    url = settings.pricing_engine_url.rstrip("/") + "/v2/event"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
            for event_type, party_size in events:
                resp = await client.post(url, json={
                    "service_id": service_id,
                    "event_type": event_type,
                    "party_size": party_size,
                })
                resp.raise_for_status()
    except Exception as e:
        logger.warning(f"engine event sync failed (non-fatal, self-heals daily): {e!r}")


def notify_engine(restaurant_id: uuid.UUID, events: list[tuple[str, int]]) -> None:
    """Schedule event delivery in the background. Never raises, never blocks."""
    if not events:
        return
    try:
        task = asyncio.get_running_loop().create_task(
            _post_events(default_service_id(restaurant_id), events)
        )
        _pending.add(task)
        task.add_done_callback(_pending.discard)
    except RuntimeError:
        # No running loop (sync test context) — skip silently.
        logger.warning("engine event sync skipped: no running event loop")
