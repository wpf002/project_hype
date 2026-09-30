# Security Audit — project_hype

Commit `13c3c40` · 2026-09-30 · read-only review of `backend/`, `frontend/`, deploy config and agent config.

## 1. Threat model

- No user accounts, no payments, no uploads, no PII beyond subscriber email addresses. Nothing here is worth stealing at scale.
- What's actually worth attacking: **availability** (a public dashboard that's down is the whole product), the **subscriber email list**, and the **paid API keys** (OXR, Anthropic, Resend, Alpha Vantage) via quota burn.
- Trust boundaries: anonymous internet → FastAPI (`/api/*`); third-party RSS/commodity feeds → scoring pipeline → Claude → public responses; owner → `/api/analytics/summary` via `X-Analytics-Token`.
- Every write endpoint is anonymous by design. The real controls are rate limits, per-address cooldowns, and emailed bearer tokens — not auth.
- Biggest structural weakness: the rate limiter is the only thing standing between the internet and a 20-connection DB pool, and two DB-touching endpoints are outside it.

## 2. Findings

### [MEDIUM] `/api/status` and `/api/portfolio/{id}` are unmetered and hold a pool connection

**What.** Every other route carries `@limiter.limit(...)`. These two don't. Both call `pool.acquire()`, the pool is `max_size=20` (`backend/db/db.py:48`), and no `acquire()` call anywhere passes a timeout — asyncpg's default is to wait indefinitely. `/api/status` is also Railway's `healthcheckPath`.

**Proof.**
- `backend/routers/rates.py:122` — `@router.get("/status")` with no limiter; body runs `await conn.fetchval("SELECT 1")` at `rates.py:132-135`.
- `backend/routers/portfolio.py:68` — `@router.get("/portfolio/{share_id}")` with no limiter; `get_shared_portfolio` acquires at `backend/db/db.py:637`.
- `backend/db/db.py:48` — `create_pool(dsn, min_size=2, max_size=20, ssl=db_ssl)`, no `timeout=`.
- `backend/railway.toml:6-8` — `healthcheckPath = "/api/status"`, `restartPolicyMaxRetries = 3`.

**Reach.** Anonymous, unauthenticated, one shell loop. `while true; do curl -s https://<api>/api/status & done` saturates the pool; subsequent `acquire()` calls block forever instead of erroring; `/api/status` stops responding; Railway's healthcheck times out; `ON_FAILURE` restarts, burns its 3 retries, and the deploy stays down. Every other endpoint that touches the DB stalls at the same time.

**Fix.**
```python
# backend/routers/rates.py
@router.get("/status")
@limiter.limit("30/minute")
async def get_status(request: Request):   # request param is required by slowapi

# backend/routers/portfolio.py
@router.get("/portfolio/{share_id}")
@limiter.limit("60/minute")
async def get_portfolio(request: Request, share_id: str):
```
And bound the wait so a saturated pool degrades instead of hanging — in `db.py`, `create_pool(..., timeout=5.0, command_timeout=10.0)`, or pass `pool.acquire(timeout=5)` at each call site. Also cap `share_id` length (`share_id: str = Path(max_length=32)`); it's currently unbounded.

**Effort.** ~30 min.

---

### [MEDIUM] Rate-limit keys and analytics visitor hashes disagree about which IP to trust

**What.** Two different notions of "the client" coexist, and at most one of them can be right.

- `backend/rate_limit.py:20` uses `key_func=get_remote_address`, which is `request.client.host` only. Uvicorn rewrites that from `X-Forwarded-For` **only** when the socket peer is inside `--forwarded-allow-ips`, which defaults to `127.0.0.1` (`backend/Dockerfile:34`, `backend/.env.example` `FORWARDED_ALLOW_IPS=127.0.0.1`).
- `backend/routers/analytics.py:76-81` reads the raw `x-forwarded-for` header directly, bypassing uvicorn's trust check entirely.

**Proof.**
- `backend/rate_limit.py:20` — `Limiter(key_func=get_remote_address, ...)`
- `backend/routers/analytics.py:78-80` — `fwd = request.headers.get("x-forwarded-for", ""); if fwd: return fwd.split(",")[0].strip()`
- `backend/Dockerfile:34` — `--forwarded-allow-ips=${FORWARDED_ALLOW_IPS:-127.0.0.1}`
- `backend/.env.example` — comment says "Railway: ... or leave as default and let Railway's edge set the real client IP at the socket level"

