"""
Lightweight self-hosted analytics.

POST /api/analytics/event   — record a frontend event (fire-and-forget safe)
GET  /api/analytics/summary — visitor counts + event counts by window

Privacy design
--------------
No cookies, no third-party scripts, no PII at rest. "Unique visitors" are
counted from a one-way hash of (daily salt + client IP + User-Agent). The salt
rotates every UTC day, so hashes cannot be correlated across days and no raw
IP address is ever written to the database.
"""

import hashlib
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel

from rate_limit import limiter
from db.db import write_analytics_event, get_analytics_summary

router = APIRouter()
logger = logging.getLogger(__name__)

# Set ANALYTICS_SALT in production to a long random string. Without it the
# daily salt is still date-rotated, but a known-plaintext attacker with the
# source could enumerate IPs; the env var closes that gap.
_SECRET_SALT = os.getenv("ANALYTICS_SALT", "project-hype-default-salt")


def _client_ip(request: Request) -> str:
    """Real client IP, accounting for the Railway/nginx proxy hop."""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        # Left-most entry is the original client
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _visitor_hash(request: Request) -> str:
    """
    Stable-for-today, unlinkable-across-days visitor fingerprint.
    Returns 32 hex chars. Never reversible to an IP in practice.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    ua = request.headers.get("user-agent", "")
    raw = f"{_SECRET_SALT}|{today}|{_client_ip(request)}|{ua}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


class EventPayload(BaseModel):
    event: str
    props: Optional[Dict[str, Any]] = None


@router.post("/analytics/event", status_code=204)
@limiter.limit("120/minute")
async def record_event(request: Request, body: EventPayload):
    """Record a single analytics event. Always 204 — callers don't await the result."""
    name = (body.event or "").strip()[:64]
    if not name:
        return
    try:
        await write_analytics_event(name, body.props or {}, _visitor_hash(request))
    except Exception:
        # Analytics failures must never surface to the user
        logger.warning("Analytics write failed for event=%s", name, exc_info=True)


@router.get("/analytics/summary")
@limiter.limit("30/minute")
async def analytics_summary(request: Request):
    """
    Traffic and engagement summary.

    Returns unique visitors and page views for the last 24h / 7d / 30d /
    all-time, plus per-event counts and a tail of recent events.
    """
    return await get_analytics_summary()
