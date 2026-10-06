#!/usr/bin/env bash
# Installation complète (Linux / macOS) : dépendances, dataset, entraînement des 4 modèles.
set -euo pipefail
cd "$(dirname "$0")"

echo "[1/4] Environnement Python (backend/.venv)"
if [ ! -x backend/.venv/bin/python ]; then
  python3 -m venv backend/.venv 2>/dev/null || {
    # Debian/Ubuntu sans python3-venv : venv sans pip + bootstrap
    python3 -m venv --without-pip backend/.venv
    curl -sS https://bootstrap.pypa.io/get-pip.py | backend/.venv/bin/python
  }
fi
backend/.venv/bin/pip install -q -r backend/requirements-train.txt \
  --extra-index-url https://download.pytorch.org/whl/cpu

echo "[2/4] Dépendances frontend"
(cd frontend && npm ci --no-audit --no-fund)

echo "[3/4] Dataset (data/processed, data/generated)"
(cd backend && .venv/bin/python scripts/build_dataset.py)

echo "[4/4] Entraînement des 4 modèles (models/)"
(cd backend && .venv/bin/python scripts/train_models.py)

echo "Terminé. Lancez ./start_backend.sh puis ./start_frontend.sh"
