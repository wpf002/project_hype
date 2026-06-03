# Security Assessment & Code-Health Audit — Project Hype

**Repository:** `project_hype`
**Assessment date:** 2026-06-02 (second full pass; supersedes the 2026-05-29 pass)
**Scope:** Full codebase (backend + frontend + infra), READ-ONLY, findings only.
**Methodology:** Manual review of every entry point + a parallel multi-agent audit across six domains (access control, injection, secrets/data, infra/config, supply chain, code health), followed by adversarial re-verification of every High/Critical candidate against the live code.

> **Read-only pass.** Nothing was modified, refactored, or deleted. This report enumerates findings and recommended fixes; remediation decisions are left to the owner.
>
> **This is a re-run on byte-identical code** (last commit `042f262`, 2026-05-07; clean working tree). Differences from the first pass are therefore *analysis variance* + an *updated dependency-advisory database*, not new code. See [§0 Re-run delta](#0--re-run-delta-vs-first-pass).

---

## 0 · Re-run delta vs first pass

The code did not change between passes, so this section is the most useful output of the re-run.

**New findings this pass (not raised on 2026-05-29):**
| ID | Finding | Why it appeared now |
|----|---------|---------------------|
| M-8 | `@vitest/browser` CVE GHSA-2h32-95rg-cppp (CVSS 9.6, reflected XSS, **dev-only**) | npm advisory DB surfaced it since the last `npm audit`; first pass reported only postcss+ws moderates |
| L-4 | FX API keys embedded in request URLs (`fx_service.py:38,109`) — leak via logs | deeper read of the FX service |
| L-12 | Frontend lockfile stale — root `version 1.0.0` vs `package.json 1.3.0` | lockfile inspection |
| L-13 | Frontend `news/history/signals` fetches swallow non-2xx (`App.jsx:398-424`) | frontend error-handling review |
| L-15 | Router imports `START_TIME` from `main` — layering inversion (`rates.py:118`) | architecture review |
| L-16 | `get_change_24h` runs a full 24h table scan per `/rate/{code}` (`db.py:224`) | performance review |

**Severity shifts (same finding, different rating):**
| Finding | First pass | This pass | Note |
|---------|-----------|-----------|------|
| Alert subscribe/unsubscribe abuse | Low (verified) | **Medium** (verified) | verifier weighed sender-reputation/CAN-SPAM harm higher this time |
| Backend no-lockfile / floating deps | Low (verified) | **Medium** (verified) | both passes downgraded from analysis-High; landed one notch apart |
| No authentication on any endpoint | Medium | **Info** | this pass treated auth-less as intentional-by-design (per stored memory) |
| MOCK_HEADLINES duplicate keys | Low | **Medium** | reclassified as a data-correctness bug, not just dead code |
| nginx master runs as root | Low | **Medium** | |
| ROI accepts Inf/NaN | Low | **Medium** | reclassified as money-path correctness defect |

**Takeaway:** the two passes are consistent on *what* is wrong; they differ by roughly one severity notch on ~6 judgment calls, and the dependency-CVE picture legitimately changed (advisory DBs are live). Treat the union of both passes as the working list. **Still 0 Critical / 0 High after verification.**

---

## Executive Summary

Project Hype is a **FastAPI (Python 3.13) + React 18/Vite** application for speculative foreign-currency intelligence: FX rates, ROI modeling, portfolio sharing, email alerts, and news/sentiment via the Anthropic Claude API. Deployed on Railway behind Docker/nginx.

**Overall posture: solid for an unauthenticated public-data app.** Parameterized SQL everywhere (no SQLi), all outbound URLs hardcoded (no SSRF), React auto-escaping with no `dangerouslySetInnerHTML` (no XSS), no secrets in repo or git history, non-root backend container, explicit (non-wildcard) CORS, generic exception handler, real nginx CSP/security headers. Residual risk is a cluster of Mediums concentrated on the three state-changing endpoints (portfolio share, alert subscribe/unsubscribe), rate-limiting effectiveness, dependency pinning, and CI/ops maturity.

### Findings by severity (post-verification)

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Medium   | 11 |
| Low      | 16 |
| Info     | 5 |

> Two findings were rated **High** by the analysis pass and **both were downgraded to Medium** after adversarial verification (see [Appendix A](#appendix-a--adversarial-verification-log)). The `@vitest/browser` advisory carries an upstream **CVSS 9.6 (Critical)** score but is rated **Medium** here because it is a dev/test-only dependency never shipped to the browser bundle.

### Top 5 must-fix items

1. **[M-1] Harden the alert endpoints** — add double opt-in on subscribe, a signed unsubscribe token, and a rate limit + email validation on `DELETE /unsubscribe`. *(`backend/routers/alerts.py:24-46`)*
2. **[M-2] Make rate limiting effective** — uvicorn runs without `--proxy-headers`, so behind nginx/Railway `get_remote_address` resolves to the proxy IP and all clients share one bucket; also add limits to `/portfolio/share`, `/unsubscribe`, `/news`, and other unthrottled routes. *(`backend/Dockerfile:25`, `backend/rate_limit.py:20`)*
3. **[M-5] Disable public `/docs`, `/redoc`, `/openapi.json` in production.** *(`backend/main.py:71-76`)*
4. **[M-7/M-8] Pin & lock dependencies + add CVE scanning in CI** — backend has no lockfile and floating `>=` ranges; the frontend dev toolchain carries an unpatched CVSS-9.6 advisory; there is no CI at all. *(`backend/requirements.txt:1-7`, `frontend/package.json:22`, no `.github/`)*
5. **[M-4] Treat news headlines as untrusted in the Claude prompt** — fence/escape attacker-influenceable RSS text feeding sentiment → catalyst → alert emails. *(`backend/services/hype_service.py:150-166`)*

---

## Part 1 — Scope & Attack Surface

### Stack (verified from files)

| Layer | Technology | Evidence |
|-------|-----------|----------|
| Backend | FastAPI ≥0.111, uvicorn, asyncpg, httpx, anthropic SDK, slowapi | `backend/requirements.txt` |
| Runtime | Python 3.13-slim (Docker), non-root user | `backend/Dockerfile` |
| Database | PostgreSQL 16 (asyncpg pool) | `docker-compose.yml`, `backend/db/db.py` |
| Frontend | React 18.3 + Vite 6, served by nginx 1.27-alpine | `frontend/package.json`, `frontend/Dockerfile` |
| Deploy | Railway (Dockerfile builder) | `*/railway.toml` |

### 1.1 Entry points (HTTP — all under `/api`, all unauthenticated)

| Method | Route | Handler | Rate limit | Notes |
|--------|-------|---------|-----------|-------|
| GET | `/api/rates` | `rates.py:43` | 60/min | public market data |
| GET | `/api/rate/{code}` | `rates.py:77` | **none** | allowlist-validated; full 24h scan per call (L-16) |
| GET | `/api/status` | `rates.py:114` | none | version/uptime/db-status |
| POST | `/api/roi` | `roi.py:65` | 30/min | money math; accepts Inf/NaN (M-9) |
| GET | `/api/news/{code}` | `news.py:20` | **none** | triggers outbound RSS fetch |
| GET | `/api/history/{code}` | `history.py:19` | none | `limit` bounded 1–672 |
| GET | `/api/hype/{code}` | `hype.py:20` | none | `limit` bounded 1–720 |
| **POST** | `/api/portfolio/share` | `portfolio.py:30` | **none** | unauthenticated write, unvalidated (L-1) |
| GET | `/api/portfolio/{id}` | `portfolio.py:40` | none | world-readable by 48-bit ID, no expiry |
| **POST** | `/api/alerts/subscribe` | `alerts.py:24` | 5/min | no double opt-in (M-1) |
| **DELETE** | `/api/alerts/unsubscribe` | `alerts.py:42` | **none** | deletes by raw email, no token/validation (M-1) |
| GET | `/api/signals/{code}` | `signals.py:28` | none | |
| GET | `/`, `/docs`, `/redoc`, `/openapi.json` | FastAPI | none | full surface disclosure (M-5) |

**Background workers** (`backend/main.py:27-67`): `_hype_engine_loop` (12h, scores + fires alert emails), `_signal_polling_loop` (4h), `_rate_snapshot_loop` (1h). No WebSocket/SSE, queues, CLI, webhooks, or MCP exposure.

### 1.2 Sensitive data flows

| Data | Class | Enters | Stored | Exits |
|------|-------|--------|--------|-------|
| Subscriber email | PII | `POST /alerts/subscribe` | `subscribers`, plaintext, no retention | SendGrid `to`, logs |
| Portfolio positions | Mild financial | `POST /portfolio/share` | `shared_portfolios` (JSON), no expiry | `GET /portfolio/{id}` (public by ID) |
| API keys (OXR/FX/Anthropic/SendGrid) | Credentials | env only | not persisted | outbound headers; **FX key in URL (L-4)** |
| `DATABASE_URL` | Credentials | env | not persisted | asyncpg (`ssl="prefer"` — M-4/S) |

No payment-card data, no passwords, no auth tokens, no real money movement.

### 1.3 Third-party / outbound (all hardcoded hosts — no user-controlled URLs)
OXR, ExchangeRate-API, Anthropic Claude, SendGrid, and scrapers/RSS (bonbast, DolarToday, lirarate, CBM, GDELT, IMF/OFAC/BIS). Plausible analytics on the frontend.

### 1.4 SBOM (unchanged from first pass; dep-advisory state changed)

**Backend (`requirements.txt`) — runtime, all floating `>=`, NO lockfile:** `fastapi>=0.111.0`, `uvicorn>=0.29.0`, `httpx>=0.27.0`, `python-dotenv>=1.0.1`, `asyncpg>=0.29.0`, `anthropic>=0.30.0`, `slowapi>=0.1.9`. Dev: `pytest>=8.0`, `pytest-asyncio>=0.23`, `httpx>=0.27.0`.

**Frontend (`package.json`) — lockfile committed but STALE (root `1.0.0` ≠ manifest `1.3.0`, L-12):** runtime `react ^18.3.1`, `react-dom ^18.3.1`; dev `vite ^6.4.2`, `vitest/@vitest/* ^4.1.4`, testing-library, happy-dom, jsdom.

**`npm audit` (ran against lockfile):** **1 critical + 2 moderate, 0 high.** All dev/build-only, not shipped to the browser bundle:
- **`@vitest/browser` 4.1.4** — GHSA-2h32-95rg-cppp, **CVSS 9.6**, reflected XSS via `otelCarrier` query param in Vitest browser mode (range `>=4.0.17 <4.1.6`). → **M-8**
- `postcss 8.5.8` — GHSA-qx2v-qp2m-jg93, CVSS 6.1 (XSS in CSS stringify). → L-11
- `ws 8.20.0` — GHSA-58qx-3vcg-4xpx, CVSS 4.4 (uninitialized memory). → L-11

**`pip-audit` / `safety`:** **not installed** in the environment — backend Python deps were **not** CVE-scanned at runtime; must be done in CI *(unverified — stated explicitly).*

---

## Part 2 — Security Checklist (good / partial / missing)

### Sensitive Data Protection
- ✅ No secrets committed (verified across tree + history); `.env` git- and docker-ignored; secrets via `os.getenv`.
- ✅ Edge TLS/HSTS; generic 500 handler hides internals.
- ⚠️ DB TLS not enforced (`ssl="prefer"` — M-3-data); FX key in URL (L-4); PII plaintext/no retention (L-5); emails in logs (L-6); dev creds in compose (L-3).

### Access Control & Authentication
- ⚠️ No authN/authZ — **intentional** for public reads (I-1), but the three write/PII endpoints lack abuse controls (M-1, M-2).
- ⚠️ Portfolio world-readable by ID, no expiry/revocation (L-2); share IDs are strong 48-bit (not a weakness).
- ⚠️ DB connects as a single DDL-capable role (I-2).

### Input Handling & Injection
- ✅ SQLi none (asyncpg `$1`), SSRF none (hardcoded URLs), XSS none (React escaping), command/deserialization none.
- ⚠️ Prompt injection RSS→Claude (M-4, clamped output limits blast radius).
- ❌ `POST /portfolio/share` is the one unvalidated boundary: no allowlist, no finiteness/positivity, no length cap (L-1).

### Third-Party & Supply Chain
- ✅ Frontend lockfile present (but stale, L-12).
- ❌ Backend no lockfile + floating ranges (M-7); pre-1.0 `anthropic`/young `slowapi` (M-7); dev-toolchain CVSS-9.6 CVE (M-8); no CVE scanning/CI (L-10).

### Infrastructure & Config
- ✅ Non-root backend; no baked secrets; explicit CORS; CSP + headers; stateless (no cookies).
- ❌ `/docs` public (M-5); nginx runs as root (M-6); base images mutable tags (L-8); broad CSP wildcard + `unsafe-inline` (L-9); localhost CORS default ships if unset (L-7); no CI (L-10).

### Logging & Monitoring
- ✅ Traceback logged server-side, generic body to client; `/api/status` health.
- ⚠️ PII (emails) + raw SendGrid bodies logged (L-6); broad `except` masks DB **write** failures in `write_snapshots`/`insert_signal` (I-5); no audit trail for financial/sharing actions.

---

## Part 3 — Findings Register

> Post-verification severities. Overlapping findings from multiple domains are consolidated (cross-refs noted). **(NEW)** marks items not in the first pass.

### Medium

| ID | Finding | File:Lines | Fix summary |
|----|---------|-----------|-------------|
| **M-1** | **Alert subscribe/unsubscribe abuse** — no double opt-in; `unsubscribe` has no token, no rate limit, no email validation (deletes by raw email). *Verified Medium.* | `backend/routers/alerts.py:24-46` (`db.py:450,463`) | Double opt-in w/ confirm token; signed unsubscribe token; `@limiter.limit` + `_EMAIL_RE` on unsubscribe. |
| **M-2** | **Rate limiting ineffective** — uvicorn started without `--proxy-headers`, so `get_remote_address` returns the nginx/Railway proxy IP → all clients share one bucket; `/portfolio/share`, `/unsubscribe`, `/news`, `/history`, `/hype`, `/signals`, `/rate/{code}`, `/status` have no limit. | `backend/Dockerfile:25`, `backend/rate_limit.py:20`, routers | Run uvicorn `--proxy-headers --forwarded-allow-ips=<trusted CIDR>`; add limits to write + expensive read routes. |
| **M-4** | **Prompt injection** — attacker-influenceable RSS headlines concatenated raw into the Claude prompt; output drives catalyst score → alert emails. Output clamped to `[-1,1]` so no RCE/exfil. | `backend/services/hype_service.py:150-166` | Fence headlines as untrusted data; system-prompt clause to ignore embedded instructions; cap per-headline length. |
| **M-3-data** | **`asyncpg ssl="prefer"`** silently downgrades to plaintext; no cert verification — subscriber PII could traverse network in cleartext. | `backend/db/db.py:44-45` | `ssl="require"`/verified context in prod via env flag; `prefer` only for local Docker. |
| **M-5** | **`/docs`, `/redoc`, `/openapi.json` public in prod** — full API map for an auth-less API. | `backend/main.py:71-76` | `docs_url=None`/`redoc_url=None`/`openapi_url=None` when `ENV=production`, or gate behind auth. |
| **M-6** | **nginx master runs as root** (no `USER`), unlike the hardened backend image. | `frontend/Dockerfile:21-32` | Use `nginxinc/nginx-unprivileged` or add non-root `USER` + chown + high port. |
| **M-7** | **Backend dependency pinning** — no lockfile, all `>=` ranges; includes pre-1.0 high-churn `anthropic` and young `slowapi` on the rate-limit path; base image pinned to mutable tag, deps resolved at build time. *Verified Medium (down from High).* | `backend/requirements.txt:1-7`, `backend/Dockerfile:1,13-14` | `pip-compile --generate-hashes`/uv lock, `==` pins, digest-pin base image, Dependabot/Renovate. |
| **M-8** | **`@vitest/browser` CVE** GHSA-2h32-95rg-cppp, CVSS 9.6 reflected XSS — **dev/test-only**, not in the production bundle. **(NEW)** | `frontend/package.json:22` (lockfile resolves 4.1.4) | `npm audit fix` → `@vitest/browser >=4.1.6`; never expose the test browser server off localhost. |
| **M-9** | **ROI endpoint accepts non-finite floats** (Inf/NaN) — money math returns garbage / invalid JSON. | `backend/routers/roi.py:32-49,96-111` | `math.isfinite` + magnitude bound in validators; guard `current_value != 0`. |
| **M-10** | **`MOCK_HEADLINES` duplicate dict keys** (GEL/MZN/PKR/TZS defined twice) — earlier blocks silently discarded → dead code + edit-has-no-effect trap. | `backend/services/news_service.py:169,225,302,330,365,379,386` | Delete duplicate blocks; add ruff `F601` / startup key-count assert. |
| **M-11** | **App.jsx god-component** — 2,667 lines, ~50 hooks, all fetch/calc/render inline; untestable, regression-prone. | `frontend/src/App.jsx:207-2666` | Extract custom hooks + per-tab components; isolate ROI/formatting. |

### Low

| ID | Finding | File:Lines |
|----|---------|-----------|
| L-1 | `POST /portfolio/share`: unvalidated codes + no finiteness/positivity on `amount` + no positions cap + no rate limit + no expiry/prune | `backend/routers/portfolio.py:16-37` (`db.py:423`) |
| L-2 | Portfolio reads unauthenticated/world-readable by ID, no expiry/revocation (48-bit ID itself is fine) | `backend/routers/portfolio.py:40-45`, `db.py:425` |
| L-3 | Hardcoded Postgres creds (`hype/hype`) in compose (dev-only) | `docker-compose.yml:6-7,26` |
| L-4 | **FX API keys embedded in request URLs** — leak via httpx exception logging/upstream logs **(NEW)** | `backend/services/fx_service.py:38,109` (`exotic_rates_service.py:213`) |
| L-5 | Subscriber email PII plaintext, no consent/retention/pruning | `backend/db/db.py:102-109,450-460` |
| L-6 | Subscriber emails + raw SendGrid `resp.text` written to logs | `backend/services/email_service.py:138-140,162-166` |
| L-7 | Localhost CORS default ships silently if `ALLOWED_ORIGINS` unset | `backend/main.py:107-118` |
| L-8 | Base images pinned to mutable minor tags, not digests | `backend/Dockerfile:1`, `frontend/Dockerfile:2,21`, `docker-compose.yml:3` |
| L-9 | Broad CSP: `connect-src https://*.up.railway.app` wildcard + `style-src 'unsafe-inline'` | `frontend/nginx.conf:18` |
| L-10 | No CI/CD — no dep/container/SAST scanning, no Dependabot/Renovate, no branch protection | `.github` (absent) |
| L-11 | Transitive dev-only npm moderates: `postcss 8.5.8`, `ws 8.20.0` | `frontend/package-lock.json` |
| L-12 | **Frontend lockfile stale** — root `version 1.0.0` ≠ `package.json 1.3.0` **(NEW)** | `frontend/package-lock.json` |
| L-13 | **Frontend `news/history/signals` fetches swallow non-2xx** (parse `{detail}` as data → render crash) **(NEW)** | `frontend/src/App.jsx:398-401,410-413,421-424` |
| L-14 | Tests are happy-path/validation only — no injection/IDOR/authz/non-finite coverage on money & share paths | `backend/tests/test_roi.py`, `test_portfolio.py`, `test_alerts.py` |
| L-15 | **Router imports `START_TIME` from `main`** — layering inversion; `import asyncio` inside function bodies **(NEW)** | `backend/routers/rates.py:118,117,144,154` |
| L-16 | **`get_change_24h` re-runs a full 24h aggregation per `/rate/{code}`** (O(all currencies)); endpoint unthrottled **(NEW)** | `backend/db/db.py:224-226`, `rates.py:77-104` |

### Info

- **I-1** No authentication on any endpoint — **intentional, auth-less by design**; recorded as context (every control then rests on rate-limiting + validation). `backend/main.py:121-128`
- **I-2** Single `DATABASE_URL` role runs DDL + DML — not least-privilege; cannot verify Railway grants from repo. `backend/db/db.py:31-45`
- **I-3** No secrets committed — verified clean across tree and history (positive baseline). `backend/.env.example`
- **I-4** `pip-audit` unavailable in environment — backend Python deps **not** CVE-scanned (run in CI). `backend/requirements.txt:1-7`
- **I-5** Broad `except` in **write** paths (`write_snapshots`, `insert_signal`) masks persistent write failures (only a log line; `/api/status` does `SELECT 1` only). Read-path swallowing is acceptable. `backend/db/db.py:131-156,498-517`

### Code health — positives confirmed (both passes)
Clean layering (thin routers → services → isolated DB); **no dead files** (`currencies.py`, `howToBuy.js`, `Landing.jsx`, `rate_limit.py` all imported; all 8 routers mounted); `httpx` clients per-request with `async with` (no leaks); no committed artifacts/`.pyc`/stale `.env`; **zero `TODO`/`FIXME`**; background loops correctly log+retry rather than dying.

---

## Part 4 — Risk Prioritization & Roadmap

### 4.1 Risk matrix (top items)

| ID | Severity | Exploitability | Blast radius | Priority |
|----|----------|---------------|--------------|----------|
| M-1 | Medium | High (no auth/limit) | Email abuse, sender reputation, griefing | **P1** |
| M-2 | Medium | High | All abuse controls undermined | **P1** |
| M-5 | Medium | High (trivial) | Recon / info disclosure | **P1** |
| M-7/M-8 | Medium | Latent / dev-only | Build integrity; dev-host XSS | **P1** |
| M-4 | Medium | Med (needs feed influence) | Skewed scores / spurious alerts | P2 |
| M-3-data | Medium | Low (needs misconfig/MITM) | PII confidentiality | P2 |
| M-6 | Medium | Low | Container blast radius | P2 |
| M-9, M-10, M-11 | Medium | — (correctness/maint.) | Bad money output / data bug / regressions | P2–P3 |
| L-* / I-* | Low/Info | varies | bounded / dev-only | P3–P4 |

### 4.2 Standards mapping
- **OWASP Top 10 (2021):** A01 (M-1, L-1, L-2, I-1) · A02 (M-3-data, L-4, L-5) · A03 (✅ SQLi/XSS/SSRF clean; M-4 LLM only) · A04 (M-2, M-1) · A05 (M-5, M-6, L-7, L-8, L-9) · A06 (M-7, M-8, L-10, L-11, L-12) · A09 (I-5, L-6, L-10) · A10 (✅ none).
- **OWASP ASVS (L1):** gaps in V2 (M-1), V4 (M-1, L-1, L-2), V7 (I-5, L-6), V9 (M-3-data), V13 (M-2, M-5), V14 (M-7, M-8, L-8, L-10).
- **NIST CSF:** Identify (M-7, I-4, L-12) · Protect (M-1–M-6, L-1–L-9) · Detect (I-5, L-6, L-10, L-13) · Respond/Recover (no incident hooks; Railway `restartPolicy` only).
- **PCI-DSS:** **Not applicable** — no cardholder data, no payment flows, no money movement. Re-scope if a payment/brokerage integration is ever added.

### 4.3 Remediation order
1. **Config quick wins (hours):** M-5 disable prod docs · L-7 fail-closed CORS · L-3 mark dev creds · M-8/L-11/L-12 `npm audit fix` + regenerate lockfile.
2. **Write/abuse surface (P1):** M-1 alert hardening · M-2 proxy-aware + broaden rate limits · L-1 portfolio-share validation/caps/expiry.
3. **Supply chain & CI (P1):** M-7 lockfile + `==` pins + digest base images · L-10 CI with `pip-audit`/`npm audit`/Trivy/Dependabot + branch protection.
4. **Data protection (P2):** M-3-data enforce DB TLS · L-4 keys out of URLs / scrub logs · L-5 PII consent/retention · L-6 mask logs.
5. **Correctness & ops (P2):** M-9 reject Inf/NaN · M-10 dedupe MOCK_HEADLINES · M-4 fence LLM input · I-5 surface write failures · L-13 frontend error handling · L-16 scoped 24h query.
6. **Maintainability (P3):** M-6 unprivileged nginx · M-11 decompose App.jsx · L-15 fix layering · add the authz/IDOR/abuse/non-finite/429 tests (L-14).

---

## Appendix A — Adversarial Verification Log

Both High candidates were independently re-checked against the live code and confirmed **real but over-rated**, downgraded to **Medium** this pass:

| Original finding | Verdict | Original → Final | Reason |
|------------------|---------|------------------|--------|
| Anyone can subscribe/unsubscribe any email (`alerts.py:24-46`) | Real | **High → Medium** | App is auth-less by design, no money/accounts/PII beyond email; ceiling is sender-reputation/CAN-SPAM harm + user griefing. *Correction: subscribe **is** rate-limited (5/min); **unsubscribe** is the unthrottled one.* |
| Backend no lockfile / floating `>=` (`requirements.txt:1-7`) | Real | **High → Medium** | Latent supply-chain/reproducibility gap; exploitation needs an external precondition (upstream compromise/breaking release) — not directly exploitable in-codebase. Build path confirmed via `Dockerfile:13-14` + `railway.toml`. |

*(First pass landed both at Low; this pass at Medium. The one-notch difference is analysis variance on impact weighting — neither reaches High.)*

**Net: 0 Critical / 0 High remain.** The `@vitest/browser` advisory's upstream CVSS 9.6 is recorded as Medium here on dev-only-scope grounds.

---

*End of report (second pass, 2026-06-02). No changes have been made to the codebase. Awaiting direction on remediation.*
