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
  60%  News sentiment   — VADER compound score averaged across article titles/descriptions
  40%  Rate momentum    — % rate change over last 7 days (normalised)
"""

import asyncio
import logging
import statistics
from datetime import datetime, timezone, timedelta
from typing import Dict, Tuple

import httpx
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

from data.currencies import CURRENCIES, EXOTIC_NO_LIVE
from db.db import (
    get_history,
    write_hype_snapshots,
    write_catalyst_snapshots,
    get_latest_catalyst_scores,
    get_subscribers_for_code,
)
from services.email_service import send_catalyst_alert

logger = logging.getLogger(__name__)

GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc"

HIGH_FLOOR_CODES = EXOTIC_NO_LIVE

_vader = SentimentIntensityAnalyzer()


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


def _score_sentiment(articles: list) -> float:
    """Score sentiment using VADER. Returns -100 to +100."""
    if not articles:
        return 0.0
    scores = []
    for a in articles:
        text = ((a.get("title") or "") + " " + (a.get("description") or "")).strip()
        if not text:
            continue
        compound = _vader.polarity_scores(text)["compound"]
        scores.append(compound)
    if not scores:
        return 0.0
    # compound is -1 to +1; scale to -100 to +100
    return round(sum(scores) / len(scores) * 100, 2)


async def _fetch_news_data(code: str, query: str) -> Tuple[int, int, float]:
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

    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(GDELT_URL, params=params)

            if resp.status_code == 429:
                wait = 15 * (attempt + 1)  # 15s, 30s, 45s
                logger.warning("GDELT 429 for %s (attempt %d), retrying in %ds", code, attempt + 1, wait)
                await asyncio.sleep(wait)
                continue

            resp.raise_for_status()
            try:
                data = resp.json()
            except Exception:
                # GDELT returns an empty body (not JSON) when no articles match.
                # This is a valid "zero results" — don't retry.
                return 0, 0, 0.0

            articles = data.get("articles") or []
            total_7d = len(articles)

            weighted = 0
            for a in articles:
                seen = a.get("seendate", "")
                try:
                    pub_dt = datetime.strptime(seen, "%Y%m%dT%H%M%SZ").replace(
                        tzinfo=timezone.utc
                    )
                    weighted += 3 if pub_dt >= cutoff_48h else 1
                except (ValueError, TypeError):
                    weighted += 1

            sentiment = _score_sentiment(articles)
            return total_7d, weighted, sentiment

        except Exception as exc:
            logger.warning("GDELT fetch failed for %s (attempt %d): %s", code, attempt + 1, exc)
            # Non-429 errors (timeouts, connection resets) get one quick retry
            if attempt < 2:
                await asyncio.sleep(1)

    return 0, 0, 0.0


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
    logger.info("Score engine: starting for %d currencies via GDELT", len(CURRENCIES))

    # Capture previous catalyst scores BEFORE computing new ones (for alert diffing)
    old_catalyst = await get_latest_catalyst_scores()

    # Build a quick lookup map for currency metadata
    currency_map = {c["code"]: c for c in CURRENCIES}

    raw_volume: Dict[str, int] = {}
    raw_recency: Dict[str, int] = {}
    raw_sentiment: Dict[str, float] = {}
    raw_volatility: Dict[str, float] = {}
    raw_momentum: Dict[str, float] = {}

    # Semaphore(2): only 2 concurrent GDELT requests — prevents 429s from
    # burst traffic. 40 currencies at 2 concurrent takes ~60s which is fine
    # given the 12-hour scoring interval.
    semaphore = asyncio.Semaphore(2)

    async def fetch_one(currency: dict) -> None:
        code = currency["code"]
        query = currency.get("news_query", currency["name"])
        async with semaphore:
            total, weighted, sentiment = await _fetch_news_data(code, query)
            raw_volume[code] = total
            raw_recency[code] = weighted
            raw_sentiment[code] = sentiment
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
        }

    await write_hype_snapshots(hype_out)
    await write_catalyst_snapshots(catalyst_out)
    logger.info("Score engine: wrote hype + catalyst for %d currencies", len(CURRENCIES))

    # ── Fire alerts for significant Catalyst spikes ────────────────────────
    await _check_and_send_alerts(catalyst_out, old_catalyst, currency_map)
