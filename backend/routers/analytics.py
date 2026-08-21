"""
Lightweight self-hosted analytics.

POST /api/analytics/event  — record a frontend event (fire-and-forget safe)
GET  /api/analytics/summary — event counts by name, last 30 days and all-time

No authentication required — event data is non-sensitive aggregated counts.
The summary endpoint is intentionally open so the owner can bookmark it.
"""

import json
import logging
from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import Any, Dict, Optional

from rate_limit import limiter
from db.db import write_analytics_event, get_analytics_summary

router = APIRouter()
logger = logging.getLogger(__name__)


class EventPayload(BaseModel):
    event: str
    props: Optional[Dict[str, Any]] = None


@router.post("/analytics/event", status_code=204)
@limiter.limit("120/minute")
async def record_event(request: Request, body: EventPayload):
    """Record a single analytics event. Returns 204 — callers don't need to await the result."""
    name = (body.event or "").strip()[:64]
    if not name:
        return
    props = body.props or {}
    try:
        await write_analytics_event(name, props)
    except Exception:
        # Never let analytics failures surface to the user
        logger.warning("Analytics write failed for event=%s", name, exc_info=True)


@router.get("/analytics/summary")
@limiter.limit("30/minute")
async def analytics_summary(request: Request):
    """
    Event counts for the last 30 days and all-time, grouped by event name.
    Bookmark https://backend-production-6057.up.railway.app/api/analytics/summary
    to check your usage stats.
    """
    return await get_analytics_summary()
