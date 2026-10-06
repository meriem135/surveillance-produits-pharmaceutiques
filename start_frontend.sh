#!/usr/bin/env bash
# Dashboard React (Vite). Si le backend n'est pas sur 8000 : BACKEND_URL=http://localhost:8010 ./start_frontend.sh
set -euo pipefail
cd "$(dirname "$0")/frontend"
export BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
echo "Dashboard sur http://localhost:5173 (API : ${BACKEND_URL})"
exec npx vite --port 5173
