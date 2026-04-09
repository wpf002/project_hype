"""
Signals router — GET /api/signals/{code}

Returns the latest 10 institutional signals for a currency, newest first.
Signal types: IMF_POSITIVE, IMF_NEGATIVE, SANCTIONS_RELIEF, SANCTIONS_ADDED
"""

from fastapi import APIRouter, HTTPException
from typing import List, Optional
from pydantic import BaseModel

from data.currencies import CURRENCY_MAP
from db.db import get_signals

router = APIRouter()


class Signal(BaseModel):
    id: int
    code: str
    signal_type: str
    headline: str
    url: str
    published_at: str
    processed_at: str


@router.get("/signals/{code}", response_model=List[Signal])
async def get_signals_for_currency(code: str):
    code = code.upper()
    if code not in CURRENCY_MAP:
        raise HTTPException(
            status_code=404,
            detail=f"Currency '{code}' not tracked.",
        )
    return await get_signals(code, limit=10)
