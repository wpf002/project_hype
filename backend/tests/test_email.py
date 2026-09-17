"""Email payloads — unsubscribe paths and link targets."""

import services.email_service as es

TOKEN = "u" * 43


def test_alert_has_one_click_unsubscribe_headers():
    p = es.build_catalyst_payload("a@example.com", TOKEN, "IQD", {"name": "Iraqi Dinar"}, 40, 60)
    assert p["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert f"token={TOKEN}" in p["headers"]["List-Unsubscribe"]
    assert p["headers"]["List-Unsubscribe"].startswith("<https://") or "localhost" in p["headers"]["List-Unsubscribe"]


def test_alert_body_links_to_unsubscribe_page():
    p = es.build_catalyst_payload("a@example.com", TOKEN, "IQD", {"name": "Iraqi Dinar"}, 40, 60)
    html = next(c["value"] for c in p["content"] if c["type"] == "text/html")
    text = next(c["value"] for c in p["content"] if c["type"] == "text/plain")
    assert f"/app?unsubscribe={TOKEN}" in html
    assert f"/app?unsubscribe={TOKEN}" in text


def test_confirmation_links_to_frontend_not_a_state_changing_get():
    p = es.build_confirmation_payload("a@example.com", ["IQD"], TOKEN)
    html = next(c["value"] for c in p["content"] if c["type"] == "text/html")
    assert f"{es.APP_URL}/app?confirm={TOKEN}" in html
    assert "/api/alerts/confirm" not in html


def test_click_tracking_disabled_so_token_links_are_not_rewritten():
    p = es.build_confirmation_payload("a@example.com", ["IQD"], TOKEN)
    assert p["tracking_settings"]["click_tracking"]["enable"] is False


def test_plain_text_part_comes_first():
    p = es.build_confirmation_payload("a@example.com", ["IQD"], TOKEN)
    assert [c["type"] for c in p["content"]] == ["text/plain", "text/html"]


def test_mask_email():
    assert es.mask_email("investor@example.com") == "i***@example.com"
