"""
Commodity service — provider chain, mixed-granularity normalisation, and
failure observability.

Context: the commodity factor silently produced neutral-50 for every currency
in production for an extended period because Yahoo began returning HTTP 429 and
nothing surfaced it. These tests lock in the resilience and the observability.
All tests are network-free.
"""

import asyncio
from datetime import date, timedelta

import httpx
import pytest

import services.commodity_service as cs


@pytest.fixture(autouse=True)
def _reset_module_state(monkeypatch):
    # Neutralise Alpha Vantage pacing by default — otherwise any test that
    # exercises the AV path waits the real 13s gap per call. The two pacing
    # tests re-enable a small gap explicitly.
    monkeypatch.setattr(cs, "AV_REQUEST_GAP", 0.0)
    monkeypatch.setattr(cs, "_av_last_call", 0.0)
    cs._cache["data"] = None
    cs._cache["fetched_at"] = 0.0
    cs._last_errors.clear()
    cs._sources.clear()
    cs._health.update(
        last_attempt_at=None, last_success_at=None,
        tickers_ok=0, tickers_total=0, last_error=None,
    )
    yield


# ── Window normalisation ─────────────────────────────────────────────────────

def test_normalise_exact_14_day_span_is_unscaled():
    today = date(2026, 8, 20)
    obs = [(today - timedelta(days=14), 100.0), (today, 110.0)]
    assert cs.normalise_to_window(obs) == 10.0


def test_normalise_scales_monthly_series_down_to_14_days():
    """
    The core of mixed-granularity support: a ~30-day move must be expressed as
    its 14-day equivalent, or monthly sources would look far more volatile than
    daily ones and bias every currency linked to them.
    """
    today = date(2026, 8, 20)
    obs = [(today - timedelta(days=30), 100.0), (today, 130.0)]

    pct = cs.normalise_to_window(obs)

    expected = round(((130 / 100) ** (14 / 30) - 1) * 100, 2)
    assert pct == expected
    assert 0 < pct < 30, "14d equivalent must be well below the raw 30d move"


def test_daily_and_monthly_agree_on_same_underlying_trend():
    """Two sources sampling one trend at different rates must not disagree."""
    today = date(2026, 8, 20)
    daily_rate = 1.01  # +1%/day compounding

    daily = [(today - timedelta(days=d), 100.0 * daily_rate ** (30 - d)) for d in range(30, -1, -1)]
    monthly = [(today - timedelta(days=30), 100.0), (today, 100.0 * daily_rate ** 30)]

    assert cs.normalise_to_window(daily) == pytest.approx(
        cs.normalise_to_window(monthly), abs=0.25
    )


def test_normalise_picks_observation_closest_to_target():
    """Extra history must not widen the window."""
    today = date(2026, 8, 20)
    obs = [
        (today - timedelta(days=120), 10.0),   # far history — must be ignored
        (today - timedelta(days=15), 100.0),   # closest to the 14-day target
        (today, 110.0),
    ]
    pct = cs.normalise_to_window(obs)
    assert pct == pytest.approx(((110 / 100) ** (14 / 15) - 1) * 100, abs=0.01)


@pytest.mark.parametrize("obs", [
    [],
    [(date(2026, 8, 20), 100.0)],                                  # single point
    [(date(2026, 8, 20), 0.0), (date(2026, 8, 6), 100.0)],         # zero price
    [(date(2026, 8, 20), 100.0), (date(2026, 8, 20), 110.0)],      # zero span
])
def test_normalise_rejects_unusable_series(obs):
    assert cs.normalise_to_window(obs) is None


def test_normalise_ignores_none_and_negative_prices():
    today = date(2026, 8, 20)
    obs = [
        (today - timedelta(days=14), 100.0),
        (today - timedelta(days=7), None),
        (today - timedelta(days=3), -5.0),
        (today, 110.0),
    ]
    assert cs.normalise_to_window(obs) == 10.0


# ── Provider chain ───────────────────────────────────────────────────────────

