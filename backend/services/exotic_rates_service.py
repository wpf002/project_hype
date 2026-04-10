"""
Exotic Rates Service — scrapes real-world parallel/black market rates for
currencies where commercial FX APIs return fictional official rates.

Each scraper:
  - Uses httpx async GET/POST with a realistic User-Agent
  - Parses response (HTML or JSON)
  - Returns (rate_float, source_name, data_confidence) or None on failure
  - Caches results for 6 hours (these rates don't move by the minute)
  - Falls back silently on any error; logs failure type for Railway visibility

data_confidence values:
  "live"             — scraped from live source right now
  "scraped_cached"   — from in-memory cache of a recent scrape
  "analyst_estimate" — hardcoded fallback, no reliable scrape available
"""

import logging
import re
import time
from typing import Dict, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

# Cache: {code: (rate, source_name, confidence, fetched_at)}
_cache: Dict[str, Tuple[float, str, str, float]] = {}
CACHE_TTL = 6 * 3600  # 6 hours
TIMEOUT = 10.0         # all scrapers use this timeout


def _cache_get(code: str) -> Optional[Tuple[float, str, str]]:
    entry = _cache.get(code)
    if entry and (time.time() - entry[3]) < CACHE_TTL:
        rate, source, confidence, _ = entry
        return rate, source, "scraped_cached" if confidence == "live" else confidence
    return None


def _cache_set(code: str, rate: float, source: str, confidence: str) -> None:
    _cache[code] = (rate, source, confidence, time.time())


# ── IRR — Iranian Rial via bonbast.com ───────────────────────────────────────

async def _fetch_irr() -> Optional[Tuple[float, str, str]]:
    """
    bonbast.com is the most-cited black market rate tracker for IRR.

    Strategy: the page embeds a one-time token in a JS block which is used to
    POST to /json — returns a JSON dict with 'usd1' (buy) and 'usd2' (sell).
    We use usd2 (sell = what IRR holders get when converting to USD).
    Rate is IRR per 1 USD — we invert to get USD per 1 IRR.
    """
    cached = _cache_get("IRR")
    if cached:
        return cached

    source_url = "https://www.bonbast.com"
    try:
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
            # Step 1: fetch page to extract the rotating token
            page = await client.get(source_url, headers=headers)
            page.raise_for_status()

            m = re.search(r'param:\s*"([^"]+)"', page.text)
            if not m:
                logger.warning("IRR: bonbast.com — could not find token in page JS (%s)", source_url)
                return None
            token = m.group(1)

            # Step 2: POST to /json with the token
            json_resp = await client.post(
                "https://www.bonbast.com/json",
                data={"param": token},
                headers={
                    **headers,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": source_url,
                },
            )
            json_resp.raise_for_status()
            data = json_resp.json()

        # usd2 = sell rate (IRR holders selling to USD) — what the market pays
        raw_str = data.get("usd2") or data.get("usd1")
        if not raw_str:
            logger.warning("IRR: bonbast.com JSON missing usd1/usd2 keys: %s", list(data.keys())[:10])
            return None

        raw = float(str(raw_str).replace(",", ""))
        if not (100_000 <= raw <= 5_000_000):
            logger.warning("IRR: bonbast.com rate %.0f outside sanity range [100K–5M]", raw)
            return None

        rate = 1.0 / raw
        _cache_set("IRR", rate, "bonbast.com", "live")
        logger.info("IRR scraped from bonbast.com (%s): %.0f IRR/USD → %.10f USD/IRR", source_url, raw, rate)
        return rate, "bonbast.com", "live"

    except Exception as exc:
        logger.warning("IRR: bonbast.com scrape failed (%s) — %s: %s",
                       source_url, type(exc).__name__, exc)
    return None


# ── VES — Venezuelan Bolívar via DolarToday public JSON ─────────────────────

