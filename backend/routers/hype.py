from fastapi import APIRouter, HTTPException, Query
from typing import List
from pydantic import BaseModel

from data.currencies import CURRENCY_MAP
from db.db import get_hype_history

router = APIRouter()


class HypeSnapshot(BaseModel):
    id: int
    code: str
    score: float
    news_count: int
    volatility: float
    timestamp: str


@router.get("/hype/{code}", response_model=List[HypeSnapshot])
async def get_hype_history_route(
    code: str,
    limit: int = Query(default=24, ge=1, le=720),
):
    code = code.upper()
    if code not in CURRENCY_MAP:
        raise HTTPException(
            status_code=404,
            detail=f"Currency '{code}' is not tracked. Use GET /api/rates for the full list.",
        )
    return await get_hype_history(code, limit)
