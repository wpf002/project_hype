"""
Commodity Price Service — 14-day % changes for the commodities that drive
speculative currency movements in Project Hype.

Sources (in order, mirroring the primary/fallback pattern in fx_service):

  1. Yahoo Finance V8 chart API — free, no key, no quota. Tried first so it
     costs nothing when it works. As of Aug 2026 Yahoo returns HTTP 429 for
     unauthenticated futures requests, so in practice this usually fails.
  2. Alpha Vantage TIME_SERIES_DAILY — requires ALPHA_VANTAGE_KEY. Only called
     for tickers Yahoo failed, which preserves the small free-tier quota and
     means AV usage drops back to zero automatically if Yahoo recovers.

Why ETF proxies for Alpha Vantage: AV's native commodity endpoints only return
daily data for oil and natural gas — copper, soy and cocoa are monthly, far too
coarse for a 14-day change. Liquid commodity ETFs track their underlying
futures closely enough for a directional signal, and TIME_SERIES_DAILY covers
all five uniformly.

Cache: 12 hours, matching the hype/catalyst engine cycle that is its only
consumer. At worst that is 5 AV requests per 12h = 10/day, inside the 25/day
free tier.

Graceful failure: returns {} if every source fails; callers skip the commodity
factor rather than crashing. Because that failure is otherwise invisible,
get_commodity_health() reports it via GET /api/status.
"""

import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

# 12h — the catalyst engine runs every 12h and is the only consumer, so a
# shorter TTL would burn Alpha Vantage quota for data nothing reads.
_CACHE_TTL = 12 * 3600
_cache: Dict = {"data": None, "fetched_at": 0.0}