async def _fetch_ves() -> Optional[Tuple[float, str, str]]:
    """
    DolarToday is the definitive parallel market rate tracker for VES.
    Public JSON endpoint — no scraping needed.
    Rate is VES per 1 USD — we invert.
    """
    cached = _cache_get("VES")
    if cached:
        return cached

    source_url = "https://s3.amazonaws.com/dolartoday/data.json"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(source_url, headers={"User-Agent": USER_AGENT})
            resp.raise_for_status()
        data = resp.json()
        usd_data = data.get("USD", {})
        raw = usd_data.get("transferencia") or usd_data.get("promedio")
        if raw and isinstance(raw, (int, float)) and raw > 0:
            rate = 1.0 / float(raw)
            _cache_set("VES", rate, "DolarToday", "live")
            logger.info("VES scraped from DolarToday (%s): %.2f VES/USD → %.10f USD/VES",
                        source_url, raw, rate)
            return rate, "DolarToday", "live"
        logger.warning("VES: DolarToday (%s) JSON missing expected fields: %s",
                       source_url, list(usd_data.keys()))
    except Exception as exc:
        logger.warning("VES: DolarToday scrape failed (%s) — %s: %s",
                       source_url, type(exc).__name__, exc)
    return None


# ── LBP — Lebanese Pound via lirarate.org ───────────────────────────────────

async def _fetch_lbp() -> Optional[Tuple[float, str, str]]:
    """
    lirarate.org tracks the Sayrafa-adjacent street rate for LBP.
    Rate is LBP per 1 USD — we invert.
    """
    cached = _cache_get("LBP")
    if cached:
        return cached

    source_url = "https://lirarate.org"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(
                source_url,
                headers={"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"},
            )
            resp.raise_for_status()
        html = resp.text
        # LBP rates are typically 85,000–100,000 per USD
        matches = re.findall(r'([\d,]{6,8})\s*(?:LBP|LL|£)?', html[:8000])
        for m in matches:
            try:
                raw = float(m.replace(",", ""))
                if 60_000 <= raw <= 200_000:
                    rate = 1.0 / raw
                    _cache_set("LBP", rate, "lirarate.org", "live")
                    logger.info("LBP scraped from lirarate.org (%s): %.0f LBP/USD → %.10f USD/LBP",
                                source_url, raw, rate)
                    return rate, "lirarate.org", "live"
            except (ValueError, ZeroDivisionError):
                continue
        logger.warning("LBP: lirarate.org (%s) parse failed — no rate in expected range", source_url)
    except Exception as exc:
        logger.warning("LBP: lirarate.org scrape failed (%s) — %s: %s",
                       source_url, type(exc).__name__, exc)
    return None


# ── ZWL — Zimbabwe Dollar / ZiG via ExchangeRate-API ────────────────────────

async def _fetch_zwl() -> Optional[Tuple[float, str, str]]:
    """
    Zimbabwe replaced ZWL with ZiG (ZWG) in April 2024.

    RBZ.co.zw is protected by a Radware captcha — direct scraping is blocked.
    ExchangeRate-API reliably covers ZWG (and aliases it as ZWL), making it
    the best available source for this currency.

    Requires FX_API_KEY (ExchangeRate-API v6) in environment.
    Rate is ZWG per 1 USD — we invert to USD per 1 ZWG.
    """
    cached = _cache_get("ZWL")
    if cached:
        return cached

    import os
    api_key = os.getenv("FX_API_KEY", "")
    if not api_key:
        logger.warning("ZWL: FX_API_KEY not set — cannot fetch ZWG rate")
        return None

    source_url = f"https://v6.exchangerate-api.com/v6/{api_key}/latest/USD"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(source_url, headers={"User-Agent": USER_AGENT})
            resp.raise_for_status()
        data = resp.json()
        rates = data.get("conversion_rates", {})

        # ZWG is the current code; ZWL is kept as alias by some providers
        raw = rates.get("ZWG") or rates.get("ZWL")
        if raw and float(raw) > 0:
            raw = float(raw)
            if not (1.0 <= raw <= 10_000.0):
                logger.warning("ZWL/ZWG: ExchangeRate-API rate %.4f outside sanity range", raw)
                return None
            rate = 1.0 / raw
            _cache_set("ZWL", rate, "ExchangeRate-API (ZWG)", "live")
            logger.info("ZWL/ZiG scraped from ExchangeRate-API (%s): %.4f ZWG/USD → %.10f USD/ZWG",
                        "exchangerate-api.com", raw, rate)
            return rate, "ExchangeRate-API (ZWG)", "live"

        logger.warning("ZWL: ExchangeRate-API (%s) missing ZWG/ZWL in response: %s",
                       "exchangerate-api.com", [k for k in rates if k.startswith("ZW")])
    except Exception as exc:
        logger.warning("ZWL: ExchangeRate-API scrape failed (%s) — %s: %s",
                       "exchangerate-api.com", type(exc).__name__, exc)
    return None


