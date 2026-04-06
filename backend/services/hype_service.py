"""
Hype Score Engine + Catalyst Engine — run together every 12 hours.

News source: GDELT Project DOC API — free, no API key, global coverage,
no meaningful rate limits. Covers 100+ languages; we filter for English.

HYPE SCORE (0–100)  — backward-looking: how much noise right now?
  40%  News volume      — article count in last 7 days (normalised)
  30%  Recency weight   — articles <48h count 3×, rest 1× (normalised)
  20%  Rate volatility  — stdev of rate_snapshots over last 24h (normalised)
  10%  Baseline floor   — exotic/sanctioned currencies floor 60, others floor 20

CATALYST SCORE (0–100) — forward-looking: appreciation potential
  60%  News sentiment   — bullish vs bearish keyword ratio across article titles
  40%  Rate momentum    — % rate change over last 7 days (normalised)
"""

import asyncio
import logging
import os
import statistics
from datetime import datetime, timezone, timedelta
from typing import Dict, Tuple

import httpx

from data.currencies import CURRENCIES, EXOTIC_NO_LIVE
from db.db import get_history, write_hype_snapshots, write_catalyst_snapshots

logger = logging.getLogger(__name__)

GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc"

HIGH_FLOOR_CODES = EXOTIC_NO_LIVE

# ── Sentiment keyword lists ────────────────────────────────────────────────
# Tuned for speculative currency narratives — geopolitical signals that
# precede revaluations, stabilisation events, or depreciations.

BULLISH_KEYWORDS = {
    "revaluation", "revalue", "revalued", "revaluing",
    "appreciation", "appreciating", "appreciates",
    "liberalization", "liberalise", "liberalize",
    "reconstruction", "reconstruction fund",
    "ceasefire", "cease-fire", "peace deal", "peace agreement", "peace talks",
    "normalization", "normalisation",
    "sanctions relief", "sanctions lifted", "sanctions removed", "sanctions eased",
    "sanctions waived",
    "article viii", "article 8", "imf approval", "imf program", "imf deal",
    "imf agreement", "imf compliance",
    "forex reform", "currency reform", "exchange rate reform",
    "peg adjustment", "managed float",
    "foreign reserve", "reserve growth", "reserve increase",
    "stabilization", "stabilisation", "stabilize", "stabilise",
    "economic recovery", "trade surplus", "export growth",
    "oil revenue", "oil production increase",
    "fdi", "foreign investment", "investment surge", "investment inflow",
    "diplomatic ties", "diplomatic relations",
    "economic reform", "banking reform", "central bank independence",
    "debt relief", "debt restructuring success",
}

BEARISH_KEYWORDS = {
    "hyperinflation", "hyper-inflation",
    "devaluation", "devalue", "devalued", "devaluing",
    "currency collapse", "economic collapse", "financial collapse",
    "new sanctions", "fresh sanctions", "additional sanctions",
    "parallel market", "black market", "unofficial rate",
    "capital flight", "capital controls", "capital restriction",
    "military coup", "coup d'état", "coup attempt", "junta",
    "civil war", "armed conflict", "military offensive",
    "currency crisis", "exchange crisis", "balance of payments crisis",
    "sovereign default", "debt default",
    "embargo", "trade embargo", "trade ban", "economic blockade",
    "money printing", "currency printing",
    "inflation spiral", "banking collapse", "bank run",
    "asset freeze", "frozen assets",
}


def _floor(code: str) -> float:
    return 60.0 if code in HIGH_FLOOR_CODES else 20.0


def _normalise(values: Dict[str, float]) -> Dict[str, float]:
    """Min-max normalise a dict of floats to 0-100. Returns 50 for all if range is 0."""
    if not values:
        return {}
    lo = min(values.values())
    hi = max(values.values())
    if hi == lo:
        return {k: 50.0 for k in values}
    return {k: (v - lo) / (hi - lo) * 100 for k, v in values.items()}


def _score_sentiment(articles: list) -> float:
    """
    Score a list of NewsAPI article dicts on a -100 to +100 scale.
    Scans title + description for bullish/bearish keywords.
    Net score normalised by article count so volume doesn't inflate sentiment.
    """
    if not articles:
        return 0.0
    total = 0
    for a in articles:
        text = ((a.get("title") or "") + " " + (a.get("description") or "")).lower()
        bull = sum(1 for kw in BULLISH_KEYWORDS if kw in text)
        bear = sum(1 for kw in BEARISH_KEYWORDS if kw in text)
        total += bull - bear
    per_article = total / len(articles)
    return max(-100.0, min(100.0, per_article * 33.3))


