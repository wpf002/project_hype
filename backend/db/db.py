"""
SQLite persistence for rate snapshots.

No ORM — raw sqlite3 only.
One connection per call; sqlite3 handles its own locking.
DB file lives at backend/db/rates.db (gitignored).
"""

import json
import os
import secrets
import sqlite3
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rates.db")


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create tables and indexes if they don't exist. Safe to call on every startup."""
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS rate_snapshots (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                code      TEXT    NOT NULL,
                rate      REAL    NOT NULL,
                live      INTEGER NOT NULL,
                timestamp TEXT    NOT NULL
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_code_ts ON rate_snapshots (code, timestamp)"
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS shared_portfolios (
                id         TEXT PRIMARY KEY,
                positions  TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS hype_snapshots (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                code       TEXT    NOT NULL,
                score      REAL    NOT NULL,
                news_count INTEGER NOT NULL DEFAULT 0,
                volatility REAL    NOT NULL DEFAULT 0,
                timestamp  TEXT    NOT NULL
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_hype_code_ts ON hype_snapshots (code, timestamp)"
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS catalyst_snapshots (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                code       TEXT    NOT NULL,
                score      REAL    NOT NULL,
                sentiment  REAL    NOT NULL DEFAULT 0,
                momentum   REAL    NOT NULL DEFAULT 0,
                timestamp  TEXT    NOT NULL
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_catalyst_code_ts ON catalyst_snapshots (code, timestamp)"
        )
        conn.commit()
    logger.info("DB initialised at %s", DB_PATH)


def write_snapshots(rates: Dict[str, Tuple[float, bool]]) -> None:
    """
    Insert one row per currency and prune rows older than 7 days.
    Called after every cache refresh in fx_service.
    """
    now = datetime.now(timezone.utc).isoformat()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    rows = [
        (code, rate, 1 if live else 0, now)
        for code, (rate, live) in rates.items()
    ]

    try:
        with _connect() as conn:
            conn.executemany(
                "INSERT INTO rate_snapshots (code, rate, live, timestamp) VALUES (?, ?, ?, ?)",
                rows,
            )
            conn.execute(
                "DELETE FROM rate_snapshots WHERE timestamp < ?", (cutoff,)
            )
            conn.commit()
    except Exception:
        logger.exception("Failed to write rate snapshots")


def get_history(code: str, limit: int = 24) -> List[dict]:
    """Return the last `limit` snapshots for `code`, newest first."""
    try:
        with _connect() as conn:
            rows = conn.execute(
                """SELECT id, code, rate, live, timestamp
                   FROM rate_snapshots
                   WHERE code = ?
                   ORDER BY timestamp DESC
                   LIMIT ?""",
                (code.upper(), limit),
            ).fetchall()
        return [
            {
                "id": r["id"],
                "code": r["code"],
                "rate": r["rate"],
                "live": bool(r["live"]),
                "timestamp": r["timestamp"],
            }
            for r in rows
        ]
    except Exception:
        logger.exception("Failed to fetch history for %s", code)
        return []


def get_all_changes_24h() -> Dict[str, Optional[float]]:
    """
    For each currency, compute % change between oldest and newest snapshot
    in the last 24 h. Returns {} if the table is empty or has no data.
    Currencies with fewer than 2 snapshots in the window are omitted
    (callers treat missing key as null / no data).
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    try:
        with _connect() as conn:
            rows = conn.execute(
                """SELECT code, rate
                   FROM rate_snapshots
                   WHERE timestamp >= ?
                   ORDER BY code, timestamp""",
                (cutoff,),
            ).fetchall()
    except Exception:
        logger.exception("Failed to fetch 24h changes")
        return {}

    # Group rates in chronological order per code
    by_code: Dict[str, list] = {}
    for r in rows:
        by_code.setdefault(r["code"], []).append(r["rate"])

    result: Dict[str, float] = {}
    for code, rates in by_code.items():
        if len(rates) < 2:
            continue
        oldest, newest = rates[0], rates[-1]
        if oldest == 0:
            continue
        result[code] = round(((newest - oldest) / oldest) * 100, 4)

    return result


def get_change_24h(code: str) -> Optional[float]:
    """Single-currency convenience wrapper around get_all_changes_24h."""
    return get_all_changes_24h().get(code.upper())


# ── Hype snapshots ────────────────────────────────────────────────────────

def write_hype_snapshots(scores: Dict[str, dict]) -> None:
    """
    Insert one hype snapshot per currency and prune rows older than 30 days.
    `scores` is {code: {score, news_count, volatility}}.
    """
    now = datetime.now(timezone.utc).isoformat()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

    rows = [
        (code, v["score"], v.get("news_count", 0), v.get("volatility", 0.0), now)
        for code, v in scores.items()
    ]

    try:
        with _connect() as conn:
            conn.executemany(
                "INSERT INTO hype_snapshots (code, score, news_count, volatility, timestamp) VALUES (?, ?, ?, ?, ?)",
                rows,
            )
            conn.execute("DELETE FROM hype_snapshots WHERE timestamp < ?", (cutoff,))
            conn.commit()
    except Exception:
        logger.exception("Failed to write hype snapshots")


def get_hype_history(code: str, limit: int = 24) -> List[dict]:
    """Return the last `limit` hype snapshots for `code`, newest first."""
    try:
        with _connect() as conn:
            rows = conn.execute(
                """SELECT id, code, score, news_count, volatility, timestamp
                   FROM hype_snapshots
                   WHERE code = ?
                   ORDER BY timestamp DESC
                   LIMIT ?""",
                (code.upper(), limit),
            ).fetchall()
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


def get_latest_hype_scores() -> Dict[str, float]:
    """Return the most recent hype score for every currency that has one."""
    try:
        with _connect() as conn:
            rows = conn.execute(
                """SELECT code, score
                   FROM hype_snapshots
                   WHERE id IN (
                       SELECT MAX(id) FROM hype_snapshots GROUP BY code
                   )"""
            ).fetchall()
        return {r["code"]: r["score"] for r in rows}
    except Exception:
        logger.exception("Failed to fetch latest hype scores")
        return {}


# ── Catalyst snapshots ────────────────────────────────────────────────────

def write_catalyst_snapshots(data: Dict[str, dict]) -> None:
    """Insert one catalyst snapshot per currency and prune rows older than 30 days."""
    now = datetime.now(timezone.utc).isoformat()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    rows = [
        (code, v["score"], v.get("sentiment", 0.0), v.get("momentum", 0.0), now)
        for code, v in data.items()
    ]
    try:
        with _connect() as conn:
            conn.executemany(
                "INSERT INTO catalyst_snapshots (code, score, sentiment, momentum, timestamp) VALUES (?, ?, ?, ?, ?)",
                rows,
            )
            conn.execute("DELETE FROM catalyst_snapshots WHERE timestamp < ?", (cutoff,))
            conn.commit()
    except Exception:
        logger.exception("Failed to write catalyst snapshots")


def get_latest_catalyst_scores() -> Dict[str, dict]:
    """Return the most recent catalyst snapshot for every currency that has one."""
    try:
        with _connect() as conn:
            rows = conn.execute(
                """SELECT code, score, sentiment, momentum
                   FROM catalyst_snapshots
                   WHERE id IN (
                       SELECT MAX(id) FROM catalyst_snapshots GROUP BY code
                   )"""
            ).fetchall()
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

def create_shared_portfolio(positions: list) -> str:
    """
    Persist `positions` as JSON and return the generated 8-char ID.
    ID is generated with secrets.token_urlsafe(6)[:8] (URL-safe, no padding).
    """
    share_id = secrets.token_urlsafe(6)[:8]
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO shared_portfolios (id, positions, created_at) VALUES (?, ?, ?)",
            (share_id, json.dumps(positions), now),
        )
        conn.commit()
    return share_id


def get_shared_portfolio(share_id: str) -> Optional[list]:
    """Return the positions list for `share_id`, or None if not found."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT positions FROM shared_portfolios WHERE id = ?",
            (share_id,),
        ).fetchone()
    if row is None:
        return None
    return json.loads(row["positions"])
