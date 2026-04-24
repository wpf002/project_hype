import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List

from db.db import create_shared_portfolio, get_shared_portfolio

router = APIRouter()

# Built from a server-controlled env var so callers cannot influence the
# share URL via the Referer header.
APP_URL = os.getenv("APP_URL", "http://localhost:5173").rstrip("/")


class Position(BaseModel):
    code: str
    amount: float


class ShareRequest(BaseModel):
    positions: List[Position]


class ShareResponse(BaseModel):
    id: str
    url: str


@router.post("/portfolio/share", response_model=ShareResponse)
async def share_portfolio(body: ShareRequest):
    if not body.positions:
        raise HTTPException(status_code=400, detail="positions must not be empty")

    positions = [{"code": p.code.upper(), "amount": p.amount} for p in body.positions]
    share_id = await create_shared_portfolio(positions)
    return ShareResponse(id=share_id, url=f"{APP_URL}?portfolio={share_id}")


@router.get("/portfolio/{share_id}")
async def get_portfolio(share_id: str):
    positions = await get_shared_portfolio(share_id)
    if positions is None:
        raise HTTPException(status_code=404, detail=f"Shared portfolio '{share_id}' not found.")
    return positions
