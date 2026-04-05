from fastapi import APIRouter, HTTPException
from typing import List
from pydantic import BaseModel

from data.currencies import CURRENCIES, CURRENCY_MAP
from services.fx_service import get_all_rates, get_rate

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
    live: bool  # True = from live API, False = hardcoded fallback


class SingleRate(CurrencyRate):
    news_query: str


@router.get("/rates", response_model=List[CurrencyRate])
async def get_all_currency_rates():
    """
    Returns all 40 currencies with their current USD rate.
    Each entry includes a `live` boolean indicating whether the rate
    came from the live ExchangeRate-API feed or the hardcoded fallback.
    """
    all_rates = await get_all_rates()
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
    )
