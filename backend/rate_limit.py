"""
Shared slowapi Limiter instance.

Imported by main.py (to register exception handler + middleware) and by
routers (to decorate specific endpoints). Centralising the instance avoids
circular imports.

Disable in tests by setting RATE_LIMIT_ENABLED=false in the environment
before importing main.
"""

import os

from slowapi import Limiter
from slowapi.util import get_remote_address


RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"

limiter = Limiter(key_func=get_remote_address, enabled=RATE_LIMIT_ENABLED)
