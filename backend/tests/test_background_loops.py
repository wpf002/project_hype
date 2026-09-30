"""
Background loop ordering.

Regression: _rate_snapshot_loop slept an hour before its first fetch, so a
service restarting more often than hourly never wrote a snapshot from this
loop. Production went 2026-09-26 to 2026-09-30 without one, which left every
currency with no 24h change (that needs two snapshots inside 24 hours).
"""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

import main


async def test_rate_snapshot_loop_fetches_before_sleeping():
    order = []

    async def fake_rates():
        order.append("fetch")

    async def fake_sleep(_seconds):
        order.append("sleep")
        raise asyncio.CancelledError  # stop after the first iteration

    with patch.object(main, "get_all_rates", side_effect=fake_rates), \
         patch.object(main.asyncio, "sleep", side_effect=fake_sleep):
        with pytest.raises(asyncio.CancelledError):
            await main._rate_snapshot_loop()

    assert order == ["fetch", "sleep"], f"expected fetch first, got {order}"


async def test_rate_snapshot_loop_survives_a_failing_fetch():
    """One bad fetch must not kill the loop; the next tick still runs."""
    calls = {"n": 0}

    async def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("upstream down")

    async def fake_sleep(_seconds):
        if calls["n"] >= 2:
            raise asyncio.CancelledError

    with patch.object(main, "get_all_rates", side_effect=flaky), \
         patch.object(main.asyncio, "sleep", side_effect=fake_sleep):
        with pytest.raises(asyncio.CancelledError):
            await main._rate_snapshot_loop()

    assert calls["n"] == 2


async def test_analytics_prune_loop_prunes_before_sleeping():
    order = []

    async def fake_prune():
        order.append("prune")
        return 0

    async def fake_sleep(_seconds):
        order.append("sleep")
        raise asyncio.CancelledError

    with patch.object(main, "prune_analytics_events", side_effect=fake_prune), \
         patch.object(main.asyncio, "sleep", side_effect=fake_sleep):
        with pytest.raises(asyncio.CancelledError):
            await main._analytics_prune_loop()

    assert order == ["prune", "sleep"]
