import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from slowapi.errors import RateLimitExceeded

from rate_limit import limiter
from routers import rates, roi, news, history, portfolio, hype, alerts, signals
from db.db import init_db, write_snapshots
from services.hype_service import calculate_all_hype_scores
from services.signal_service import poll_signals
from services.fx_service import get_all_rates

load_dotenv()

logger = logging.getLogger(__name__)

# Captured once at import time so /api/status can report uptime_seconds
START_TIME: float = time.time()


async def _hype_engine_loop() -> None:
    while True:
        try:
            await calculate_all_hype_scores()
        except Exception:
            logger.exception("Hype engine error — will retry in 1 hour")
            await asyncio.sleep(3600)
            continue
        await asyncio.sleep(43200)  # 12 hours


async def _signal_polling_loop() -> None:
    while True:
        try:
            await poll_signals()
        except Exception:
            logger.exception("Signal polling error — will retry in 1 hour")
            await asyncio.sleep(3600)
            continue
        await asyncio.sleep(14400)  # 4 hours


async def _rate_snapshot_loop() -> None:
    """Write a rate snapshot every hour, aligned with the OXR cache TTL."""
    while True:
        await asyncio.sleep(3600)  # 1 hour
        try:
            result = await get_all_rates()
            await write_snapshots({code: (r[0], r[1]) for code, r in result.items()})
        except Exception:
            logger.exception("Rate snapshot loop iteration failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    from services.fx_service import warm_cache_from_db
    await warm_cache_from_db()
    asyncio.create_task(_hype_engine_loop())
    asyncio.create_task(_signal_polling_loop())
    asyncio.create_task(_rate_snapshot_loop())
    yield


app = FastAPI(
    title="Project Hype API",
    description="Speculative foreign currency intelligence — rates, ROI modeling, and geopolitical news.",
    version="1.3.0",
    lifespan=lifespan,
)

# ── Rate limiting ─────────────────────────────────────────────────────────────
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests. Please slow down and try again shortly."},
    )


# ── Generic exception handler ─────────────────────────────────────────────────
# Catches anything not raised as HTTPException or RequestValidationError.
# Logs the full traceback server-side, but returns a generic JSON body so we
# never leak stack traces, file paths, or DB internals to the caller.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error."},
    )


# ── CORS ──────────────────────────────────────────────────────────────────────
# ALLOWED_ORIGINS must be a comma-separated explicit list — never "*".
# A safe localhost-only default is used if unset (dev convenience). In
# production the Railway env var ALLOWED_ORIGINS is required.
_raw_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000",
)
allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip() and o.strip() != "*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
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
        "version": "1.3.0",
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
