from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import List

from db.db import create_shared_portfolio, get_shared_portfolio

router = APIRouter()


class Position(BaseModel):
    code: str
    amount: float


class ShareRequest(BaseModel):
    positions: List[Position]


class ShareResponse(BaseModel):
    id: str
    url: str


@router.post("/portfolio/share", response_model=ShareResponse)
async def share_portfolio(body: ShareRequest, request: Request):
    if not body.positions:
        raise HTTPException(status_code=400, detail="positions must not be empty")

    positions = [{"code": p.code.upper(), "amount": p.amount} for p in body.positions]
    share_id = await create_shared_portfolio(positions)

    referer = request.headers.get("referer", "")
    if referer:
        from urllib.parse import urlparse
        parsed = urlparse(referer)
        frontend_origin = f"{parsed.scheme}://{parsed.netloc}"
    else:
        frontend_origin = str(request.base_url).rstrip("/")

    url = f"{frontend_origin}?portfolio={share_id}"
    return ShareResponse(id=share_id, url=url)


@router.get("/portfolio/{share_id}")
async def get_portfolio(share_id: str):
    positions = await get_shared_portfolio(share_id)
    if positions is None:
        raise HTTPException(status_code=404, detail=f"Shared portfolio '{share_id}' not found.")
    return positions
