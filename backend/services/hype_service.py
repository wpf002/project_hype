"""
Hype Score Engine + Catalyst Engine — run together every hour.

HYPE SCORE (0–100)  — backward-looking: how much noise is there right now?
  40%  News volume      — article count in last 7 days (normalised)
  30%  Recency weight   — articles <48h count 3×, rest 1× (normalised)
  20%  Rate volatility  — stdev of rate_snapshots over last 24h (normalised)
  10%  Baseline floor   — exotic/sanctioned currencies floor 60, others floor 20
  If NEWSAPI_KEY absent: volatility 67%, baseline 33%

CATALYST SCORE (0–100) — forward-looking: appreciation potential
  60%  News sentiment   — bullish vs bearish keyword ratio across articles
  40%  Rate momentum    — % rate change over last 7 days (normalised)
  If NEWSAPI_KEY absent: 100% rate momentum
"""

import asyncio
import logging
import os
import statistics
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Tuple

import httpx

from data.currencies import CURRENCIES, EXOTIC_NO_LIVE
from db.db import get_history, write_hype_snapshots, write_catalyst_snapshots

logger = logging.getLogger(__name__)

NEWSAPI_KEY = os.getenv("NEWSAPI_KEY", "")
NEWSAPI_URL = "https://newsapi.org/v2/everything"

HIGH_FLOOR_CODES = EXOTIC_NO_LIVE

# ── Sentiment keyword lists ────────────────────────────────────────────────
# Specific to speculative currency narratives — avoid generic finance terms
# that would match unrelated articles.

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
    "peg adjustment", "currency peg", "managed float",
    "foreign reserve", "reserve growth", "reserve increase",
    "stabilization", "stabilisation", "stabilize", "stabilise",
    "reconstruction", "recovery", "economic recovery",
    "trade surplus", "export growth", "oil revenue", "oil production increase",
    "fdi", "foreign investment", "investment surge", "investment inflow",
    "diplomatic", "diplomatic ties", "diplomatic relations",
    "economic reform", "banking reform", "central bank independence",
    "debt relief", "debt restructuring success",
}

