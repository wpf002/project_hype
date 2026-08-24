"""
Commodity Price Service — 14-day % changes for the commodities that drive
speculative currency movements in Project Hype.

PROVIDER CHAIN
--------------
Each commodity declares an ordered list of providers, tried until one returns
usable data. No single upstream can disable the factor:

  yahoo         Free, no key, daily. Fast when it works, but unreliable — it
                has returned HTTP 429 for all futures tickers for extended
                periods. Tried first only because it is free and costs nothing.
  alphavantage  Daily, via liquid ETF proxies. Requires ALPHA_VANTAGE_KEY and
                is capped at 25 requests/day, so it is used only where its
                daily granularity beats FRED's monthly.
  fred          St. Louis Fed. No API key, no quota, no bot detection, and it
                covers every commodity we track — this is the guaranteed floor.
                Daily for WTI; monthly for the IMF global-price series.

Ordering is per-commodity, not global. Oil goes to FRED before Alpha Vantage
because FRED's WTI series is daily *and* free, so spending quota on it would
buy nothing. Cocoa has no ETF proxy (both iPath cocoa ETNs were delisted and
nothing liquid replaced them), so it runs yahoo -> fred.

MIXED GRANULARITY
-----------------
Sources disagree on sampling: FRED WTI is daily, FRED cocoa is monthly. Naively
comparing "first vs last row" would make a monthly series look far more volatile
than a daily one purely because it spans more calendar time, biasing every
currency linked to it.

Every provider therefore returns raw (date, price) observations, and a single
shared function normalises them: it picks the observation closest to 14 days
before the newest, measures the ACTUAL span, and converts the change to a
14-day equivalent geometrically. A monthly series spanning 31 days and a daily
series spanning 14 become directly comparable.

Cache: 12 hours, matching the catalyst engine cycle that is its only consumer.

Graceful failure: returns {} only if every provider fails for every commodity.
Because that would silently neutralise a scoring factor, get_commodity_health()
reports per-commodity status and which provider served each value, surfaced via
GET /api/status.
"""

import asyncio
import csv
import io
import logging
import os
import time
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

Observation = Tuple[date, float]

# The horizon every provider's data is normalised onto.
TARGET_WINDOW_DAYS = 14
# How much history to request. Wide enough that a monthly series yields several
# points while a daily series still comfortably covers the 14-day window.
_LOOKBACK_DAYS = 150

_CACHE_TTL = 12 * 3600
_cache: Dict = {"data": None, "fetched_at": 0.0}

ALPHA_VANTAGE_KEY = os.getenv("ALPHA_VANTAGE_KEY", "")
AV_URL = "https://www.alphavantage.co/query"
FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"
# AV free tier allows 5 requests/minute. The engine runs twice a day, so
# spacing requests generously costs nothing.
AV_REQUEST_GAP = 13.0

