"""Public guest endpoints — the QR free-lane flow.

No auth: guests scan the door QR and join the queue from their phone.
Tenancy comes from the unguessable venue qr_token; entry status uses the
entry UUID itself as the capability (122 random bits).

Abuse controls: per-IP join limit, party-size bounds, a per-venue waiting
cap, and staff can walk-away anything that looks fake. Guest joins run the
SAME create_entry path as staff joins: identical capture, tickets, engine
sync, and live board broadcast.
"""

from __future__ import annotations

import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.queue import (
    _broadcast,
    compute_queue_state,
    create_entry,
)
from app.database import get_session
from app.models.operations import QueueEntry, QueueEntryStatus, QueueEntryType
from app.models.restaurant import Restaurant
from app.schemas.queue import QueueEntryCreate
from app.services.engine_events import notify_engine

router = APIRouter()

JOIN_WINDOW_S = 600
JOIN_MAX_PER_WINDOW = 3
# Refuse public joins beyond this many waiting parties — flood guard and an
# honest signal (a 60-party line should talk to the host anyway).
PUBLIC_JOIN_QUEUE_CAP = 60

_joins: dict[str, deque] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() or (request.client.host if request.client else "unknown")


async def _venue_by_token(session: AsyncSession, qr_token: str) -> Restaurant:
    if not qr_token or len(qr_token) > 48:
        raise HTTPException(status_code=404, detail="Unknown venue.")
    venue = (await session.execute(
        select(Restaurant).where(Restaurant.qr_token == qr_token)
    )).scalar_one_or_none()
    if venue is None:
        raise HTTPException(status_code=404, detail="Unknown venue.")
    return venue


class PublicJoin(BaseModel):
    party_size: int = Field(ge=1, le=8)


def _entry_public_view(entry: QueueEntry, parties_ahead: int, venue: Restaurant) -> dict:
    # Honest remaining estimate: join-time prediction minus elapsed, floored.
    # The p10/p90 band counts down the same way (it is a band on the same
    # wall-clock event, so elapsed time shifts all three identically).
    remaining = None
    remaining_p10 = None
    remaining_p90 = None
    if entry.predicted_wait_at_join is not None and entry.status == QueueEntryStatus.waiting:
        joined = entry.joined_at if entry.joined_at.tzinfo else entry.joined_at.replace(tzinfo=timezone.utc)
        elapsed = (datetime.now(timezone.utc) - joined).total_seconds() / 60.0
        remaining = max(0.0, round(entry.predicted_wait_at_join - elapsed, 1))
        if entry.predicted_wait_p10_at_join is not None and entry.predicted_wait_p90_at_join is not None:
            remaining_p10 = max(0.0, round(entry.predicted_wait_p10_at_join - elapsed, 1))
            remaining_p90 = max(0.0, round(entry.predicted_wait_p90_at_join - elapsed, 1))
    return {
        "entry_id": str(entry.id),
        "ticket_no": entry.ticket_no,
        "status": entry.status.value,
        "party_size": entry.party_size,
        "parties_ahead": parties_ahead,
        "est_remaining_mins": remaining,
        "est_remaining_p10": remaining_p10,
        "est_remaining_p90": remaining_p90,
        "venue_name": venue.name,
        "venue_name_ja": venue.name_ja,
        # Lets terminal states link back to the join page ("join again") —
        # the guest already had this token; the entry UUID stays the capability.
        "venue_token": venue.qr_token,
        # Receipt fields: staff-sold fast passes surface as purchase proof on
        # the guest ticket page (Model B — the restaurant collected the money).
        "entry_type": entry.entry_type.value,
        "paid_amount": entry.skip_price if entry.entry_type == QueueEntryType.premium else None,
        # True when payment already happened online (Stripe); register-mode
        # passes stay False until staff collects at seating.
        "paid_online": entry.stripe_checkout_id is not None,
        # Seconds left in the confirm-at-counter window (register-mode guest
        # passes); None = confirmed or not applicable.
        "pending_seconds_left": (
            max(0, int((entry.premium_pending_until - datetime.now(timezone.utc)).total_seconds()))
            if entry.premium_pending_until is not None and entry.status == QueueEntryStatus.waiting
            else None
        ),
    }


@router.get("/venue/{qr_token}")
async def venue_info(
    qr_token: str,
    session: AsyncSession = Depends(get_session),
) -> dict:
    venue = await _venue_by_token(session, qr_token)
    state = await compute_queue_state(session, venue.id)
    vs = await get_venue_settings(session, venue.id)
    return {
        "venue_name": venue.name,
        "venue_name_ja": venue.name_ja,
        "logo_url": venue.logo_url,
        "waiting": state.total_waiting,
        "accepting": state.total_waiting < PUBLIC_JOIN_QUEUE_CAP,
        # False => the QR page is skip-only: the physical line is the free
        # queue, so no digital free-join button renders (or is accepted).
        "free_join_enabled": vs.guest_free_join_enabled,
    }