**Reach.** Two cases, both real, depending on the deployed value of `FORWARDED_ALLOW_IPS`:

1. **Default `127.0.0.1` (most likely on Railway).** Railway's edge proxy is not `127.0.0.1`, so uvicorn refuses the header and `request.client.host` is the proxy's address. Every visitor on the internet then shares **one** rate-limit bucket: one client doing 5 `POST /api/alerts/subscribe` calls exhausts the 5/min limit for all real users. Meanwhile `_visitor_hash` still reads the untrusted header, so any caller can set `X-Forwarded-For: <random>` per request and mint unlimited distinct `visitor_hash` values — visitor counts in `/api/analytics/summary` become attacker-controlled.
2. **`FORWARDED_ALLOW_IPS=*`.** Rate limits become fully bypassable: rotate `X-Forwarded-For` per request and every limit in the app (including `5/minute` on subscribe and `10/minute` on portfolio share) is gone.

**Fix.** Pin `FORWARDED_ALLOW_IPS` to Railway's proxy CIDR (never `*`), then make both consumers use the single trusted value that uvicorn produced:

```python
# backend/routers/analytics.py — delete the header read
def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"
```

Verify with `curl -H 'X-Forwarded-For: 1.2.3.4' https://<api>/api/status` and confirm the logged peer is the proxy, not `1.2.3.4`.

**Effort.** ~1 h including the Railway variable change and a verification curl.

---

### [LOW] No Pydantic model rejects unknown fields

**What.** Confirms the scanner. Zero `model_config = ConfigDict(extra="forbid")` and zero `extra=` anywhere in `backend/` — a grep for `ConfigDict|model_config|extra=` across all `.py` returns nothing. Every request model silently discards fields it doesn't declare.

**Proof.** `backend/routers/portfolio.py:42` (`ShareRequest`), `backend/routers/roi.py:36` (`ROIRequest`), `backend/routers/alerts.py:65,70` (`SubscribeRequest`, `TokenRequest`), `backend/routers/analytics.py:132` (`EventPayload`) — all plain `BaseModel`.

**Reach.** Low today: nothing spreads a request body into a query (every insert names its columns explicitly, e.g. `portfolio.py:63` builds `{"code": ..., "amount": ...}` by hand), so extra fields go nowhere. The risk is forward-looking — the day a field is added to a model, a typo'd client field fails open instead of loud.

**Fix.** On each request model:
```python
from pydantic import BaseModel, ConfigDict

class ShareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    positions: List[Position]
```
`Position` needs it too, or `{"code": "IQD", "amount": 1, "amuont": 5}` still passes.

**Effort.** ~20 min plus a test run (`test_security.py` may need new cases).

---

### [LOW] `.env*` variants outside the listed names aren't gitignored, and there's no gitleaks hook

**What.** Confirms `t1-env`. `.gitignore` enumerates specific paths rather than a pattern.

**Proof.** `.gitignore:15-19` lists `.env`, `backend/.env`, `frontend/.env.local`, `frontend/.env*.local`, `*.env.local`. A file named `backend/.env.production`, `backend/.env.railway`, or `.env.local` at the repo root is **not** matched and would be staged by `git add .`. No `.pre-commit-config.yaml` and no `.husky/` exist.

**Reach.** Requires an owner mistake, but this repo is public and holds live keys for four paid APIs, so the blast radius of one mistake is the whole key set.

**Fix.** In `.gitignore`:
```
.env
.env.*
!.env.example
**/.env
**/.env.*
!**/.env.example
```
Then add a hook:
```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.28.0
    hooks: [{ id: gitleaks }]
```

**Effort.** ~15 min.

---

### [LOW] `shared_portfolios` is the only table with no retention prune

**What.** Every other table bounds itself — `rate_snapshots` 7 days (`db.py:246-248`), `hype_snapshots`/`catalyst_snapshots` 30 days (`db.py:380-382`, `519-521`), `signals` 90 days (`db.py:767-769`), `analytics_events` 180 days (`db.py:841-863`), `claude_sentiment_cache` 30 days (`db.py:608-610`), `alert_confirmations` on expiry (`db.py:656`). `shared_portfolios` has an `INSERT` (`db.py:627`) and a `SELECT` (`db.py:638`) and no `DELETE` at all.

