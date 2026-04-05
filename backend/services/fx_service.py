"""
FX Service — fetches live exchange rates from ExchangeRate-API v6.

Architecture decisions:
- Rates from ExchangeRate-API are quoted as "units of foreign currency per 1 USD".
  We invert to get "USD per 1 unit of foreign currency" to match our data model.
- Currencies in EXOTIC_NO_LIVE are never fetched — their official rates are
  politically fictitious (IRR, KPW), junta-controlled with dual markets (MMK),
  or unavailable on commercial APIs due to sanctions or state collapse.
- Cache is per-process in-memory with a 15-minute TTL. Sufficient for a
  speculation dashboard — these rates don't move tick-by-tick.
- If FX_API_KEY is absent we skip the fetch entirely and serve all fallbacks.
"""

import os
import time
import logging
from typing import Dict, Optional, Tuple

import httpx
from dotenv import load_dotenv

from data.currencies import CURRENCIES, EXOTIC_NO_LIVE

load_dotenv()

logger = logging.getLogger(__name__)

FX_API_KEY = os.getenv("FX_API_KEY", "")
FX_API_URL = "https://v6.exchangerate-api.com/v6/{key}/latest/USD"

CACHE_TTL_SECONDS = 15 * 60  # 15 minutes

# Cache structure: {"rates": {code: usd_per_unit}, "fetched_at": float}
_cache: Dict = {"rates": {}, "fetched_at": 0.0}

# Fallback rates indexed by code for O(1) access
_FALLBACK_RATES: Dict[str, float] = {c["code"]: c["rate"] for c in CURRENCIES}


def _is_cache_valid() -> bool:
    return (
        bool(_cache["rates"])
        and (time.time() - _cache["fetched_at"]) < CACHE_TTL_SECONDS
    )


async def _fetch_live_rates() -> Optional[Dict[str, float]]:
    """
    Fetch all rates from ExchangeRate-API.
    Returns a dict of {code: usd_per_unit} on success, None on failure.
    API returns units-of-foreign-per-1-USD, so we invert each value.
    """
    if not FX_API_KEY:
        logger.info("FX_API_KEY not set — using fallback rates for all currencies.")
        return None

    url = FX_API_URL.format(key=FX_API_KEY)
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

        if data.get("result") != "success":
            logger.warning("ExchangeRate-API returned non-success: %s", data.get("result"))
            return None

        raw_rates: Dict[str, float] = data.get("conversion_rates", {})
        # Invert: API gives "how many X per 1 USD", we want "how many USD per 1 X"
        inverted = {
            code: (1.0 / rate) if rate else 0.0
            for code, rate in raw_rates.items()
            if rate
        }
        return inverted

    except httpx.HTTPStatusError as exc:
        logger.error("ExchangeRate-API HTTP error %s: %s", exc.response.status_code, exc)
    except httpx.RequestError as exc:
        logger.error("ExchangeRate-API request failed: %s", exc)
    except Exception as exc:
        logger.error("Unexpected error fetching FX rates: %s", exc)

    return None


async def get_all_rates() -> Dict[str, Tuple[float, bool]]:
    """
    Returns {code: (rate_usd, is_live)} for all 40 currencies.
    is_live=True means the rate came from the live API.
    is_live=False means it's the hardcoded fallback.
    Exotics in EXOTIC_NO_LIVE always return is_live=False.
    """
    if not _is_cache_valid():
        live_rates = await _fetch_live_rates()
        if live_rates:
            _cache["rates"] = live_rates
            _cache["fetched_at"] = time.time()
        else:
            _cache["rates"] = {}
            _cache["fetched_at"] = time.time()  # cache the miss too, avoid hammering

    result: Dict[str, Tuple[float, bool]] = {}

    for currency in CURRENCIES:
        code = currency["code"]
        fallback = _FALLBACK_RATES[code]

        if code in EXOTIC_NO_LIVE:
            result[code] = (fallback, False)
            continue

        live_rate = _cache["rates"].get(code)
        if live_rate and live_rate > 0:
            result[code] = (live_rate, True)
        else:
            result[code] = (fallback, False)

    return result


async def get_rate(code: str) -> Tuple[float, bool]:
    """
    Returns (rate_usd, is_live) for a single currency code.
    """
    all_rates = await get_all_rates()
    code = code.upper()

    if code in all_rates:
        return all_rates[code]

    # Unknown code — return fallback 0 with is_live=False
    return (0.0, False)
