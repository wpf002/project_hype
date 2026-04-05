from fastapi import APIRouter, HTTPException, Query
from typing import List
from pydantic import BaseModel

from data.currencies import CURRENCY_MAP
from db.db import get_history

router = APIRouter()


class RateSnapshot(BaseModel):
    id: int
    code: str
    rate: float
    live: bool
    timestamp: str


@router.get("/history/{code}", response_model=List[RateSnapshot])
async def get_rate_history(
    code: str,
    limit: int = Query(default=24, ge=1, le=672),  # max 7 days × 48 samples/day
):
    """
    Returns the last `limit` rate snapshots for a currency (newest first).
    404 if the currency code is not tracked.
    Snapshots are written every 15 minutes; up to 96 per 24 h window.
    """
    code = code.upper()
    if code not in CURRENCY_MAP:
        raise HTTPException(
            status_code=404,
            detail=f"Currency '{code}' is not tracked. Use GET /api/rates for the full list.",
        )

    return get_history(code, limit)
