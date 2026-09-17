"""
Alert subscriptions — double opt-in.

Locks in the property that matters before launch: nobody can subscribe or
unsubscribe an address without holding a token delivered to that inbox.
"""

from unittest.mock import AsyncMock, patch

VALID_EMAIL = "investor@example.com"
VALID_CODES = ["IQD", "IRR"]
TOKEN = "t" * 43  # shape of secrets.token_urlsafe(32)


def _patch_subscribe(recent=False, sent=True):
    return (
        patch("routers.alerts.recent_confirmation_exists", new_callable=AsyncMock, return_value=recent),
        patch("routers.alerts.create_alert_confirmation", new_callable=AsyncMock),
        patch("routers.alerts.send_confirmation_email", new_callable=AsyncMock, return_value=sent),
    )


# ── subscribe ────────────────────────────────────────────────────────────────

async def test_subscribe_sends_confirmation_not_subscription(client):
    p_recent, p_create, p_send = _patch_subscribe()
    with p_recent, p_create as create, p_send as send, \
         patch("routers.alerts.confirm_subscriber", new_callable=AsyncMock) as confirm:
        r = await client.post("/api/alerts/subscribe", json={"email": VALID_EMAIL, "codes": VALID_CODES})
    assert r.status_code == 200
    assert r.json()["pending_confirmation"] is True
    create.assert_awaited_once()
    send.assert_awaited_once()
    confirm.assert_not_awaited()  # nothing goes live until the link is clicked


async def test_subscribe_stores_only_a_hash_of_the_emailed_token(client):
    p_recent, p_create, p_send = _patch_subscribe()
    with p_recent, p_create as create, p_send as send:
        await client.post("/api/alerts/subscribe", json={"email": VALID_EMAIL, "codes": ["IQD"]})
    emailed_token = send.await_args.args[2]
    stored_hash = create.await_args.args[2]
    assert emailed_token not in stored_hash
    assert len(stored_hash) == 64


async def test_subscribe_cooldown_does_not_resend(client):
    p_recent, p_create, p_send = _patch_subscribe(recent=True)
    with p_recent, p_create as create, p_send as send:
        r = await client.post("/api/alerts/subscribe", json={"email": VALID_EMAIL, "codes": VALID_CODES})
    assert r.status_code == 200
    assert r.json()["pending_confirmation"] is True  # same answer, no oracle
    create.assert_not_awaited()
    send.assert_not_awaited()


async def test_subscribe_reports_send_failure(client):
    p_recent, p_create, p_send = _patch_subscribe(sent=False)
    with p_recent, p_create, p_send:
        r = await client.post("/api/alerts/subscribe", json={"email": VALID_EMAIL, "codes": VALID_CODES})
    assert r.status_code == 503


async def test_subscribe_normalises_email_and_codes(client):
    p_recent, p_create, p_send = _patch_subscribe()
    with p_recent, p_create as create, p_send:
        r = await client.post("/api/alerts/subscribe", json={"email": "INVESTOR@EXAMPLE.COM", "codes": ["iqd", "IQD"]})
    assert r.status_code == 200
    assert create.await_args.args[0] == "investor@example.com"
    assert create.await_args.args[1] == ["IQD"]


async def test_subscribe_invalid_email(client):
    r = await client.post("/api/alerts/subscribe", json={"email": "not-an-email", "codes": VALID_CODES})
    assert r.status_code == 422


async def test_subscribe_all_unknown_codes_rejected(client):
    r = await client.post("/api/alerts/subscribe", json={"email": VALID_EMAIL, "codes": ["FAKE", "NOPE"]})
    assert r.status_code == 422


async def test_subscribe_missing_fields(client):
    r = await client.post("/api/alerts/subscribe", json={})
    assert r.status_code == 422


# ── confirm ──────────────────────────────────────────────────────────────────

