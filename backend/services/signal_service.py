"""
Signal Service — monitors IMF and OFAC RSS feeds for institutional signals
that are material to the exotic/speculative currencies tracked by Project Hype.

Runs every 4 hours. Classifies article mentions into typed signals and persists
them to the signals table. Deduplication is done at the DB layer by headline.

Signal types:
  IMF_POSITIVE     — program approval, tranche release, Article IV positive
  IMF_NEGATIVE     — program suspended, off-track, arrears
  SANCTIONS_RELIEF — relief, license, exemption
  SANCTIONS_ADDED  — new designation, blocked, additional sanctions
"""

import asyncio
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import List, Tuple, Optional

import httpx

from db.db import insert_signal

logger = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (compatible; ProjectHype/1.2; +https://projecthype.io)"

# ── Feed definitions ──────────────────────────────────────────────────────────

IMF_RSS_URL = "https://www.imf.org/en/News/rss?language=eng"
OFAC_RSS_URL = "https://home.treasury.gov/rss.xml"

# ── Currency → country terms for matching ─────────────────────────────────────

IMF_CURRENCY_TERMS = {
    "ARS": ["argentina", "argentinian", "bcra"],
    "EGP": ["egypt", "egyptian", "cbe"],
    "PKR": ["pakistan", "pakistani", "sbp"],
    "GHS": ["ghana", "ghanaian", "bog"],
    "ETB": ["ethiopia", "ethiopian", "nbe"],
    "NGN": ["nigeria", "nigerian", "cbn"],
    "LBP": ["lebanon", "lebanese", "bdl", "banque du liban"],
    "SDG": ["sudan", "sudanese", "cbos"],
    "MMK": ["myanmar", "burma", "cbm"],
    "ZWG": ["zimbabwe", "zimbabwean", "rbz"],
    "VES": ["venezuela", "venezuelan", "bcv"],
    "YER": ["yemen", "yemeni", "cby"],
    "IRR": ["iran", "iranian"],
    "KPW": ["north korea", "dprk", "korea"],
}

OFAC_CURRENCY_TERMS = {
    "IRR":  ["iran", "iranian", "irgc", "irisl"],
    "KPW":  ["north korea", "dprk", "pyongyang", "kim"],
    "SYP":  ["syria", "syrian", "damascus"],
    "MMK":  ["myanmar", "burma", "tatmadaw", "min aung"],
    "SDG":  ["sudan", "sudanese", "rsf", "khartoum"],
    "ZWG":  ["zimbabwe", "zimbabwean", "zanu"],
    "YER":  ["yemen", "yemeni", "houthi", "ansarallah"],
    "VES":  ["venezuela", "venezuelan", "maduro", "pdvsa"],
}

# ── IMF signal keywords ────────────────────────────────────────────────────────

IMF_POSITIVE_TERMS = [
    "program", "agreement", "tranche", "article iv",
    "standby arrangement", "extended fund facility", "eff",
    "disbursement", "approved", "approval", "completed review",
    "reform progress", "on track",
]

IMF_NEGATIVE_TERMS = [
    "suspended", "off-track", "off track", "missed targets",
    "arrears", "delayed", "breach", "not met", "non-compliance",
    "program ended", "talks stalled", "failed",
]

# ── OFAC signal keywords ───────────────────────────────────────────────────────

SANCTIONS_RELIEF_TERMS = [
    "sanctions relief", "general license", "specific license",
    "exemption", "waiver", "delisted", "de-listed", "removed from",
    "easing", "eased", "wind-down",
]

SANCTIONS_ADDED_TERMS = [
    "additional sanctions", "new sanctions", "designated",
    "blocked", "sdn list", "specially designated", "executive order",
    "ofac action", "ofac targets", "further sanctions",
]


# ── RSS parsing ───────────────────────────────────────────────────────────────

def _parse_rss_items(xml_text: str) -> List[dict]:
    """Parse RSS XML and return list of {title, description, link, pubDate} dicts."""
    items = []
    try:
        root = ET.fromstring(xml_text)
        for item in root.findall(".//item"):
            title = (item.findtext("title") or "").strip()
            desc = (item.findtext("description") or "").strip()
            link = (item.findtext("link") or "").strip()
            pub = (item.findtext("pubDate") or "").strip()
            if title:
                items.append({"title": title, "description": desc, "link": link, "pubDate": pub})
    except ET.ParseError as exc:
        logger.debug("RSS parse error: %s", exc)
    return items


async def _fetch_rss(url: str) -> List[dict]:
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": USER_AGENT})
            resp.raise_for_status()
        return _parse_rss_items(resp.text)
    except Exception as exc:
        logger.warning("Signal feed fetch failed %s: %s", url, exc)
        return []


def _text_contains_any(text: str, terms: List[str]) -> bool:
    tl = text.lower()
    return any(t in tl for t in terms)


def _classify_imf(title: str, desc: str) -> Optional[str]:
    combined = (title + " " + desc).lower()
    if _text_contains_any(combined, IMF_NEGATIVE_TERMS):
        return "IMF_NEGATIVE"
    if _text_contains_any(combined, IMF_POSITIVE_TERMS):
        return "IMF_POSITIVE"
    return None


def _classify_ofac(title: str, desc: str) -> Optional[str]:
    combined = (title + " " + desc).lower()
    if _text_contains_any(combined, SANCTIONS_RELIEF_TERMS):
        return "SANCTIONS_RELIEF"
    if _text_contains_any(combined, SANCTIONS_ADDED_TERMS):
        return "SANCTIONS_ADDED"
    return None


# ── Main polling function ─────────────────────────────────────────────────────

async def poll_signals() -> None:
    """
    Fetch IMF and OFAC RSS feeds, classify articles, and persist signals.
    Called on startup then every 4 hours.
    """
    logger.info("Signal service: polling IMF and OFAC feeds")

    imf_items, ofac_items = await asyncio.gather(
        _fetch_rss(IMF_RSS_URL),
        _fetch_rss(OFAC_RSS_URL),
    )

    imf_stored = 0
    for item in imf_items:
        title = item["title"]
        desc = item["description"]
        signal_type = _classify_imf(title, desc)
        if not signal_type:
            continue
        combined = (title + " " + desc).lower()
        for code, terms in IMF_CURRENCY_TERMS.items():
            if _text_contains_any(combined, terms):
                await insert_signal(
                    code=code,
                    signal_type=signal_type,
                    headline=title,
                    url=item["link"],
                    published_at=item["pubDate"],
                )
                logger.info("IMF signal %s → %s: %s", signal_type, code, title[:80])
                imf_stored += 1

    ofac_stored = 0
    for item in ofac_items:
        title = item["title"]
        desc = item["description"]
        signal_type = _classify_ofac(title, desc)
        if not signal_type:
            continue
        combined = (title + " " + desc).lower()
        for code, terms in OFAC_CURRENCY_TERMS.items():
            if _text_contains_any(combined, terms):
                await insert_signal(
                    code=code,
                    signal_type=signal_type,
                    headline=title,
                    url=item["link"],
                    published_at=item["pubDate"],
                )
                logger.info("OFAC signal %s → %s: %s", signal_type, code, title[:80])
                ofac_stored += 1

    logger.info(
        "Signal service: stored %d IMF signals, %d OFAC signals",
        imf_stored, ofac_stored,
    )
