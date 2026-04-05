"""
ROI Router — currency position sizing and return calculations.

Financial model:
  A speculator holds N units of a foreign currency purchased at (or near) the
  current spot rate. We calculate the USD value of the position at the current
  rate and at a hypothetical target rate, then derive gross gain and ROI.

  current_value  = amount × current_rate_usd
  target_value   = amount × target_rate_usd
  gain           = target_value − current_value
  roi_percent    = (gain / current_value) × 100
  multiplier     = target_rate / current_rate  (the "how many X" factor)

  Edge cases handled:
  - amount ≤ 0: rejected (400)
  - target_rate ≤ 0: rejected (400)
  - current_rate = 0: exotic with no price — rejected (422)
  - target_rate < current_rate: valid, returns negative ROI (devaluation scenario)
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from data.currencies import CURRENCY_MAP
from services.fx_service import get_rate

router = APIRouter()


class ROIRequest(BaseModel):
    code: str
    amount: float          # Units of foreign currency held
    target_rate: float     # Hypothetical future USD per 1 unit of foreign currency

    @field_validator("amount")
    @classmethod
    def amount_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("amount must be greater than zero")
        return v

    @field_validator("target_rate")
    @classmethod
    def target_rate_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("target_rate must be greater than zero")
        return v


class ROIResponse(BaseModel):
    code: str
    amount: float
    current_rate: float
    target_rate: float
    current_value: float     # USD value of position at current rate
    target_value: float      # USD value of position at target rate
    gain: float              # USD profit/loss (negative = loss)
    roi_percent: float       # Return on investment as a percentage
    multiplier: float        # How many times the currency appreciates (target/current)
    live: bool               # Whether current_rate came from live feed


@router.post("/roi", response_model=ROIResponse)
async def calculate_roi(req: ROIRequest):
    """
    Calculate ROI for a speculative currency position.

    - amount: units of foreign currency held (e.g. 20,000,000 IQD)
    - target_rate: projected future USD/unit rate (e.g. 0.001 USD per IQD)

    Returns current USD value, projected USD value, gross gain, ROI %, and
    the appreciation multiplier (e.g. 1.31x for a 31% gain scenario).
    """
    code = req.code.upper()

    if code not in CURRENCY_MAP:
        raise HTTPException(
            status_code=404,
            detail=f"Currency '{code}' is not tracked.",
        )

    current_rate, is_live = await get_rate(code)

    if current_rate <= 0:
        raise HTTPException(
            status_code=422,
            detail=(
                f"No valid rate available for '{code}'. "
                "This is likely a sanctioned or conflict-zone currency with no tradable price."
            ),
        )

    current_value = req.amount * current_rate
    target_value = req.amount * req.target_rate
    gain = target_value - current_value
    roi_percent = (gain / current_value) * 100
    multiplier = req.target_rate / current_rate

    return ROIResponse(
        code=code,
        amount=req.amount,
        current_rate=current_rate,
        target_rate=req.target_rate,
        current_value=round(current_value, 6),
        target_value=round(target_value, 6),
        gain=round(gain, 6),
        roi_percent=round(roi_percent, 4),
        multiplier=round(multiplier, 6),
        live=is_live,
    )