async def test_confirm_valid_token_activates_subscription(client):
    with patch("routers.alerts.consume_alert_confirmation", new_callable=AsyncMock,
               return_value=(VALID_EMAIL, ["IQD"])) as consume, \
         patch("routers.alerts.confirm_subscriber", new_callable=AsyncMock) as confirm:
        r = await client.post("/api/alerts/confirm", json={"token": TOKEN})
    assert r.status_code == 200
    assert r.json() == {"confirmed": True, "codes": ["IQD"]}
    assert consume.await_args.args[0] != TOKEN  # looked up by hash
    email, codes, unsub = confirm.await_args.args
    assert (email, codes) == (VALID_EMAIL, ["IQD"])
    assert len(unsub) >= 40


async def test_confirm_invalid_or_expired_token(client):
    with patch("routers.alerts.consume_alert_confirmation", new_callable=AsyncMock, return_value=None), \
         patch("routers.alerts.confirm_subscriber", new_callable=AsyncMock) as confirm:
        r = await client.post("/api/alerts/confirm", json={"token": TOKEN})
    assert r.status_code == 400
    confirm.assert_not_awaited()


async def test_confirm_malformed_token_never_reaches_db(client):
    with patch("routers.alerts.consume_alert_confirmation", new_callable=AsyncMock) as consume:
        r = await client.post("/api/alerts/confirm", json={"token": "'; DROP TABLE subscribers;--"})
    assert r.status_code == 400
    consume.assert_not_awaited()


# ── unsubscribe ──────────────────────────────────────────────────────────────

async def test_unsubscribe_by_token(client):
    with patch("routers.alerts.delete_subscriber_by_token", new_callable=AsyncMock, return_value=True) as d:
        r = await client.post("/api/alerts/unsubscribe", json={"token": TOKEN})
    assert r.status_code == 200
    assert r.json()["unsubscribed"] is True
    d.assert_awaited_once_with(TOKEN)


async def test_unsubscribe_unknown_token_gives_same_answer(client):
    with patch("routers.alerts.delete_subscriber_by_token", new_callable=AsyncMock, return_value=False):
        r = await client.post("/api/alerts/unsubscribe", json={"token": TOKEN})
    assert r.status_code == 200
    assert r.json()["unsubscribed"] is True


async def test_unsubscribe_by_email_alone_is_no_longer_possible(client):
    """The old DELETE {email} endpoint let anyone unsubscribe anyone."""
    r = await client.request("DELETE", "/api/alerts/unsubscribe", json={"email": VALID_EMAIL})
    assert r.status_code == 405
    r = await client.post("/api/alerts/unsubscribe", json={"email": VALID_EMAIL})
    assert r.status_code == 422


async def test_one_click_unsubscribe(client):
    with patch("routers.alerts.delete_subscriber_by_token", new_callable=AsyncMock) as d:
        r = await client.post(f"/api/alerts/unsubscribe/one-click?token={TOKEN}",
                              data={"List-Unsubscribe": "One-Click"})
    assert r.status_code == 200
    d.assert_awaited_once_with(TOKEN)


async def test_no_state_changing_get_endpoints(client):
    """Mail scanners pre-fetch links; a GET must never confirm or unsubscribe."""
    for path in ("/api/alerts/confirm", "/api/alerts/unsubscribe", "/api/alerts/unsubscribe/one-click"):
        r = await client.get(f"{path}?token={TOKEN}")
        assert r.status_code == 405, path


# ── feature switch ───────────────────────────────────────────────────────────

async def test_disabled_alerts_refuse_signup_and_confirm_but_allow_unsubscribe(client, monkeypatch):
    from services import email_service
    monkeypatch.setattr(email_service, "ALERTS_ENABLED", False)
    with patch("routers.alerts.send_confirmation_email", new_callable=AsyncMock) as send, \
         patch("routers.alerts.delete_subscriber_by_token", new_callable=AsyncMock) as d:
        r1 = await client.post("/api/alerts/subscribe", json={"email": VALID_EMAIL, "codes": VALID_CODES})
        r2 = await client.post("/api/alerts/confirm", json={"token": TOKEN})
        r3 = await client.post("/api/alerts/unsubscribe", json={"token": TOKEN})
    assert r1.status_code == 503
    assert r2.status_code == 503
    assert r3.status_code == 200  # leaving must always work
    send.assert_not_awaited()
    d.assert_awaited_once()
