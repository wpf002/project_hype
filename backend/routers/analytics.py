"""
Lightweight self-hosted analytics.

POST /api/analytics/event   — record a frontend event (public, sanitised)
GET  /api/analytics/summary — visitor/event counts (requires ANALYTICS_TOKEN)

Privacy design
--------------
No cookies, no third-party scripts, no PII at rest. "Unique visitors" are
counted from a one-way hash of (daily salt + client IP + User-Agent). The salt
rotates every UTC day, so hashes cannot be correlated across days and no raw
IP address is ever written to the database.

Trust model
-----------
/analytics/event is necessarily public — the browser calls it with no
credentials. It is therefore treated as fully untrusted input: the event name
and every prop are sanitised and hard-capped before they reach the database
(see _sanitise_props). Rate limiting alone is not sufficient, because a single
permitted request could otherwise carry an arbitrarily large JSON body.

/analytics/summary is owner-only. It aggregates business metrics and runs
several full-table scans, so it is gated on a shared secret rather than being
world-readable.
"""

import hashlib
import json
import logging
import os
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from rate_limit import limiter
from db.db import write_analytics_event, get_analytics_summary

router = APIRouter()
logger = logging.getLogger(__name__)

IS_PRODUCTION = os.getenv("APP_ENV", "development").strip().lower() == "production"

# Rotating-salt input. Set ANALYTICS_SALT to a long random string in production:
# this repository is public, so without it the salt is a known constant and a
# leaked database would allow visitor hashes to be reversed by enumerating the
# IPv4 space against a known salt/date/User-Agent.
_SECRET_SALT = os.getenv("ANALYTICS_SALT", "")
if not _SECRET_SALT:
    if IS_PRODUCTION:
        # Fail loudly in logs but stay up — analytics must never take the API
        # down. A random per-process salt means visitor counts fragment across
        # restarts, which is strictly better than a publicly known salt.
        _SECRET_SALT = secrets.token_hex(32)
        logger.error(
            "ANALYTICS_SALT is not set in production. Using a random per-process "
            "salt: visitor counts will reset on every restart. Set ANALYTICS_SALT "
            "to a stable random string to fix this."
        )
    else:
        _SECRET_SALT = "dev-only-salt"

# Owner-only gate for the summary endpoint.
ANALYTICS_TOKEN = os.getenv("ANALYTICS_TOKEN", "")

# Hard caps on untrusted event payloads.
MAX_EVENT_NAME = 64
MAX_PROPS = 12           # keys per event
MAX_KEY_LEN = 40
MAX_VALUE_LEN = 120
MAX_PROPS_BYTES = 1024   # serialised ceiling, enforced after per-field caps


def _client_ip(request: Request) -> str:
    """Real client IP, accounting for the Railway/nginx proxy hop."""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _visitor_hash(request: Request) -> str:
    """
    Stable-for-today, unlinkable-across-days visitor fingerprint.
    Returns 32 hex chars. Never reversible to an IP in practice.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    ua = request.headers.get("user-agent", "")[:400]
    raw = f"{_SECRET_SALT}|{today}|{_client_ip(request)}|{ua}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _sanitise_props(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Coerce an untrusted props object into something safe to persist.

    Drops nested structures (JSONB would happily store an arbitrarily deep
    tree), caps key/value sizes, caps key count, and finally enforces a total
    serialised ceiling so many small keys cannot add up to a large row.
    """
    if not isinstance(raw, dict):
        return {}

    clean: Dict[str, Any] = {}
    for key, value in list(raw.items())[:MAX_PROPS]:
        if not isinstance(key, str):
            continue
        k = key.strip()[:MAX_KEY_LEN]
        if not k:
            continue
        if isinstance(value, bool) or isinstance(value, int):
            clean[k] = value
        elif isinstance(value, float):
            # Reject NaN/Infinity — not representable in strict JSON
            clean[k] = value if value == value and abs(value) != float("inf") else None
        elif isinstance(value, str):
            clean[k] = value[:MAX_VALUE_LEN]
        elif value is None:
            clean[k] = None
        else:
            # dict / list / anything exotic — record the type, discard content
            clean[k] = f"<{type(value).__name__}>"

    # Total-size backstop: drop keys until the payload fits.
    while clean and len(json.dumps(clean).encode("utf-8")) > MAX_PROPS_BYTES:
        clean.pop(next(reversed(clean)))
    return clean


class EventPayload(BaseModel):
    event: str
    props: Optional[Dict[str, Any]] = None


@router.post("/analytics/event", status_code=204)
@limiter.limit("120/minute")
async def record_event(request: Request, body: EventPayload):
    """Record a single analytics event. Always 204 — callers don't await the result."""
    name = (body.event or "").strip()[:MAX_EVENT_NAME]
    if not name:
        return
    try:
        await write_analytics_event(name, _sanitise_props(body.props), _visitor_hash(request))
    except Exception:
        # Analytics failures must never surface to the user
        logger.warning("Analytics write failed for event=%s", name, exc_info=True)


@router.get("/analytics/summary")
@limiter.limit("30/minute")
async def analytics_summary(
    request: Request,
    x_analytics_token: str = Header(default=""),
):
    """
    Traffic and engagement summary. Owner-only.

    Authenticate with the ANALYTICS_TOKEN value:
        curl -H "X-Analytics-Token: <token>" .../api/analytics/summary

    Returns 404 rather than 401 when unauthorised so the endpoint's existence
    isn't advertised to scanners.
    """
    if not ANALYTICS_TOKEN:
        if IS_PRODUCTION:
            logger.error("ANALYTICS_TOKEN is not set — /analytics/summary is disabled.")
            raise HTTPException(status_code=404, detail="Not found")
        # Dev convenience only; production always requires the token.
        logger.warning("ANALYTICS_TOKEN unset — summary is open (development only).")
    elif not secrets.compare_digest(x_analytics_token, ANALYTICS_TOKEN):
        raise HTTPException(status_code=404, detail="Not found")

    return await get_analytics_summary()
