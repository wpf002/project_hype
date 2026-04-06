"""
Tests for POST /api/portfolio/share and GET /api/portfolio/{id}
"""

from unittest.mock import AsyncMock, patch
import pytest


POSITIONS = [
    {"code": "IQD", "amount": 5_000_000},
    {"code": "IRR", "amount": 10_000_000},
]


# ── POST /api/portfolio/share ──────────────────────────────────────────────

async def test_share_portfolio_ok(client):
    with patch(
        "routers.portfolio.create_shared_portfolio",
        new_callable=AsyncMock,
        return_value="abc12345",
    ):
        r = await client.post(
            "/api/portfolio/share",
            json={"positions": POSITIONS},
        )
    assert r.status_code == 200
    d = r.json()
    assert d["id"] == "abc12345"
    assert "abc12345" in d["url"]


async def test_share_portfolio_url_contains_id(client):
    with patch(
        "routers.portfolio.create_shared_portfolio",
        new_callable=AsyncMock,
        return_value="xyz99999",
    ):
        r = await client.post(
            "/api/portfolio/share",
            json={"positions": POSITIONS},
        )
    assert "?portfolio=xyz99999" in r.json()["url"]


async def test_share_portfolio_codes_uppercased(client):
    captured = []

    async def _mock_create(positions):
        captured.extend(positions)
        return "test1234"

    with patch("routers.portfolio.create_shared_portfolio", side_effect=_mock_create):
        await client.post(
            "/api/portfolio/share",
            json={"positions": [{"code": "iqd", "amount": 100}]},
        )
    assert captured[0]["code"] == "IQD"


async def test_share_portfolio_empty_positions_rejected(client):
    r = await client.post(
        "/api/portfolio/share",
        json={"positions": []},
    )
    assert r.status_code == 400
    assert "empty" in r.json()["detail"]


async def test_share_portfolio_missing_positions_field(client):
    r = await client.post("/api/portfolio/share", json={})
    assert r.status_code == 422


# ── GET /api/portfolio/{share_id} ─────────────────────────────────────────

async def test_get_portfolio_ok(client):
    stored = [{"code": "IQD", "amount": 5_000_000}]
    with patch(
        "routers.portfolio.get_shared_portfolio",
        new_callable=AsyncMock,
        return_value=stored,
    ):
        r = await client.get("/api/portfolio/abc12345")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["code"] == "IQD"
    assert data[0]["amount"] == 5_000_000


async def test_get_portfolio_not_found(client):
    with patch(
        "routers.portfolio.get_shared_portfolio",
        new_callable=AsyncMock,
        return_value=None,
    ):
        r = await client.get("/api/portfolio/doesnotexist")
    assert r.status_code == 404
    assert "not found" in r.json()["detail"]


async def test_get_portfolio_multiple_positions(client):
    stored = [
        {"code": "IQD", "amount": 5_000_000},
        {"code": "VES", "amount": 200_000},
    ]
    with patch(
        "routers.portfolio.get_shared_portfolio",
        new_callable=AsyncMock,
        return_value=stored,
    ):
        r = await client.get("/api/portfolio/multi1234")
    assert r.status_code == 200
    assert len(r.json()) == 2
