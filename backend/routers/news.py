from fastapi import APIRouter, HTTPException
from typing import List
from pydantic import BaseModel

from data.currencies import CURRENCY_MAP
from services.news_service import get_news

router = APIRouter()


class Headline(BaseModel):
    title: str
    source: str
    url: str
    published_at: str
    description: str
    mock: bool = False


@router.get("/news/{code}", response_model=List[Headline])
async def get_currency_news(code: str):
    """
    Returns up to 5 headlines for a given currency code.

    Fetches real articles via the 3-tier RSS pipeline (IMF/World Bank/OFAC/BIS
    institutional feeds, GDELT quality-domain filter, currency-specific regional
    RSS). No external API key required.

    Falls back to analyst-written mock headlines if all live feeds fail.

    The `mock` field on each headline indicates whether the data is real.
    """
    code = code.upper()

    if code not in CURRENCY_MAP:
        raise HTTPException(
            status_code=404,
            detail=f"Currency '{code}' is not tracked. Use GET /api/rates for the full list.",
        )

    headlines = await get_news(code)
    return headlines
