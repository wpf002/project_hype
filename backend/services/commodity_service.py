"""
Commodity Price Service — 14-day % changes for commodities that drive
speculative currency movements in Project Hype.

Source: Yahoo Finance V8 chart API (no API key required).
Cache: 6 hours, aligned with the hype/catalyst score refresh cycle.
Graceful failure: returns {} if all fetches fail; callers skip the
commodity factor rather than crashing.
"""

import asyncio
import logging
import time
from typing import Dict, Optional

import httpx

logger = logging.getLogger(__name__)

_CACHE_TTL = 6 * 3600
_cache: Dict = {"data": None, "fetched_at": 0.0}

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,*/*;q=0.9",
    "Accept-Language": "en-US,en;q=0.9",
}

# Yahoo Finance futures tickers for key commodity groups
TICKERS: Dict[str, str] = {
    "oil":    "CL=F",   # WTI Crude Oil Futures
    "gold":   "GC=F",   # Gold Futures
    "copper": "HG=F",   # Copper Futures (CMX)
    "soy":    "ZS=F",   # Soybean Futures
    "cocoa":  "CC=F",   # Cocoa Futures
}


async def _fetch_pct_change(
    session: httpx.AsyncClient,
    key: str,
    ticker: str,
) -> Optional[float]:
    """
    Fetch the closing-price % change over ~14 trading days for one ticker.
    Uses range=21d so we always have ≥14 trading days after weekends/holidays.
    Returns None on any failure so callers can omit missing commodities.
    """
    try:
        resp = await session.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}",
            params={"interval": "1d", "range": "21d", "includePrePost": "false"},
            headers=_HEADERS,
            timeout=12.0,
        )
        resp.raise_for_status()
        data = resp.json()

        closes = (
            data.get("chart", {})
                .get("result", [{}])[0]
                .get("indicators", {})
                .get("quote", [{}])[0]
                .get("close", [])
        )
        closes = [c for c in closes if c is not None]
        if len(closes) < 2:
            logger.warning("Commodity %s (%s): only %d data points", key, ticker, len(closes))
            return None

        old_price, new_price = closes[0], closes[-1]
        if old_price <= 0:
            return None

        pct = round((new_price / old_price - 1.0) * 100.0, 2)
        logger.info("Commodity %s (%s): %.2f%% change over %d sessions", key, ticker, pct, len(closes))
        return pct

    except Exception as exc:
        logger.warning("Commodity fetch failed — %s (%s): %s", key, ticker, exc)
        return None


async def get_commodity_changes() -> Dict[str, float]:
    """
    Returns {commodity_key: pct_change_14d} for all tracked commodities.
    Partial results are valid — callers omit links for missing commodities.
    Returns {} only if all fetches fail.
    """
    if _cache["data"] is not None and (time.time() - _cache["fetched_at"]) < _CACHE_TTL:
        return _cache["data"]

    async with httpx.AsyncClient(follow_redirects=True) as session:
        raw_results = await asyncio.gather(
            *[_fetch_pct_change(session, key, ticker) for key, ticker in TICKERS.items()],
            return_exceptions=True,
        )

    results: Dict[str, float] = {}
    for key, val in zip(TICKERS.keys(), raw_results):
        if isinstance(val, (int, float)) and not isinstance(val, bool):
            results[key] = float(val)

    if results:
        _cache["data"] = results
        _cache["fetched_at"] = time.time()
        logger.info("Commodity cache updated (%d/%d tickers): %s", len(results), len(TICKERS), results)
    else:
        logger.warning("All commodity fetches failed — commodity factor skipped this cycle")

    return results
