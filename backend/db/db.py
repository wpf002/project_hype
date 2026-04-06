"""
PostgreSQL persistence via asyncpg connection pool.

All public functions are async. The pool is created in init_db() (called
at startup) and stored as the module-level _pool, accessed via get_pool().

Timestamps are stored as ISO 8601 strings (UTC) in TEXT columns so they
sort lexicographically — identical semantics to the prior SQLite schema.
"""

import json
import os
import secrets
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional

import asyncpg

logger = logging.getLogger(__name__)

_pool: Optional[asyncpg.Pool] = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool not initialised — call await init_db() first.")
    return _pool


async def init_db() -> None:
    global _pool

    dsn = os.getenv("DATABASE_URL", "")
    if not dsn:
        raise RuntimeError("DATABASE_URL environment variable is not set.")

    # Railway (and some other hosts) use the postgres:// scheme;
    # asyncpg requires postgresql://.
    if dsn.startswith("postgres://"):
        dsn = dsn.replace("postgres://", "postgresql://", 1)

    _pool = await asyncpg.create_pool(dsn, min_size=1, max_size=10)

    async with _pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS rate_snapshots (
                id        BIGSERIAL PRIMARY KEY,
                code      TEXT             NOT NULL,
                rate      DOUBLE PRECISION NOT NULL,
                live      BOOLEAN          NOT NULL,
                timestamp TEXT             NOT NULL
            )
        """)
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_code_ts "
            "ON rate_snapshots (code, timestamp)"
        )
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS shared_portfolios (
                id         TEXT PRIMARY KEY,
                positions  TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS hype_snapshots (
                id         BIGSERIAL        PRIMARY KEY,
                code       TEXT             NOT NULL,
                score      DOUBLE PRECISION NOT NULL,
                news_count INTEGER          NOT NULL DEFAULT 0,
                volatility DOUBLE PRECISION NOT NULL DEFAULT 0,
                timestamp  TEXT             NOT NULL
            )
        """)
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_hype_code_ts "
            "ON hype_snapshots (code, timestamp)"
        )
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS catalyst_snapshots (
                id        BIGSERIAL        PRIMARY KEY,
                code      TEXT             NOT NULL,
                score     DOUBLE PRECISION NOT NULL,
                sentiment DOUBLE PRECISION NOT NULL DEFAULT 0,
                momentum  DOUBLE PRECISION NOT NULL DEFAULT 0,
                timestamp TEXT             NOT NULL
            )
        """)
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_catalyst_code_ts "
            "ON catalyst_snapshots (code, timestamp)"
        )
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS subscribers (
                id         BIGSERIAL        PRIMARY KEY,
                email      TEXT UNIQUE      NOT NULL,
                codes      TEXT[]           NOT NULL DEFAULT '{}',
                created_at TEXT             NOT NULL
            )
        """)

    logger.info("DB pool initialised, all tables ready.")


# ── Rate snapshots ────────────────────────────────────────────────────────

async def write_snapshots(rates: Dict[str, tuple]) -> None:
    """
    Insert one row per currency and prune rows older than 7 days.
    rates: {code: (rate_float, is_live_bool)}
    """
    now = datetime.now(timezone.utc).isoformat()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    rows = [
        (code, rate, bool(live), now)
        for code, (rate, live) in rates.items()
    ]

    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.executemany(
                "INSERT INTO rate_snapshots (code, rate, live, timestamp) "
                "VALUES ($1, $2, $3, $4)",
                rows,
            )
            await conn.execute(
                "DELETE FROM rate_snapshots WHERE timestamp < $1", cutoff
            )
    except Exception:
        logger.exception("Failed to write rate snapshots")


async def get_history(code: str, limit: int = 24) -> List[dict]:
    """Return the last `limit` snapshots for `code`, newest first."""
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT id, code, rate, live, timestamp
                   FROM rate_snapshots
                   WHERE code = $1
                   ORDER BY timestamp DESC
                   LIMIT $2""",
                code.upper(), limit,
            )
        return [
            {
                "id": r["id"],
                "code": r["code"],
                "rate": r["rate"],
                "live": r["live"],
                "timestamp": r["timestamp"],
            }
            for r in rows
        ]
    except Exception:
        logger.exception("Failed to fetch history for %s", code)
        return []


async def get_all_changes_24h() -> Dict[str, Optional[float]]:
    """
    For each currency compute % change between oldest and newest snapshot
    in the last 24 h.  Currencies with < 2 snapshots in the window are
    omitted (callers treat missing key as null / no data).
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT code, rate
                   FROM rate_snapshots
                   WHERE timestamp >= $1
                   ORDER BY code, timestamp""",
                cutoff,
            )
    except Exception:
        logger.exception("Failed to fetch 24h changes")
        return {}

    by_code: Dict[str, list] = {}
    for r in rows:
        by_code.setdefault(r["code"], []).append(r["rate"])

    result: Dict[str, float] = {}
    for code, rate_list in by_code.items():
        if len(rate_list) < 2:
            continue
        oldest, newest = rate_list[0], rate_list[-1]
        if oldest == 0:
            continue
        result[code] = round(((newest - oldest) / oldest) * 100, 4)

    return result


async def get_change_24h(code: str) -> Optional[float]:
    """Single-currency convenience wrapper."""
    return (await get_all_changes_24h()).get(code.upper())


# ── Hype snapshots ────────────────────────────────────────────────────────

async def write_hype_snapshots(scores: Dict[str, dict]) -> None:
    """
    Insert one hype snapshot per currency and prune rows older than 30 days.
    scores: {code: {score, news_count, volatility}}
    """
    now = datetime.now(timezone.utc).isoformat()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

    rows = [
        (code, v["score"], v.get("news_count", 0), v.get("volatility", 0.0), now)
        for code, v in scores.items()
    ]

    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.executemany(
                "INSERT INTO hype_snapshots (code, score, news_count, volatility, timestamp) "
                "VALUES ($1, $2, $3, $4, $5)",
                rows,
            )
            await conn.execute(
                "DELETE FROM hype_snapshots WHERE timestamp < $1", cutoff
            )
    except Exception:
        logger.exception("Failed to write hype snapshots")


async def get_hype_history(code: str, limit: int = 24) -> List[dict]:
    """Return the last `limit` hype snapshots for `code`, newest first."""
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT id, code, score, news_count, volatility, timestamp
                   FROM hype_snapshots
                   WHERE code = $1
                   ORDER BY timestamp DESC
                   LIMIT $2""",
                code.upper(), limit,
            )
        return [
            {
                "id": r["id"],
                "code": r["code"],
                "score": r["score"],
                "news_count": r["news_count"],
                "volatility": r["volatility"],
                "timestamp": r["timestamp"],
            }
            for r in rows
        ]
    except Exception:
        logger.exception("Failed to fetch hype history for %s", code)
        return []


