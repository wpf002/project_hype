from fastapi import APIRouter, HTTPException, Query, Request
from typing import List
from pydantic import BaseModel

from data.currencies import CURRENCY_MAP
from db.db import get_history
from rate_limit import limiter

router = APIRouter()


class RateSnapshot(BaseModel):
    id: int
    code: str
    rate: float
    live: bool
    timestamp: str


@router.get("/history/{code}", response_model=List[RateSnapshot])
@limiter.limit("60/minute")
async def get_rate_history(
    request: Request,
    code: str,
    limit: int = Query(default=24, ge=1, le=672),
):
    code = code.upper()
    if code not in CURRENCY_MAP:
        raise HTTPException(
            status_code=404,
            detail=f"Currency '{code}' is not tracked. Use GET /api/rates for the full list.",
        )
    return await get_history(code, limit)