# ── MMK — Myanmar Kyat via Central Bank of Myanmar JSON API ─────────────────

async def _fetch_mmk() -> Optional[Tuple[float, str, str]]:
    """
    CBM publishes a public JSON API with official rates.
    Note: the official rate (~2,100) diverges significantly from the parallel
    market rate (~4,200+). We return the official rate and flag accordingly.
    Rate: MMK per 1 USD → we invert.
    """
    cached = _cache_get("MMK")
    if cached:
        return cached

    source_url = "https://forex.cbm.gov.mm/api/latest"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(source_url, headers={"User-Agent": USER_AGENT})
            resp.raise_for_status()
        data = resp.json()
        rates = data.get("rates", {})
        usd_rate_str = rates.get("USD") or rates.get("USD ")
        if usd_rate_str:
            raw = float(str(usd_rate_str).replace(",", ""))
            if 1_000 <= raw <= 10_000:
                rate = 1.0 / raw
                _cache_set("MMK", rate, "Central Bank of Myanmar", "live")
                logger.info("MMK scraped from CBM API (%s): %.2f MMK/USD (official; parallel ~2×)",
                            source_url, raw)
                return rate, "Central Bank of Myanmar", "live"
        logger.warning("MMK: CBM API (%s) missing USD rate: %s",
                       source_url, list(rates.keys())[:5])
    except Exception as exc:
        logger.warning("MMK: CBM API scrape failed (%s) — %s: %s",
                       source_url, type(exc).__name__, exc)
    return None


# ── Public interface ──────────────────────────────────────────────────────────

# Analyst estimates for currencies where no scraper exists
# (rate in USD per 1 unit, last analyst update noted)
_ANALYST_ESTIMATES: Dict[str, Tuple[float, str]] = {
    "KPW": (0.00000111, "NK Economy Watch / analyst estimate"),
    "SYP": (0.0000769,  "Syria Report / analyst estimate"),
    "SDG": (0.000357,   "Sudan parallel market estimate"),
    "SOS": (0.00175,    "CBS Mogadishu / analyst estimate"),
    "YER": (0.000400,   "Aden CBY / analyst estimate"),
}

_SCRAPER_MAP = {
    "IRR": _fetch_irr,
    "VES": _fetch_ves,
    "LBP": _fetch_lbp,
    "ZWL": _fetch_zwl,
    "MMK": _fetch_mmk,
}


async def get_exotic_rate(code: str) -> Tuple[Optional[float], str, str]:
    """
    Try to return (rate, source_name, data_confidence) for an exotic currency.
    Returns (None, "", "analyst_estimate") if no scraper exists for the code.

    data_confidence: "live" | "scraped_cached" | "analyst_estimate"
    """
    code = code.upper()

    scraper = _SCRAPER_MAP.get(code)
    if scraper:
        result = await scraper()
        if result:
            return result
        # Scraper failed — serve stale cache rather than dropping to analyst
        stale = _cache.get(code)
        if stale:
            return stale[0], stale[1] + " (stale)", "scraped_cached"

    # Analyst estimate fallback
    if code in _ANALYST_ESTIMATES:
        rate, source = _ANALYST_ESTIMATES[code]
        return rate, source, "analyst_estimate"

    return None, "", "analyst_estimate"
