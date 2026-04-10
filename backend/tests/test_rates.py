"""
Tests for GET /api/rates, GET /api/rate/{code}, GET /api/status
"""

from unittest.mock import AsyncMock, patch
import pytest

# ── shared mock data ───────────────────────────────────────────────────────

MOCK_RATES = {
    "IQD": (0.000763, True, "oxr"),
    "IRR": (0.0000238, False, "analyst"),
    "VES": (0.027, True, "scraped"),
}

MOCK_CHANGES = {"IQD": 0.52, "IRR": -0.10, "VES": 1.8}

MOCK_HYPE_SCORES = {"IQD": 72.5, "IRR": 81.0, "VES": 55.3}

MOCK_CATALYST = {
    "IQD": {"catalyst_score": 64.0, "sentiment": 0.4, "momentum_7d": 1.2, "sentiment_source": "claude"},
    "IRR": {"catalyst_score": 78.0, "sentiment": 0.8, "momentum_7d": 2.1, "sentiment_source": "keyword_fallback"},
}


def _rates_patches(
    rates=MOCK_RATES,
    changes=MOCK_CHANGES,
    hype=MOCK_HYPE_SCORES,
    catalyst=MOCK_CATALYST,
):
    """Context manager that patches all four data sources for the rates router."""
    return (
        patch("routers.rates.get_all_rates", new_callable=AsyncMock, return_value=rates),
        patch("routers.rates.get_all_changes_24h", new_callable=AsyncMock, return_value=changes),
        patch("routers.rates.get_latest_hype_scores", new_callable=AsyncMock, return_value=hype),
        patch("routers.rates.get_latest_catalyst_scores", new_callable=AsyncMock, return_value=catalyst),
    )


# ── GET /api/rates ─────────────────────────────────────────────────────────

async def test_get_rates_returns_list(client):
    p1, p2, p3, p4 = _rates_patches()
    with p1, p2, p3, p4:
        r = await client.get("/api/rates")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) > 0


async def test_get_rates_fields(client):
    """Each item must contain all required CurrencyRate fields."""
    p1, p2, p3, p4 = _rates_patches()
    with p1, p2, p3, p4:
        r = await client.get("/api/rates")
    item = r.json()[0]
    required = {"code", "name", "flag", "rate", "mcap", "vol", "hype", "story", "live", "source"}
    assert required.issubset(item.keys())


async def test_get_rates_iqd_present(client):
    """IQD must appear somewhere in the list."""
    p1, p2, p3, p4 = _rates_patches()
    with p1, p2, p3, p4:
        r = await client.get("/api/rates")
    codes = [c["code"] for c in r.json()]
    assert "IQD" in codes


async def test_get_rates_live_flag_propagated(client):
    """IQD should be marked live=True and source=oxr per mock."""
    p1, p2, p3, p4 = _rates_patches()
    with p1, p2, p3, p4:
        r = await client.get("/api/rates")
    iqd = next(c for c in r.json() if c["code"] == "IQD")
    assert iqd["live"] is True
    assert iqd["source"] == "oxr"
    assert iqd["rate"] == pytest.approx(0.000763)


async def test_get_rates_source_field_variants(client):
    """Different source values (scraped, analyst) should pass through correctly."""
    p1, p2, p3, p4 = _rates_patches()
    with p1, p2, p3, p4:
        r = await client.get("/api/rates")
    data = {c["code"]: c for c in r.json()}
    assert data["IRR"]["source"] == "analyst"
    assert data["VES"]["source"] == "scraped"


async def test_get_rates_hype_score_populated(client):
    """hype_score comes from the mock hype scores dict."""
    p1, p2, p3, p4 = _rates_patches()
    with p1, p2, p3, p4:
        r = await client.get("/api/rates")
    iqd = next(c for c in r.json() if c["code"] == "IQD")
    assert iqd["hype_score"] == pytest.approx(72.5)


