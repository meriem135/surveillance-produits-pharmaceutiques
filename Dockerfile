# VigiloChain : une seule image (dashboard React compilé + API FastAPI, un seul port).
#   docker compose up -d --build        (voir docker-compose.yml)
# Au premier démarrage, le jeu de données est reconstruit depuis notebook/Raw dans le volume data/.

# ── 1. Dashboard React (Vite) ────────────────────────────────────────────────
FROM node:22-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ── 2. API FastAPI + modèles ─────────────────────────────────────────────────
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
# libgomp1 : OpenMP pour xgboost et scikit-learn ; curl : contrôle de santé
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Dépendances d'abord (couche mise en cache tant que les requirements ne changent pas) ; torch en version CPU
COPY backend/requirements.txt backend/requirements-train.txt backend/requirements-dev.txt backend/
# xgboost 3 dépend de NCCL (305 Mo, multi-GPU uniquement) : inutile sur CPU, retiré puis vérifié.
RUN pip install -r backend/requirements-train.txt -r backend/requirements-dev.txt \
      --extra-index-url https://download.pytorch.org/whl/cpu \
 && pip uninstall -y nvidia-nccl-cu13 nvidia-nccl-cu12 \
 && python -c "import numpy as np, torch, xgboost; xgboost.XGBClassifier(n_estimators=2).fit(np.random.rand(20, 3), np.arange(20) % 2); print('torch', torch.__version__, 'xgboost', xgboost.__version__)"
COPY backend/ backend/
COPY notebook/Raw/ notebook/Raw/
COPY models/ models/
COPY --from=frontend /src/frontend/dist/ backend/static/
COPY docker/entrypoint.sh /usr/local/bin/vigilochain-entrypoint
RUN chmod 755 /usr/local/bin/vigilochain-entrypoint \
 && useradd --system --create-home --uid 10001 vigilo \
 && mkdir -p data \
 && chown -R vigilo:vigilo /app
USER vigilo
WORKDIR /app/backend
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/docs > /dev/null || exit 1
ENTRYPOINT ["vigilochain-entrypoint"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
