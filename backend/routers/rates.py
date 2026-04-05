from fastapi import APIRouter, HTTPException
from typing import List, Optional
from pydantic import BaseModel

from data.currencies import CURRENCIES, CURRENCY_MAP
from services.fx_service import get_all_rates, get_rate
from db.db import get_all_changes_24h, get_change_24h

router = APIRouter()


class CurrencyRate(BaseModel):
    code: str
    name: str
    flag: str
    rate: float
    mcap: str
    vol: str
    hype: int
    story: str
    live: bool          # True = from live API, False = hardcoded fallback
    change_24h: Optional[float] = None   # % change over last 24 h; null if insufficient data


class SingleRate(CurrencyRate):
    news_query: str


@router.get("/rates", response_model=List[CurrencyRate])
async def get_all_currency_rates():
    """
    Returns all 40 currencies with their current USD rate.
    Each entry includes a `live` boolean and a `change_24h` percentage
    (null when fewer than 2 snapshots exist in the last 24 hours).
    """
    all_rates = await get_all_rates()
    changes = get_all_changes_24h()
    result = []

    for currency in CURRENCIES:
        code = currency["code"]
        rate_value, is_live = all_rates.get(code, (currency["rate"], False))
        result.append(
            CurrencyRate(
                code=code,
                name=currency["name"],
                flag=currency["flag"],
                rate=rate_value,
                mcap=currency["mcap"],
                vol=currency["vol"],
                hype=currency["hype"],
                story=currency["story"],
                live=is_live,
                change_24h=changes.get(code),
            )
        )

    return result


@router.get("/rate/{code}", response_model=SingleRate)
async def get_single_currency_rate(code: str):
    """
    Returns a single currency's rate and full metadata.
    404 if the currency code is not tracked.
    """
    code = code.upper()
    currency = CURRENCY_MAP.get(code)

    if not currency:
        raise HTTPException(
            status_code=404,
            detail=f"Currency '{code}' is not tracked. Use GET /api/rates for the full list.",
        )

    rate_value, is_live = await get_rate(code)

    return SingleRate(
        code=code,
        name=currency["name"],
        flag=currency["flag"],
        rate=rate_value,
        mcap=currency["mcap"],
        vol=currency["vol"],
        hype=currency["hype"],
        story=currency["story"],
        news_query=currency["news_query"],
        live=is_live,
        change_24h=get_change_24h(code),
    )
