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

    # DB TLS mode is configurable so production can ENFORCE encryption rather
    # than silently downgrading. Default "prefer" preserves prior behaviour
    # (works for local Docker without SSL); set DB_SSL=require (or verify-full)
    # in production so a non-TLS endpoint fails loudly instead of going cleartext.
    db_ssl = os.getenv("DB_SSL", "prefer").strip() or "prefer"
    _pool = await asyncpg.create_pool(dsn, min_size=2, max_size=20, ssl=db_ssl)

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
                id               BIGSERIAL        PRIMARY KEY,
                code             TEXT             NOT NULL,
                score            DOUBLE PRECISION NOT NULL,
                sentiment        DOUBLE PRECISION NOT NULL DEFAULT 0,
                momentum         DOUBLE PRECISION NOT NULL DEFAULT 0,
                timestamp        TEXT             NOT NULL,
                sentiment_source TEXT             NOT NULL DEFAULT 'keyword_fallback',
                commodity        DOUBLE PRECISION NOT NULL DEFAULT 50
            )
        """)
        # Migrate existing tables that predate the sentiment_source / commodity columns
        await conn.execute("""
            ALTER TABLE catalyst_snapshots
            ADD COLUMN IF NOT EXISTS sentiment_source TEXT NOT NULL DEFAULT 'keyword_fallback'
        """)
        await conn.execute("""
            ALTER TABLE catalyst_snapshots
            ADD COLUMN IF NOT EXISTS commodity DOUBLE PRECISION NOT NULL DEFAULT 50
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
        # Migration: add consent_at for GDPR/CAN-SPAM lawful-basis tracking.
        # Existing rows get the current timestamp as a safe backfill default.
        await conn.execute("""
            ALTER TABLE subscribers
            ADD COLUMN IF NOT EXISTS consent_at TEXT NOT NULL DEFAULT ''
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS signals (
                id           BIGSERIAL PRIMARY KEY,
                code         TEXT      NOT NULL,
                signal_type  TEXT      NOT NULL,
                headline     TEXT      NOT NULL,
                url          TEXT      NOT NULL DEFAULT '',
                published_at TEXT      NOT NULL DEFAULT '',
                processed_at TEXT      NOT NULL
            )
        """)
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_signals_code_ts "
            "ON signals (code, processed_at DESC)"
        )
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS analytics_events (
                id           BIGSERIAL PRIMARY KEY,
                event_name   TEXT      NOT NULL,
                props        JSONB     NOT NULL DEFAULT '{}',
                visitor_hash TEXT      NOT NULL DEFAULT '',
                created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        # Migration for tables created before visitor_hash existed
        await conn.execute("""
            ALTER TABLE analytics_events
            ADD COLUMN IF NOT EXISTS visitor_hash TEXT NOT NULL DEFAULT ''
        """)
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_analytics_event_ts "
            "ON analytics_events (event_name, created_at DESC)"
        )
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_analytics_visitor_ts "
            "ON analytics_events (visitor_hash, created_at DESC)"
        )

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
        # Log at ERROR (not exception) so the traceback surfaces in Railway
        # logs but the background loop continues. The caller (_rate_snapshot_loop
        # in main.py) already logs at exception level on its own uncaught errors.
        logger.error(
            "Failed to write rate snapshots (%d currencies) — data loss for this cycle",
            len(rows),
            exc_info=True,
        )


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
    """
    Compute 24h % change for a single currency using a scoped query.

    This is intentionally separate from get_all_changes_24h() — the bulk helper
    fetches every currency's rows for the dashboard; this scoped query is used
    by /rate/{code} and is O(one currency) rather than O(all currencies).
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT rate
                   FROM rate_snapshots
                   WHERE code = $1 AND timestamp >= $2
                   ORDER BY timestamp""",
                code.upper(), cutoff,
            )
    except Exception:
        logger.exception("Failed to fetch 24h change for %s", code)
        return None

    rates = [r["rate"] for r in rows]
    if len(rates) < 2:
        return None
    oldest, newest = rates[0], rates[-1]
    if oldest == 0:
        return None
    return round(((newest - oldest) / oldest) * 100, 4)


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


