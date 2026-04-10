"""
Hype Score Engine + Catalyst Engine — run together every 12 hours.

News source: GDELT Project DOC API — free, no API key, global coverage,
no meaningful rate limits. Covers 100+ languages; we filter for English.

Sentiment scoring: Claude API (claude-haiku-4-5-20251001) — understands
financial/geopolitical context that VADER cannot: "sanctions relief" is
bullish, "IMF program suspended" is bearish, "CBI reduces auction spread"
is strongly bullish for IQD. Up to 10 headlines per batch to minimise cost.

HYPE SCORE (0–100)  — backward-looking: how much noise right now?
  40%  News volume      — article count in last 7 days (normalised)
  30%  Recency weight   — articles <48h count 3×, rest 1× (normalised)
  20%  Rate volatility  — stdev of rate_snapshots over last 24h (normalised)
  10%  Baseline floor   — exotic/sanctioned currencies floor 60, others floor 20

CATALYST SCORE (0–100) — forward-looking: appreciation potential
  60%  News sentiment   — Claude compound score averaged across article titles/descriptions
  40%  Rate momentum    — % rate change over last 7 days (normalised)
"""

import asyncio
import json
import logging
import os
import statistics
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Tuple

import httpx
from dotenv import load_dotenv

from data.currencies import CURRENCIES, EXOTIC_NO_LIVE
from db.db import (
    get_history,
    write_hype_snapshots,
    write_catalyst_snapshots,
    get_latest_catalyst_scores,
    get_subscribers_for_code,
)
from services.email_service import send_catalyst_alert

load_dotenv()

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"

HIGH_FLOOR_CODES = EXOTIC_NO_LIVE

CLAUDE_BATCH_SIZE = 8  # headlines per API call

BULLISH_KEYWORDS = {"reform", "agreement", "tranche", "revaluation", "surplus", "growth", "recovery"}
BEARISH_KEYWORDS = {"sanctions", "default", "collapse", "crisis", "inflation", "devaluation", "suspended"}


def _floor(code: str) -> float:
    return 60.0 if code in HIGH_FLOOR_CODES else 20.0


def _normalise(values: Dict[str, float]) -> Dict[str, float]:
    if not values:
        return {}
    lo = min(values.values())
    hi = max(values.values())
    if hi == lo:
        return {k: 50.0 for k in values}
    return {k: (v - lo) / (hi - lo) * 100 for k, v in values.items()}


def _keyword_score(texts: List[str]) -> float:
    """Simple keyword-based sentiment fallback when ANTHROPIC_API_KEY is absent."""
    total = 0.0
    for text in texts:
        lower = text.lower()
        bull = sum(1 for w in BULLISH_KEYWORDS if w in lower)
        bear = sum(1 for w in BEARISH_KEYWORDS if w in lower)
        if bull + bear > 0:
            total += (bull - bear) / (bull + bear)
    if not texts:
        return 0.0
    return round((total / len(texts)) * 100, 2)


async def score_headlines_with_claude(
    headlines: List[dict],
    currency_code: str,
    currency_name: str,
    story: str,
) -> tuple:
    """
    Score headlines using Claude API for financial/geopolitical context.
    Batches up to CLAUDE_BATCH_SIZE headlines per API call.
    Returns (compound_score, sentiment_source) where compound_score is -100..+100
    and sentiment_source is 'claude' | 'keyword_fallback'.
    """
    if not headlines:
        return 0.0, "keyword_fallback"

    # Build text list from title + description
    texts = []
    for a in headlines:
        text = ((a.get("title") or "") + " " + (a.get("description") or "")).strip()
        if text:
            texts.append(text)

    if not texts:
        return 0.0, "keyword_fallback"

    if not ANTHROPIC_API_KEY:
        logger.warning("ANTHROPIC_API_KEY not set — using keyword fallback for %s", currency_code)
        score = _keyword_score(texts)
        logger.info("Sentiment [%s] = %.2f (keyword_fallback)", currency_code, score)
        return score, "keyword_fallback"

    # Process in batches of CLAUDE_BATCH_SIZE
    all_scores: List[float] = []
    sample_reasoning: str = ""
    for i in range(0, len(texts), CLAUDE_BATCH_SIZE):
        batch = texts[i: i + CLAUDE_BATCH_SIZE]
        batch_scores, reasoning = await _score_batch_with_claude(batch, currency_code, currency_name, story)
        all_scores.extend(batch_scores)
        if not sample_reasoning and reasoning:
            sample_reasoning = reasoning

    if not all_scores:
        score = _keyword_score(texts)
        logger.info("Sentiment [%s] = %.2f (keyword_fallback after Claude error)", currency_code, score)
        return score, "keyword_fallback"

    avg = sum(all_scores) / len(all_scores)
    # Scale -1..+1 to -100..+100
    compound = round(avg * 100, 2)
    logger.info("Sentiment [%s] = %.2f (claude) — sample: %s", currency_code, compound, sample_reasoning)
    return compound, "claude"


