"""
Hype Score Engine — computes a 0-100 score for each currency every hour.

Four weighted components:
  40%  News volume      — article count in last 7 days (normalised)
  30%  Recency weight   — articles <48h count 3×, rest 1× (normalised)
  20%  Rate volatility  — stdev of rate_snapshots over last 24h (normalised)
  10%  Baseline floor   — exotic/sanctioned currencies floor 60, others floor 20

If NEWSAPI_KEY is not set the two news components are skipped and the
remaining weights are renormalised: volatility → 67%, baseline → 33%.
"""

import asyncio
import logging
import os
import statistics
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional

import httpx

from data.currencies import CURRENCIES, EXOTIC_NO_LIVE
from db.db import get_history, write_hype_snapshots

logger = logging.getLogger(__name__)

NEWSAPI_KEY = os.getenv("NEWSAPI_KEY", "")
NEWSAPI_URL = "https://newsapi.org/v2/everything"

# Codes that get a baseline floor of 60 (all others get 20)
HIGH_FLOOR_CODES = EXOTIC_NO_LIVE


def _floor(code: str) -> float:
    return 60.0 if code in HIGH_FLOOR_CODES else 20.0


def _normalise(values: Dict[str, float]) -> Dict[str, float]:
    """Min-max normalise a dict of floats to 0-100. Returns 0 for all if range is 0."""
    if not values:
        return {}
    lo = min(values.values())
    hi = max(values.values())
    if hi == lo:
        return {k: 50.0 for k in values}
    return {k: (v - lo) / (hi - lo) * 100 for k, v in values.items()}


async def _fetch_news_counts(code: str, query: str) -> tuple[int, int]:
    """
    Return (total_7d, weighted_score) for `query`:
      total_7d      — articles published in the last 7 days
      weighted_cnt  — articles <48h × 3 + older articles × 1
    Returns (0, 0) on any error.
    """
    if not NEWSAPI_KEY:
        return 0, 0

    now = datetime.now(timezone.utc)
    from_7d = (now - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    from_48h = (now - timedelta(hours=48)).strftime("%Y-%m-%dT%H:%M:%SZ")

    params_7d = {
        "q": query,
        "from": from_7d,
        "language": "en",
        "sortBy": "publishedAt",
        "pageSize": 100,
        "apiKey": NEWSAPI_KEY,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(NEWSAPI_URL, params=params_7d)
            resp.raise_for_status()
            data = resp.json()

        articles = data.get("articles", [])
        total_7d = len(articles)
        cutoff_48h = now - timedelta(hours=48)

        weighted = 0
        for a in articles:
            pub = a.get("publishedAt", "")
            try:
                pub_dt = datetime.fromisoformat(pub.replace("Z", "+00:00"))
                if pub_dt >= cutoff_48h:
                    weighted += 3
                else:
                    weighted += 1
            except ValueError:
                weighted += 1

        return total_7d, weighted

    except Exception as exc:
        logger.warning("NewsAPI fetch failed for %s (%s): %s", code, query[:40], exc)
        return 0, 0


def _get_volatility(code: str) -> float:
    """Return stdev of rate snapshots over last 24h, or 0 if insufficient data."""
    snapshots = get_history(code, limit=96)  # up to 96 × 15-min = 24h
    if len(snapshots) < 2:
        return 0.0
    rates = [s["rate"] for s in snapshots]
    try:
        return statistics.stdev(rates)
    except statistics.StatisticsError:
        return 0.0


async def calculate_all_hype_scores() -> None:
    """
    Compute hype scores for all 40 currencies and persist to hype_snapshots.
    Called once on startup and then every hour via the background loop in main.py.
    """
    logger.info("Hype engine: starting calculation for %d currencies", len(CURRENCIES))

    use_news = bool(NEWSAPI_KEY)
    if not use_news:
        logger.info("Hype engine: NEWSAPI_KEY not set — news components skipped")

    # ── Gather raw signals ────────────────────────────────────────────────
    raw_volume: Dict[str, int] = {}
    raw_recency: Dict[str, int] = {}
    raw_volatility: Dict[str, float] = {}

    if use_news:
        # Fetch news concurrently (bounded to avoid hammering the API)
        semaphore = asyncio.Semaphore(5)

        async def fetch_one(currency: dict) -> None:
            code = currency["code"]
            query = currency.get("news_query", currency["name"])
            async with semaphore:
                total, weighted = await _fetch_news_counts(code, query)
                raw_volume[code] = total
                raw_recency[code] = weighted

        await asyncio.gather(*[fetch_one(c) for c in CURRENCIES])
    else:
        for c in CURRENCIES:
            raw_volume[c["code"]] = 0
            raw_recency[c["code"]] = 0

    for c in CURRENCIES:
        raw_volatility[c["code"]] = _get_volatility(c["code"])

    # ── Normalise each component ──────────────────────────────────────────
    norm_volume = _normalise(raw_volume)
    norm_recency = _normalise(raw_recency)
    norm_volatility = _normalise(raw_volatility)

    # ── Compose weighted score ────────────────────────────────────────────
    scores: Dict[str, dict] = {}

    for c in CURRENCIES:
        code = c["code"]
        floor = _floor(code)

        if use_news:
            raw_score = (
                0.40 * norm_volume.get(code, 0)
                + 0.30 * norm_recency.get(code, 0)
                + 0.20 * norm_volatility.get(code, 0)
                + 0.10 * floor
            )
        else:
            # Renormalise: volatility 67%, baseline 33%
            raw_score = (
                0.67 * norm_volatility.get(code, 0)
                + 0.33 * floor
            )

        # Enforce floor and clamp to [0, 100]
        score = max(floor, min(100.0, raw_score))

        scores[code] = {
            "score": round(score, 2),
            "news_count": raw_volume.get(code, 0),
            "volatility": round(raw_volatility.get(code, 0.0), 8),
        }

    write_hype_snapshots(scores)
    logger.info("Hype engine: wrote %d scores", len(scores))
