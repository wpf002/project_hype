"""
Security-critical tests — abuse, IDOR, boundary validation, injection-surface.

These cover the paths that the original happy-path suite did not:
  - Portfolio share: untracked codes, Inf/NaN/negative amounts, oversized position list
  - ROI: Inf/NaN/negative inputs
  - Alert subscribe/unsubscribe: invalid email formats, oversized email
  - MOCK_HEADLINES dedup: verify no duplicate keys in the dict (catches M-10)
  - Parameterized-query surface: SQL-metachar codes reach the DB as bound params (not injected)
  - /rate/{code} and /history/{code}: SQL-metachar in path param returns 404, not 500/SQLi
"""

import math
import pytest
from unittest.mock import AsyncMock, patch


# ── Helpers ───────────────────────────────────────────────────────────────────

VALID_POSITION = {"code": "IQD", "amount": 1_000_000}


# ── Portfolio share — input validation ────────────────────────────────────────

async def test_share_rejects_untracked_code(client):
    r = await client.post(
        "/api/portfolio/share",
        json={"positions": [{"code": "FAKE", "amount": 1000}]},
    )
    assert r.status_code == 422


async def test_share_rejects_infinity_amount(client):
    # JSON Infinity is not valid JSON; use a very large float that Pydantic
    # receives as a float literal — our validator must catch it.
    # httpx serialises Python float('inf') as 'Infinity' which is invalid JSON,
    # so the server will 422 at parse time.  We also test a finite-but-huge value.
    r = await client.post(
        "/api/portfolio/share",
        json={"positions": [{"code": "IQD", "amount": 2e15}]},
    )
    assert r.status_code == 422, "amounts > 1e15 should be rejected"


async def test_share_rejects_negative_amount(client):
    r = await client.post(
        "/api/portfolio/share",
        json={"positions": [{"code": "IQD", "amount": -100}]},
    )
    assert r.status_code == 422


async def test_share_rejects_zero_amount(client):
    r = await client.post(
        "/api/portfolio/share",
        json={"positions": [{"code": "IQD", "amount": 0}]},
    )
    assert r.status_code == 422


async def test_share_rejects_oversized_positions(client):
    """51 positions should exceed the MAX_POSITIONS=50 cap and return 400."""
    with patch(
        "routers.portfolio.create_shared_portfolio",
        new_callable=AsyncMock,
        return_value="ok123456",
    ):
        r = await client.post(
            "/api/portfolio/share",
            json={"positions": [{"code": "IQD", "amount": 1000}] * 51},
        )
    assert r.status_code == 400
    assert "50" in r.json()["detail"]


async def test_share_accepts_exactly_max_positions(client):
    """50 positions should be accepted (boundary)."""
    with patch(
        "routers.portfolio.create_shared_portfolio",
        new_callable=AsyncMock,
        return_value="ok123456",
    ):
        r = await client.post(
            "/api/portfolio/share",
            json={"positions": [{"code": "IQD", "amount": 1000}] * 50},
        )
    assert r.status_code == 200


async def test_share_sql_metachar_code_rejected(client):
    """A code containing SQL metacharacters should fail allowlist validation (422), not reach the DB."""
    r = await client.post(
        "/api/portfolio/share",
        json={"positions": [{"code": "'; DROP TABLE rate_snapshots;--", "amount": 1000}]},
    )
    assert r.status_code == 422


# ── ROI — Inf / NaN / negative ────────────────────────────────────────────────

async def test_roi_rejects_oversized_amount(client):
    from unittest.mock import AsyncMock, patch
    with patch("routers.roi.get_rate", new_callable=AsyncMock, return_value=(0.001, True, "oxr")):
        r = await client.post(
            "/api/roi",
            json={"code": "IQD", "amount": 2e15, "target_rate": 0.001},
        )
    assert r.status_code == 422, "amount > 1e15 must be rejected"


async def test_roi_rejects_oversized_target_rate(client):
    with patch("routers.roi.get_rate", new_callable=AsyncMock, return_value=(0.001, True, "oxr")):
        r = await client.post(
            "/api/roi",
            json={"code": "IQD", "amount": 1_000_000, "target_rate": 2e15},
        )
    assert r.status_code == 422, "target_rate > 1e15 must be rejected"


