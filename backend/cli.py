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
import json
import secrets
import string
import sys
from datetime import timezone
from zoneinfo import ZoneInfo

from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy import select

from app.auth.users import UserManager
from app.database import SessionLocal
from app.models.operations import QueueEntry, QueueEntryStatus
from app.models.restaurant import Restaurant, VenueSettings, VenueType
from app.models.user import LanguagePref, User, UserRole
from app.schemas.user import UserCreate

JST = ZoneInfo("Asia/Tokyo")


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
            qr_token=secrets.token_urlsafe(18),
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


async def export_training_data(out_path: str | None, include_test: bool) -> int:
    """Dump completed queue entries (seated or walked away) as JSONL training
    rows: join-time snapshot features + outcome labels + venue structure.
    Joins to the ML server's prediction JSONL via prediction_request_id.
    Returns the row count."""
    def _mins(later, earlier) -> float | None:
        if later is None or earlier is None:
            return None
        a = later if later.tzinfo else later.replace(tzinfo=timezone.utc)
        b = earlier if earlier.tzinfo else earlier.replace(tzinfo=timezone.utc)
        return round((a - b).total_seconds() / 60.0, 2)

    rows: list[dict] = []
    async with SessionLocal() as session:
        restaurants = {
            r.id: r for r in (await session.execute(select(Restaurant))).scalars()
        }
        stmt = (
            select(QueueEntry)
            .where(QueueEntry.status.in_(
                [QueueEntryStatus.seated, QueueEntryStatus.walked_away]
            ))
            .order_by(QueueEntry.joined_at.asc())
        )
        for e in (await session.execute(stmt)).scalars():
            r = restaurants.get(e.restaurant_id)
            if not include_test and e.party_name and "test" in e.party_name.lower():
                continue
            joined = e.joined_at if e.joined_at.tzinfo else e.joined_at.replace(tzinfo=timezone.utc)
            joined_jst = joined.astimezone(JST)
            rows.append({
                "entry_id": str(e.id),
                "restaurant_id": str(e.restaurant_id),
                "status": e.status.value,
                "party_size": e.party_size,
                "entry_type": e.entry_type.value,
                # Labels
                "true_wait_mins": _mins(e.seated_at, e.joined_at),
                "censored_wait_mins": _mins(e.walked_away_at, e.joined_at),
                # Join-time snapshot features
                "queue_ahead_regular": e.queue_ahead_regular,
                "queue_ahead_premium": e.queue_ahead_premium,
                "queue_pressure_at_join": e.queue_pressure_at_join,
                "predicted_wait_at_join": e.predicted_wait_at_join,
                "predicted_wait_p10_at_join": e.predicted_wait_p10_at_join,
                "predicted_wait_p90_at_join": e.predicted_wait_p90_at_join,
                "prediction_request_id": e.prediction_request_id,
                # Money (premium)
                "skip_price": e.skip_price,
                "quoted_price": e.quoted_price,
                "pricing_session_id": e.pricing_session_id,
                # Time features (JST — what the model trains on)
                "joined_at_utc": joined.isoformat(),
                "joined_jst_date": joined_jst.date().isoformat(),
                "joined_jst_hour": joined_jst.hour,
                "joined_jst_dow": joined_jst.weekday(),
                # Venue structure (for baseline computations downstream)
                "restaurant_seat_count": r.seat_count if r else None,
                "restaurant_avg_turn_minutes": r.avg_turn_minutes if r else None,
                "restaurant_avg_check": r.avg_check_size if r else None,
            })

    out = open(out_path, "w") if out_path else sys.stdout
    try:
        for row in rows:
            out.write(json.dumps(row) + "\n")
    finally:
        if out_path:
            out.close()
    return len(rows)


async def rotate_qr(restaurant_name: str) -> str:
    """Mint (or rotate) a venue's guest QR token. Rotation instantly
    invalidates the old printed QR — reprint before swapping signs."""
    async with SessionLocal() as session:
        venue = (
            await session.execute(
                select(Restaurant).where(Restaurant.name == restaurant_name)
            )
        ).scalar_one_or_none()
        if venue is None:
            raise SystemExit(f"no restaurant named {restaurant_name!r}")
        venue.qr_token = secrets.token_urlsafe(18)
        await session.commit()
        return venue.qr_token


async def set_superuser(email: str, enabled: bool) -> None:
    async with SessionLocal() as session:
        u = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if u is None:
            raise SystemExit(f"no user with email {email!r}")
        u.is_superuser = enabled
        await session.commit()


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

    ex = sub.add_parser(
        "export-training-data",
        help="Dump completed queue entries as JSONL training rows",
    )
    ex.add_argument("--out", default=None, help="Output path (default: stdout)")
    ex.add_argument(
        "--include-test",
        action="store_true",
        help="Keep rows whose party_name contains 'test' (excluded by default)",
    )

    rq = sub.add_parser(
        "rotate-qr",
        help="Mint or rotate a venue's guest QR token (invalidates the old QR)",
    )
    rq.add_argument("--restaurant-name", required=True)

    su = sub.add_parser("set-superuser", help="Grant/revoke founder admin (cross-venue overview)")
    su.add_argument("--email", required=True)
    su.add_argument("--revoke", action="store_true")

    args = parser.parse_args()

    if args.cmd == "set-superuser":
        asyncio.run(set_superuser(args.email, not args.revoke))
        print(f"{args.email}: is_superuser={'False' if args.revoke else 'True'}")
        return

    if args.cmd == "rotate-qr":
        token = asyncio.run(rotate_qr(args.restaurant_name))
        print(f"qr_token: {token}")
        print(f"guest URL: https://app.ifasto.com/q/{token}")
        return

    if args.cmd == "export-training-data":
        n = asyncio.run(export_training_data(args.out, args.include_test))
        print(f"exported {n} rows" + (f" -> {args.out}" if args.out else ""), file=sys.stderr)
        return

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
        print("  role:       owner")
        print("=" * 60)
        print("\n  Send the password to the operator via a secure channel.")
        print("  Have them change it after first login.\n")


if __name__ == "__main__":
    main()
