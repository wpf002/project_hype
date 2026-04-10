"""
Test configuration for Project Hype backend.

Strategy:
- Set all required env vars before any project code is imported.
- Import db.db and hype_service first, then patch their functions via
  patch.object before importing main. Since main.py uses `from x import y`,
  the names bound into main's namespace at import time will be the mocks.
- Individual tests patch the specific router-level functions they need.
"""

import os
import sys

# ── env vars must come before any project import ──────────────────────────
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ["FX_API_KEY"] = ""
os.environ["SENDGRID_API_KEY"] = ""
os.environ["NEWSAPI_KEY"] = ""
os.environ["ALLOWED_ORIGINS"] = "http://localhost:5173"

# ── add backend/ to path so all imports resolve from the project root ──────
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from unittest.mock import AsyncMock, patch  # noqa: E402
import pytest  # noqa: E402
from httpx import AsyncClient, ASGITransport  # noqa: E402

# Import the modules first so patch.object can target them, then import
# main so that the patched names are what main binds at import time.
import db.db as _db_module  # noqa: E402
import services.hype_service as _hype_module  # noqa: E402
import services.signal_service as _signal_module  # noqa: E402

_patch_init_db = patch.object(_db_module, "init_db", new_callable=AsyncMock)
_patch_hype_engine = patch.object(
    _hype_module, "calculate_all_hype_scores", new_callable=AsyncMock
)
_patch_signal_poll = patch.object(
    _signal_module, "poll_signals", new_callable=AsyncMock
)
_patch_init_db.start()
_patch_hype_engine.start()
_patch_signal_poll.start()

# Import main AFTER patches are live so from-imports bind to mocks
from main import app  # noqa: E402


@pytest.fixture
async def client():
    """Async HTTP client wired directly to the FastAPI ASGI app."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac
