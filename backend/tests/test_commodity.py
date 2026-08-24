"""
Commodity service — source fallback, parsing and failure observability.

These tests never hit the network. They exist because the commodity factor
failed silently in production for an extended period (Yahoo began returning
HTTP 429), and nothing distinguished "commodity genuinely neutral" from
"upstream dead".
"""

import asyncio

import httpx
import pytest

import services.commodity_service as cs


@pytest.fixture(autouse=True)
def _reset_module_state():
    """Each test gets a clean cache/health so ordering can't leak state."""
    cs._cache["data"] = None
    cs._cache["fetched_at"] = 0.0
    cs._last_errors.clear()
    cs._sources.clear()
    cs._health.update(
        last_attempt_at=None, last_success_at=None,
        tickers_ok=0, tickers_total=0, last_error=None,
    )
    yield


class _Resp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class _FakeSession:
    """Minimal stand-in for httpx.AsyncClient — get() must be awaitable."""

    def __init__(self, payload):
        self._payload = payload

    async def get(self, *args, **kwargs):
        return _Resp(self._payload)


def _av_payload(closes):
    """Build an Alpha Vantage TIME_SERIES_DAILY payload from a close list."""
    return {
        "Time Series (Daily)": {
            f"2026-08-{i + 1:02d}": {"4. close": f"{c}"} for i, c in enumerate(closes)
        }
    }


def test_pct_change_basic():
    assert cs._pct_change([100.0, 110.0]) == 10.0
    assert cs._pct_change([100.0, 90.0]) == -10.0


def test_pct_change_rejects_unusable_series():
    assert cs._pct_change([]) is None
    assert cs._pct_change([100.0]) is None          # need >= 2 points
    assert cs._pct_change([0.0, 50.0]) is None      # non-positive base
    assert cs._pct_change([None, None]) is None


def test_alpha_vantage_parses_trailing_15_sessions():
    """Only the most recent 15 closes define the ~14-day change."""
    closes = [float(100 + i) for i in range(20)]  # 100..119
    session = _FakeSession(_av_payload(closes))

    pct = asyncio.run(cs._fetch_alpha_vantage(session, "oil", "USO"))

    # trailing 15 of 100..119 is 105..119
    assert pct == pytest.approx(round((119 / 105 - 1) * 100, 2))
    assert cs._sources["oil"] == "alphavantage:USO"
    assert "oil" not in cs._last_errors


@pytest.mark.parametrize("problem_key", ["Note", "Information", "Error Message"])
def test_alpha_vantage_detects_soft_errors(problem_key):
    """AV signals throttling with HTTP 200 plus an explanatory key, not a 4xx."""
    session = _FakeSession({problem_key: "rate limit reached"})

    pct = asyncio.run(cs._fetch_alpha_vantage(session, "gold", "GLD"))

    assert pct is None
    assert "alphavantage" in cs._last_errors["gold"]
    assert "gold" not in cs._sources


def test_yahoo_http_error_records_status_code():
    """A 429 must be recorded verbatim — that is the real production failure."""
    class S:
        async def get(self, *a, **k):
            raise httpx.HTTPStatusError(
                "429", request=httpx.Request("GET", "http://x"),
                response=httpx.Response(429),
            )

    pct = asyncio.run(cs._fetch_yahoo(S(), "oil", "CL=F"))

    assert pct is None
    assert cs._last_errors["oil"] == "yahoo HTTP 429"


def test_health_reports_degraded_when_everything_fails(monkeypatch):
    """The whole point: total failure must be observable, not silent."""
    async def all_fail(session, key, ticker):
        cs._last_errors[key] = "yahoo HTTP 429"
        return None

    monkeypatch.setattr(cs, "_fetch_yahoo", all_fail)
    monkeypatch.setattr(cs, "ALPHA_VANTAGE_KEY", "")

    result = asyncio.run(cs.get_commodity_changes())
    health = cs.get_commodity_health()

    assert result == {}
    assert health["degraded"] is True
    assert health["tickers_ok"] == 0
    assert health["alpha_vantage_configured"] is False
    assert "429" in health["last_error"]


def test_alpha_vantage_only_called_for_tickers_yahoo_missed(monkeypatch):
    """Preserves the small AV free-tier quota."""
    async def yahoo_partial(session, key, ticker):
        if key == "oil":
            cs._sources[key] = "yahoo"
            return 5.0
        cs._last_errors[key] = "yahoo HTTP 429"
        return None

    called = []

    async def av(session, key, symbol):
        called.append(key)
        return 1.0

    monkeypatch.setattr(cs, "_fetch_yahoo", yahoo_partial)
    monkeypatch.setattr(cs, "_fetch_alpha_vantage", av)
    monkeypatch.setattr(cs, "ALPHA_VANTAGE_KEY", "k")
    monkeypatch.setattr(cs, "AV_REQUEST_GAP", 0)

    result = asyncio.run(cs.get_commodity_changes())

    assert "oil" not in called, "oil succeeded via Yahoo — must not burn AV quota"
    assert set(called) == set(cs.TICKERS) - {"oil"}
    assert result["oil"] == 5.0
    assert cs.get_commodity_health()["degraded"] is False


def test_cache_prevents_refetch(monkeypatch):
    calls = []

    async def yahoo(session, key, ticker):
        calls.append(key)
        return 2.0

    monkeypatch.setattr(cs, "_fetch_yahoo", yahoo)

    first = asyncio.run(cs.get_commodity_changes())
    n_after_first = len(calls)
    second = asyncio.run(cs.get_commodity_changes())

    assert first == second
    assert len(calls) == n_after_first, "second call must be served from cache"