ALPHA_VANTAGE_KEY = os.getenv("ALPHA_VANTAGE_KEY", "")
AV_URL = "https://www.alphavantage.co/query"
# AV free tier allows 5 requests/minute. The engine runs twice a day, so
# spacing requests generously costs nothing and keeps us well clear.
AV_REQUEST_GAP = 13.0

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,*/*;q=0.9",
    "Accept-Language": "en-US,en;q=0.9",
}

# Yahoo Finance futures tickers (primary source)
TICKERS: Dict[str, str] = {
    "oil":    "CL=F",   # WTI Crude Oil Futures
    "gold":   "GC=F",   # Gold Futures
    "copper": "HG=F",   # Copper Futures (CMX)
    "soy":    "ZS=F",   # Soybean Futures
    "cocoa":  "CC=F",   # Cocoa Futures
}

# Alpha Vantage ETF proxies (fallback source). See module docstring for why
# these are ETFs rather than AV's native commodity endpoints.
AV_PROXIES: Dict[str, str] = {
    "oil":    "USO",    # United States Oil Fund — tracks WTI
    "gold":   "GLD",    # SPDR Gold Shares
    "copper": "CPER",   # United States Copper Index Fund
    "soy":    "SOYB",   # Teucrium Soybean Fund
    "cocoa":  "NIB",    # iPath Bloomberg Cocoa ETN
}

# Per-commodity failure reasons and the source each value came from,
# surfaced via get_commodity_health().
_last_errors: Dict[str, str] = {}
_sources: Dict[str, str] = {}
_health: Dict = {
    "last_attempt_at": None,
    "last_success_at": None,
    "tickers_ok": 0,
    "tickers_total": 0,
    "last_error": None,
}


def get_commodity_health() -> Dict:
    """Cache/fetch health for /api/status. Never performs a network call."""
    age = int(time.time() - _cache["fetched_at"]) if _cache["fetched_at"] else None
    return {
        **_health,
        "cache_age_seconds": age,
        "cache_populated": _cache["data"] is not None,
        "degraded": _health["tickers_ok"] == 0 and _health["last_attempt_at"] is not None,
        "sources": dict(_sources),
        "alpha_vantage_configured": bool(ALPHA_VANTAGE_KEY),
    }


def _pct_change(closes: list) -> Optional[float]:
    """% change between the first and last close in a series."""
    closes = [c for c in closes if c is not None]
    if len(closes) < 2 or closes[0] <= 0:
        return None
    return round((closes[-1] / closes[0] - 1.0) * 100.0, 2)


async def _fetch_yahoo(session: httpx.AsyncClient, key: str, ticker: str) -> Optional[float]:
    """
    14-day % close change for one Yahoo futures ticker.
    range=21d so we retain >=14 trading days after weekends/holidays.
    Returns None on any failure so callers can fall back per-commodity.
    """
    try:
        resp = await session.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}",
            params={"interval": "1d", "range": "21d", "includePrePost": "false"},
            headers=_HEADERS,
            timeout=12.0,
        )
        resp.raise_for_status()
        closes = (
            resp.json().get("chart", {})
                .get("result", [{}])[0]
                .get("indicators", {})
                .get("quote", [{}])[0]
                .get("close", [])
        )
        pct = _pct_change(closes)
        if pct is None:
            _last_errors[key] = "insufficient data"
            return None
        _last_errors.pop(key, None)
        _sources[key] = "yahoo"
        logger.info("Commodity %s (%s) via Yahoo: %+.2f%%", key, ticker, pct)
        return pct
    except httpx.HTTPStatusError as exc:
        _last_errors[key] = f"yahoo HTTP {exc.response.status_code}"
        return None
    except Exception as exc:
        _last_errors[key] = f"yahoo {type(exc).__name__}"
        return None


async def _fetch_alpha_vantage(session: httpx.AsyncClient, key: str, symbol: str) -> Optional[float]:
    """
    14-day % close change for one Alpha Vantage ETF proxy.
    Uses outputsize=compact (last 100 sessions) and takes the most recent 15.
    """
    try:
        resp = await session.get(
            AV_URL,
            params={
                "function": "TIME_SERIES_DAILY",
                "symbol": symbol,
                "outputsize": "compact",
                "apikey": ALPHA_VANTAGE_KEY,
            },
            headers=_HEADERS,
            timeout=20.0,
        )
        resp.raise_for_status()
        data = resp.json()

        # AV signals throttling/errors with HTTP 200 and an explanatory key
        for problem in ("Note", "Information", "Error Message"):
            if problem in data:
                _last_errors[key] = f"alphavantage: {str(data[problem])[:80]}"
                logger.warning("Alpha Vantage %s (%s): %s", key, symbol, data[problem])
                return None

        series = data.get("Time Series (Daily)", {})
        if not series:
            _last_errors[key] = "alphavantage: empty series"
            return None

        # Oldest-first, then take the trailing 15 sessions (~14 day change)
        closes = [
            float(series[d]["4. close"])
            for d in sorted(series.keys())
            if "4. close" in series[d]
        ][-15:]

        pct = _pct_change(closes)
        if pct is None:
            _last_errors[key] = "alphavantage: insufficient data"
            return None
        _last_errors.pop(key, None)
        _sources[key] = f"alphavantage:{symbol}"
        logger.info("Commodity %s (%s) via Alpha Vantage: %+.2f%%", key, symbol, pct)
        return pct
    except httpx.HTTPStatusError as exc:
        _last_errors[key] = f"alphavantage HTTP {exc.response.status_code}"
        return None
    except Exception as exc:
        _last_errors[key] = f"alphavantage {type(exc).__name__}"
        return None


async def get_commodity_changes() -> Dict[str, float]:
    """
    Returns {commodity_key: pct_change_14d}.
    Partial results are valid — callers omit links for missing commodities.
    Returns {} only if every source fails for every commodity.
    """
    if _cache["data"] is not None and (time.time() - _cache["fetched_at"]) < _CACHE_TTL:
        return _cache["data"]

    results: Dict[str, float] = {}

    async with httpx.AsyncClient(follow_redirects=True) as session:
        # ── Primary: Yahoo, all tickers concurrently (free, no quota) ────────
        raw = await asyncio.gather(
            *[_fetch_yahoo(session, k, t) for k, t in TICKERS.items()],
            return_exceptions=True,
        )
        for key, val in zip(TICKERS.keys(), raw):
            if isinstance(val, (int, float)) and not isinstance(val, bool):
                results[key] = float(val)
            elif isinstance(val, BaseException):
                _last_errors[key] = f"yahoo {type(val).__name__}"

        # ── Fallback: Alpha Vantage, only for what Yahoo missed ─────────────
        missing = [k for k in TICKERS if k not in results]
        if missing and ALPHA_VANTAGE_KEY:
            logger.info(
                "Yahoo returned %d/%d commodities; falling back to Alpha Vantage for: %s",
                len(results), len(TICKERS), ", ".join(missing),
            )
            for i, key in enumerate(missing):
                if i:
                    await asyncio.sleep(AV_REQUEST_GAP)  # respect 5 req/min
                val = await _fetch_alpha_vantage(session, key, AV_PROXIES[key])
                if val is not None:
                    results[key] = val
        elif missing and not ALPHA_VANTAGE_KEY:
            logger.warning(
                "Yahoo returned %d/%d commodities and ALPHA_VANTAGE_KEY is not set — "
                "no fallback available for: %s",
                len(results), len(TICKERS), ", ".join(missing),
            )

    now_iso = datetime.now(timezone.utc).isoformat()
    _health["last_attempt_at"] = now_iso
    _health["tickers_ok"] = len(results)
    _health["tickers_total"] = len(TICKERS)
    for k in results:
        _last_errors.pop(k, None)
    _health["last_error"] = "; ".join(f"{k}: {v}" for k, v in sorted(_last_errors.items())) or None

    if results:
        _health["last_success_at"] = now_iso
        _cache["data"] = results
        _cache["fetched_at"] = time.time()
        logger.info("Commodity cache updated (%d/%d): %s", len(results), len(TICKERS), results)
    else:
        logger.error(
            "All %d commodity fetches failed across every source — commodity factor "
            "DISABLED this cycle; every currency scores a neutral 50 on that axis. "
            "Last errors: %s",
            len(TICKERS), _health["last_error"],
        )

    return results
