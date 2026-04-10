import asyncio
import os
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from routers import rates, roi, news, history, portfolio, hype, alerts, signals
from db.db import init_db, write_snapshots
from services.hype_service import calculate_all_hype_scores
from services.signal_service import poll_signals
from services.fx_service import get_all_rates

load_dotenv()

# Captured once at import time so /api/status can report uptime_seconds
START_TIME: float = time.time()


async def _hype_engine_loop() -> None:
    while True:
        try:
            await calculate_all_hype_scores()
        except Exception:
            import logging
            logging.getLogger(__name__).exception("Hype engine error — will retry in 1 hour")
            await asyncio.sleep(3600)
            continue
        await asyncio.sleep(43200)  # 12 hours


async def _signal_polling_loop() -> None:
    while True:
        try:
            await poll_signals()
        except Exception:
            import logging
            logging.getLogger(__name__).exception("Signal polling error — will retry in 1 hour")
            await asyncio.sleep(3600)
            continue
        await asyncio.sleep(14400)  # 4 hours


async def _rate_snapshot_loop() -> None:
    """Write a rate snapshot every 5 minutes so history accumulates quickly."""
    while True:
        await asyncio.sleep(300)  # 5 minutes
        try:
            result = await get_all_rates()
            await write_snapshots({code: (r[0], r[1]) for code, r in result.items()})
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    asyncio.create_task(_hype_engine_loop())
    asyncio.create_task(_signal_polling_loop())
    asyncio.create_task(_rate_snapshot_loop())
    yield


app = FastAPI(
    title="Project Hype API",
    description="Speculative foreign currency intelligence — rates, ROI modeling, and geopolitical news.",
    version="1.2.0",
    lifespan=lifespan,
)


_raw_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000",
)
allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rates.router, prefix="/api")
app.include_router(roi.router, prefix="/api")
app.include_router(news.router, prefix="/api")
app.include_router(history.router, prefix="/api")
app.include_router(portfolio.router, prefix="/api")
app.include_router(hype.router, prefix="/api")
app.include_router(alerts.router, prefix="/api")
app.include_router(signals.router, prefix="/api")


@app.get("/")
async def root():
    return {
        "service": "Project Hype API",
        "version": "1.2.0",
        "docs": "/docs",
        "endpoints": [
            "GET  /api/rates",
            "GET  /api/rate/{code}",
            "GET  /api/status",
            "POST /api/roi",
            "GET  /api/news/{code}",
            "GET  /api/history/{code}",
            "GET  /api/hype/{code}",
            "POST /api/portfolio/share",
            "GET  /api/portfolio/{id}",
            "POST /api/alerts/subscribe",
            "DELETE /api/alerts/unsubscribe",
            "GET  /api/signals/{code}",
        ],
    }
