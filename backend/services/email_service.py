"""
Email alert service using SendGrid API via httpx.

If SENDGRID_API_KEY is not set, alerts are logged to stdout (dev mode).
FROM_EMAIL defaults to alerts@projecthype.io — configure a verified
sender in your SendGrid account or override via env var.
"""

import os
import logging
import httpx

logger = logging.getLogger(__name__)

SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY", "")
FROM_EMAIL = os.getenv("ALERT_FROM_EMAIL", "alerts@projecthype.io")
FROM_NAME = "Project Hype"
APP_URL = os.getenv("APP_URL", "https://frontend-production-f60f1.up.railway.app")

SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send"


def _build_html(code: str, currency: dict, old_score: float, new_score: float) -> str:
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
                <a href="{APP_URL}" style="color:#5a5a8a;">Manage alerts at projecthype.io</a>
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


async def send_catalyst_alert(
    email: str,
    code: str,
    currency: dict,
    old_score: float,
    new_score: float,
) -> None:
    """
    Send a Catalyst Score spike alert email via SendGrid.
    Falls back to console logging if SENDGRID_API_KEY is not configured.
    """
    delta = round(new_score - old_score)
    subject = f"⚡ {code} Catalyst Score +{delta} pts — Project Hype Alert"
    html = _build_html(code, currency, old_score, new_score)

    if not SENDGRID_API_KEY:
        logger.info(
            "[DEV] Email alert (no SENDGRID_API_KEY): to=%s subject=%s",
            email, subject,
        )
        return

    payload = {
        "personalizations": [{"to": [{"email": email}]}],
        "from": {"email": FROM_EMAIL, "name": FROM_NAME},
        "subject": subject,
        "content": [{"type": "text/html", "value": html}],
    }

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
            if resp.status_code not in (200, 202):
                logger.warning(
                    "SendGrid returned %s for %s: %s",
                    resp.status_code, email, resp.text,
                )
    except Exception:
        logger.exception("Failed to send alert to %s", email)