async def _score_batch_with_claude(
    texts: List[str],
    currency_code: str,
    currency_name: str,
    story: str,
) -> tuple:
    """
    Send one batch to Claude and return (scores, sample_reasoning).
    scores is a list of floats (-1.0 to +1.0), sample_reasoning is one sentence.
    """
    headlines_block = "\n".join(f"{idx + 1}. {t}" for idx, t in enumerate(texts))

    user_prompt = (
        f"Score the sentiment of these headlines for {currency_name} ({currency_code}).\n"
        f"Context: {story}\n\n"
        f"Headlines:\n{headlines_block}\n\n"
        "Return a JSON object:\n"
        "{\n"
        '  "scores": [\n'
        '    {"headline": "...", "score": 0.0, "reasoning": "..."}\n'
        "  ],\n"
        '  "compound": 0.0\n'
        "}\n"
        "Where score is -1.0 (strongly bearish) to +1.0 (strongly bullish),\n"
        "and compound is the weighted average across all headlines.\n"
        "reasoning is one sentence max."
    )

    payload = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 1024,
        "system": (
            "You are a senior currency analyst specializing in exotic, frontier, "
            "and speculative foreign exchange markets. You have deep expertise in "
            "revaluation mechanics, IMF program structures, sanctions regimes, "
            "central bank auction systems (including CBI USD auction spreads), "
            "black market dynamics, post-conflict reconstruction economics, and "
            "the retail speculative communities that follow these currencies. "
            "You understand that context determines sentiment — 'CBI reduces "
            "auction spread' is strongly bullish for IQD, 'IMF tranche released' "
            "is bullish for ARS or EGP, 'OFAC designation' is bearish for IRR, "
            "'parallel market premium widens' is bearish for any currency. "
            "Return only valid JSON, no commentary, no markdown."
        ),
        "messages": [{"role": "user", "content": user_prompt}],
    }

    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(ANTHROPIC_API_URL, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        raw_text = data["content"][0]["text"].strip()
        # Strip markdown fences if Claude adds them despite instructions
        if raw_text.startswith("```"):
            raw_text = raw_text.split("```")[1]
            if raw_text.startswith("json"):
                raw_text = raw_text[4:]
        raw_text = raw_text.strip()

        parsed = json.loads(raw_text)
        items = parsed.get("scores", [])
        scores = []
        sample_reasoning = ""
        for item in items:
            score = float(item.get("score", 0.0))
            score = max(-1.0, min(1.0, score))
            scores.append(score)
            if not sample_reasoning:
                sample_reasoning = item.get("reasoning", "")
        return scores, sample_reasoning

    except Exception as exc:
        logger.warning("Claude sentiment scoring failed for %s: %s", currency_code, exc)
        return [], ""


async def _fetch_news_data(code: str, query: str, currency: dict) -> Tuple[int, int, float, str]:
    """Fetch news via the tiered RSS pipeline (no GDELT) and score sentiment."""
    from services.news_service import get_news
    now = datetime.now(timezone.utc)
    cutoff_48h = now - timedelta(hours=48)

    try:
        articles = await get_news(code)
    except Exception as exc:
        logger.warning("News fetch failed for %s: %s", code, exc)
        articles = []

    total = len(articles)

    weighted = 0
    for a in articles:
        pub_str = a.get("published_at", "")
        try:
            pub_dt = datetime.fromisoformat(pub_str.replace("Z", "+00:00"))
            weighted += 3 if pub_dt >= cutoff_48h else 1
        except (ValueError, TypeError, AttributeError):
            weighted += 1

    sentiment, sentiment_source = await score_headlines_with_claude(
        articles,
        code,
        currency.get("name", code),
        currency.get("story", ""),
    )

    logger.info(
        "Sentiment [%s] = %.2f via %s (from %d articles via RSS pipeline)",
        code, sentiment, sentiment_source, total,
    )
    return total, weighted, sentiment, sentiment_source


async def _get_volatility(code: str) -> float:
    snapshots = await get_history(code, limit=96)
    if len(snapshots) < 2:
        return 0.0
    try:
        return statistics.stdev(s["rate"] for s in snapshots)
    except statistics.StatisticsError:
        return 0.0


async def _get_momentum_7d(code: str) -> float:
    snapshots = await get_history(code, limit=672)
    if len(snapshots) < 2:
        return 0.0
    newest = snapshots[0]["rate"]
    oldest = snapshots[-1]["rate"]
    if oldest == 0:
        return 0.0
    return ((newest - oldest) / oldest) * 100


async def _check_and_send_alerts(
    catalyst_out: Dict[str, dict],
    old_catalyst: Dict[str, dict],
    currency_map: Dict[str, dict],
) -> None:
    """Fire email alerts for any Catalyst Score that jumped 15+ points."""
    SPIKE_THRESHOLD = 15.0

    for code, new_data in catalyst_out.items():
        new_score = new_data["score"]
        old_data = old_catalyst.get(code)
        if not old_data:
            continue
        old_score = old_data.get("catalyst_score", 0.0)
        if new_score - old_score < SPIKE_THRESHOLD:
            continue

        logger.info(
            "Catalyst spike: %s %.1f → %.1f (+%.1f)",
            code, old_score, new_score, new_score - old_score,
        )
        subscribers = await get_subscribers_for_code(code)
        if not subscribers:
            continue

        currency = currency_map.get(code, {})
        await asyncio.gather(*[
            send_catalyst_alert(email, code, currency, old_score, new_score)
            for email in subscribers
        ])


async def calculate_all_hype_scores() -> None:
    """
    Compute hype + catalyst scores for all currencies and persist both tables.
    Called on startup then every 12 hours.
    """
    logger.info("Score engine: starting for %d currencies via RSS pipeline + Claude sentiment", len(CURRENCIES))

    # Capture previous catalyst scores BEFORE computing new ones (for alert diffing)
    old_catalyst = await get_latest_catalyst_scores()

    # Build a quick lookup map for currency metadata
    currency_map = {c["code"]: c for c in CURRENCIES}

    raw_volume: Dict[str, int] = {}
    raw_recency: Dict[str, int] = {}
    raw_sentiment: Dict[str, float] = {}
    raw_sentiment_source: Dict[str, str] = {}
    raw_volatility: Dict[str, float] = {}
    raw_momentum: Dict[str, float] = {}

    # Semaphore(5): RSS feeds have no rate limits; capped at 5 to avoid exhausting the DB pool.
    semaphore = asyncio.Semaphore(5)

    async def fetch_one(currency: dict) -> None:
        code = currency["code"]
        query = currency.get("news_query", currency["name"])
        async with semaphore:
            total, weighted, sentiment, sentiment_source = await _fetch_news_data(code, query, currency)
            raw_volume[code] = total
            raw_recency[code] = weighted
            raw_sentiment[code] = sentiment
            raw_sentiment_source[code] = sentiment_source
            await asyncio.sleep(0.5)  # courtesy gap between releases

    await asyncio.gather(*[fetch_one(c) for c in CURRENCIES])
    use_news = any(v > 0 for v in raw_volume.values())

    vol_mom = await asyncio.gather(*[
        asyncio.gather(_get_volatility(c["code"]), _get_momentum_7d(c["code"]))
        for c in CURRENCIES
    ])
    for c, (vol, mom) in zip(CURRENCIES, vol_mom):
        raw_volatility[c["code"]] = vol
        raw_momentum[c["code"]] = mom

    # ── Normalise ──────────────────────────────────────────────────────────
    norm_volume     = _normalise(raw_volume)
    norm_recency    = _normalise(raw_recency)
    norm_volatility = _normalise(raw_volatility)

    shifted_sentiment = {k: v + 100 for k, v in raw_sentiment.items()}
    norm_sentiment = _normalise(shifted_sentiment)

    mom_min = min(raw_momentum.values(), default=0)
    norm_momentum = _normalise({k: v - mom_min for k, v in raw_momentum.items()})

    # ── Compose scores ─────────────────────────────────────────────────────
    hype_out: Dict[str, dict] = {}
    catalyst_out: Dict[str, dict] = {}

    for c in CURRENCIES:
        code = c["code"]
        floor = _floor(code)

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
            "sentiment_source": raw_sentiment_source.get(code, "keyword_fallback"),
        }

    await write_hype_snapshots(hype_out)
    await write_catalyst_snapshots(catalyst_out)
    logger.info("Score engine: wrote hype + catalyst for %d currencies", len(CURRENCIES))

    # ── Fire alerts for significant Catalyst spikes ────────────────────────
    await _check_and_send_alerts(catalyst_out, old_catalyst, currency_map)
