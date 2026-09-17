"""
Email alert service using SendGrid API via httpx.

If SENDGRID_API_KEY is not set, emails are logged instead of sent (dev mode).
FROM_EMAIL defaults to alerts@projecthype.io, which requires the projecthype.io
domain to be authenticated in SendGrid (SPF/DKIM CNAMEs in Cloudflare DNS).

Two message types:
  confirmation  sent on signup; the subscription only takes effect after the
                recipient clicks the link (double opt-in)
  catalyst      the alert itself; carries a per-subscriber unsubscribe token in
                the footer and in RFC 8058 one-click List-Unsubscribe headers

Links point at the frontend (/app?confirm=… and /app?unsubscribe=…), which
POSTs the token to the API. Email security scanners routinely fetch every link
in a message; a GET that changed state would confirm or unsubscribe people
without their involvement.
"""

import os
import logging
from typing import List

import httpx

logger = logging.getLogger(__name__)

SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY", "")
# Master switch for the alerts feature. Off by default: signups, confirmations
# and alert sends are refused/skipped, and the UI hides alert entry points
# (read via GET /api/status). Unsubscribe always works regardless.
ALERTS_ENABLED = os.getenv("ALERTS_ENABLED", "false").strip().lower() == "true"
FROM_EMAIL = os.getenv("ALERT_FROM_EMAIL", "alerts@projecthype.io")
FROM_NAME = "Project Hype"
APP_URL = os.getenv("APP_URL", "https://projecthype.io").rstrip("/")
# Public API origin for the one-click unsubscribe endpoint, which mail providers
# POST to directly. Railway injects RAILWAY_PUBLIC_DOMAIN for the service.
API_PUBLIC_URL = (
    os.getenv("API_PUBLIC_URL")
    or (f"https://{os.environ['RAILWAY_PUBLIC_DOMAIN']}" if os.getenv("RAILWAY_PUBLIC_DOMAIN") else "")
    or "http://localhost:8000"
).rstrip("/")

SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send"


def _build_html(code: str, currency: dict, old_score: float, new_score: float, unsubscribe_url: str) -> str:
    delta = round(new_score - old_score)
    flag = currency.get("flag", "")
    name = currency.get("name", code)
    story = currency.get("story", "")
    color = "#00b4ff" if new_score >= 70 else "#ffa500" if new_score >= 40 else "#9b59b6"

    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Project Hype Alert</title>
