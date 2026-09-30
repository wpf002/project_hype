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
    assert f"/app?unsubscribe={TOKEN}" in p["html"]
    assert f"/app?unsubscribe={TOKEN}" in p["text"]


def test_confirmation_links_to_frontend_not_a_state_changing_get():
    p = es.build_confirmation_payload("a@example.com", ["IQD"], TOKEN)
    assert f"{es.APP_URL}/app?confirm={TOKEN}" in p["html"]
    assert "/api/alerts/confirm" not in p["html"]


def test_payload_uses_resend_shape():
    p = es.build_confirmation_payload("a@example.com", ["IQD"], TOKEN)
    assert p["to"] == ["a@example.com"]
    assert p["from"].endswith(f"<{es.FROM_EMAIL}>")
    assert p["html"] and p["text"]
    # SendGrid-only keys must not linger
    assert "personalizations" not in p and "content" not in p


def test_both_html_and_plain_text_are_sent():
    """A text part keeps the message out of spam filters that penalise HTML-only."""
    p = es.build_confirmation_payload("a@example.com", ["IQD"], TOKEN)
    assert TOKEN in p["text"] and TOKEN in p["html"]


def test_mask_email():
    assert es.mask_email("investor@example.com") == "i***@example.com"
