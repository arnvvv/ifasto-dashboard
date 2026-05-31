"""In-memory queue-event broadcaster, scoped per restaurant.

Each restaurant's connected WebSocket clients live in a set; broadcast()
fans out a JSON event to all of them.

Single-worker only. When we scale to multi-worker gunicorn, swap to Redis
pub/sub (the redis client is already in requirements + the URL is in .env).
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class QueueBroadcaster:
    def __init__(self) -> None:
        # restaurant_id -> set of connected WebSockets
        self._channels: dict[uuid.UUID, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, restaurant_id: uuid.UUID, ws: WebSocket) -> None:
        async with self._lock:
            self._channels[restaurant_id].add(ws)
        logger.info(
            "ws.subscribe restaurant=%s total=%d",
            restaurant_id, len(self._channels[restaurant_id]),
        )

    async def unsubscribe(self, restaurant_id: uuid.UUID, ws: WebSocket) -> None:
        async with self._lock:
            self._channels[restaurant_id].discard(ws)
        logger.info(
            "ws.unsubscribe restaurant=%s total=%d",
            restaurant_id, len(self._channels[restaurant_id]),
        )

    async def broadcast(self, restaurant_id: uuid.UUID, event: dict[str, Any]) -> None:
        """Fan an event out to every connected client for this restaurant.
        Dead sockets are pruned silently."""
        payload = json.dumps(event, default=str)
        async with self._lock:
            targets = list(self._channels[restaurant_id])
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._channels[restaurant_id].discard(ws)


broadcaster = QueueBroadcaster()
