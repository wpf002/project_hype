"""
Tests for POST /api/roi
"""

from unittest.mock import AsyncMock, patch
import pytest


async def test_roi_basic_calculation(client):
    """Standard ROI calculation with a live rate."""
    with patch(
        "routers.roi.get_rate",
        new_callable=AsyncMock,
        return_value=(0.000763, True, "oxr"),
    ):
        r = await client.post(
            "/api/roi",
            json={"code": "IQD", "amount": 1_000_000, "target_rate": 0.001},
        )
    assert r.status_code == 200
    d = r.json()
    assert d["code"] == "IQD"
    assert d["current_rate"] == pytest.approx(0.000763)
    assert d["current_value"] == pytest.approx(763.0, rel=1e-3)
    assert d["target_value"] == pytest.approx(1000.0, rel=1e-3)
    assert d["gain"] == pytest.approx(237.0, rel=1e-3)
    assert d["roi_percent"] == pytest.approx(31.06, rel=1e-2)
    assert d["multiplier"] == pytest.approx(1.3106, rel=1e-3)
    assert d["live"] is True


async def test_roi_case_insensitive(client):
    with patch(
        "routers.roi.get_rate",
        new_callable=AsyncMock,
        return_value=(0.000763, False, "analyst"),
    ):
        r = await client.post(
            "/api/roi",
            json={"code": "iqd", "amount": 100, "target_rate": 0.001},
        )
    assert r.status_code == 200
    assert r.json()["code"] == "IQD"


async def test_roi_fallback_rate_not_live(client):
    with patch(
        "routers.roi.get_rate",
        new_callable=AsyncMock,
        return_value=(0.000763, False, "analyst"),
    ):
        r = await client.post(
            "/api/roi",
            json={"code": "IQD", "amount": 1000, "target_rate": 0.001},
        )
    assert r.status_code == 200
    assert r.json()["live"] is False


async def test_roi_negative_return_when_target_below_current(client):
    """If target < current, ROI should be negative (devaluation scenario)."""
    with patch(
        "routers.roi.get_rate",
        new_callable=AsyncMock,
        return_value=(0.001, True, "oxr"),
    ):
        r = await client.post(
            "/api/roi",
            json={"code": "IQD", "amount": 1_000_000, "target_rate": 0.0005},
        )
    assert r.status_code == 200
    d = r.json()
    assert d["gain"] < 0
    assert d["roi_percent"] < 0
    assert d["multiplier"] == pytest.approx(0.5)


async def test_roi_unknown_currency(client):
    r = await client.post(
        "/api/roi",
        json={"code": "FAKE", "amount": 1000, "target_rate": 0.001},
    )
    assert r.status_code == 404
    assert "not tracked" in r.json()["detail"]


async def test_roi_zero_amount_rejected(client):
    r = await client.post(
        "/api/roi",
        json={"code": "IQD", "amount": 0, "target_rate": 0.001},
    )
    assert r.status_code == 422


async def test_roi_negative_amount_rejected(client):
    r = await client.post(
        "/api/roi",
        json={"code": "IQD", "amount": -500, "target_rate": 0.001},
    )
    assert r.status_code == 422


async def test_roi_zero_target_rate_rejected(client):
    r = await client.post(
        "/api/roi",
        json={"code": "IQD", "amount": 1000, "target_rate": 0},
    )
    assert r.status_code == 422


async def test_roi_negative_target_rate_rejected(client):
    r = await client.post(
        "/api/roi",
        json={"code": "IQD", "amount": 1000, "target_rate": -0.001},
    )
    assert r.status_code == 422


async def test_roi_zero_current_rate_rejected(client):
    """Currencies with rate=0 (no price data) should return 422."""
    with patch(
        "routers.roi.get_rate",
        new_callable=AsyncMock,
        return_value=(0.0, False, "analyst"),
    ):
        r = await client.post(
            "/api/roi",
            json={"code": "IQD", "amount": 1000, "target_rate": 0.001},
        )
    assert r.status_code == 422
    assert "No valid rate" in r.json()["detail"]


async def test_roi_missing_fields(client):
    r = await client.post("/api/roi", json={"code": "IQD"})
    assert r.status_code == 422


async def test_roi_response_fields_complete(client):
    """All ROIResponse fields must be present."""
    with patch(
        "routers.roi.get_rate",
        new_callable=AsyncMock,
        return_value=(0.000763, True, "oxr"),
    ):
        r = await client.post(
            "/api/roi",
            json={"code": "IQD", "amount": 500_000, "target_rate": 0.001},
        )
    assert r.status_code == 200
    required = {
        "code", "amount", "current_rate", "target_rate",
        "current_value", "target_value", "gain", "roi_percent",
        "multiplier", "live",
    }
    assert required.issubset(r.json().keys())
