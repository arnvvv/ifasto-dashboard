"""Daily system-ready deep check (cron, 07:00 JST).

Not "is it up" (the hourly external monitor owns that) but "does the machine
actually work": runs a full synthetic fast-pass transaction on the dedicated
E2E TEST VENUE (never a real one), plus service/DB/engine/backup/disk/cert
checks. Writes system_check_result.json, which /api/admin/overview surfaces
as the green/red System Ready banner on the founder admin page.

Run manually any time:  cd backend && .venv/bin/python system_check.py
"""

from __future__ import annotations

import asyncio
import glob
import json
import os
import shutil
import subprocess
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

JST = ZoneInfo("Asia/Tokyo")
BASE = "http://localhost:8000"
ENGINE = "http://localhost:5001"
TEST_VENUE_NAME = "E2E Test Venue"
RESULT_PATH = Path(__file__).parent / "system_check_result.json"

results: list[dict] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append({"name": name, "ok": bool(ok), "detail": detail[:200]})
    print(f"  [{'OK' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def check_services() -> None:
    for svc in ("ifasto-dashboard-api", "ifasto-dashboard-web", "ifasto-ml"):
        try:
            out = subprocess.run(
                ["systemctl", "is-active", svc],
                capture_output=True, text=True, timeout=10,
            ).stdout.strip()
            record(f"service:{svc}", out == "active", out)
        except Exception as e:
            record(f"service:{svc}", False, repr(e))


def check_http() -> None:
    try:
        r = httpx.get(f"{BASE}/health", timeout=10).json()
        record("api+db", r.get("status") == "ok" and r.get("db") == "ok", str(r))
    except Exception as e:
        record("api+db", False, repr(e))
    try:
        r = httpx.get(f"{ENGINE}/health", timeout=10).json()
        record("engine+model", r.get("status") == "healthy" and r.get("model_loaded") is True,
               f"model_version={r.get('model_version')}")
    except Exception as e:
        record("engine+model", False, repr(e))
    try:
        r = httpx.get("http://localhost:3000/login", timeout=15)
        record("web", r.status_code == 200, f"http {r.status_code}")
    except Exception as e:
        record("web", False, repr(e))


def check_disk() -> None:
    try:
        du = shutil.disk_usage("/")
        free_pct = du.free / du.total * 100
        record("disk", free_pct > 15, f"{free_pct:.0f}% free")
    except Exception as e:
        record("disk", False, repr(e))


def check_backup() -> None:
    try:
        dumps = sorted(glob.glob(os.path.expanduser("~/backups/ifasto_dashboard_*.sql.gz")))
        if not dumps:
            record("backup", False, "no dumps found")
            return
        newest = dumps[-1]
        age_h = (time.time() - os.path.getmtime(newest)) / 3600
        size_kb = os.path.getsize(newest) / 1024
        record("backup", age_h < 26 and size_kb > 10,
               f"{Path(newest).name} age={age_h:.1f}h size={size_kb:.0f}KB")
    except Exception as e:
        record("backup", False, repr(e))


def check_cert() -> None:
    try:
        out = subprocess.run(
            ["bash", "-c",
             "echo | openssl s_client -servername app.ifasto.com "
             "-connect app.ifasto.com:443 2>/dev/null | openssl x509 -noout -enddate"],
            capture_output=True, text=True, timeout=20,
        ).stdout.strip()
        # notAfter=Aug 22 12:00:00 2026 GMT
        end = datetime.strptime(out.split("=", 1)[1].strip(), "%b %d %H:%M:%S %Y %Z")
        days = (end - datetime.utcnow()).days
        record("tls_cert", days > 14, f"{days} days left")
    except Exception as e:
        record("tls_cert", False, repr(e))


async def check_e2e() -> None:
    """Full synthetic fast-pass transaction on the TEST venue, then cleanup.
    offer -> accept (pending window) -> confirm -> seat -> statement."""
    from sqlalchemy import delete, select

    from app.auth.users import get_jwt_strategy
    from app.database import SessionLocal
    from app.models.operations import QueueEntry, Transaction
    from app.models.restaurant import Restaurant
    from app.models.user import User

    async with SessionLocal() as s:
        venue = (await s.execute(
            select(Restaurant).where(Restaurant.name == TEST_VENUE_NAME)
        )).scalar_one_or_none()
        if venue is None:
            record("e2e", False, "test venue missing")
            return
        user = (await s.execute(
            select(User).where(User.restaurant_id == venue.id)
        )).scalars().first()
        token = await get_jwt_strategy().write_token(user)
        qr = venue.qr_token
        vid = venue.id

    service_id = f"{vid}:{datetime.now(JST).date().isoformat()}"

    async def cleanup():
        async with SessionLocal() as s:
            await s.execute(delete(Transaction).where(Transaction.restaurant_id == vid))
            await s.execute(delete(QueueEntry).where(QueueEntry.restaurant_id == vid))
            await s.commit()
        try:
            httpx.post(f"{ENGINE}/v2/service/{service_id}/reset", timeout=10)
        except Exception:
            pass

    H = {"Authorization": f"Bearer {token}"}
    try:
        await cleanup()  # pre: known-clean state

        offer = httpx.get(f"{BASE}/api/public/venue/{qr}/fastpass",
                          params={"party_size": 2}, timeout=15).json()
        if not (offer.get("enabled") and offer.get("available")):
            record("e2e:offer", False, str(offer))
            return
        price = offer["price_minor"]
        record("e2e:offer", price > 0 and price % 50 == 0, f"¥{price}")

        acc = httpx.post(f"{BASE}/api/public/venue/{qr}/fastpass/accept",
                         json={"party_size": 2}, timeout=15).json()
        eid = acc.get("entry_id")
        pend = acc.get("pending_seconds_left")
        record("e2e:accept+pending", bool(eid) and pend is not None and 200 <= pend <= 310,
               f"pending={pend}s")

        conf = httpx.patch(f"{BASE}/api/queue/entries/{eid}/confirm-payment",
                           headers=H, timeout=15).json()
        record("e2e:confirm", conf.get("premium_pending_until") is None, "")

        seat = httpx.patch(f"{BASE}/api/queue/entries/{eid}/seat",
                           headers=H, timeout=15).json()
        record("e2e:seat", seat.get("status") == "seated", "")

        stmt = httpx.get(f"{BASE}/api/reports/statement", headers=H, timeout=15).json()
        record("e2e:statement", stmt.get("gross_total", 0) >= price,
               f"gross=¥{stmt.get('gross_total')}")
    except Exception as e:
        record("e2e", False, repr(e))
    finally:
        await cleanup()  # post: leave no trace


def main() -> int:
    print(f"system check @ {datetime.now(JST).isoformat()}")
    check_services()
    check_http()
    check_disk()
    check_backup()
    check_cert()
    asyncio.run(check_e2e())

    ok = all(c["ok"] for c in results)
    payload = {
        "ts": datetime.now(JST).isoformat(),
        "pass": ok,
        "failed": [c["name"] for c in results if not c["ok"]],
        "checks": results,
    }
    RESULT_PATH.write_text(json.dumps(payload, indent=2))
    print(f"RESULT: {'PASS' if ok else 'FAIL'} -> {RESULT_PATH}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
