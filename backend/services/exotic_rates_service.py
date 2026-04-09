"""
Exotic Rates Service — scrapes real-world parallel/black market rates for
currencies where commercial FX APIs return fictional official rates.

Each scraper:
  - Uses httpx async GET with a realistic User-Agent
  - Parses response (HTML or JSON)
  - Returns (rate_float, source_name, data_confidence) or None on failure
  - Caches results for 6 hours (these rates don't move by the minute)
  - Falls back silently on any error

data_confidence values:
  "live"             — scraped from live source right now
  "scraped_cached"   — from in-memory cache of a recent scrape
  "analyst_estimate" — hardcoded fallback, no reliable scrape available
"""

import logging
import time
import xml.etree.ElementTree as ET
from typing import Dict, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (compatible; ProjectHype/1.2; +https://projecthype.io)"

# Cache: {code: (rate, source_name, confidence, fetched_at)}
_cache: Dict[str, Tuple[float, str, str, float]] = {}
CACHE_TTL = 6 * 3600  # 6 hours


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
    bonbast.com publishes the most-cited black market rate tracker for IRR.
    Their page contains a JSON data block or a rates table with USD row.
    Rate is IRR per 1 USD — we invert to USD per 1 IRR.
    """
    cached = _cache_get("IRR")
    if cached:
        return cached
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(
                "https://www.bonbast.com",
                headers={"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"},
            )
            resp.raise_for_status()

        html = resp.text
        # bonbast embeds rates in a <table> — locate USD row
        # Pattern: look for "USD" near a numeric rate (typically 6-7 digits for IRR)
        import re
        # Match patterns like >600,000< or >600000< near USD
        matches = re.findall(r'USD.*?([\d,]{5,10})', html[:5000], re.IGNORECASE | re.DOTALL)
        if not matches:
            # Broader search
            matches = re.findall(r'([\d,]{6,9})\s*</td>', html)

        for m in matches:
            try:
                raw = float(m.replace(",", ""))
                if 200_000 <= raw <= 2_000_000:  # sanity: IRR is ~500K–800K per USD
                    rate = 1.0 / raw
                    _cache_set("IRR", rate, "bonbast.com", "live")
                    logger.info("IRR scraped from bonbast.com: %.2f IRR/USD → %.10f USD/IRR", raw, rate)
                    return rate, "bonbast.com", "live"
            except (ValueError, ZeroDivisionError):
                continue

        logger.warning("IRR: bonbast.com parse failed — no valid rate found")
    except Exception as exc:
        logger.debug("IRR scrape failed: %s", exc)
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
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            resp = await client.get(
                "https://s3.amazonaws.com/dolartoday/data.json",
                headers={"User-Agent": USER_AGENT},
            )
            resp.raise_for_status()
        data = resp.json()
        usd_data = data.get("USD", {})
        # Try transferencia first, then promedio
        raw = usd_data.get("transferencia") or usd_data.get("promedio")
        if raw and isinstance(raw, (int, float)) and raw > 0:
            rate = 1.0 / float(raw)
            _cache_set("VES", rate, "DolarToday", "live")
            logger.info("VES scraped from DolarToday: %.2f VES/USD → %.10f USD/VES", raw, rate)
            return rate, "DolarToday", "live"
        logger.warning("VES: DolarToday JSON missing expected fields: %s", list(usd_data.keys()))
    except Exception as exc:
        logger.debug("VES scrape failed: %s", exc)
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
    try:
        import re
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            resp = await client.get(
                "https://lirarate.org",
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
                    logger.info("LBP scraped from lirarate.org: %.0f LBP/USD", raw)
                    return rate, "lirarate.org", "live"
            except (ValueError, ZeroDivisionError):
                continue
        logger.warning("LBP: lirarate.org parse failed")
    except Exception as exc:
        logger.debug("LBP scrape failed: %s", exc)
    return None


# ── ZWL — Zimbabwe via Reserve Bank of Zimbabwe ──────────────────────────────

async def _fetch_zwl() -> Optional[Tuple[float, str, str]]:
    """
    RBZ publishes official exchange rate data. ZWL was replaced by ZiG (ZWG)
    in April 2024. We attempt to parse the published rate table.
    Rate is ZWL/ZiG per 1 USD — we invert.
    """
    cached = _cache_get("ZWL")
    if cached:
        return cached
    try:
        import re
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(
                "https://www.rbz.co.zw/index.php/financial-markets/exchange-rates",
                headers={"User-Agent": USER_AGENT},
            )
            resp.raise_for_status()
        html = resp.text
        # ZiG rate vs USD — typically single-digit to low double-digit
        matches = re.findall(r'USD.*?([\d.]{1,8})', html[:10000], re.IGNORECASE | re.DOTALL)
        for m in matches:
            try:
                raw = float(m)
                if 1.0 <= raw <= 50.0:  # ZiG launched at ~13.56 per USD
                    rate = 1.0 / raw
                    _cache_set("ZWL", rate, "RBZ (Reserve Bank of Zimbabwe)", "live")
                    logger.info("ZWL/ZiG scraped from RBZ: %.4f ZiG/USD", raw)
                    return rate, "RBZ (Reserve Bank of Zimbabwe)", "live"
            except (ValueError, ZeroDivisionError):
                continue
        logger.warning("ZWL: RBZ parse failed")
    except Exception as exc:
        logger.debug("ZWL scrape failed: %s", exc)
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
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(
                "https://forex.cbm.gov.mm/api/latest",
                headers={"User-Agent": USER_AGENT},
            )
            resp.raise_for_status()
        data = resp.json()
        # Response: {"info": {...}, "timestamp": "...", "rates": {"USD": "2100.0", ...}}
        rates = data.get("rates", {})
        usd_rate_str = rates.get("USD") or rates.get("USD ")
        if usd_rate_str:
            raw = float(str(usd_rate_str).replace(",", ""))
            if 1_000 <= raw <= 10_000:
                rate = 1.0 / raw
                _cache_set("MMK", rate, "Central Bank of Myanmar", "live")
                logger.info("MMK scraped from CBM API: %.2f MMK/USD (official; parallel ~2×)", raw)
                return rate, "Central Bank of Myanmar", "live"
        logger.warning("MMK: CBM API response missing USD rate: %s", list(rates.keys())[:5])
    except Exception as exc:
        logger.debug("MMK scrape failed: %s", exc)
    return None


# ── Public interface ──────────────────────────────────────────────────────────

# Analyst estimates for currencies where no scrape exists
# (rate in USD per 1 unit, last analyst update noted)
_ANALYST_ESTIMATES: Dict[str, Tuple[float, str]] = {
    "KPW": (0.00000111, "NK Economy Watch / analyst estimate"),
    "SYP": (0.0000769, "Syria Report / analyst estimate"),
    "SDG": (0.000357,  "Sudan parallel market estimate"),
    "SOS": (0.00175,   "CBS Mogadishu / analyst estimate"),
    "YER": (0.000400,  "Aden CBY / analyst estimate"),
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
        # Scraper failed — check if there's a stale cache entry
        stale = _cache.get(code)
        if stale:
            return stale[0], stale[1] + " (stale)", "scraped_cached"

    # Analyst estimate fallback
    if code in _ANALYST_ESTIMATES:
        rate, source = _ANALYST_ESTIMATES[code]
        return rate, source, "analyst_estimate"

    return None, "", "analyst_estimate"
