import asyncio
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from routers import rates, roi, news, history, portfolio, hype
from db.db import init_db
from services.hype_service import calculate_all_hype_scores

load_dotenv()

app = FastAPI(
    title="Project Hype API",
    description="Speculative foreign currency intelligence — rates, ROI modeling, and geopolitical news.",
    version="1.1.0",
)

init_db()


async def _hype_engine_loop() -> None:
    while True:
        await calculate_all_hype_scores()
        await asyncio.sleep(43200)  # 12 hours — 40 req/run × 2 = 80 req/day (free tier: 100)


@app.on_event("startup")
async def startup_event() -> None:
    asyncio.create_task(_hype_engine_loop())


# ALLOWED_ORIGINS: comma-separated list of allowed frontend origins.
# Defaults to local dev URLs. Override in production via environment variable.
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


@app.get("/")
async def root():
    return {
        "service": "Project Hype API",
        "version": "1.0.0",
        "docs": "/docs",
        "endpoints": [
            "GET  /api/rates",
            "GET  /api/rate/{code}",
            "POST /api/roi",
            "GET  /api/news/{code}",
            "GET  /api/history/{code}",
            "GET  /api/hype/{code}",
            "POST /api/portfolio/share",
            "GET  /api/portfolio/{id}",
        ],
    }
