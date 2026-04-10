# Project HYPE

**Live speculative foreign currency intelligence dashboard** — real-time hype scoring, NLP catalyst analysis, ROI modeling, and catalyst spike alerts for 40 exotic and undervalued currencies.

**Live:** https://frontend-production-3fb7.up.railway.app  
**API:** https://backend-production-6529.up.railway.app  
**API Docs:** https://backend-production-6529.up.railway.app/docs

---

## What it does

- **Hype Score** — composite score (0–100) measuring current market attention: news volume, recency weighting, and 7-day rate volatility. Exotic/sanctioned currencies get a structural floor so they don't disappear from the board when headlines go quiet.
- **Catalyst Score** — forward-looking signal: VADER NLP sentiment on live GDELT headlines (60%) + 7-day rate momentum (40%). High hype + low catalyst = forum chatter. High catalyst = something is actually moving.
- **ROI Modeler** — enter an amount held, set a target rate, see current value / projected value / gain / multiplier. Quick Scenarios model 2×, 5×, 10×, 50×, 100× revaluations instantly.
- **Live Rates** — ExchangeRate-API feed for ~30 currencies (updated every 15 min), analyst fallback rates for 10 sanctioned/exotic currencies (IRR, KPW, ZWL, MMK, SYP, VES, LBP, SDG, YER, SOS) with a clear LIVE / EST badge.
- **Portfolio Tracker** — track positions across multiple currencies, share a portfolio via short URL.
- **Catalyst Alerts** — email notification when any tracked currency's Catalyst Score jumps 15+ points between scoring cycles. Free, no spam, unsubscribe anytime.
- **Rate History** — 7-day sparkline per currency (snapshots every 15 min, stored in PostgreSQL).
- **Hype Map** — treemap-style visual of all 40 currencies by hype intensity.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.13, FastAPI, asyncpg, VADER NLP |
| Database | PostgreSQL (Railway managed) |
| Frontend | React 18, Vite 5, inline styles |
| Serving | nginx (Docker) / Railway |
| Rates | ExchangeRate-API v6 |
| News & NLP | GDELT via NewsAPI + VADER sentiment |
| Email | SendGrid |
| Analytics | Plausible (privacy-friendly, no cookies) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser                                 │
│  Landing (/)  ──→  Dashboard (/app)  ──→  /api/*               │
└─────────────────────────────┬───────────────────────────────────┘
                              │ HTTPS
              ┌───────────────▼────────────────┐
              │         nginx (Frontend)        │
              │   React/Vite SPA · port 80      │
              │   /api/* → proxy to backend     │
              └───────────────┬────────────────┘
                              │ http (Docker) / direct (Railway)
              ┌───────────────▼────────────────┐
              │      FastAPI Backend            │
              │  /api/rates   /api/roi          │
              │  /api/news    /api/history      │
              │  /api/hype    /api/alerts       │
              │  /api/portfolio  /api/status    │
              └──────┬──────────────┬──────────┘
                     │              │
          ┌──────────▼──┐    ┌──────▼──────────┐
          │ PostgreSQL   │    │ External APIs    │
          │ rate_snapshots│   │ ExchangeRate-API │
          │ hype_snapshots│   │ NewsAPI / GDELT  │
          │ catalyst_snap │   │ SendGrid         │
          │ subscribers  │    └─────────────────┘
          │ shared_portf │
          └─────────────┘

  Hype Engine: background task, runs every 12h
  Rate snapshots: written on every /api/rates call, pruned to 7 days
```

---

## Local development

### Prerequisites
- Python 3.13+
- Node 20+
- PostgreSQL (or use Docker Compose — recommended)

### Quickstart with Docker Compose

```bash
# 1. Copy env file and add your API keys
cp backend/.env.example backend/.env
# edit backend/.env

# 2. Start everything
docker compose up --build

# Frontend → http://localhost:3000
# Backend  → http://localhost:8000
# API docs → http://localhost:8000/docs
```

Rebuild after code changes:

```bash
docker compose up --build --force-recreate
```

### Without Docker

**Backend:**
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # add your keys + DATABASE_URL
uvicorn main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
VITE_API_URL=http://localhost:8000 npm run dev
# → http://localhost:5173
```

---

## Environment variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | **Yes** | PostgreSQL connection string (`postgresql://user:pass@host/db`). Railway injects this automatically. |
| `FX_API_KEY` | No | [ExchangeRate-API v6](https://www.exchangerate-api.com/) key. Without it, all currencies use analyst fallback rates. |
| `NEWSAPI_KEY` | No | [NewsAPI.org](https://newsapi.org/) key. Without it, analyst-written mock headlines are served and Catalyst Score is 100% rate momentum. |
| `SENDGRID_API_KEY` | No | SendGrid key for catalyst spike alert emails. |
| `SENDGRID_FROM_EMAIL` | No | Sender address for alerts (e.g. `alerts@yourdomain.com`). |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins. Defaults to `http://localhost:5173,http://localhost:3000`. In production, set to your frontend Railway URL. |

### Frontend (build-time)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | Base URL for API calls. Set to `""` when nginx proxies (Docker Compose). Set to the backend Railway URL in production. |

---

## Tests

```bash
# Backend (pytest)
cd backend
source .venv/bin/activate
pytest

# Frontend (Vitest)
cd frontend
npm test
```

---

## Railway Deployment

Two Railway services, one monorepo (`wpf002/project_hype`):

| Service | Railway root directory | URL |
| --- | --- | --- |
| **backend** | `backend/` | <https://backend-production-a64b.up.railway.app> |
| **frontend** | `frontend/` | <https://frontend-production-3fb7.up.railway.app> |

### Required environment variables

#### Backend service (set in Railway dashboard → Variables)

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL DSN — **injected automatically** by the Railway Postgres plugin |
| `ANTHROPIC_API_KEY` | Claude Haiku API key for geopolitical sentiment scoring |
| `OXR_APP_ID` | Open Exchange Rates app ID — primary live FX feed |
| `FX_API_KEY` | ExchangeRate-API v6 key — fallback FX feed |
| `NEWSAPI_KEY` | NewsAPI.org key — Tier 2 news headlines |
| `SENDGRID_API_KEY` | SendGrid API key for catalyst spike alert emails |
| `ALERT_FROM_EMAIL` | Verified sender address for alert emails (e.g. `alerts@yourdomain.com`) |
| `APP_URL` | `https://frontend-production-3fb7.up.railway.app` |
| `ALLOWED_ORIGINS` | `https://frontend-production-3fb7.up.railway.app` |

#### Frontend service (build-time variable — triggers a full image rebuild)

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | `https://backend-production-a64b.up.railway.app` |

> `VITE_API_URL` is baked into the JS bundle at build time. After setting or changing it, trigger a redeploy — a restart alone is not enough.

### Setup order

1. **Add the Postgres plugin** to your Railway project first. Railway injects `DATABASE_URL` automatically once the plugin is provisioned.
2. **Deploy the Backend service** — set root directory to `backend/`, add all backend env vars above, then deploy.
3. **Deploy the Frontend service** — set root directory to `frontend/`, add `VITE_API_URL`, then deploy.

### Force a redeploy

Push any commit to `main` — both services auto-deploy via the Railway GitHub integration.

To redeploy without a code change: Railway dashboard → service → **Redeploy**.

---

## API endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/rates` | All 40 currencies — rate, hype score, catalyst score, 24h change |
| `GET` | `/api/rate/{code}` | Single currency + news query metadata |
| `GET` | `/api/status` | Service health — version, db status, uptime, score freshness |
| `POST` | `/api/roi` | ROI calculation. Body: `{ code, amount, target_rate }` |
| `GET` | `/api/news/{code}` | Up to 5 headlines for a currency |
| `GET` | `/api/history/{code}` | Rate snapshots (last 24, newest first) |
| `GET` | `/api/hype/{code}` | Hype score history for a currency |
| `POST` | `/api/portfolio/share` | Create a shareable portfolio URL |
| `GET` | `/api/portfolio/{id}` | Retrieve a shared portfolio |
| `POST` | `/api/alerts/subscribe` | Subscribe to catalyst spike alerts |
| `DELETE` | `/api/alerts/unsubscribe` | Unsubscribe from alerts |

Full interactive docs: `/docs` (Swagger UI) and `/redoc`.

---

## Data sources

| Source | Used for |
|---|---|
| [ExchangeRate-API v6](https://www.exchangerate-api.com/) | Live exchange rates for ~30 currencies, updated every 15 min |
| [GDELT via NewsAPI](https://newsapi.org/) | Real-time headlines for NLP sentiment scoring |
| [VADER NLP](https://github.com/cjhutto/vaderSentiment) | Sentiment analysis on headlines for Catalyst Score |
| Analyst fallback rates | Fixed rates for 10 sanctioned/exotic currencies with no reliable market feed |
| [SendGrid](https://sendgrid.com/) | Transactional email for catalyst spike alerts |

---

## Project structure

```
project_hype/
├── docker-compose.yml
├── README.md
├── LICENSE
├── backend/
│   ├── Dockerfile
│   ├── railway.toml
│   ├── main.py                  FastAPI app + lifespan hype engine
│   ├── requirements.txt
│   ├── data/
│   │   └── currencies.py        40 currency definitions + fallback rates
│   ├── db/
│   │   └── db.py                asyncpg pool, all DB helpers
│   ├── routers/
│   │   ├── rates.py             GET /api/rates, /api/rate/{code}, /api/status
│   │   ├── roi.py               POST /api/roi
│   │   ├── news.py              GET /api/news/{code}
│   │   ├── history.py           GET /api/history/{code}
│   │   ├── hype.py              GET /api/hype/{code}
│   │   ├── portfolio.py         POST/GET /api/portfolio/*
│   │   └── alerts.py            POST/DELETE /api/alerts/*
│   └── services/
│       ├── fx_service.py        ExchangeRate-API + 15min cache
│       ├── hype_service.py      Hype + Catalyst scoring engine
│       ├── news_service.py      NewsAPI + VADER + mock fallback
│       └── email_service.py     SendGrid alert dispatch
└── frontend/
    ├── Dockerfile
    ├── railway.toml
    ├── nginx.conf
    ├── vite.config.js
    ├── index.html               Plausible analytics script
    └── src/
        ├── main.jsx             Route: / → Landing, /app → App
        ├── Landing.jsx          Marketing landing page
        └── App.jsx              Full dashboard UI
```

---

## License

MIT — see [LICENSE](./LICENSE).
