from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import rates, roi, news

app = FastAPI(
    title="Project Hype API",
    description="Speculative foreign currency intelligence — rates, ROI modeling, and geopolitical news.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rates.router, prefix="/api")
app.include_router(roi.router, prefix="/api")
app.include_router(news.router, prefix="/api")


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
        ],
    }