async def get_latest_rates_snapshot() -> Optional[Dict[str, tuple]]:
    """
    Return the most recent rate snapshot per currency as {code: (rate, fetched_at_unix)}.
    Used to warm the FX in-memory cache on startup so restarts don't burn OXR quota.
    """
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT DISTINCT ON (code) code, rate, live, timestamp
                   FROM rate_snapshots
                   ORDER BY code, timestamp DESC"""
            )
        if not rows:
            return None
        result = {}
        for r in rows:
            ts = r["timestamp"]
            if hasattr(ts, "timestamp"):
                fetched_at = ts.timestamp()
            else:
                from datetime import datetime, timezone
                fetched_at = datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp()
            result[r["code"]] = (r["rate"], r["live"], fetched_at)
        return result
    except Exception:
        logger.exception("Failed to fetch latest rate snapshot")
        return None


async def get_latest_rate_updated_at() -> Optional[str]:
    """Return the timestamp of the most recent rate snapshot (any currency)."""
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            val = await conn.fetchval(
                "SELECT MAX(timestamp) FROM rate_snapshots"
            )
        return val
    except Exception:
        logger.exception("Failed to fetch latest rate timestamp")
        return None


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
        (
            code,
            v["score"],
            v.get("sentiment", 0.0),
            v.get("momentum", 0.0),
            now,
            v.get("sentiment_source", "keyword_fallback"),
            v.get("commodity", 50.0),
        )
        for code, v in data.items()
    ]

    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.executemany(
                "INSERT INTO catalyst_snapshots "
                "(code, score, sentiment, momentum, timestamp, sentiment_source, commodity) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7)",
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
                """SELECT DISTINCT ON (code) code, score, sentiment, momentum, sentiment_source, commodity
                   FROM catalyst_snapshots
                   ORDER BY code, timestamp DESC"""
            )
        return {
            r["code"]: {
                "catalyst_score": r["score"],
                "sentiment": r["sentiment"],
                "momentum_7d": r["momentum"],
                "sentiment_source": r["sentiment_source"],
                "commodity": r["commodity"],
            }
            for r in rows
        }
    except Exception:
        logger.exception("Failed to fetch latest catalyst scores")
        return {}


# ── Shared portfolios ──────────────────────────────────────────────────────

async def create_shared_portfolio(positions: list) -> str:
    """Persist positions as JSON and return a URL-safe share ID (11 chars, 64-bit entropy)."""
    # token_urlsafe(8) produces 11 base64url characters from 8 random bytes (64 bits).
    # The previous token_urlsafe(6)[:8] was a no-op slice — token_urlsafe(6) always
    # produces exactly 8 chars, so [:8] never removed anything. Using 8 bytes instead
    # of 6 increases entropy from 48 to 64 bits.
    share_id = secrets.token_urlsafe(8)
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
            """INSERT INTO subscribers (email, codes, created_at, consent_at)
               VALUES ($1, $2, $3, $3)
               ON CONFLICT (email) DO UPDATE
                 SET codes = EXCLUDED.codes,
                     consent_at = EXCLUDED.consent_at""",
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


# ── Signals ───────────────────────────────────────────────────────────────────

async def insert_signal(
    code: str,
    signal_type: str,
    headline: str,
    url: str,
    published_at: str,
) -> None:
    """Insert an institutional signal if a matching one doesn't already exist (dedup by headline)."""
    now = datetime.now(timezone.utc).isoformat()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            # Dedup: skip if same headline + code already stored
            exists = await conn.fetchval(
                "SELECT 1 FROM signals WHERE code = $1 AND headline = $2 LIMIT 1",
                code.upper(), headline,
            )
            if not exists:
                await conn.execute(
                    "INSERT INTO signals (code, signal_type, headline, url, published_at, processed_at) "
                    "VALUES ($1, $2, $3, $4, $5, $6)",
                    code.upper(), signal_type, headline, url, published_at, now,
                )
            # Prune old signals
            await conn.execute(
                "DELETE FROM signals WHERE processed_at < $1", cutoff
            )
    except Exception:
        logger.error(
            "Failed to insert/prune signal for %s — signal may be lost",
            code,
            exc_info=True,
        )


