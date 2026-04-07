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

## Deployment (Railway)

Railway runs backend and frontend as two separate services from the same monorepo.

### 1 — Create a Railway project

New Project → Deploy from GitHub repo → select `wpf002/project_hype`.

### 2 — Deploy the Backend service

- **Root Directory:** `backend`
- **Variables:**
  ```
  DATABASE_URL=<Railway PostgreSQL URL>
  FX_API_KEY=<your key>
  NEWSAPI_KEY=<your key>
  SENDGRID_API_KEY=<your key>
  SENDGRID_FROM_EMAIL=alerts@yourdomain.com
  ALLOWED_ORIGINS=https://your-frontend.up.railway.app
  ```

### 3 — Deploy the Frontend service

- **Root Directory:** `frontend`
- **Variables:**
  ```
  VITE_API_URL=https://your-backend.up.railway.app
  ```

### 4 — Update backend CORS

After the frontend deploys, update `ALLOWED_ORIGINS` in the backend service to the actual frontend URL and redeploy.

> `VITE_API_URL` is baked into the JS bundle at build time — changing it in Railway requires a full redeploy (not just a restart).

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
