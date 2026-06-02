#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

if [ ! -f ".env" ]; then
  echo "No .env file found. Copying from .env.example..."
  cp .env.example .env
  echo "Edit backend/.env to add your FX_API_KEY and NEWSAPI_KEY."
fi

# --proxy-headers trusts X-Forwarded-For from localhost (127.0.0.1) only,
# which is correct for local dev where there is no reverse proxy.
uvicorn main:app --reload --port 8000 --reload-exclude venv \
  --proxy-headers --forwarded-allow-ips=127.0.0.1