async def _fetch_news_data(code: str, query: str) -> Tuple[int, int, float]:
    """
    Fetch up to 100 articles from GDELT DOC API for `query` over the last 7 days.
    Returns (total_7d, weighted_recency_cnt, sentiment_score).
    Returns (0, 0, 0.0) on any error.

    GDELT is free, requires no API key, and provides broad global coverage
    across thousands of sources — ideal for exotic and geopolitically sensitive
    currencies that mainstream financial APIs under-cover.
    """
    now = datetime.now(timezone.utc)
    cutoff_48h = now - timedelta(hours=48)

    params = {
        "query": query,
        "mode": "artlist",
        "maxrecords": 100,
        "timespan": "7d",
        "sourcelang": "english",
        "format": "json",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(GDELT_URL, params=params)
            resp.raise_for_status()
            data = resp.json()

        articles = data.get("articles") or []
        total_7d = len(articles)

        weighted = 0
        for a in articles:
            seen = a.get("seendate", "")
            try:
                # GDELT seendate format: 20240401T120000Z
                pub_dt = datetime.strptime(seen, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
                weighted += 3 if pub_dt >= cutoff_48h else 1
            except (ValueError, TypeError):
                weighted += 1

        sentiment = _score_sentiment(articles)
        return total_7d, weighted, sentiment

    except Exception as exc:
        logger.warning("GDELT fetch failed for %s: %s", code, exc)
        return 0, 0, 0.0


def _get_volatility(code: str) -> float:
    """Stdev of rate snapshots over last 24h; 0 if insufficient data."""
    snapshots = get_history(code, limit=96)
    if len(snapshots) < 2:
        return 0.0
    try:
        return statistics.stdev(s["rate"] for s in snapshots)
    except statistics.StatisticsError:
        return 0.0


def _get_momentum_7d(code: str) -> float:
    """
    % rate change oldest→newest across last 7 days of snapshots.
    Positive = currency appreciating vs USD. Returns 0 if insufficient data.
    """
    snapshots = get_history(code, limit=672)  # 96/day × 7 days
    if len(snapshots) < 2:
        return 0.0
    newest = snapshots[0]["rate"]
    oldest = snapshots[-1]["rate"]
    if oldest == 0:
        return 0.0
    return ((newest - oldest) / oldest) * 100


async def calculate_all_hype_scores() -> None:
    """
    Compute hype + catalyst scores for all currencies and persist both tables.
    Called on startup then every 12 hours (2 runs/day = 80 NewsAPI req/day).
    """
    logger.info("Score engine: starting for %d currencies via GDELT", len(CURRENCIES))

    # ── Gather news data concurrently via GDELT (free, no API key required) ──
    raw_volume: Dict[str, int] = {}
    raw_recency: Dict[str, int] = {}
    raw_sentiment: Dict[str, float] = {}
    raw_volatility: Dict[str, float] = {}
    raw_momentum: Dict[str, float] = {}

    # Limit to 8 concurrent GDELT requests to be a good citizen
    semaphore = asyncio.Semaphore(8)

    async def fetch_one(currency: dict) -> None:
        code = currency["code"]
        query = currency.get("news_query", currency["name"])
        async with semaphore:
            total, weighted, sentiment = await _fetch_news_data(code, query)
            raw_volume[code] = total
            raw_recency[code] = weighted
            raw_sentiment[code] = sentiment

    await asyncio.gather(*[fetch_one(c) for c in CURRENCIES])
    use_news = any(v > 0 for v in raw_volume.values())

    for c in CURRENCIES:
        raw_volatility[c["code"]] = _get_volatility(c["code"])
        raw_momentum[c["code"]] = _get_momentum_7d(c["code"])

    # ── Normalise ──────────────────────────────────────────────────────────
    norm_volume     = _normalise(raw_volume)
    norm_recency    = _normalise(raw_recency)
    norm_volatility = _normalise(raw_volatility)

    # Shift sentiment (-100..+100) to positive domain before normalising
    shifted_sentiment = {k: v + 100 for k, v in raw_sentiment.items()}
    norm_sentiment = _normalise(shifted_sentiment)

    # Shift momentum to handle negative values before normalising
    mom_min = min(raw_momentum.values(), default=0)
    norm_momentum = _normalise({k: v - mom_min for k, v in raw_momentum.items()})

    # ── Compose scores ─────────────────────────────────────────────────────
    hype_out: Dict[str, dict] = {}
    catalyst_out: Dict[str, dict] = {}

    for c in CURRENCIES:
        code = c["code"]
        floor = _floor(code)

        # Hype — how much attention right now?
        if use_news:
            raw_hype = (
                0.40 * norm_volume.get(code, 0)
                + 0.30 * norm_recency.get(code, 0)
                + 0.20 * norm_volatility.get(code, 0)
                + 0.10 * floor
            )
        else:
            raw_hype = (
                0.67 * norm_volatility.get(code, 0)
                + 0.33 * floor
            )
        hype_score = round(max(floor, min(100.0, raw_hype)), 2)

        # Catalyst — forward-looking appreciation potential
        if use_news:
            raw_catalyst = (
                0.60 * norm_sentiment.get(code, 50)
                + 0.40 * norm_momentum.get(code, 50)
            )
        else:
            raw_catalyst = norm_momentum.get(code, 50)
        catalyst_score = round(max(0.0, min(100.0, raw_catalyst)), 2)

        hype_out[code] = {
            "score": hype_score,
            "news_count": raw_volume.get(code, 0),
            "volatility": round(raw_volatility.get(code, 0.0), 8),
        }
        catalyst_out[code] = {
            "score": catalyst_score,
            "sentiment": round(raw_sentiment.get(code, 0.0), 2),
            "momentum": round(raw_momentum.get(code, 0.0), 4),
        }

    write_hype_snapshots(hype_out)
    write_catalyst_snapshots(catalyst_out)
    logger.info("Score engine: wrote hype + catalyst for %d currencies", len(CURRENCIES))
