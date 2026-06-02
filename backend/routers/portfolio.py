import math
import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator
from typing import List

from data.currencies import CURRENCY_MAP
from db.db import create_shared_portfolio, get_shared_portfolio
from rate_limit import limiter

router = APIRouter()

# Built from a server-controlled env var so callers cannot influence the
# share URL via the Referer header.
APP_URL = os.getenv("APP_URL", "http://localhost:5173").rstrip("/")

MAX_POSITIONS = 50          # cap unbounded request bodies / stored rows
MAX_AMOUNT = 1e15           # sane upper bound for a single position size


class Position(BaseModel):
    code: str
    amount: float

    @field_validator("code")
    @classmethod
    def code_must_be_tracked(cls, v: str) -> str:
        code = v.strip().upper()
        if code not in CURRENCY_MAP:
            raise ValueError(f"Currency '{v}' is not tracked.")
        return code

    @field_validator("amount")
    @classmethod
    def amount_must_be_finite_positive(cls, v: float) -> float:
        if not math.isfinite(v) or v <= 0 or v > MAX_AMOUNT:
            raise ValueError("amount must be a finite number in (0, 1e15]")
        return v


class ShareRequest(BaseModel):
    positions: List[Position]


class ShareResponse(BaseModel):
    id: str
    url: str


@router.post("/portfolio/share", response_model=ShareResponse)
@limiter.limit("10/minute")
async def share_portfolio(request: Request, body: ShareRequest):
    if not body.positions:
        raise HTTPException(status_code=400, detail="positions must not be empty")
    if len(body.positions) > MAX_POSITIONS:
        raise HTTPException(
            status_code=400,
            detail=f"at most {MAX_POSITIONS} positions are allowed",
        )

    # code is already validated + uppercased by the Position validator
    positions = [{"code": p.code, "amount": p.amount} for p in body.positions]
    share_id = await create_shared_portfolio(positions)
    return ShareResponse(id=share_id, url=f"{APP_URL}?portfolio={share_id}")


@router.get("/portfolio/{share_id}")
async def get_portfolio(share_id: str):
    positions = await get_shared_portfolio(share_id)
    if positions is None:
        raise HTTPException(status_code=404, detail=f"Shared portfolio '{share_id}' not found.")
    return positions