@router.post("/venue/{qr_token}/join", status_code=201)
async def public_join(
    qr_token: str,
    body: PublicJoin,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    venue = await _venue_by_token(session, qr_token)
    vs_join = await get_venue_settings(session, venue.id)
    if not vs_join.guest_free_join_enabled:
        raise HTTPException(status_code=409, detail="This venue takes the line at the door.")

    ip = _client_ip(request)
    now = time.monotonic()
    bucket = _joins[ip]
    while bucket and now - bucket[0] > JOIN_WINDOW_S:
        bucket.popleft()
    if len(bucket) >= JOIN_MAX_PER_WINDOW:
        raise HTTPException(status_code=429, detail="Too many joins from this device.")
    bucket.append(now)
    if len(_joins) > 10_000:
        _joins.clear()

    state = await compute_queue_state(session, venue.id)
    if state.total_waiting >= PUBLIC_JOIN_QUEUE_CAP:
        raise HTTPException(status_code=409, detail="Queue is full; please see the host.")

    entry = await create_entry(session, venue.id, QueueEntryCreate(
        party_size=body.party_size,
        entry_type=QueueEntryType.regular,
    ))
    ahead = await _parties_ahead(session, entry)
    return _entry_public_view(entry, ahead, venue)


async def _parties_ahead(session: AsyncSession, entry: QueueEntry) -> int:
    stmt = select(QueueEntry).where(
        QueueEntry.restaurant_id == entry.restaurant_id,
        QueueEntry.status == QueueEntryStatus.waiting,
        QueueEntry.joined_at < entry.joined_at,
    )
    return len(list((await session.execute(stmt)).scalars().all()))


@router.get("/entry/{entry_id}")
async def entry_status(
    entry_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> dict:
    entry = await session.get(QueueEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Not found.")
    venue = await session.get(Restaurant, entry.restaurant_id)
    if venue is None:
        raise HTTPException(status_code=404, detail="Not found.")
    ahead = await _parties_ahead(session, entry) if entry.status == QueueEntryStatus.waiting else 0
    return _entry_public_view(entry, ahead, venue)


@router.post("/entry/{entry_id}/leave")
async def entry_leave(
    entry_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Guest-initiated cancel. Recorded as walked_away — and unlike a staff
    walk-away, we KNOW this one is a true abandonment (better labels)."""
    entry = await session.get(QueueEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Not found.")
    if entry.status != QueueEntryStatus.waiting:
        raise HTTPException(status_code=409, detail="No longer waiting.")
    entry.status = QueueEntryStatus.walked_away
    entry.walked_away_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(entry)
    if entry.entry_type == QueueEntryType.premium:
        notify_engine(entry.restaurant_id, [("premium_release", entry.party_size)])
    else:
        notify_engine(entry.restaurant_id, [("queue_leave", entry.party_size)])
    await _broadcast(session, entry.restaurant_id, "walked_away", entry)
    venue = await session.get(Restaurant, entry.restaurant_id)
    return _entry_public_view(entry, 0, venue)


# ---------------------------------------------------------------------------
# Guest self-serve fast pass (flagged per venue; default OFF).
#
# register mode: pass issues immediately, guest pays at the till when seated.
# stripe mode:  guest pays in Stripe Checkout on the VENUE'S OWN account
#               (their restricted key — ifasto never touches funds); the pass
#               issues only after the session reports paid. Fulfilment is
#               idempotent via the unique stripe_checkout_id column.
# ---------------------------------------------------------------------------

import httpx as _httpx

from app.api.queue import PENDING_WINDOW_MIN, create_entry
from app.schemas.queue import QueueEntryCreate
from app.services.engine_payload import get_venue_settings
from app.services.caps import MIN_FASTPASS_QUEUE
from app.services.quote_service import QuoteRefused, get_quote

STRIPE_API = "https://api.stripe.com/v1"

_quote_hits: dict[str, deque] = defaultdict(deque)
QUOTE_WINDOW_S = 60
QUOTE_MAX_PER_WINDOW = 12


def _quote_rate_ok(ip: str) -> bool:
    now = time.monotonic()
    bucket = _quote_hits[ip]
    while bucket and now - bucket[0] > QUOTE_WINDOW_S:
        bucket.popleft()
    if len(bucket) >= QUOTE_MAX_PER_WINDOW:
        return False
    bucket.append(now)
    if len(_quote_hits) > 10_000:
        _quote_hits.clear()
    return True


class FastpassAccept(BaseModel):
    party_size: int = Field(ge=1, le=8)


class FastpassComplete(BaseModel):
    qr_token: str = Field(min_length=1, max_length=48)
    checkout_session_id: str = Field(min_length=1, max_length=80)


@router.get("/venue/{qr_token}/fastpass")
async def fastpass_offer(
    qr_token: str,
    request: Request,
    party_size: int = 2,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """The guest-facing offer: is the paid lane on, and at what price right
    now. Refusals return enabled=True with a reason so the UI can hide the
    card gracefully rather than erroring."""
    venue = await _venue_by_token(session, qr_token)
    vs = await get_venue_settings(session, venue.id)
    if not vs.fastpass_guest_enabled:
        return {"enabled": False}
    if not 1 <= party_size <= 8:
        raise HTTPException(status_code=422, detail="party_size out of range.")
    if not _quote_rate_ok(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many requests.")
    state = await compute_queue_state(session, venue.id)
    if state.total_waiting < MIN_FASTPASS_QUEUE:
        return {"enabled": True, "available": False, "reason": "queue_too_short"}
    try:
        q = await get_quote(session, venue.id, party_size, source="guest_offer")
    except QuoteRefused as exc:
        return {"enabled": True, "available": False, "reason": exc.reason}
    return {
        "enabled": True,
        "available": True,
        "payment_mode": vs.payment_mode,
        "price_minor": q["price_minor"],
        "currency": q.get("currency", "JPY"),
        "predicted_wait_mins": q.get("predicted_wait_mins"),
        "session_id": q.get("session_id"),
    }


@router.post("/venue/{qr_token}/fastpass/accept", status_code=201)
async def fastpass_accept(
    qr_token: str,
    body: FastpassAccept,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Guest accepts the fast pass. The price is ALWAYS re-quoted server-side
    at this moment — the client never supplies it."""
    venue = await _venue_by_token(session, qr_token)
    vs = await get_venue_settings(session, venue.id)
    if not vs.fastpass_guest_enabled:
        raise HTTPException(status_code=404, detail="Not available.")
    if not _quote_rate_ok(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many requests.")

    state = await compute_queue_state(session, venue.id)
    if state.total_waiting < MIN_FASTPASS_QUEUE:
        raise HTTPException(status_code=409, detail={
            "reason": "queue_too_short",
            "message": "The line is short right now; please join the regular queue.",
        })

    try:
        q = await get_quote(session, venue.id, body.party_size, source="guest_accept")
    except QuoteRefused as exc:
        raise HTTPException(status_code=409, detail={"reason": exc.reason, "message": exc.message})

    price = int(q["price_minor"])

    if vs.payment_mode == "stripe" and vs.stripe_secret_key:
        # Create a Checkout Session on the venue's own Stripe account.
        # Wallets (Apple Pay / Google Pay) surface automatically on the
        # hosted page; no per-domain registration needed.
        success = (
            "https://app.ifasto.com/g/pay/complete"
            f"?token={qr_token}&cs={{CHECKOUT_SESSION_ID}}"
        )
        form = {
            "mode": "payment",
            "success_url": success,
            "cancel_url": f"https://app.ifasto.com/q/{qr_token}",
            "line_items[0][price_data][currency]": "jpy",
            "line_items[0][price_data][unit_amount]": str(price),
            "line_items[0][price_data][product_data][name]": f"Fast pass — {venue.name}",
            "line_items[0][quantity]": "1",
            "metadata[qr_token]": qr_token,
            "metadata[party_size]": str(body.party_size),
            "metadata[price_minor]": str(price),
            "expires_at": str(int(time.time()) + 35 * 60),  # Stripe min ~30min
        }
        try:
            async with _httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{STRIPE_API}/checkout/sessions",
                    data=form,
                    auth=(vs.stripe_secret_key, ""),
                )
                resp.raise_for_status()
                cs = resp.json()
        except _httpx.HTTPError:
            raise HTTPException(
                status_code=503,
                detail={"reason": "payment_unavailable",
                        "message": "Payment provider did not respond."},
            )
        return {"mode": "stripe", "checkout_url": cs["url"]}

    # register mode: issue the pass now with a 5-minute confirm window —
    # staff marks payment/commitment at the counter or the slot auto-demotes
    # back to the free queue (ticket intact).
    entry = await create_entry(session, venue.id, QueueEntryCreate(
        party_size=body.party_size,
        entry_type=QueueEntryType.premium,
        skip_price=price,
        quoted_price=price,
        pricing_session_id=q.get("session_id"),
    ))
    entry.premium_pending_until = datetime.now(timezone.utc) + timedelta(minutes=PENDING_WINDOW_MIN)
    await session.commit()
    await session.refresh(entry)
    await _ws_broadcast(session, venue.id, "updated", entry)
    ahead = await _parties_ahead(session, entry)
    return {"mode": "register", **_entry_public_view(entry, ahead, venue)}


@router.post("/fastpass/complete")
async def fastpass_complete(
    body: FastpassComplete,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Stripe redirect target. Verifies the checkout session against the
    venue's own account and fulfils the pass exactly once."""
    venue = await _venue_by_token(session, body.qr_token)
    vs = await get_venue_settings(session, venue.id)
    if not vs.stripe_secret_key:
        raise HTTPException(status_code=404, detail="Not available.")

    # Idempotency first: fulfilled already?
    existing = (await session.execute(
        select(QueueEntry).where(QueueEntry.stripe_checkout_id == body.checkout_session_id)
    )).scalar_one_or_none()
    if existing is not None:
        ahead = await _parties_ahead(session, existing) if existing.status == QueueEntryStatus.waiting else 0
        return _entry_public_view(existing, ahead, venue)

    try:
        async with _httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{STRIPE_API}/checkout/sessions/{body.checkout_session_id}",
                auth=(vs.stripe_secret_key, ""),
            )
            resp.raise_for_status()
            cs = resp.json()
    except _httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Payment provider did not respond.")

    meta = cs.get("metadata") or {}
    if cs.get("payment_status") != "paid":
        raise HTTPException(status_code=402, detail="Payment not completed.")
    if meta.get("qr_token") != body.qr_token:
        raise HTTPException(status_code=409, detail="Session does not match venue.")

    price = int(meta.get("price_minor") or cs.get("amount_total") or 0)

    # Upgrade fulfilment: convert the guest's EXISTING entry (keeps ticket).
    up_id = meta.get("upgrade_entry_id")
    if up_id:
        entry = await session.get(QueueEntry, uuid.UUID(up_id))
        if entry is None:
            raise HTTPException(status_code=404, detail="Entry not found.")
        if entry.entry_type != QueueEntryType.premium:
            # Paid: honor past the cap, same policy as new-pass fulfilment.
            entry = await _convert_to_premium(
                session, entry, price, None,
                checkout_id=body.checkout_session_id, enforce_cap=False,
            )
        ahead = await _parties_ahead(session, entry) if entry.status == QueueEntryStatus.waiting else 0
        return _entry_public_view(entry, ahead, venue)

    party = int(meta.get("party_size") or 2)

    # The guest PAID: honor the pass even if the cap filled while they were
    # in checkout (rare; bounded by checkout expiry). Entry creation runs the
    # same path as every other join for capture + broadcast, so we bypass
    # only the cap here, deliberately, by calling create_entry directly —
    # its premium cap applies to guest-accept, and acceptance already
    # re-checked it moments before payment began.
    entry = await create_entry(session, venue.id, QueueEntryCreate(
        party_size=party,
        entry_type=QueueEntryType.premium,
        skip_price=price,
        quoted_price=price,
    ), enforce_premium_cap=False)
    entry.stripe_checkout_id = body.checkout_session_id
    await session.commit()
    await session.refresh(entry)
    ahead = await _parties_ahead(session, entry)
    return _entry_public_view(entry, ahead, venue)


# ---------------------------------------------------------------------------
# In-queue upgrade: a guest already waiting in the FREE line converts their
# existing entry to a fast pass — keeping their ticket number and join time.
# The most motivated buyer is someone mid-wait; this is their path.
# ---------------------------------------------------------------------------

from app.api.queue import _broadcast as _ws_broadcast
from app.api.queue import _premium_lock, compute_queue_state as _cqs
from app.services.caps import allowed_passes as _allowed


async def _upgradable(session: AsyncSession, entry_id: uuid.UUID):
    """Entry + venue + settings, or an HTTP error if not upgradable."""
    entry = await session.get(QueueEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Not found.")
    venue = await session.get(Restaurant, entry.restaurant_id)
    if venue is None:
        raise HTTPException(status_code=404, detail="Not found.")
    vs = await get_venue_settings(session, entry.restaurant_id)
    if not vs.fastpass_guest_enabled:
        raise HTTPException(status_code=404, detail="Not available.")
    if entry.status != QueueEntryStatus.waiting:
        raise HTTPException(status_code=409, detail={"reason": "not_waiting",
                                                     "message": "No longer waiting."})
    if entry.entry_type == QueueEntryType.premium:
        raise HTTPException(status_code=409, detail={"reason": "already_premium",
                                                     "message": "Already a fast pass."})
    return entry, venue, vs


async def _convert_to_premium(session: AsyncSession, entry: QueueEntry,
                              price: int, session_id: str | None,
                              checkout_id: str | None = None,
                              enforce_cap: bool = True) -> QueueEntry:
    """Atomically flip a waiting regular entry to premium under the same
    per-venue lock the creation path uses. Ticket number and joined_at are
    preserved — the guest keeps their identity and history."""
    async with _premium_lock(entry.restaurant_id):
        if enforce_cap:
            cur = await _cqs(session, entry.restaurant_id)
            cap = _allowed(cur.total_waiting)
            if cur.premium_waiting >= cap:
                raise HTTPException(status_code=409, detail={
                    "reason": "pass_cap_reached",
                    "message": (f"Fast-pass limit reached: {cur.premium_waiting}/{cap} "
                                f"for a queue of {cur.total_waiting}."),
                })
        entry.entry_type = QueueEntryType.premium
        entry.skip_price = price
        entry.quoted_price = price
        if session_id:
            entry.pricing_session_id = session_id
        if checkout_id:
            entry.stripe_checkout_id = checkout_id
            entry.premium_pending_until = None  # paid online = confirmed
        else:
            entry.premium_pending_until = (
                datetime.now(timezone.utc) + timedelta(minutes=PENDING_WINDOW_MIN)
            )
        await session.commit()
        await session.refresh(entry)
    # Engine sync: the party already counted as queue_join at their original
    # join; a purchase decrements queue and increments premium.
    notify_engine(entry.restaurant_id, [("premium_purchase", entry.party_size)])
    await _ws_broadcast(session, entry.restaurant_id, "upgraded", entry)
    return entry


@router.get("/entry/{entry_id}/upgrade-offer")
async def upgrade_offer(
    entry_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        entry, venue, vs = await _upgradable(session, entry_id)
    except HTTPException as exc:
        if exc.status_code == 409:
            return {"available": False, "reason": exc.detail.get("reason")}
        raise
    if not _quote_rate_ok(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many requests.")
    try:
        q = await get_quote(session, venue.id, entry.party_size, source="guest_upgrade_offer")
    except QuoteRefused as exc:
        return {"available": False, "reason": exc.reason}
    return {
        "available": True,
        "payment_mode": vs.payment_mode,
        "price_minor": q["price_minor"],
        "currency": q.get("currency", "JPY"),
    }


@router.post("/entry/{entry_id}/upgrade")
async def upgrade_entry(
    entry_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    entry, venue, vs = await _upgradable(session, entry_id)
    if not _quote_rate_ok(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many requests.")

    try:
        q = await get_quote(session, venue.id, entry.party_size, source="guest_upgrade")
    except QuoteRefused as exc:
        raise HTTPException(status_code=409, detail={"reason": exc.reason, "message": exc.message})
    price = int(q["price_minor"])

    if vs.payment_mode == "stripe" and vs.stripe_secret_key:
        success = (
            "https://app.ifasto.com/g/pay/complete"
            f"?token={venue.qr_token}&cs={{CHECKOUT_SESSION_ID}}"
        )
        form = {
            "mode": "payment",
            "success_url": success,
            "cancel_url": f"https://app.ifasto.com/g/{entry.id}",
            "line_items[0][price_data][currency]": "jpy",
            "line_items[0][price_data][unit_amount]": str(price),
            "line_items[0][price_data][product_data][name]": f"Fast pass — {venue.name}",
            "line_items[0][quantity]": "1",
            "metadata[qr_token]": venue.qr_token or "",
            "metadata[upgrade_entry_id]": str(entry.id),
            "metadata[price_minor]": str(price),
            "expires_at": str(int(time.time()) + 35 * 60),
        }
        try:
            async with _httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(f"{STRIPE_API}/checkout/sessions",
                                         data=form, auth=(vs.stripe_secret_key, ""))
                resp.raise_for_status()
                cs = resp.json()
        except _httpx.HTTPError:
            raise HTTPException(status_code=503, detail={
                "reason": "payment_unavailable",
                "message": "Payment provider did not respond."})
        return {"mode": "stripe", "checkout_url": cs["url"]}

    entry = await _convert_to_premium(session, entry, price, q.get("session_id"))
    ahead = await _parties_ahead(session, entry)
    return {"mode": "register", **_entry_public_view(entry, ahead, venue)}