BEARISH_KEYWORDS = {
    "hyperinflation", "hyper-inflation",
    "devaluation", "devalue", "devalued", "devaluing",
    "currency collapse", "economic collapse", "financial collapse",
    "sanctions", "sanctioned", "new sanctions", "fresh sanctions",
    "parallel market", "black market", "unofficial rate",
    "capital flight", "capital controls", "capital restriction",
    "military coup", "coup d'état", "coup attempt", "junta",
    "civil war", "armed conflict", "military offensive",
    "currency crisis", "exchange crisis", "balance of payments crisis",
    "default", "debt default", "sovereign default",
    "embargo", "trade embargo", "trade ban", "economic blockade",
    "money printing", "currency printing", "printing press",
    "inflation crisis", "inflation spiral",
    "banking collapse", "bank run", "financial freeze",
    "asset freeze", "asset seizure", "frozen assets",
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
    Score articles list on -100 to +100 scale using keyword matching.
    Each article title + description is scanned for bullish/bearish keywords.
    Net score normalised by article count to prevent volume bias.
    """
    if not articles:
        return 0.0

    total = 0
    for a in articles:
        text = ((a.get("title") or "") + " " + (a.get("description") or "")).lower()
        bull = sum(1 for kw in BULLISH_KEYWORDS if kw in text)
        bear = sum(1 for kw in BEARISH_KEYWORDS if kw in text)
        total += bull - bear

    # Normalise: divide by articles, scale so ±3 net/article → ±100
    per_article = total / len(articles)
    return max(-100.0, min(100.0, per_article * 33.3))


async def _fetch_news_data(code: str, query: str) -> Tuple[int, int, float, list]:
    """
    Fetch articles from NewsAPI and return:
      (total_7d, weighted_recency_cnt, sentiment_score, articles)
    Returns (0, 0, 0.0, []) on any error or missing key.
    """
    if not NEWSAPI_KEY:
        return 0, 0, 0.0, []

    now = datetime.now(timezone.utc)
    from_7d = (now - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    cutoff_48h = now - timedelta(hours=48)

    params = {
        "q": query,
        "from": from_7d,
        "language": "en",
        "sortBy": "publishedAt",
        "pageSize": 100,
        "apiKey": NEWSAPI_KEY,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(NEWSAPI_URL, params=params)
            resp.raise_for_status()
            data = resp.json()

        articles = data.get("articles", [])
        total_7d = len(articles)

        weighted = 0
        for a in articles:
            pub = a.get("publishedAt", "")
            try:
                pub_dt = datetime.fromisoformat(pub.replace("Z", "+00:00"))
                weighted += 3 if pub_dt >= cutoff_48h else 1
            except ValueError:
                weighted += 1

        sentiment = _score_sentiment(articles)
        return total_7d, weighted, sentiment, articles

    except Exception as exc:
        logger.warning("NewsAPI fetch failed for %s: %s", code, exc)
        return 0, 0, 0.0, []


def _get_volatility(code: str) -> float:
    """Stdev of rate snapshots over last 24h, 0 if insufficient data."""
    snapshots = get_history(code, limit=96)
    if len(snapshots) < 2:
        return 0.0
    try:
        return statistics.stdev(s["rate"] for s in snapshots)
    except statistics.StatisticsError:
        return 0.0


def _get_momentum_7d(code: str) -> float:
    """
    % rate change from oldest to newest snapshot in last 7 days.
    Positive = currency appreciating vs USD.
    Returns 0.0 if insufficient history.
    """
    snapshots = get_history(code, limit=672)  # 96 snapshots/day × 7 days
    if len(snapshots) < 2:
        return 0.0
    newest = snapshots[0]["rate"]
    oldest = snapshots[-1]["rate"]
    if oldest == 0:
        return 0.0
    return ((newest - oldest) / oldest) * 100


async def calculate_all_hype_scores() -> None:
    """
    Compute hype + catalyst scores for all currencies and persist both.
    Called on startup then every hour via the background loop in main.py.
    """
    logger.info("Score engine: starting for %d currencies", len(CURRENCIES))

    use_news = bool(NEWSAPI_KEY)
    if not use_news:
        logger.info("Score engine: NEWSAPI_KEY absent — news components skipped")

    # ── Gather raw signals (one NewsAPI call per currency if key present) ──
    raw_volume: Dict[str, int] = {}
    raw_recency: Dict[str, int] = {}
    raw_sentiment: Dict[str, float] = {}
    raw_volatility: Dict[str, float] = {}
    raw_momentum: Dict[str, float] = {}

    if use_news:
        semaphore = asyncio.Semaphore(5)

        async def fetch_one(currency: dict) -> None:
            code = currency["code"]
            query = currency.get("news_query", currency["name"])
            async with semaphore:
                total, weighted, sentiment, _ = await _fetch_news_data(code, query)
                raw_volume[code] = total
                raw_recency[code] = weighted
                raw_sentiment[code] = sentiment

        await asyncio.gather(*[fetch_one(c) for c in CURRENCIES])
    else:
        for c in CURRENCIES:
            raw_volume[c["code"]] = 0
            raw_recency[c["code"]] = 0
            raw_sentiment[c["code"]] = 0.0

    for c in CURRENCIES:
        raw_volatility[c["code"]] = _get_volatility(c["code"])
        raw_momentum[c["code"]] = _get_momentum_7d(c["code"])

    # ── Normalise ──────────────────────────────────────────────────────────
    norm_volume = _normalise(raw_volume)
    norm_recency = _normalise(raw_recency)
    norm_volatility = _normalise(raw_volatility)
    # Sentiment is already -100..+100; shift to 0..100 for normalisation
    shifted_sentiment = {k: v + 100 for k, v in raw_sentiment.items()}
    norm_sentiment = _normalise(shifted_sentiment)
    # Momentum: shift to handle negative values
    mom_min = min(raw_momentum.values()) if raw_momentum else 0
    shifted_momentum = {k: v - mom_min for k, v in raw_momentum.items()}
    norm_momentum = _normalise(shifted_momentum)

    # ── Compose scores ─────────────────────────────────────────────────────
    hype_out: Dict[str, dict] = {}
    catalyst_out: Dict[str, dict] = {}

    for c in CURRENCIES:
        code = c["code"]
        floor = _floor(code)

        # Hype score
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

        # Catalyst score
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
