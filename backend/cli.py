"""Admin CLI for the pilot phase. Mints owner accounts paired with a
restaurant + default venue settings. Public registration is disabled,
so this is the ONLY way new accounts get created until self-signup is
turned on.

Usage:
    python cli.py create-owner \\
        --email "owner@menchirashi.jp" \\
        --name "Arnav Vig" \\
        --restaurant-name "Menchirashi" \\
        --venue-type ramen \\
        --avg-check 2500

Generates a random 16-char password, prints it ONCE, and exits. Send
the password to the operator via a secure channel (Signal etc.) and
have them change it after first login.
"""

import argparse
import asyncio
import secrets
import string

from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase

from app.auth.users import UserManager
from app.database import SessionLocal
from app.models.restaurant import Restaurant, VenueSettings, VenueType
from app.models.user import LanguagePref, User, UserRole
from app.schemas.user import UserCreate


def _generate_password(length: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


async def create_owner(
    email: str,
    name: str,
    restaurant_name: str,
    restaurant_name_ja: str | None,
    venue_type: str,
    avg_check: int,
) -> str:
    """Atomically: create restaurant + default settings + owner user. Return
    the cleartext password so we can print it once."""
    password = _generate_password()

    async with SessionLocal() as session:
        # 1. Create the restaurant first (other rows FK to it).
        restaurant = Restaurant(
            name=restaurant_name,
            name_ja=restaurant_name_ja,
            venue_type=VenueType(venue_type),
            avg_check_size=avg_check,
            currency="JPY",
        )
        session.add(restaurant)
        await session.flush()  # populate restaurant.id

        # 2. Default venue settings.
        session.add(VenueSettings(restaurant_id=restaurant.id))

        # 3. Create the owner user via FastAPI-Users' UserManager so password
        #    hashing matches what /auth/jwt/login expects.
        user_db = SQLAlchemyUserDatabase(session, User)
        user_manager = UserManager(user_db)
        await user_manager.create(
            UserCreate(
                email=email,
                password=password,
                name=name,
                role=UserRole.owner,
                language_pref=LanguagePref.ja,
                restaurant_id=restaurant.id,
                is_active=True,
                is_verified=True,
            )
        )

        await session.commit()
        return password


def main() -> None:
    parser = argparse.ArgumentParser(prog="cli.py", description="ifasto admin CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    co = sub.add_parser("create-owner", help="Mint an owner account + venue")
    co.add_argument("--email", required=True)
    co.add_argument("--name", required=True)
    co.add_argument("--restaurant-name", required=True)
    co.add_argument("--restaurant-name-ja", default=None, help="Japanese name (optional)")
    co.add_argument(
        "--venue-type",
        default="other",
        choices=[t.value for t in VenueType],
    )
    co.add_argument("--avg-check", type=int, required=True, help="Average per-person check, in yen")

    args = parser.parse_args()

    if args.cmd == "create-owner":
        pw = asyncio.run(
            create_owner(
                email=args.email,
                name=args.name,
                restaurant_name=args.restaurant_name,
                restaurant_name_ja=args.restaurant_name_ja,
                venue_type=args.venue_type,
                avg_check=args.avg_check,
            )
        )
        print()
        print("=" * 60)
        print("  Owner account minted")
        print("=" * 60)
        print(f"  email:      {args.email}")
        print(f"  password:   {pw}")
        print(f"  restaurant: {args.restaurant_name}")
        print(f"  role:       owner")
        print("=" * 60)
        print("\n  Send the password to the operator via a secure channel.")
        print("  Have them change it after first login.\n")


if __name__ == "__main__":
    main()