**Reach.** `POST /api/portfolio/share` at 10/min with 50 positions per row is ~7.2 k rows/day from a single key, forever. Combined with the rate-limit finding above, the write rate is either globally capped (harmless) or uncapped (unbounded). Disk growth, not compromise.

**Fix.** Add a prune and call it from `_analytics_prune_loop` in `main.py:68`:
```python
async def prune_shared_portfolios(days: int = 365) -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    ...  # DELETE FROM shared_portfolios WHERE created_at < $1
```
Needs an index on `created_at` to stay cheap.

**Effort.** ~30 min. Confirm a share link expiring after a year is acceptable product behaviour first.

---

### [LOW] `unsub_token` is stored in plaintext while the confirmation token is hashed

**What.** Inconsistent handling of the two emailed bearer credentials. `alert_confirmations` stores only `sha256(token)` and the comment at `db.py:140-141` is explicit that "a database read alone cannot confirm anyone". `subscribers.unsub_token` stores the raw value.

**Proof.** `backend/routers/alerts.py:88` passes `_hash(token)` for confirmations; `alerts.py:108` passes `secrets.token_urlsafe(32)` raw. `backend/db/db.py:712-721` — `DELETE FROM subscribers WHERE unsub_token = $1` compares plaintext.

**Reach.** Needs read access to the `subscribers` table, which already exposes the email addresses themselves — so the marginal gain to an attacker is only the ability to unsubscribe people. Genuinely low; listed because the stated design intent isn't applied uniformly.

**Fix.** Store `sha256(unsub_token)` in the column and hash the inbound token in `delete_subscriber_by_token`, matching `consume_alert_confirmation`. Needs a one-off migration (or accept that existing tokens stop working and re-issue on the next alert).

**Effort.** ~45 min including migration.

---

### [LOW] The public root response advertises `/api/analytics/summary`

**What.** `analytics.py:164` states the reason the summary returns 404 instead of 401: "so the endpoint's existence isn't advertised to scanners." `main.py:193` then lists `GET /api/analytics/summary` in the unauthenticated `/` response.

**Proof.** `backend/main.py:193` vs `backend/routers/analytics.py:164-173`.

**Reach.** Information disclosure only. The `secrets.compare_digest` check at `analytics.py:172` is sound and the token isn't guessable; this just negates the obfuscation the code went out of its way to add.

**Fix.** Drop that line from the `endpoints` list in `main.py`, or drop the whole enumeration — it duplicates `/docs`, which is already disabled in production.

**Effort.** 2 min.

---

### [LOW] CSP has no `form-action`

**What.** `frontend/nginx-security-headers.conf:16` sets a tight policy — `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`. `form-action` is absent, so it falls back to unrestricted.

**Reach.** Very low. The app renders no `<form>` elements. This is defence-in-depth against a future injected form.

**Fix.** Append `form-action 'self';` to the policy string. Note the file's own warning: any nginx `location` block with its own `add_header` must `include` this file or it loses all of these headers.

**Effort.** 2 min.

---

## 3. Checklist