async def test_get_rates_catalyst_score_populated(client):
    p1, p2, p3, p4 = _rates_patches()
    with p1, p2, p3, p4:
        r = await client.get("/api/rates")
    iqd = next(c for c in r.json() if c["code"] == "IQD")
    assert iqd["catalyst_score"] == pytest.approx(64.0)
    assert iqd["sentiment"] == pytest.approx(0.4)


async def test_get_rates_change_24h_populated(client):
    p1, p2, p3, p4 = _rates_patches()
    with p1, p2, p3, p4:
        r = await client.get("/api/rates")
    iqd = next(c for c in r.json() if c["code"] == "IQD")
    assert iqd["change_24h"] == pytest.approx(0.52)


async def test_get_rates_missing_hype_falls_back_to_currency_default(client):
    """Currency with no hype score in DB falls back to its static default."""
    p1, p2, p3, p4 = _rates_patches(hype={})  # empty hype scores
    with p1, p2, p3, p4:
        r = await client.get("/api/rates")
    iqd = next(c for c in r.json() if c["code"] == "IQD")
    assert iqd["hype_score"] is not None  # falls back to currency["hype"]


# ── GET /api/rate/{code} ───────────────────────────────────────────────────

async def test_get_single_rate_ok(client):
    with (
        patch("routers.rates.get_rate", new_callable=AsyncMock, return_value=(0.000763, True, "oxr")),
        patch("routers.rates.get_latest_hype_scores", new_callable=AsyncMock, return_value=MOCK_HYPE_SCORES),
        patch("routers.rates.get_latest_catalyst_scores", new_callable=AsyncMock, return_value=MOCK_CATALYST),
        patch("routers.rates.get_change_24h", new_callable=AsyncMock, return_value=0.52),
    ):
        r = await client.get("/api/rate/IQD")
    assert r.status_code == 200
    data = r.json()
    assert data["code"] == "IQD"
    assert data["rate"] == pytest.approx(0.000763)
    assert data["live"] is True
    assert data["source"] == "oxr"
    assert "news_query" in data


async def test_get_single_rate_case_insensitive(client):
    with (
        patch("routers.rates.get_rate", new_callable=AsyncMock, return_value=(0.000763, True, "oxr")),
        patch("routers.rates.get_latest_hype_scores", new_callable=AsyncMock, return_value={}),
        patch("routers.rates.get_latest_catalyst_scores", new_callable=AsyncMock, return_value={}),
        patch("routers.rates.get_change_24h", new_callable=AsyncMock, return_value=None),
    ):
        r = await client.get("/api/rate/iqd")
    assert r.status_code == 200
    assert r.json()["code"] == "IQD"


async def test_get_single_rate_unknown_code(client):
    r = await client.get("/api/rate/FAKE")
    assert r.status_code == 404
    assert "not tracked" in r.json()["detail"]


# ── GET /api/status ────────────────────────────────────────────────────────

async def test_get_status_structure(client):
    with patch(
        "routers.rates.get_latest_hype_updated_at",
        new_callable=AsyncMock,
        return_value="2024-01-15T12:00:00+00:00",
    ), patch(
        "routers.rates.get_latest_rate_updated_at",
        new_callable=AsyncMock,
        return_value="2024-01-15T12:00:00+00:00",
    ):
        r = await client.get("/api/status")
    assert r.status_code == 200
    data = r.json()
    assert "version" in data
    assert "currencies_tracked" in data
    assert "last_hype_run" in data
    assert "last_rate_fetch" in data
    assert "db_status" in data
    assert "uptime_seconds" in data
    assert data["currencies_tracked"] > 0
    assert data["version"] == "1.2.0"


async def test_get_status_null_when_no_scores(client):
    with patch(
        "routers.rates.get_latest_hype_updated_at",
        new_callable=AsyncMock,
        return_value=None,
    ), patch(
        "routers.rates.get_latest_rate_updated_at",
        new_callable=AsyncMock,
        return_value=None,
    ):
        r = await client.get("/api/status")
    assert r.status_code == 200
    assert r.json()["last_hype_run"] is None
    assert r.json()["last_rate_fetch"] is None
