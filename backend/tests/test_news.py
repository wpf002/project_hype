"""
Tests for GET /api/news/{code}
"""

from unittest.mock import AsyncMock, patch
import pytest


MOCK_HEADLINES = [
    {
        "title": "Iraqi Dinar Eyes Reform Amid IMF Talks",
        "source": "Reuters",
        "url": "https://example.com/1",
        "published_at": "2024-01-15T10:00:00Z",
        "description": "Iraq holds talks with the IMF on exchange rate reform.",
        "mock": False,
    },
    {
        "title": "Central Bank of Iraq Boosts Reserves",
        "source": "AP",
        "url": "https://example.com/2",
        "published_at": "2024-01-14T08:00:00Z",
        "description": "Foreign reserve growth continues.",
        "mock": False,
    },
]


async def test_get_news_ok(client):
    with patch("routers.news.get_news", new_callable=AsyncMock, return_value=MOCK_HEADLINES):
        r = await client.get("/api/news/IQD")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 2
    assert data[0]["title"] == "Iraqi Dinar Eyes Reform Amid IMF Talks"


async def test_get_news_fields(client):
    with patch("routers.news.get_news", new_callable=AsyncMock, return_value=MOCK_HEADLINES):
        r = await client.get("/api/news/IQD")
    item = r.json()[0]
    assert {"title", "source", "url", "published_at", "description", "mock"}.issubset(item.keys())


async def test_get_news_case_insensitive(client):
    with patch("routers.news.get_news", new_callable=AsyncMock, return_value=MOCK_HEADLINES):
        r = await client.get("/api/news/iqd")
    assert r.status_code == 200


async def test_get_news_unknown_code(client):
    r = await client.get("/api/news/FAKE")
    assert r.status_code == 404
    assert "not tracked" in r.json()["detail"]


async def test_get_news_empty_list(client):
    """No headlines available — should still return 200 with empty list."""
    with patch("routers.news.get_news", new_callable=AsyncMock, return_value=[]):
        r = await client.get("/api/news/IQD")
    assert r.status_code == 200
    assert r.json() == []


async def test_get_news_mock_flag_preserved(client):
    mock_news = [{**MOCK_HEADLINES[0], "mock": True}]
    with patch("routers.news.get_news", new_callable=AsyncMock, return_value=mock_news):
        r = await client.get("/api/news/IQD")
    assert r.json()[0]["mock"] is True


async def test_get_news_different_currencies(client):
    for code in ["IRR", "VES", "AFN"]:
        with patch("routers.news.get_news", new_callable=AsyncMock, return_value=[]):
            r = await client.get(f"/api/news/{code}")
        assert r.status_code == 200