def test_every_commodity_has_a_keyless_provider():
    """
    Architectural guarantee: no commodity may depend solely on a flaky or
    key-gated upstream. FRED needs no key and has no quota, so each chain must
    include it as a floor.
    """
    for commodity, chain in cs.SOURCES.items():
        providers = [p for p, _ in chain]
        assert "fred" in providers, f"{commodity} has no keyless fallback"


def test_chain_falls_through_to_later_provider(monkeypatch):
    async def yahoo_dead(session, symbol):
        raise httpx.HTTPStatusError(
            "429", request=httpx.Request("GET", "http://x"), response=httpx.Response(429)
        )

    today = date(2026, 8, 20)
    async def fred_ok(session, series_id):
        return [(today - timedelta(days=14), 100.0), (today, 105.0)]

    monkeypatch.setitem(cs._FETCHERS, "yahoo", yahoo_dead)
    monkeypatch.setitem(cs._FETCHERS, "fred", fred_ok)
    monkeypatch.setattr(cs, "ALPHA_VANTAGE_KEY", "")

    result = asyncio.run(cs.get_commodity_changes())

    assert set(result) == set(cs.SOURCES), "FRED floor must cover every commodity"
    assert all(v == 5.0 for v in result.values())
    assert cs.get_commodity_health()["degraded"] is False
    assert all(s.startswith("fred:") for s in cs._sources.values())


def test_alpha_vantage_skipped_without_key(monkeypatch):
    called = []

    async def av(session, symbol):
        called.append(symbol)
        raise AssertionError("must not be called without a key")

    async def dead(session, symbol):
        raise RuntimeError("down")

    monkeypatch.setitem(cs._FETCHERS, "alphavantage", av)
    monkeypatch.setitem(cs._FETCHERS, "yahoo", dead)
    monkeypatch.setitem(cs._FETCHERS, "fred", dead)
    monkeypatch.setattr(cs, "ALPHA_VANTAGE_KEY", "")

    asyncio.run(cs.get_commodity_changes())

    assert called == []
    assert "no key" in cs.get_commodity_health()["last_error"]


def test_earlier_provider_wins(monkeypatch):
    today = date(2026, 8, 20)

    async def yahoo_ok(session, symbol):
        return [(today - timedelta(days=14), 100.0), (today, 120.0)]

    async def fred_should_not_run(session, series_id):
        raise AssertionError("must not reach FRED when Yahoo succeeded")

    monkeypatch.setitem(cs._FETCHERS, "yahoo", yahoo_ok)
    monkeypatch.setitem(cs._FETCHERS, "fred", fred_should_not_run)

    result = asyncio.run(cs.get_commodity_changes())

    assert all(v == 20.0 for v in result.values())
    assert all(s.startswith("yahoo:") for s in cs._sources.values())


# ── Observability ────────────────────────────────────────────────────────────

def test_empty_message_exception_still_reports_a_cause():
    """
    httpx.ReadError('') has no message; logging it raw produced a bare
    'fred: ' that hid the real failure during development.
    """
    async def blank(session, symbol):
        raise httpx.ReadError("")

    async def main():
        for name in cs._FETCHERS:
            cs._FETCHERS[name] = blank
        async with httpx.AsyncClient() as s:
            return await cs._resolve_commodity(s, "cocoa")

    original = dict(cs._FETCHERS)
    try:
        assert asyncio.run(main()) is None
    finally:
        cs._FETCHERS.update(original)

    err = cs._last_errors["cocoa"]
    assert "ReadError" in err, f"cause must survive, got {err!r}"
    assert not err.rstrip().endswith(":"), "must not log a bare 'provider:'"


def test_total_failure_is_reported_as_degraded(monkeypatch):
    async def dead(session, symbol):
        raise RuntimeError("upstream down")

    for name in list(cs._FETCHERS):
        monkeypatch.setitem(cs._FETCHERS, name, dead)
    monkeypatch.setattr(cs, "ALPHA_VANTAGE_KEY", "k")

    result = asyncio.run(cs.get_commodity_changes())
    health = cs.get_commodity_health()

    assert result == {}
    assert health["degraded"] is True
    assert health["tickers_ok"] == 0
    assert "upstream down" in health["last_error"]


