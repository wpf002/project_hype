import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List

from db.db import upsert_subscriber, delete_subscriber
from data.currencies import CURRENCY_MAP

router = APIRouter()

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class SubscribeRequest(BaseModel):
    email: str
    codes: List[str]


class UnsubscribeRequest(BaseModel):
    email: str


@router.post("/alerts/subscribe")
async def subscribe(body: SubscribeRequest):
    email = body.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Invalid email address.")

    codes = [c.upper() for c in body.codes if c.upper() in CURRENCY_MAP]
    if not codes:
        raise HTTPException(
            status_code=422,
            detail="No valid tracked currency codes provided.",
        )

    await upsert_subscriber(email, codes)
    return {"subscribed": True, "email": email, "codes": codes}


@router.delete("/alerts/unsubscribe")
async def unsubscribe(body: UnsubscribeRequest):
    email = body.email.strip().lower()
    await delete_subscriber(email)
    return {"unsubscribed": True}
