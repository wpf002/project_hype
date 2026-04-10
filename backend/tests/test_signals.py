"""
Tests for GET /api/signals/{code}
"""

from unittest.mock import AsyncMock, patch
import pytest

MOCK_SIGNALS = [
    {
        "id": 1,
        "code": "IQD",
        "signal_type": "IMF_POSITIVE",
        "headline": "IMF approves tranche for Iraq amid fiscal reforms",
        "url": "https://www.imf.org/en/news/example",
        "published_at": "Wed, 09 Apr 2025 12:00:00 GMT",
        "processed_at": "2025-04-09T12:05:00+00:00",
    },
    {
        "id": 2,
        "code": "IQD",
        "signal_type": "SANCTIONS_RELIEF",
        "headline": "US Treasury issues general license for Iraq reconstruction payments",
        "url": "https://home.treasury.gov/example",
        "published_at": "Tue, 08 Apr 2025 09:00:00 GMT",
        "processed_at": "2025-04-08T09:05:00+00:00",
    },
]


async def test_get_signals_ok(client):
    with patch("routers.signals.get_signals", new_callable=AsyncMock, return_value=MOCK_SIGNALS):
        r = await client.get("/api/signals/IQD")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 2
    assert data[0]["signal_type"] == "IMF_POSITIVE"
    assert data[1]["signal_type"] == "SANCTIONS_RELIEF"


async def test_get_signals_fields(client):
    with patch("routers.signals.get_signals", new_callable=AsyncMock, return_value=MOCK_SIGNALS):
        r = await client.get("/api/signals/IQD")
    item = r.json()[0]
    required = {"id", "code", "signal_type", "headline", "url", "published_at", "processed_at"}
    assert required.issubset(item.keys())


async def test_get_signals_case_insensitive(client):
    with patch("routers.signals.get_signals", new_callable=AsyncMock, return_value=MOCK_SIGNALS):
        r = await client.get("/api/signals/iqd")
    assert r.status_code == 200


async def test_get_signals_unknown_code(client):
    r = await client.get("/api/signals/FAKE")
    assert r.status_code == 404
    assert "not tracked" in r.json()["detail"]


async def test_get_signals_empty(client):
    with patch("routers.signals.get_signals", new_callable=AsyncMock, return_value=[]):
        r = await client.get("/api/signals/IRR")
    assert r.status_code == 200
    assert r.json() == []


async def test_get_signals_irr_sanctions(client):
    irr_signal = [{
        "id": 3,
        "code": "IRR",
        "signal_type": "SANCTIONS_ADDED",
        "headline": "OFAC designates additional Iranian entities",
        "url": "https://home.treasury.gov/irr-example",
        "published_at": "Mon, 07 Apr 2025 15:00:00 GMT",
        "processed_at": "2025-04-07T15:05:00+00:00",
    }]
    with patch("routers.signals.get_signals", new_callable=AsyncMock, return_value=irr_signal):
        r = await client.get("/api/signals/IRR")
    assert r.status_code == 200
    assert r.json()[0]["signal_type"] == "SANCTIONS_ADDED"


async def test_get_signals_all_types_valid(client):
    """All four signal types should be accepted and returned without error."""
    for sig_type in ("IMF_POSITIVE", "IMF_NEGATIVE", "SANCTIONS_RELIEF", "SANCTIONS_ADDED"):
        mock = [{
            "id": 1, "code": "ARS", "signal_type": sig_type,
            "headline": "Test headline", "url": "", "published_at": "", "processed_at": "",
        }]
        with patch("routers.signals.get_signals", new_callable=AsyncMock, return_value=mock):
            r = await client.get("/api/signals/ARS")
        assert r.status_code == 200
        assert r.json()[0]["signal_type"] == sig_type
