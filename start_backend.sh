#!/usr/bin/env bash
# Backend FastAPI. Port modifiable : PORT=8010 ./start_backend.sh
set -euo pipefail
cd "$(dirname "$0")/backend"
PORT="${PORT:-8000}"
echo "Backend sur http://localhost:${PORT} (docs : /docs)"
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
