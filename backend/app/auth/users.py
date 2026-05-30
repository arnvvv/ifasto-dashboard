"""FastAPI-Users wiring — UserManager, DB adapter, JWT auth backend,
plus the dependency factories for protecting routes by role."""

import uuid
from typing import AsyncGenerator

from fastapi import Depends, HTTPException, status
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.models.user import User, UserRole


# --- DB adapter -------------------------------------------------------------

async def get_user_db(session: AsyncSession = Depends(get_session)):
    yield SQLAlchemyUserDatabase(session, User)


# --- UserManager ------------------------------------------------------------

class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret = settings.jwt_secret
    verification_token_secret = settings.jwt_secret

    async def on_after_register(self, user: User, request=None) -> None:
        # Pilot stage — no email send. Owner accounts are minted via admin CLI.
        pass


async def get_user_manager(user_db=Depends(get_user_db)) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db)


# --- Auth backend (JWT in Authorization: Bearer header) ---------------------

bearer_transport = BearerTransport(tokenUrl="api/auth/jwt/login")


def get_jwt_strategy() -> JWTStrategy:
    return JWTStrategy(
        secret=settings.jwt_secret,
        lifetime_seconds=settings.jwt_lifetime_seconds,
    )


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)


# --- FastAPI-Users entry point ---------------------------------------------

fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend])

# The two dependencies we'll use everywhere:
current_active_user = fastapi_users.current_user(active=True)
current_superuser = fastapi_users.current_user(active=True, superuser=True)


# --- Role-based access control ---------------------------------------------

def require_role(*allowed: UserRole):
    """FastAPI dependency factory — gate a route to one or more roles."""

    async def _dep(user: User = Depends(current_active_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions for this action.",
            )
        return user

    return _dep
