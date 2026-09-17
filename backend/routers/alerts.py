"""
Catalyst alert subscriptions — double opt-in.

POST /alerts/subscribe                 send a confirmation email; stores nothing
                                       on the subscriber list yet
POST /alerts/confirm                   redeem the emailed token → subscription live
POST /alerts/unsubscribe               remove a subscriber by their emailed token
POST /alerts/unsubscribe/one-click     RFC 8058 target for List-Unsubscribe-Post

Every state change requires a token that was delivered to the inbox, so nobody
can subscribe or unsubscribe an address they don't control. There are no GET
endpoints that change state: mail scanners fetch links automatically.
"""

import hashlib
import re
import secrets
from typing import List

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from data.currencies import CURRENCY_MAP
from db.db import (
    confirm_subscriber,
    consume_alert_confirmation,
    create_alert_confirmation,
    delete_subscriber_by_token,
    recent_confirmation_exists,
)
from rate_limit import limiter
from services.email_service import send_confirmation_email

router = APIRouter()

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_MAX_EMAIL_LEN = 254  # RFC 5321 max forward-path length
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{20,128}$")


def _normalise_email(raw: str) -> str:
    """Lowercase/trim and validate an email, raising 422 on anything invalid."""
    email = raw.strip().lower()
    if len(email) > _MAX_EMAIL_LEN or not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Invalid email address.")
    return email


def _clean_token(raw: str) -> str:
    """Reject anything that couldn't be a token we issued, before touching the DB."""
    token = (raw or "").strip()
    return token if _TOKEN_RE.match(token) else ""


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class SubscribeRequest(BaseModel):
    email: str
    codes: List[str]


class TokenRequest(BaseModel):
    token: str


@router.post("/alerts/subscribe")
@limiter.limit("5/minute")
async def subscribe(request: Request, body: SubscribeRequest):
    email = _normalise_email(body.email)

    codes = sorted({c.upper() for c in body.codes if c.upper() in CURRENCY_MAP})
    if not codes:
        raise HTTPException(status_code=422, detail="No valid tracked currency codes provided.")

    # Cooldown per address: repeated submissions can't be used to flood
    # someone's inbox with confirmation emails.
    if not await recent_confirmation_exists(email):
        token = secrets.token_urlsafe(32)
        await create_alert_confirmation(email, codes, _hash(token))
        if not await send_confirmation_email(email, codes, token):
            raise HTTPException(
                status_code=503,
                detail="Couldn't send the confirmation email. Please try again later.",
            )

    # Identical response whether or not the address is already subscribed.
    return {"pending_confirmation": True, "codes": codes}


@router.post("/alerts/confirm")
@limiter.limit("10/minute")
async def confirm(request: Request, body: TokenRequest):
    token = _clean_token(body.token)
    redeemed = await consume_alert_confirmation(_hash(token)) if token else None
    if not redeemed:
        raise HTTPException(status_code=400, detail="This confirmation link is invalid or has expired.")
    email, codes = redeemed
    await confirm_subscriber(email, codes, secrets.token_urlsafe(32))
    return {"confirmed": True, "codes": codes}


@router.post("/alerts/unsubscribe")
@limiter.limit("10/minute")
async def unsubscribe(request: Request, body: TokenRequest):
    token = _clean_token(body.token)
    if token:
        await delete_subscriber_by_token(token)
    # Same answer whether or not the token matched — no oracle for guessing.
    return {"unsubscribed": True}


@router.post("/alerts/unsubscribe/one-click")
@limiter.limit("30/minute")
async def unsubscribe_one_click(request: Request, token: str = Query(default="")):
    """RFC 8058: mail providers POST here from the List-Unsubscribe header."""
    clean = _clean_token(token)
    if clean:
        await delete_subscriber_by_token(clean)
    return {"unsubscribed": True}
