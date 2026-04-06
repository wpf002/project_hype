import asyncio
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from routers import rates, roi, news, history, portfolio, hype, alerts
from db.db import init_db
from services.hype_service import calculate_all_hype_scores

load_dotenv()

app = FastAPI(
    title="Project Hype API",
    description="Speculative foreign currency intelligence — rates, ROI modeling, and geopolitical news.",
    version="1.2.0",
)


async def _hype_engine_loop() -> None:
    while True:
        await calculate_all_hype_scores()
        await asyncio.sleep(43200)  # 12 hours


@app.on_event("startup")
async def startup_event() -> None:
    await init_db()
    asyncio.create_task(_hype_engine_loop())


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
        ],
    }