def test_partial_success_is_not_degraded(monkeypatch):
    today = date(2026, 8, 20)

    async def only_oil(session, symbol):
        if symbol == "DCOILWTICO":
            return [(today - timedelta(days=14), 100.0), (today, 102.0)]
        raise RuntimeError("down")

    async def dead(session, symbol):
        raise RuntimeError("down")

    monkeypatch.setitem(cs._FETCHERS, "fred", only_oil)
    monkeypatch.setitem(cs._FETCHERS, "yahoo", dead)
    monkeypatch.setattr(cs, "ALPHA_VANTAGE_KEY", "")

    result = asyncio.run(cs.get_commodity_changes())
    health = cs.get_commodity_health()

    assert set(result) == {"oil"}
    assert health["degraded"] is False, "partial data is still usable"
    assert health["tickers_ok"] == 1


def test_fred_must_not_use_a_browser_user_agent():
    """
    Regression guard: FRED stalls browser-like User-Agents when serving raw
    CSV, which surfaced as an unexplained ReadTimeout. Yahoo needs the opposite.
    These header sets must stay distinct.
    """
    assert "Mozilla" not in cs._SCRIPT_HEADERS["User-Agent"]
    assert "Mozilla" in cs._BROWSER_HEADERS["User-Agent"]


def test_cache_prevents_refetch(monkeypatch):
    today = date(2026, 8, 20)
    calls = []

    async def counted(session, symbol):
        calls.append(symbol)
        return [(today - timedelta(days=14), 100.0), (today, 101.0)]

    monkeypatch.setitem(cs._FETCHERS, "yahoo", counted)

    first = asyncio.run(cs.get_commodity_changes())
    n = len(calls)
    second = asyncio.run(cs.get_commodity_changes())

    assert first == second
    assert len(calls) == n, "second call must be served from cache"


def test_alpha_vantage_calls_are_paced_across_commodities(monkeypatch):
    """
    Regression: all commodities resolve concurrently via asyncio.gather, so a
    per-chain `await asyncio.sleep(GAP)` delayed every AV call equally and then
    let them fire simultaneously — spacing nothing. Pacing must be enforced
    across commodities, not within one chain.
    """
    import time as _time

    starts = []
    today = date(2026, 8, 20)

    async def av(session, symbol):
        starts.append(_time.monotonic())
        return [(today - timedelta(days=14), 100.0), (today, 101.0)]

    async def dead(session, symbol):
        raise RuntimeError("down")

    monkeypatch.setitem(cs._FETCHERS, "alphavantage", av)
    monkeypatch.setitem(cs._FETCHERS, "yahoo", dead)
    monkeypatch.setitem(cs._FETCHERS, "fred", dead)
    monkeypatch.setattr(cs, "ALPHA_VANTAGE_KEY", "k")
    monkeypatch.setattr(cs, "AV_REQUEST_GAP", 0.05)
    monkeypatch.setattr(cs, "_av_last_call", 0.0)

    asyncio.run(cs.get_commodity_changes())

    assert len(starts) >= 2, "expected multiple AV calls to pace"
    gaps = [b - a for a, b in zip(sorted(starts), sorted(starts)[1:])]
    assert all(g >= 0.04 for g in gaps), f"AV calls not spaced: {gaps}"


def test_first_alpha_vantage_call_is_not_delayed(monkeypatch):
    """Pacing waits only for the remainder of the gap, never a fixed sleep."""
    import time as _time
    today = date(2026, 8, 20)

    async def av(session, symbol):
        return [(today - timedelta(days=14), 100.0), (today, 101.0)]

    monkeypatch.setitem(cs._FETCHERS, "alphavantage", av)
    monkeypatch.setattr(cs, "AV_REQUEST_GAP", 5.0)
    monkeypatch.setattr(cs, "_av_last_call", 0.0)

    async def one():
        async with httpx.AsyncClient() as s:
            return await cs._fetch_av_paced(s, "GLD")

    t0 = _time.monotonic()
    asyncio.run(one())
    assert _time.monotonic() - t0 < 1.0, "first call must not wait a full gap"