</head>
<body style="margin:0;padding:0;background:#070714;font-family:'Segoe UI',Arial,sans-serif;color:#e8e8ff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#070714;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0d0d1a,#111128);border:1px solid #1e1e3f;border-radius:16px 16px 0 0;padding:28px 32px;">
              <div style="font-size:11px;color:#5a5a8a;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px;">PROJECT HYPE ALERT</div>
              <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:1px;">
                ⚡ Catalyst Score Spike
              </div>
            </td>
          </tr>

          <!-- Currency card -->
          <tr>
            <td style="background:#0d0d1a;border-left:1px solid #1e1e3f;border-right:1px solid #1e1e3f;padding:28px 32px;">

              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#070714;border:1px solid {color}33;border-left:3px solid {color};border-radius:10px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <div style="font-size:28px;margin-bottom:6px;">{flag}</div>
                    <div style="font-family:'Courier New',monospace;font-weight:700;font-size:20px;color:{color};">{code}</div>
                    <div style="font-size:13px;color:#9999cc;margin-bottom:16px;">{name}</div>
                    <div style="font-size:11px;color:#5a5a8a;">{story}</div>
                  </td>
                  <td style="padding:20px 24px;text-align:right;vertical-align:top;">
                    <div style="font-size:10px;color:#5a5a8a;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">CATALYST SCORE</div>
                    <div style="font-family:'Courier New',monospace;font-size:40px;font-weight:700;color:{color};line-height:1;">{round(new_score)}</div>
                    <div style="font-size:13px;color:#00d4aa;font-weight:700;margin-top:4px;">+{delta} pts ↑</div>
                    <div style="font-size:11px;color:#5a5a8a;margin-top:4px;">was {round(old_score)}</div>
                  </td>
                </tr>
              </table>

              <div style="font-size:13px;color:#7a7aaa;line-height:1.7;margin-bottom:24px;">
                The Catalyst Score for <strong style="color:#e8e8ff;">{code}</strong> jumped
                <strong style="color:{color};">+{delta} points</strong> in the latest 12-hour scoring run,
                crossing a significant threshold. This indicates a spike in bullish news sentiment
                and/or rate momentum.
              </div>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="{APP_URL}" style="display:inline-block;padding:14px 32px;
                       background:linear-gradient(135deg,#1e1e4f,#252560);
                       color:#e8e8ff;text-decoration:none;border-radius:10px;
                       font-weight:700;font-size:14px;letter-spacing:1px;
                       border:1px solid #3a3a7a;">
                      VIEW IN PROJECT HYPE →
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#0a0a1a;border:1px solid #1e1e3f;border-top:none;
               border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;">
              <div style="font-size:11px;color:#3a3a5a;line-height:1.6;">
                You subscribed to Catalyst Score alerts for {code}.<br>
                <a href="{unsubscribe_url}" style="color:#5a5a8a;">Unsubscribe</a>
                &nbsp;·&nbsp;
                Not investment advice. Do your own research.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def mask_email(email: str) -> str:
    """Return a privacy-safe log representation: user → u***@domain."""
    if "@" not in email:
        return "***"
    local, domain = email.split("@", 1)
    return f"{local[0]}***@{domain}" if local else f"***@{domain}"


_mask_email = mask_email  # backwards-compatible alias


def confirm_url(token: str) -> str:
    return f"{APP_URL}/app?confirm={token}"


def unsubscribe_page_url(unsub_token: str) -> str:
    return f"{APP_URL}/app?unsubscribe={unsub_token}"


def one_click_unsubscribe_url(unsub_token: str) -> str:
    return f"{API_PUBLIC_URL}/api/alerts/unsubscribe/one-click?token={unsub_token}"


def _base_payload(email: str, subject: str, html: str, text: str) -> dict:
    return {
        "personalizations": [{"to": [{"email": email}]}],
        "from": {"email": FROM_EMAIL, "name": FROM_NAME},
        "subject": subject,
        # text/plain must precede text/html (SendGrid requirement)
        "content": [
            {"type": "text/plain", "value": text},
            {"type": "text/html", "value": html},
        ],
        # Click tracking would rewrite the token links through sendgrid.net.
        "tracking_settings": {
            "click_tracking": {"enable": False, "enable_text": False},
            "open_tracking": {"enable": False},
        },
    }


def build_confirmation_payload(email: str, codes: List[str], token: str) -> dict:
    link = confirm_url(token)
    code_list = ", ".join(codes)
    subject = "Confirm your Project Hype alerts"
    text = (
        f"Confirm Catalyst Score alerts for: {code_list}\n\n"
        f"{link}\n\n"
        "This link expires in 24 hours. If you didn't request this, ignore this "
        "email and you won't hear from us again."
    )
    html = f"""<!DOCTYPE html><html><body style="margin:0;background:#070714;font-family:'Segoe UI',Arial,sans-serif;color:#e8e8ff;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px;">
<table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#0d0d1a;border:1px solid #1e1e3f;border-radius:16px;">
<tr><td style="padding:32px;">
<div style="font-size:11px;color:#5a5a8a;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px;">PROJECT HYPE</div>
<div style="font-size:20px;font-weight:800;color:#fff;margin-bottom:16px;">Confirm your alerts</div>
<div style="font-size:14px;color:#9999cc;line-height:1.7;margin-bottom:24px;">
You asked for Catalyst Score alerts for <strong style="color:#e8e8ff;">{code_list}</strong>.
Nothing is sent until you confirm.</div>
<a href="{link}" style="display:inline-block;padding:14px 32px;background:#1e1e4f;color:#e8e8ff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;border:1px solid #3a3a7a;">CONFIRM ALERTS</a>
<div style="font-size:12px;color:#5a5a8a;line-height:1.6;margin-top:24px;">
The link expires in 24 hours. If you didn't request this, ignore this email and you won't hear from us again.</div>
</td></tr></table></td></tr></table></body></html>"""
    return _base_payload(email, subject, html, text)


def build_catalyst_payload(
    email: str, unsub_token: str, code: str, currency: dict, old_score: float, new_score: float,
) -> dict:
    delta = round(new_score - old_score)
    subject = f"⚡ {code} Catalyst Score +{delta} pts — Project Hype Alert"
    unsub_page = unsubscribe_page_url(unsub_token)
    html = _build_html(code, currency, old_score, new_score, unsub_page)
    text = (
        f"{code} Catalyst Score jumped +{delta} points ({round(old_score)} → {round(new_score)}).\n\n"
        f"View: {APP_URL}/app\n\n"
        f"Unsubscribe: {unsub_page}\n"
        "Not investment advice. Do your own research."
    )
    payload = _base_payload(email, subject, html, text)
    # RFC 8058 one-click unsubscribe. Gmail and Yahoo require it for bulk senders.
    payload["headers"] = {
        "List-Unsubscribe": f"<{one_click_unsubscribe_url(unsub_token)}>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }
    return payload


async def _send(payload: dict, masked: str, kind: str) -> bool:
    """POST a payload to SendGrid. Returns True on acceptance (or in dev mode)."""
    if not SENDGRID_API_KEY:
        logger.info("[DEV] %s email (no SENDGRID_API_KEY): to=%s subject=%s",
                    kind, masked, payload["subject"])
        return True
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                SENDGRID_URL,
                json=payload,
                headers={
                    "Authorization": f"Bearer {SENDGRID_API_KEY}",
                    "Content-Type": "application/json",
                },
            )
        if resp.status_code in (200, 202):
            return True
        # Log status code only — never log resp.text (may echo back PII)
        logger.warning("SendGrid returned %s for %s email to %s", resp.status_code, kind, masked)
        return False
    except Exception:
        logger.exception("Failed to send %s email to %s", kind, masked)
        return False


async def send_confirmation_email(email: str, codes: List[str], token: str) -> bool:
    return await _send(build_confirmation_payload(email, codes, token), mask_email(email), "confirmation")


async def send_catalyst_alert(
    email: str,
    unsub_token: str,
    code: str,
    currency: dict,
    old_score: float,
    new_score: float,
) -> bool:
    """Send a Catalyst Score spike alert. Falls back to logging without SENDGRID_API_KEY."""
    payload = build_catalyst_payload(email, unsub_token, code, currency, old_score, new_score)
    return await _send(payload, mask_email(email), "catalyst")
