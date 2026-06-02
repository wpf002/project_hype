"""
Shared application-level state that both main.py and routers need.

Keeping this in a small dedicated module avoids the router→main import
inversion (routers should never depend on the composition root).
"""

import time

# Captured once at import time; used by /api/status to report uptime_seconds.
START_TIME: float = time.time()
