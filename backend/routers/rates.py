import time
from fastapi import APIRouter, HTTPException
from typing import List, Optional
from pydantic import BaseModel

from data.currencies import CURRENCIES, CURRENCY_MAP
from services.fx_service import get_all_rates, get_rate
from db.db import (
    get_all_changes_24h, get_change_24h,
    get_latest_hype_scores, get_latest_catalyst_scores,
    get_latest_hype_updated_at, get_latest_rate_updated_at,
    get_pool,
)

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
    live: bool
    source: str = "analyst"          # "oxr" | "exchangerate-api" | "scraped" | "analyst"
    change_24h: Optional[float] = None
    hype_score: Optional[float] = None
    catalyst_score: Optional[float] = None
    sentiment: Optional[float] = None
    momentum_7d: Optional[float] = None


class SingleRate(CurrencyRate):
    news_query: str


@router.get("/rates", response_model=List[CurrencyRate])
async def get_all_currency_rates():
    all_rates, changes, latest_hype, latest_catalyst = await _gather_rates_data()
    result = []
    for currency in CURRENCIES:
        code = currency["code"]
        rate_entry = all_rates.get(code, (currency["rate"], False, "analyst"))
        rate_value, is_live, source = rate_entry
        cat = latest_catalyst.get(code, {})
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
                source=source,
                change_24h=changes.get(code),
                hype_score=latest_hype.get(code, float(currency["hype"])),
                catalyst_score=cat.get("catalyst_score"),
                sentiment=cat.get("sentiment"),
                momentum_7d=cat.get("momentum_7d"),
            )
        )
    return result


@router.get("/rate/{code}", response_model=SingleRate)
async def get_single_currency_rate(code: str):
    code = code.upper()
    currency = CURRENCY_MAP.get(code)
    if not currency:
        raise HTTPException(
            status_code=404,
            detail=f"Currency '{code}' is not tracked. Use GET /api/rates for the full list.",
        )

    rate_entry = await get_rate(code)
    rate_value, is_live, source = rate_entry
    latest_hype, latest_catalyst = await _gather_single_data()
    cat = latest_catalyst.get(code, {})

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
        source=source,
        change_24h=await get_change_24h(code),
        hype_score=latest_hype.get(code, float(currency["hype"])),
        catalyst_score=cat.get("catalyst_score"),
        sentiment=cat.get("sentiment"),
        momentum_7d=cat.get("momentum_7d"),
    )


@router.get("/status")
async def get_status():
    """Operational status — version, freshness timestamps, db health, uptime."""
    import asyncio
    from main import START_TIME

    last_hype_run, last_rate_fetch = await asyncio.gather(
        get_latest_hype_updated_at(),
        get_latest_rate_updated_at(),
    )

    db_status = "ok"
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
    except Exception:
        db_status = "error"

    return {
        "version": "1.2.0",
        "currencies_tracked": len(CURRENCIES),
        "last_hype_run": last_hype_run,
        "last_rate_fetch": last_rate_fetch,
        "db_status": db_status,
        "uptime_seconds": int(time.time() - START_TIME),
    }


async def _gather_rates_data():
    import asyncio
    return await asyncio.gather(
        get_all_rates(),
        get_all_changes_24h(),
        get_latest_hype_scores(),
        get_latest_catalyst_scores(),
    )


async def _gather_single_data():
    import asyncio
    return await asyncio.gather(
        get_latest_hype_scores(),
        get_latest_catalyst_scores(),
    )