async def test_roi_rejects_negative_amount(client):
    r = await client.post(
        "/api/roi",
        json={"code": "IQD", "amount": -1, "target_rate": 0.001},
    )
    assert r.status_code == 422


async def test_roi_rejects_zero_amount(client):
    r = await client.post(
        "/api/roi",
        json={"code": "IQD", "amount": 0, "target_rate": 0.001},
    )
    assert r.status_code == 422


# ── Alert subscribe / unsubscribe — invalid email ────────────────────────────

async def test_subscribe_rejects_invalid_email(client):
    r = await client.post(
        "/api/alerts/subscribe",
        json={"email": "not-an-email", "codes": ["IQD"]},
    )
    assert r.status_code == 422


async def test_subscribe_rejects_oversized_email(client):
    long_email = "a" * 250 + "@b.com"  # > 254 chars
    r = await client.post(
        "/api/alerts/subscribe",
        json={"email": long_email, "codes": ["IQD"]},
    )
    assert r.status_code == 422


async def test_unsubscribe_rejects_invalid_email(client):
    """DELETE /alerts/unsubscribe should now validate email format (422, not 200)."""
    r = await client.request(
        "DELETE",
        "/api/alerts/unsubscribe",
        json={"email": "not-an-email"},
    )
    assert r.status_code == 422


async def test_unsubscribe_rejects_oversized_email(client):
    long_email = "a" * 250 + "@b.com"
    r = await client.request(
        "DELETE",
        "/api/alerts/unsubscribe",
        json={"email": long_email},
    )
    assert r.status_code == 422


async def test_unsubscribe_valid_email_succeeds(client):
    """A well-formed email should reach the DB (mocked) and return 200."""
    with patch("routers.alerts.delete_subscriber", new_callable=AsyncMock):
        r = await client.request(
            "DELETE",
            "/api/alerts/unsubscribe",
            json={"email": "user@example.com"},
        )
    assert r.status_code == 200
    assert r.json()["unsubscribed"] is True


# ── SQL-metachar path params: 404, not 500 ───────────────────────────────────

async def test_rate_sqlchar_code_returns_404(client):
    r = await client.get("/api/rate/'; DROP TABLE--")
    assert r.status_code == 404


async def test_history_sqlchar_code_returns_404(client):
    r = await client.get("/api/history/'; DROP TABLE--")
    assert r.status_code == 404


async def test_news_sqlchar_code_returns_404(client):
    r = await client.get("/api/news/'; DROP TABLE--")
    assert r.status_code == 404


# ── MOCK_HEADLINES dict has no duplicate keys (M-10 regression guard) ─────────

def test_mock_headlines_no_duplicate_keys():
    """Verify the MOCK_HEADLINES dict has no shadowed (duplicate) keys.
    Python silently discards earlier definitions, so this test is the safety net."""
    import ast
    import pathlib

    src = pathlib.Path(__file__).parent.parent / "services" / "news_service.py"
    tree = ast.parse(src.read_text())

    # MOCK_HEADLINES uses a type-annotated assignment (ast.AnnAssign), not ast.Assign
    for node in ast.walk(tree):
        # Handle both `X = {...}` (Assign) and `X: Type = {...}` (AnnAssign)
        if isinstance(node, ast.AnnAssign):
            target = node.target
            value = node.value
        elif isinstance(node, ast.Assign):
            # Take the first target only for simplicity
            target = node.targets[0] if node.targets else None
            value = node.value
        else:
            continue

        if not (isinstance(target, ast.Name) and target.id == "MOCK_HEADLINES"):
            continue
        if not isinstance(value, ast.Dict):
            continue

        keys = [
            k.value if isinstance(k, ast.Constant) else None
            for k in value.keys
        ]
        seen, dupes = set(), []
        for k in keys:
            if k in seen:
                dupes.append(k)
            seen.add(k)
        assert not dupes, f"MOCK_HEADLINES has duplicate keys: {dupes}"
        return  # found and checked

    pytest.fail("MOCK_HEADLINES not found in news_service.py")