async def get_signals(code: str, limit: int = 10) -> List[dict]:
    """Return the latest `limit` signals for a currency, newest first."""
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT id, code, signal_type, headline, url, published_at, processed_at
                   FROM signals
                   WHERE code = $1
                   ORDER BY processed_at DESC
                   LIMIT $2""",
                code.upper(), limit,
            )
        return [
            {
                "id": r["id"],
                "code": r["code"],
                "signal_type": r["signal_type"],
                "headline": r["headline"],
                "url": r["url"],
                "published_at": r["published_at"],
                "processed_at": r["processed_at"],
            }
            for r in rows
        ]
    except Exception:
        logger.exception("Failed to fetch signals for %s", code)
        return []


# ── Analytics ─────────────────────────────────────────────────────────────────

def _parse_props(raw) -> dict:
    """asyncpg returns JSONB columns as str; normalise to a dict for JSON output."""
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw) if raw else {}
    except (ValueError, TypeError):
        return {}


async def write_analytics_event(event_name: str, props: dict, visitor_hash: str = "") -> None:
    """Insert one analytics event row. Swallows errors so callers stay fire-and-forget."""
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO analytics_events (event_name, props, visitor_hash) "
                "VALUES ($1, $2::jsonb, $3)",
                event_name,
                json.dumps(props),
                visitor_hash,
            )
    except Exception:
        logger.warning("Analytics write failed for event=%s", event_name, exc_info=True)


async def get_analytics_summary() -> dict:
    """
    Traffic + engagement summary.

    visitors    — distinct visitor hashes (people) per time window
    page_views  — page_view events per time window
    by_event    — count of every event name per time window
    top_pages   — landing vs app split
    recent      — 20 most recent events, newest first
    """
    windows = {
        "last_24h": "24 hours",
        "last_7d": "7 days",
        "last_30d": "30 days",
    }
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            totals = await conn.fetchrow("""
                SELECT
                  COUNT(DISTINCT visitor_hash) FILTER (
                    WHERE created_at >= now() - INTERVAL '24 hours' AND visitor_hash <> '') AS v_24h,
                  COUNT(DISTINCT visitor_hash) FILTER (
                    WHERE created_at >= now() - INTERVAL '7 days'  AND visitor_hash <> '') AS v_7d,
                  COUNT(DISTINCT visitor_hash) FILTER (
                    WHERE created_at >= now() - INTERVAL '30 days' AND visitor_hash <> '') AS v_30d,
                  COUNT(DISTINCT visitor_hash) FILTER (WHERE visitor_hash <> '')            AS v_all,
                  COUNT(*) FILTER (
                    WHERE event_name = 'page_view' AND created_at >= now() - INTERVAL '24 hours') AS pv_24h,
                  COUNT(*) FILTER (
                    WHERE event_name = 'page_view' AND created_at >= now() - INTERVAL '7 days')  AS pv_7d,
                  COUNT(*) FILTER (
                    WHERE event_name = 'page_view' AND created_at >= now() - INTERVAL '30 days') AS pv_30d,
                  COUNT(*) FILTER (WHERE event_name = 'page_view')                                AS pv_all,
                  COUNT(*)                                                                        AS ev_all
                FROM analytics_events
            """)

            by_event = await conn.fetch("""
                SELECT event_name,
                       COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '24 hours') AS last_24h,
                       COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '7 days')  AS last_7d,
                       COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '30 days') AS last_30d,
                       COUNT(*)                                                          AS all_time
                FROM analytics_events
                GROUP BY event_name
                ORDER BY all_time DESC
            """)

            top_pages = await conn.fetch("""
                SELECT COALESCE(props->>'page', 'unknown') AS page,
                       COUNT(*)                            AS views,
                       COUNT(DISTINCT visitor_hash) FILTER (WHERE visitor_hash <> '') AS visitors
                FROM analytics_events
                WHERE event_name = 'page_view'
                GROUP BY 1
                ORDER BY views DESC
            """)

            referrers = await conn.fetch("""
                SELECT COALESCE(props->>'referrer', 'direct') AS referrer,
                       COUNT(*)                               AS views
                FROM analytics_events
                WHERE event_name = 'page_view'
                GROUP BY 1
                ORDER BY views DESC
                LIMIT 10
            """)

            recent = await conn.fetch(
                "SELECT event_name, props, created_at FROM analytics_events "
                "ORDER BY created_at DESC LIMIT 20"
            )

        t = totals or {}
        return {
            "visitors": {
                "last_24h": t.get("v_24h", 0),
                "last_7d": t.get("v_7d", 0),
                "last_30d": t.get("v_30d", 0),
                "all_time": t.get("v_all", 0),
            },
            "page_views": {
                "last_24h": t.get("pv_24h", 0),
                "last_7d": t.get("pv_7d", 0),
                "last_30d": t.get("pv_30d", 0),
                "all_time": t.get("pv_all", 0),
            },
            "total_events": t.get("ev_all", 0),
            "top_pages": [
                {"page": r["page"], "views": r["views"], "visitors": r["visitors"]}
                for r in top_pages
            ],
            "referrers": [
                {"referrer": r["referrer"], "views": r["views"]} for r in referrers
            ],
            "by_event": [
                {
                    "event": r["event_name"],
                    "last_24h": r["last_24h"],
                    "last_7d": r["last_7d"],
                    "last_30d": r["last_30d"],
                    "all_time": r["all_time"],
                }
                for r in by_event
            ],
            "recent": [
                {
                    "event": r["event_name"],
                    # asyncpg hands JSONB back as a string; parse so callers get an object
                    "props": _parse_props(r["props"]),
                    "at": r["created_at"].isoformat() if r["created_at"] else None,
                }
                for r in recent
            ],
        }
    except Exception:
        logger.exception("Failed to fetch analytics summary")
        return {
            "visitors": {"last_24h": 0, "last_7d": 0, "last_30d": 0, "all_time": 0},
            "page_views": {"last_24h": 0, "last_7d": 0, "last_30d": 0, "all_time": 0},
            "total_events": 0,
            "top_pages": [],
            "referrers": [],
            "by_event": [],
            "recent": [],
        }
