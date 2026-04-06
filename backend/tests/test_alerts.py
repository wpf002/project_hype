"""
Tests for POST /api/alerts/subscribe and DELETE /api/alerts/unsubscribe
"""

from unittest.mock import AsyncMock, patch
import pytest


VALID_EMAIL = "investor@example.com"
VALID_CODES = ["IQD", "IRR"]


# ── POST /api/alerts/subscribe ─────────────────────────────────────────────

async def test_subscribe_ok(client):
    with patch("routers.alerts.upsert_subscriber", new_callable=AsyncMock) as mock_upsert:
        r = await client.post(
            "/api/alerts/subscribe",
            json={"email": VALID_EMAIL, "codes": VALID_CODES},
        )
    assert r.status_code == 200
    d = r.json()
    assert d["subscribed"] is True
    assert d["email"] == VALID_EMAIL
    assert set(d["codes"]) == set(VALID_CODES)
    mock_upsert.assert_awaited_once()


async def test_subscribe_email_normalised_to_lowercase(client):
    with patch("routers.alerts.upsert_subscriber", new_callable=AsyncMock):
        r = await client.post(
            "/api/alerts/subscribe",
            json={"email": "INVESTOR@EXAMPLE.COM", "codes": ["IQD"]},
        )
    assert r.status_code == 200
    assert r.json()["email"] == "investor@example.com"


async def test_subscribe_codes_normalised_to_uppercase(client):
    with patch("routers.alerts.upsert_subscriber", new_callable=AsyncMock):
        r = await client.post(
            "/api/alerts/subscribe",
            json={"email": VALID_EMAIL, "codes": ["iqd", "irr"]},
        )
    assert r.status_code == 200
    assert set(r.json()["codes"]) == {"IQD", "IRR"}


async def test_subscribe_invalid_email(client):
    r = await client.post(
        "/api/alerts/subscribe",
        json={"email": "not-an-email", "codes": VALID_CODES},
    )
    assert r.status_code == 422
    assert "email" in r.json()["detail"].lower()


async def test_subscribe_empty_email(client):
    r = await client.post(
        "/api/alerts/subscribe",
        json={"email": "", "codes": VALID_CODES},
    )
    assert r.status_code == 422


async def test_subscribe_unknown_codes_filtered_out(client):
    """Unknown currency codes are silently dropped; only valid ones persist."""
    with patch("routers.alerts.upsert_subscriber", new_callable=AsyncMock):
        r = await client.post(
            "/api/alerts/subscribe",
            json={"email": VALID_EMAIL, "codes": ["IQD", "FAKE", "NOTREAL"]},
        )
    assert r.status_code == 200
    assert r.json()["codes"] == ["IQD"]


async def test_subscribe_all_unknown_codes_rejected(client):
    """All-unknown codes with no valid code → 422."""
    r = await client.post(
        "/api/alerts/subscribe",
        json={"email": VALID_EMAIL, "codes": ["FAKE", "BOGUS"]},
    )
    assert r.status_code == 422


async def test_subscribe_missing_fields(client):
    r = await client.post("/api/alerts/subscribe", json={"email": VALID_EMAIL})
    assert r.status_code == 422


async def test_subscribe_upsert_called_with_correct_args(client):
    with patch("routers.alerts.upsert_subscriber", new_callable=AsyncMock) as mock_upsert:
        await client.post(
            "/api/alerts/subscribe",
            json={"email": " Investor@Example.COM ", "codes": ["IQD"]},
        )
    # email should be stripped + lowercased, code should be uppercase
    args = mock_upsert.call_args[0]
    assert args[0] == "investor@example.com"
    assert "IQD" in args[1]


# ── DELETE /api/alerts/unsubscribe ─────────────────────────────────────────

async def test_unsubscribe_ok(client):
    with patch("routers.alerts.delete_subscriber", new_callable=AsyncMock) as mock_del:
        r = await client.request(
            "DELETE",
            "/api/alerts/unsubscribe",
            json={"email": VALID_EMAIL},
        )
    assert r.status_code == 200
    assert r.json()["unsubscribed"] is True
    mock_del.assert_awaited_once()


async def test_unsubscribe_missing_email(client):
    r = await client.request("DELETE", "/api/alerts/unsubscribe", json={})
    assert r.status_code == 422
