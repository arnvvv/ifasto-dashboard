"""WebSocket endpoint for the live ops board.

Browsers can't set Authorization headers on WebSocket upgrades, so the JWT
comes in via `?token=...` query param. We decode it manually using the same
JWT strategy the REST endpoints use.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.broadcast import broadcaster
from app.auth.users import get_jwt_strategy
from app.database import SessionLocal
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()


async def _user_from_token(token: str, session: AsyncSession) -> User | None:
    """Resolve a JWT to a User, or None if invalid/expired/revoked."""
    from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
    from app.auth.users import UserManager

    user_db = SQLAlchemyUserDatabase(session, User)
    user_manager = UserManager(user_db)
    strategy = get_jwt_strategy()
    try:
        user = await strategy.read_token(token, user_manager)
    except Exception:
        return None
    if user is None or not user.is_active:
        return None
    return user


@router.websocket("/ws/queue")
async def queue_socket(websocket: WebSocket, token: str | None = None):
    """Subscribe to the authenticated user's restaurant queue events.

    URL: /api/ws/queue?token=<jwt>
    Messages are JSON: {"event": "joined|seated|walked_away", "entry": {...}, "ts": ...}
    """
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="missing token")
        return

    async with SessionLocal() as session:
        user = await _user_from_token(token, session)
        if user is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="invalid token")
            return
        restaurant_id = user.restaurant_id

    await websocket.accept()
    await broadcaster.subscribe(restaurant_id, websocket)

    try:
        # Keep the connection open. Client doesn't need to send anything;
        # we just hold the socket so the broadcaster can push events.
        while True:
            # Pings keep the connection healthy through proxies.
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("websocket error")
    finally:
        await broadcaster.unsubscribe(restaurant_id, websocket)