async def get_latest_hype_scores() -> Dict[str, float]:
    """Return the most recent hype score for every currency that has one."""
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT DISTINCT ON (code) code, score
                   FROM hype_snapshots
                   ORDER BY code, timestamp DESC"""
            )
        return {r["code"]: r["score"] for r in rows}
    except Exception:
        logger.exception("Failed to fetch latest hype scores")
        return {}


async def get_latest_hype_updated_at() -> Optional[str]:
    """Return the timestamp of the most recent hype snapshot (any currency)."""
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            val = await conn.fetchval(
                "SELECT MAX(timestamp) FROM hype_snapshots"
            )
        return val
    except Exception:
        logger.exception("Failed to fetch latest hype timestamp")
        return None


# ── Catalyst snapshots ────────────────────────────────────────────────────

async def write_catalyst_snapshots(data: Dict[str, dict]) -> None:
    """Insert one catalyst snapshot per currency and prune rows older than 30 days."""
    now = datetime.now(timezone.utc).isoformat()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

    rows = [
        (code, v["score"], v.get("sentiment", 0.0), v.get("momentum", 0.0), now)
        for code, v in data.items()
    ]

    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.executemany(
                "INSERT INTO catalyst_snapshots (code, score, sentiment, momentum, timestamp) "
                "VALUES ($1, $2, $3, $4, $5)",
                rows,
            )
            await conn.execute(
                "DELETE FROM catalyst_snapshots WHERE timestamp < $1", cutoff
            )
    except Exception:
        logger.exception("Failed to write catalyst snapshots")


async def get_latest_catalyst_scores() -> Dict[str, dict]:
    """Return the most recent catalyst snapshot for every currency that has one."""
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT DISTINCT ON (code) code, score, sentiment, momentum
                   FROM catalyst_snapshots
                   ORDER BY code, timestamp DESC"""
            )
        return {
            r["code"]: {
                "catalyst_score": r["score"],
                "sentiment": r["sentiment"],
                "momentum_7d": r["momentum"],
            }
            for r in rows
        }
    except Exception:
        logger.exception("Failed to fetch latest catalyst scores")
        return {}


# ── Shared portfolios ──────────────────────────────────────────────────────

async def create_shared_portfolio(positions: list) -> str:
    """Persist positions as JSON and return the generated 8-char share ID."""
    share_id = secrets.token_urlsafe(6)[:8]
    now = datetime.now(timezone.utc).isoformat()
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO shared_portfolios (id, positions, created_at) VALUES ($1, $2, $3)",
            share_id, json.dumps(positions), now,
        )
    return share_id


async def get_shared_portfolio(share_id: str) -> Optional[list]:
    """Return positions list for `share_id`, or None if not found."""
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT positions FROM shared_portfolios WHERE id = $1", share_id
        )
    if row is None:
        return None
    return json.loads(row["positions"])


# ── Subscribers ───────────────────────────────────────────────────────────

async def upsert_subscriber(email: str, codes: List[str]) -> None:
    """Create or update a subscriber's code list."""
    now = datetime.now(timezone.utc).isoformat()
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO subscribers (email, codes, created_at)
               VALUES ($1, $2, $3)
               ON CONFLICT (email) DO UPDATE SET codes = EXCLUDED.codes""",
            email, codes, now,
        )


async def delete_subscriber(email: str) -> None:
    """Remove a subscriber by email."""
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM subscribers WHERE email = $1", email
        )


async def get_subscribers_for_code(code: str) -> List[str]:
    """Return all subscriber emails tracking `code`."""
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT email FROM subscribers WHERE $1 = ANY(codes)", code.upper()
            )
        return [r["email"] for r in rows]
    except Exception:
        logger.exception("Failed to fetch subscribers for %s", code)
        return []