# Headers are PER-PROVIDER on purpose — the two upstreams want opposite things.
#
# Yahoo blocks requests that don't look like a browser, so it gets a browser
# User-Agent. FRED does the reverse: a browser UA asking for raw CSV trips its
# anti-scraping heuristics and the connection stalls until it times out (it
# hangs rather than returning 4xx, which makes it look like a network fault).
# FRED is happy with an honest identifying client string, which is better
# API-client practice anyway. Verified empirically — do not unify these.
_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,*/*;q=0.9",
    "Accept-Language": "en-US,en;q=0.9",
}

_SCRIPT_HEADERS = {
    "User-Agent": "project-hype/1.3 (+https://project-hype.up.railway.app)",
    "Accept": "text/csv",
}

# Per-commodity provider chain, tried in order. See module docstring for why
# the ordering differs per commodity.
SOURCES: Dict[str, List[Tuple[str, str]]] = {
    "oil": [
        ("yahoo", "CL=F"),
        ("fred", "DCOILWTICO"),      # daily AND free — beats spending AV quota
        ("alphavantage", "USO"),
    ],
    "gold": [
        ("yahoo", "GC=F"),
        ("alphavantage", "GLD"),     # daily, beats FRED's monthly gold index
        ("fred", "IR14270"),         # Import Price Index: Nonmonetary Gold
    ],
    "copper": [
        ("yahoo", "HG=F"),
        ("alphavantage", "CPER"),
        ("fred", "PCOPPUSDM"),       # Global price of Copper
    ],
    "soy": [
        ("yahoo", "ZS=F"),
        ("alphavantage", "SOYB"),
        ("fred", "PSOYBUSDM"),       # Global price of Soybeans
    ],
    "cocoa": [
        ("yahoo", "CC=F"),
        ("fred", "PCOCOUSDM"),       # Global price of Cocoa — no ETF proxy exists
    ],
}

# Kept for callers/tests that reason about the commodity set.
TICKERS: Dict[str, str] = {k: v[0][1] for k, v in SOURCES.items()}

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
        "providers": {k: [p for p, _ in v] for k, v in SOURCES.items()},
    }


def normalise_to_window(observations: List[Observation]) -> Optional[float]:
    """
    Convert a price series into a TARGET_WINDOW_DAYS-equivalent % change.

    Picks the observation closest to TARGET_WINDOW_DAYS before the newest one,
    measures the real calendar span between them, and scales geometrically:

        (last / first) ** (TARGET_WINDOW_DAYS / span_days) - 1

    This is what lets a monthly series be compared with a daily one. Returns
    None if the series cannot support a meaningful change.
    """
    clean = sorted({d: p for d, p in observations if p is not None and p > 0}.items())
    if len(clean) < 2:
        return None

    last_date, last_price = clean[-1]
    target = last_date - timedelta(days=TARGET_WINDOW_DAYS)

    # Closest earlier observation to the target date; never the newest itself.
    earlier = [(d, p) for d, p in clean[:-1]]
    first_date, first_price = min(earlier, key=lambda dp: abs((dp[0] - target).days))

    span = (last_date - first_date).days
    if span <= 0 or first_price <= 0:
        return None

    ratio = last_price / first_price
    if ratio <= 0:
        return None

    pct = (ratio ** (TARGET_WINDOW_DAYS / span) - 1.0) * 100.0
    return round(pct, 2)


async def _fetch_yahoo(session: httpx.AsyncClient, symbol: str) -> List[Observation]:
    resp = await session.get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
        params={"interval": "1d", "range": "3mo", "includePrePost": "false"},
        headers=_BROWSER_HEADERS,
        timeout=12.0,
    )
    resp.raise_for_status()
    result = resp.json()["chart"]["result"][0]
    stamps = result.get("timestamp") or []
    closes = result["indicators"]["quote"][0].get("close") or []
    return [
        (datetime.fromtimestamp(t, tz=timezone.utc).date(), float(c))
        for t, c in zip(stamps, closes)
        if c is not None
    ]


async def _fetch_alpha_vantage(session: httpx.AsyncClient, symbol: str) -> List[Observation]:
    if not ALPHA_VANTAGE_KEY:
        raise RuntimeError("no ALPHA_VANTAGE_KEY configured")
    resp = await session.get(
        AV_URL,
        params={
            "function": "TIME_SERIES_DAILY",
            "symbol": symbol,
            "outputsize": "compact",
            "apikey": ALPHA_VANTAGE_KEY,
        },
        headers=_BROWSER_HEADERS,
        timeout=20.0,
    )
    resp.raise_for_status()
    data = resp.json()
    # AV signals throttling/errors with HTTP 200 plus an explanatory key
    for problem in ("Note", "Information", "Error Message"):
        if problem in data:
            raise RuntimeError(str(data[problem])[:90])
    series = data.get("Time Series (Daily)", {})
    if not series:
        raise RuntimeError("empty series")
    return [
        (date.fromisoformat(d), float(v["4. close"]))
        for d, v in series.items()
        if "4. close" in v
    ]


async def _fetch_fred(session: httpx.AsyncClient, series_id: str) -> List[Observation]:
    start = (datetime.now(timezone.utc).date() - timedelta(days=_LOOKBACK_DAYS)).isoformat()
    resp = await session.get(
        FRED_CSV_URL,
        params={"id": series_id, "cosd": start},
        headers=_SCRIPT_HEADERS,
        timeout=20.0,
    )
    resp.raise_for_status()
    rows = list(csv.reader(io.StringIO(resp.text)))
    if not rows or "observation_date" not in rows[0][0]:
        raise RuntimeError("unexpected CSV shape")
    out: List[Observation] = []
    for row in rows[1:]:
        if len(row) < 2 or row[1] in (".", ""):   # FRED marks gaps with "."
            continue
        try:
            out.append((date.fromisoformat(row[0]), float(row[1])))
        except ValueError:
            continue
    if not out:
        raise RuntimeError("no usable observations")
    return out


_FETCHERS = {
    "yahoo": _fetch_yahoo,
    "alphavantage": _fetch_alpha_vantage,
    "fred": _fetch_fred,
}


async def _resolve_commodity(session: httpx.AsyncClient, key: str) -> Optional[float]:
    """Walk this commodity's provider chain until one yields a usable change."""
    attempts: List[str] = []
    for provider, symbol in SOURCES[key]:
        if provider == "alphavantage" and not ALPHA_VANTAGE_KEY:
            attempts.append(f"{provider}: no key")
            continue
        try:
            if provider == "alphavantage" and attempts:
                await asyncio.sleep(AV_REQUEST_GAP)  # respect 5 req/min
            observations = await _FETCHERS[provider](session, symbol)
            pct = normalise_to_window(observations)
            if pct is None:
                attempts.append(f"{provider}: insufficient data")
                continue
            _sources[key] = f"{provider}:{symbol}"
            _last_errors.pop(key, None)
            logger.info(
                "Commodity %s via %s (%s): %+.2f%% (14d-equiv, %d observations)",
                key, provider, symbol, pct, len(observations),
            )
            return pct
        except httpx.HTTPStatusError as exc:
            attempts.append(f"{provider}: HTTP {exc.response.status_code}")
        except Exception as exc:
            # Some httpx errors carry an empty message (ReadError('')), which
            # would log as a bare "provider: " and hide the real cause.
            detail = str(exc).strip() or type(exc).__name__
            attempts.append(f"{provider}: {detail}"[:110])

    _last_errors[key] = " | ".join(attempts)
    logger.warning("Commodity %s unavailable — %s", key, _last_errors[key])
    return None


async def get_commodity_changes() -> Dict[str, float]:
    """
    Returns {commodity_key: pct_change_14d_equivalent}.
    Partial results are valid — callers omit links for missing commodities.
    Returns {} only if every provider fails for every commodity.
    """
    if _cache["data"] is not None and (time.time() - _cache["fetched_at"]) < _CACHE_TTL:
        return _cache["data"]

    results: Dict[str, float] = {}
    async with httpx.AsyncClient(follow_redirects=True) as session:
        resolved = await asyncio.gather(
            *[_resolve_commodity(session, k) for k in SOURCES],
            return_exceptions=True,
        )
    for key, val in zip(SOURCES.keys(), resolved):
        if isinstance(val, (int, float)) and not isinstance(val, bool):
            results[key] = float(val)
        elif isinstance(val, BaseException):
            _last_errors[key] = f"unhandled {type(val).__name__}"

    now_iso = datetime.now(timezone.utc).isoformat()
    _health["last_attempt_at"] = now_iso
    _health["tickers_ok"] = len(results)
    _health["tickers_total"] = len(SOURCES)
    for k in results:
        _last_errors.pop(k, None)
    _health["last_error"] = "; ".join(f"{k}: {v}" for k, v in sorted(_last_errors.items())) or None

    if results:
        _health["last_success_at"] = now_iso
        _cache["data"] = results
        _cache["fetched_at"] = time.time()
        logger.info("Commodity cache updated (%d/%d): %s", len(results), len(SOURCES), results)
    else:
        logger.error(
            "Every provider failed for every commodity — commodity factor DISABLED "
            "this cycle; all currencies score a neutral 50 on that axis. Errors: %s",
            _health["last_error"],
        )
    return results