| Item | Verdict | Evidence |
|---|---|---|
| `t1-auth` | **PASS** | All 7 unauthenticated mutations verified as intentional. Token-gated: `alerts.py:99` (hashed single-use confirmation), `alerts.py:112`, `alerts.py:122`. Cooldown-gated: `alerts.py:86` `recent_confirmation_exists`. Anonymous by design: `analytics.py:137`, `portfolio.py:51`. Stateless: `roi.py:69`. The one non-public route is gated — `analytics.py:172` `secrets.compare_digest`. The 9 GETs return market data with no owner. |
| `t1-idor` | **N/A** | No accounts. The only lookup-by-id is `db.py:638` `WHERE id = $1`, and `share_id` is a 64-bit capability (`db.py:623` `token_urlsafe(8)`) with no owner to scope to. |
| `t1-admin` | **N/A** | No roles. |
| `t1-mass-assign` | **PASS** | Spot-checked. `portfolio.py:63` builds dicts field by field; `analytics.py:106-125` whitelists scalar types and coerces everything else; no `**body` or dict-spread into a query anywhere. |
| `t1-bundle` | **PASS** | Spot-checked. Only `import.meta.env.VITE_API_URL` is referenced, in `App.jsx:12`, `Landing.jsx:4`, `analytics.js:10`. `ANALYTICS_TOKEN` is server-side only (`analytics.py:66`). |
| `t1-git-secrets` | **UNVERIFIED** | Current tree is clean. History not scanned — no network/command access in this audit. See manual actions. |
| `t1-env` | **FAIL** | Confirmed. `.gitignore:15-19` enumerates names instead of `.env.*`; no pre-commit or husky hook present. |
| `t1-spend` | MANUAL | 4 paid APIs: `ANTHROPIC_API_KEY`, `OXR_APP_ID`, `RESEND_API_KEY`, `ALPHA_VANTAGE_KEY`. |
| `t1-stripe` | **N/A** | Stripe not used. |
| `t2-provider` | **N/A** | No accounts, no passwords, no sessions. |
| `t2-tokens` | **N/A** | No sessions. The emailed tokens are the only credentials: confirmation has a 24 h TTL (`db.py:648`) and is single-use via `DELETE ... RETURNING` (`db.py:685-689`); `unsub_token` is intentionally permanent because mail clients must be able to POST it at any time. |
| `t2-ratelimit` | **FAIL** | Overturns the scanner's PASS. `slowapi` is present and correctly applied to 12 routes, but `rates.py:122` and `portfolio.py:68` are unmetered and both hold a pool connection, and `rate_limit.py:20`'s `get_remote_address` key is proxy-blind. See findings 1 and 2. |
| `t2-validation` | **FAIL** | Confirmed. No `ConfigDict(extra="forbid")` or `extra=` in any `.py` under `backend/`. |
| `t2-ssrf` | **PASS** | Spot-checked. Every outbound URL is a module constant; the only interpolated one is `commodity_service.py:204` with a hardcoded symbol table. No user input reaches an httpx call. Caveat under Hypotheses. |
| `t2-agents` | **PASS** | Well built. No tool use, no shell, no SQL access from the model. Untrusted headlines truncated to 500 chars and XML-fenced (`hype_service.py:227-231`), marked untrusted in both the user prompt (`:236-238`) and the system prompt (`:266-267`). Output clamped to `[-1, 1]` (`hype_service.py:339`) and only `float` scores are consumed. Model pinned to `claude-haiku-4-5-20251001`. Failure returns `([], "")` → keyword fallback. |
| `t2-prodcreds` | MANUAL | See `t3-agentcfg` and manual actions. |
| `t2-storage` | **N/A** | No uploads or object storage. |
| `t2-xss` | **PASS** | No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function` in `frontend/src`. Caveat on feed-supplied `href` under Hypotheses. |
| `t2-csrf` | **N/A** | No cookies are set or read. `main.py:156` `allow_credentials=True` is unnecessary but harmless with the explicit origin allowlist. |
| `t2-errors` | **PASS** | `main.py:124-130` logs the traceback server-side and returns a fixed `{"detail": "Internal server error."}`. No `str(exc)` or `err.message` in any response body. `rate_limit_handler` (`main.py:112`) is equally generic. |
| `t2-debug` | **PASS** | `main.py:103-105` sets `docs_url`/`redoc_url`/`openapi_url` to `None` when `APP_ENV=production`. No debug routes. Minor disclosure at `main.py:193` — see findings. |
| `t2-staging` | MANUAL | Per-environment variables are outside the repo. |
| `t3-lockfile` | **PASS** | `backend/requirements.txt` is hash-pinned via `pip-compile --generate-hashes`; the Dockerfile installs with `--require-hashes` (`Dockerfile:20`) and CI re-derives the lockfile and diffs it (`ci.yml`). `frontend/package-lock.json` installed with `npm ci`. |
| `t3-depscan` | **PASS** | `.github/dependabot.yml` plus three CI gates: `pip-audit --severity high`, `npm audit --audit-level=high`, and a Trivy image scan with `exit-code: 1` on HIGH/CRITICAL. |
| `t3-realdeps` | **UNVERIFIED** | All 41 names are correctly spelled real packages (`fastapi`, `starlette`, `pydantic`, `asyncpg`, `slowapi`, `anthropic`, `httpx`, `uvicorn` and their transitive deps) and every one is SHA-256 pinned, which rules out substitution. CVE status not checked — no network access here; CI's `pip-audit` covers it on every push. |
| `t3-agentcfg` | **FAIL** | `.claude/launch.json` (the only tracked file) is benign — `npm run dev`. `.claude/settings.local.json` is **not** committed (globally ignored via `~/.config/git/ignore`), but its allowlist grants an agent `Bash(railway variables *)`, `Bash(railway up *)`, `Bash(python3 -c ' *)`, `Bash(pip3 install *)`, `Bash(npm install *)`, `Bash(git push *)` and `Read(//Users/willfoti/**)`. That is: read every production secret, deploy, run arbitrary Python, and read the entire home directory including `~/.ssh` and `~/.aws`. |
| `t3-headers` | **PASS** | `frontend/nginx-security-headers.conf:16` — HSTS 1 y with `includeSubDomains`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, and a CSP with no `unsafe-inline` on `script-src`. `connect-src` names the backend host exactly rather than `*.up.railway.app`. `form-action` missing — see findings. |
| `t3-cors` | **PASS** | `main.py:138-160`. Explicit comma-separated allowlist, `"*"` filtered out at `:149`, methods and headers both enumerated, and startup raises in production if `ALLOWED_ORIGINS` is unset (`:143`) or empty after filtering (`:152`). |
| `t3-rawsql` | **PASS** | Spot-checked every query in `db.py`. All parameterised with `$1`-style placeholders; the only string-built SQL is static DDL in `init_db`. `code.upper()` values are passed as parameters, never concatenated. `test_security.py:90,165,170,175` assert SQL metacharacters in `code` are rejected. |
| `t3-rls` | **N/A** | No client-side DB access; the frontend only calls `/api/*`. |
| `t3-logs` | **PASS** | Emails masked via `mask_email` (`email_service.py:150-155`) at every log site. No log statement emits an API key, token, cookie, or auth header. `email_service.py:254-255` deliberately logs Resend's status code and never `resp.text`. Raw IPs are hashed before storage (`analytics.py:84-92`) and never logged. |
| `t3-auditlog` | **N/A** | No accounts, permissions, or payments to audit. |
| `t3-backups` | MANUAL | Railway Postgres settings are outside the repo. |

## 4. Hypotheses (unproven)

- **SSRF via a redirecting upstream feed.** All five httpx clients set `follow_redirects=True` (`news_service.py:426`, `signal_service.py:114`, `commodity_service.py:349`, `exotic_rates_service.py:69,130`) with no `allowed_hosts` check on the hop target. If an institutional feed were compromised or DNS-hijacked, it could 302 the fetcher to a link-local metadata address, and for `signal_service` the response text is parsed and persisted (`db.py:762`) and then served publicly at `GET /api/signals/{code}`. Unproven: requires control of a hardcoded trusted domain, and Railway's metadata surface wasn't tested. Cheap hardening: `follow_redirects=False`, or re-validate the final `resp.url` host against the expected domain.
- **`javascript:` href from a feed.** `App.jsx:2318` and `App.jsx:2479` render `h.url` and `sig.url` — both third-party RSS values — straight into `href` with no scheme allowlist. React 18.3 (`frontend/package.json`) warns on `javascript:` URLs but still renders them. Not exploitable as deployed: the CSP's `script-src 'self'` with no `'unsafe-inline'` blocks `javascript:` navigation. Unproven because it depends on the CSP being served on every route (see the `add_header` inheritance warning in `nginx-security-headers.conf:4-7`). Cheap hardening: `const safe = /^https?:\/\//.test(url) ? url : "#"`.
- **Log injection via model output.** `hype_service.py:206` logs `sample_reasoning`, which Claude generates from untrusted headlines. A headline that induced newlines in the reasoning string could forge log lines. Unproven and unlikely — the output is constrained to one sentence of JSON and Railway's log viewer isn't parsed by anything downstream.

## 5. Manual actions for the owner

| Action | Why |
|---|---|
| Run `npx gitleaks detect --log-opts="--all"` | The repo is public and history was never scanned. This is the only `t1-*` item still UNVERIFIED. |
| Set a monthly spend cap on all four paid APIs: Anthropic, Open Exchange Rates, Resend, Alpha Vantage | `t1-spend`. Anthropic calls are triggered by a 12 h background sweep, not by requests, so runaway cost would come from a leaked key, not traffic. |
| Check the deployed value of `FORWARDED_ALLOW_IPS` on Railway and pin it to the proxy CIDR — never `*` | Decides which half of finding 2 you're currently living with. |
| Confirm `DB_SSL=require` is set on Railway | `db.py:47` defaults to `prefer`, which silently accepts a cleartext connection. |
| Confirm `ANALYTICS_SALT` and `ANALYTICS_TOKEN` are set in production | Without the salt, `analytics.py:56` mints a random per-process one and visitor counts reset on every restart. Without the token, `/analytics/summary` returns 404 and you lose the dashboard. |
| Confirm `ALLOWED_ORIGINS` matches the live frontend, and that `connect-src` in `nginx-security-headers.conf:16` still names the right backend host | The header hardcodes `backend-production-6057.up.railway.app`; the frontend now serves from `projecthype.io`. If the API moved to a custom domain, the CSP silently breaks every fetch. |
| Enable MFA on Railway, Cloudflare, Resend and the Anthropic console | Those accounts hold every secret in `.env.example`. |
| Turn on Railway Postgres backups and write down the restore steps | `t3-backups`. |
| Trim `.claude/settings.local.json` — drop `Bash(railway variables *)`, `Bash(railway up *)`, `Bash(python3 -c ' *)`, and narrow `Read(//Users/willfoti/**)` to the repo | `t3-agentcfg`. Production secrets and your whole home directory are currently one agent turn away. |
| Confirm preview/staging environments don't share the prod `DATABASE_URL` or API keys | `t2-staging`. |

## 6. Close

**What an attacker gets today.** No data. No accounts, no payments, nothing to exfiltrate beyond a subscriber email list that needs DB access to reach. What they get is the ability to take the site offline: an unauthenticated flood of `/api/status` exhausts the 20-connection pool with no acquire timeout, and `/api/status` is Railway's healthcheck, so the restart policy finishes the job.

**Highest-value fix.** Add `@limiter.limit` to `/api/status` and `/api/portfolio/{id}` and pass a `timeout` to `pool.acquire()`. That's roughly 30 minutes and it closes the only path to real impact.

**Shippable as-is?** Yes, with that one fix. There are no Critical or High findings, no injection, no auth bypass, and no secret exposure. The remaining items are hardening and hygiene that can land after launch.

## 7. What's well built

- **The alerts flow is the strongest code here.** Double opt-in with the confirmation token stored only as SHA-256 (`db.py:140-150`), single-use redemption via `DELETE ... RETURNING` in one statement (`db.py:685-689`), a 24 h TTL, a 10-minute per-address resend cooldown so the endpoint can't flood an inbox, identical responses whether or not an address exists (`alerts.py:95`), no oracle on unsubscribe (`alerts.py:118`), and RFC 8058 one-click as a POST because mail scanners fetch GET links. Each of those is a mistake someone else has already made.
- **Untrusted model input handled properly.** `hype_service.py:224-231` truncates and XML-fences every headline, labels it untrusted in both the user and system prompt, clamps the returned scores to `[-1, 1]`, and falls back to keyword scoring on any failure. No tools, no shell, no DB access from the model.
- **Supply chain.** `--require-hashes` in the Dockerfile, a CI step that re-derives the lockfile and diffs it, `pip-audit`, `npm audit`, and a Trivy image scan that fails the build. Most projects this size have none of this.
- **Fail-fast production config.** `main.py:143` and `:152` refuse to start if CORS is misconfigured rather than falling back to a dev default that would mask the problem. `analytics.py:52-61` takes the opposite tradeoff deliberately and says why.
- **Retention is treated as a design property,** with an explicit window on six of seven tables and a comment explaining each choice.
- **Error handling and logging.** One generic 500 handler, emails masked everywhere, Resend's response body deliberately never logged, IPs hashed with a daily-rotating salt and never written raw.
- **Container hygiene.** Non-root `app` user, `PYTHONDONTWRITEBYTECODE`, and `docker-compose.yml` binds every port to `127.0.0.1` with a banner saying the credentials are throwaway.
- **The comments explain decisions, not syntax** — `main.py:53-61` on why the snapshot loop sleeps last, `db.py:199-205` on why the sentiment cache is a table, `nginx-security-headers.conf:4-7` on nginx's `add_header` inheritance trap. That's the kind of context that keeps a fix from being undone six months later.
