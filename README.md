# Project HYPE

Speculative foreign currency intelligence dashboard — track 40 exotic/undervalued currencies, model revaluation ROI, manage a portfolio, and read geopolitical headlines.

**Stack:** FastAPI (Python 3.13) · React 18 / Vite 5 · nginx · Docker

---

## Local Development (no Docker)

### Prerequisites
- Python 3.13+
- Node 20+

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # add your API keys
./start.sh                  # → http://localhost:8000
                             #   http://localhost:8000/docs
```

### Frontend

```bash
cd frontend
npm install
npm run dev                 # → http://localhost:5173
```

---

## Local Development (Docker Compose)

Runs both services in containers. Frontend is served by nginx on port 3000 and proxies `/api/*` to the backend — no CORS configuration needed.

```bash
# 1. Add your API keys to backend/.env
cp backend/.env.example backend/.env
# edit backend/.env

# 2. Build and start
docker compose up --build

# Frontend → http://localhost:3000
# Backend  → http://localhost:8000
# API docs → http://localhost:8000/docs
```

To rebuild after code changes:

```bash
docker compose up --build --force-recreate
```

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `FX_API_KEY` | No | [ExchangeRate-API v6](https://www.exchangerate-api.com/) key — enables live rates for ~150 currencies. Without it, all 40 currencies use hardcoded fallback rates. |
| `NEWSAPI_KEY` | No | [NewsAPI.org](https://newsapi.org/) key — enables real headlines. Without it, analyst-written mock headlines are served. |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins. Defaults to `http://localhost:5173,http://localhost:3000`. In production, set to your frontend Railway URL. |

### Frontend (build-time)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | Base URL for API calls. Set to empty string `""` when nginx is proxying (docker-compose). Set to the backend Railway URL in production. |

---

## Railway Deployment

Railway runs the backend and frontend as two separate services from the same monorepo.

### Step 1 — Create a new Railway project

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select `wpf002/project_hype`

### Step 2 — Deploy the Backend service

1. In the Railway project, click **+ New Service** → **GitHub Repo** → select the repo
2. Under **Settings → Source**:
   - **Root Directory:** `backend`
3. Under **Variables**, add:
   ```
   FX_API_KEY=your_exchangerate_api_key
   NEWSAPI_KEY=your_newsapi_key
   ALLOWED_ORIGINS=https://your-frontend.up.railway.app
   ```
   *(You'll get the frontend URL after deploying it — come back and update this.)*
4. Deploy. Note the generated backend URL (e.g. `https://project-hype-backend.up.railway.app`).

### Step 3 — Deploy the Frontend service

1. Click **+ New Service** → **GitHub Repo** → select the repo again
2. Under **Settings → Source**:
   - **Root Directory:** `frontend`
3. Under **Variables**, add:
   ```
   VITE_API_URL=https://project-hype-backend.up.railway.app
   ```
   *(Use the backend URL from Step 2.)*
4. Deploy.

### Step 4 — Update backend CORS

1. Go back to the **backend service → Variables**
2. Update `ALLOWED_ORIGINS` to include the frontend Railway URL:
   ```
   ALLOWED_ORIGINS=https://project-hype-frontend.up.railway.app
   ```
3. Redeploy the backend.

> **Note on `VITE_API_URL`:** This is a build-time variable baked into the JavaScript bundle. Any time you change it in Railway, you must trigger a redeploy (not just a restart) to rebuild the frontend with the new URL.

---

## Project Structure

```
project_hype/
├── docker-compose.yml
├── .gitignore
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── railway.toml
│   ├── main.py
│   ├── start.sh
│   ├── requirements.txt
│   ├── .env.example
│   ├── data/
│   │   └── currencies.py       40 currency definitions
│   ├── routers/
│   │   ├── rates.py            GET /api/rates, GET /api/rate/{code}
│   │   ├── roi.py              POST /api/roi
│   │   └── news.py             GET /api/news/{code}
│   └── services/
│       ├── fx_service.py       ExchangeRate-API + 15min cache
│       └── news_service.py     NewsAPI + analyst mock headlines
└── frontend/
    ├── Dockerfile
    ├── railway.toml
    ├── nginx.conf
    ├── vite.config.js
    ├── index.html
    ├── package.json
    └── src/
        ├── main.jsx
        └── App.jsx             Full UI — 4 tabs, inline styles
```

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/rates` | All 40 currencies with current rate and `live` boolean |
| GET | `/api/rate/{code}` | Single currency + metadata. 404 if unknown |
| POST | `/api/roi` | ROI calculation. Body: `{ code, amount, target_rate }` |
| GET | `/api/news/{code}` | Up to 5 headlines for a currency. 404 if unknown |

Interactive docs available at `/docs` when the backend is running.
