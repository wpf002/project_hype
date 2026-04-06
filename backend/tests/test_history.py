"""
Tests for GET /api/history/{code} and GET /api/hype/{code}
"""

from unittest.mock import AsyncMock, patch
import pytest


MOCK_RATE_HISTORY = [
    {"id": 3, "code": "IQD", "rate": 0.000765, "live": True, "timestamp": "2024-01-15T12:00:00+00:00"},
    {"id": 2, "code": "IQD", "rate": 0.000763, "live": True, "timestamp": "2024-01-15T11:00:00+00:00"},
    {"id": 1, "code": "IQD", "rate": 0.000761, "live": False, "timestamp": "2024-01-15T10:00:00+00:00"},
]

MOCK_HYPE_HISTORY = [
    {"id": 2, "code": "IQD", "score": 73.0, "news_count": 12, "volatility": 0.0002, "timestamp": "2024-01-15T12:00:00+00:00"},
    {"id": 1, "code": "IQD", "score": 70.5, "news_count": 10, "volatility": 0.0001, "timestamp": "2024-01-15T00:00:00+00:00"},
]


# ── GET /api/history/{code} ────────────────────────────────────────────────

async def test_get_history_ok(client):
    with patch(
        "routers.history.get_history",
        new_callable=AsyncMock,
        return_value=MOCK_RATE_HISTORY,
    ):
        r = await client.get("/api/history/IQD")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 3
    assert data[0]["code"] == "IQD"
    assert data[0]["rate"] == pytest.approx(0.000765)


async def test_get_history_fields(client):
    with patch(
        "routers.history.get_history",
        new_callable=AsyncMock,
        return_value=MOCK_RATE_HISTORY,
    ):
        r = await client.get("/api/history/IQD")
    item = r.json()[0]
    assert {"id", "code", "rate", "live", "timestamp"}.issubset(item.keys())


async def test_get_history_case_insensitive(client):
    with patch(
        "routers.history.get_history",
        new_callable=AsyncMock,
        return_value=MOCK_RATE_HISTORY,
    ):
        r = await client.get("/api/history/iqd")
    assert r.status_code == 200


async def test_get_history_unknown_code(client):
    r = await client.get("/api/history/FAKE")
    assert r.status_code == 404


async def test_get_history_empty_returns_list(client):
    with patch(
        "routers.history.get_history",
        new_callable=AsyncMock,
        return_value=[],
    ):
        r = await client.get("/api/history/IQD")
    assert r.status_code == 200
    assert r.json() == []


async def test_get_history_default_limit(client):
    """Verify the default limit parameter is forwarded to the db call."""
    mock = AsyncMock(return_value=[])
    with patch("routers.history.get_history", mock):
        await client.get("/api/history/IQD")
    _, called_limit = mock.call_args[0]
    assert called_limit == 24


async def test_get_history_custom_limit(client):
    mock = AsyncMock(return_value=[])
    with patch("routers.history.get_history", mock):
        await client.get("/api/history/IQD?limit=48")
    _, called_limit = mock.call_args[0]
    assert called_limit == 48


async def test_get_history_limit_too_large(client):
    r = await client.get("/api/history/IQD?limit=9999")
    assert r.status_code == 422


async def test_get_history_limit_zero(client):
    r = await client.get("/api/history/IQD?limit=0")
    assert r.status_code == 422


# ── GET /api/hype/{code} ──────────────────────────────────────────────────

async def test_get_hype_history_ok(client):
    with patch(
        "routers.hype.get_hype_history",
        new_callable=AsyncMock,
        return_value=MOCK_HYPE_HISTORY,
    ):
        r = await client.get("/api/hype/IQD")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 2
    assert data[0]["score"] == pytest.approx(73.0)
    assert data[0]["news_count"] == 12


async def test_get_hype_history_fields(client):
    with patch(
        "routers.hype.get_hype_history",
        new_callable=AsyncMock,
        return_value=MOCK_HYPE_HISTORY,
    ):
        r = await client.get("/api/hype/IQD")
    item = r.json()[0]
    assert {"id", "code", "score", "news_count", "volatility", "timestamp"}.issubset(item.keys())


async def test_get_hype_history_unknown_code(client):
    r = await client.get("/api/hype/FAKE")
    assert r.status_code == 404


async def test_get_hype_history_empty(client):
    with patch(
        "routers.hype.get_hype_history",
        new_callable=AsyncMock,
        return_value=[],
    ):
        r = await client.get("/api/hype/IQD")
    assert r.status_code == 200
    assert r.json() == []


async def test_get_hype_history_limit_max(client):
    r = await client.get("/api/hype/IQD?limit=9999")
    assert r.status_code == 422
