"""
FX Service — fetches live exchange rates from Open Exchange Rates (primary)
with ExchangeRate-API v6 as secondary fallback.

Architecture decisions:
- Open Exchange Rates (OXR) is the industry standard for production FX
  applications — broader frontier currency coverage than ExchangeRate-API.
- Both sources return rates as "units of foreign currency per 1 USD".
  We invert to get "USD per 1 unit of foreign currency".
- Exotic currencies in EXOTIC_NO_LIVE use exotic_rates_service scrapers
  (real black-market / parallel-market rates) before falling back to
  hardcoded analyst estimates.
- Cache is per-process in-memory with a 15-minute TTL.
- source enum: "oxr" | "exchangerate-api" | "scraped" | "analyst"

If neither OXR_APP_ID nor FX_API_KEY is set, we skip live fetching entirely.
"""

import os
import time
import logging
from typing import Dict, Optional, Tuple

import httpx
from dotenv import load_dotenv

from data.currencies import CURRENCIES, EXOTIC_NO_LIVE
from db.db import write_snapshots

load_dotenv()

logger = logging.getLogger(__name__)

OXR_APP_ID = os.getenv("OXR_APP_ID", "")
FX_API_KEY  = os.getenv("FX_API_KEY", "")

OXR_URL        = "https://openexchangerates.org/api/latest.json"
FALLBACK_FX_URL = "https://v6.exchangerate-api.com/v6/{key}/latest/USD"

CACHE_TTL_SECONDS = 15 * 60  # 15 minutes

_cache: Dict = {"rates": {}, "fetched_at": 0.0, "source": "analyst"}

_FALLBACK_RATES: Dict[str, float] = {c["code"]: c["rate"] for c in CURRENCIES}

_ALL_CODES = ",".join(c["code"] for c in CURRENCIES)


def _is_cache_valid() -> bool:
    return (
        bool(_cache["rates"])
        and (time.time() - _cache["fetched_at"]) < CACHE_TTL_SECONDS
    )


async def _fetch_oxr() -> Optional[Dict[str, float]]:
    """
    Fetch all tracked rates from Open Exchange Rates.
    Returns {code: usd_per_unit} on success, None on failure.
    """
    if not OXR_APP_ID:
        return None

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                OXR_URL,
                params={
                    "app_id": OXR_APP_ID,
                    "base": "USD",
                    "symbols": _ALL_CODES,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        raw_rates: Dict[str, float] = data.get("rates", {})
        if not raw_rates:
            logger.warning("OXR returned empty rates payload")
            return None

        # Invert: API gives "how many X per 1 USD", we want "how many USD per 1 X"
        inverted = {
            code: (1.0 / rate) if rate else 0.0
            for code, rate in raw_rates.items()
            if rate
        }
        logger.info("OXR: fetched %d rates", len(inverted))
        return inverted

    except httpx.HTTPStatusError as exc:
        logger.error("OXR HTTP error %s: %s", exc.response.status_code, exc)
    except httpx.RequestError as exc:
        logger.error("OXR request failed: %s", exc)
    except Exception as exc:
        logger.error("Unexpected error fetching OXR rates: %s", exc)

    return None


async def _fetch_exchangerate_api() -> Optional[Dict[str, float]]:
    """
    Secondary fallback: ExchangeRate-API v6.
    Returns {code: usd_per_unit} on success, None on failure.
    """
    if not FX_API_KEY:
        return None

    url = FALLBACK_FX_URL.format(key=FX_API_KEY)
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

        if data.get("result") != "success":
            logger.warning("ExchangeRate-API returned non-success: %s", data.get("result"))
            return None

        raw_rates: Dict[str, float] = data.get("conversion_rates", {})
        inverted = {
            code: (1.0 / rate) if rate else 0.0
            for code, rate in raw_rates.items()
            if rate
        }
        logger.info("ExchangeRate-API: fetched %d rates (fallback)", len(inverted))
        return inverted

    except httpx.HTTPStatusError as exc:
        logger.error("ExchangeRate-API HTTP error %s: %s", exc.response.status_code, exc)
    except httpx.RequestError as exc:
        logger.error("ExchangeRate-API request failed: %s", exc)
    except Exception as exc:
        logger.error("Unexpected error fetching ExchangeRate-API rates: %s", exc)

    return None


async def get_all_rates() -> Dict[str, Tuple[float, bool, str]]:
    """
    Returns {code: (rate_usd, is_live, source)} for all currencies.

    source: "oxr" | "exchangerate-api" | "scraped" | "analyst"
    is_live: True for oxr/exchangerate-api/scraped; False for analyst
    """
    from services.exotic_rates_service import get_exotic_rate

    cache_was_stale = not _is_cache_valid()

    if cache_was_stale:
        live_rates = await _fetch_oxr()
        if live_rates:
            _cache["rates"] = live_rates
            _cache["fetched_at"] = time.time()
            _cache["source"] = "oxr"
        else:
            fallback_rates = await _fetch_exchangerate_api()
            if fallback_rates:
                _cache["rates"] = fallback_rates
                _cache["fetched_at"] = time.time()
                _cache["source"] = "exchangerate-api"
            else:
                _cache["rates"] = {}
                _cache["fetched_at"] = time.time()
                _cache["source"] = "analyst"

    live_source = _cache.get("source", "analyst")
    result: Dict[str, Tuple[float, bool, str]] = {}

    for currency in CURRENCIES:
        code = currency["code"]
        fallback = _FALLBACK_RATES[code]

        if code in EXOTIC_NO_LIVE:
            # Try scraper first
            exotic_rate, exotic_source, confidence = await get_exotic_rate(code)
            if exotic_rate is not None:
                is_live = confidence in ("live", "scraped_cached")
                src = "scraped" if is_live else "analyst"
                result[code] = (exotic_rate, is_live, src)
            else:
                result[code] = (fallback, False, "analyst")
            continue

        live_rate = _cache["rates"].get(code)
        if live_rate and live_rate > 0:
            result[code] = (live_rate, True, live_source)
        else:
            result[code] = (fallback, False, "analyst")

    if cache_was_stale:
        # Write snapshots — use legacy (rate, is_live) format for DB compat
        await write_snapshots({code: (r[0], r[1]) for code, r in result.items()})

    return result


async def get_rate(code: str) -> Tuple[float, bool, str]:
    """
    Returns (rate_usd, is_live, source) for a single currency code.
    """
    all_rates = await get_all_rates()
    code = code.upper()

    if code in all_rates:
        return all_rates[code]

    return (0.0, False, "analyst")
