# Domaines métier

Chaque dossier correspond à un domaine fonctionnel de la plateforme :

| Dossier | Rôle | Fichiers principaux |
|---------|------|---------------------|
| `ml/` | ML: entités, registry, repository, schemas, service | `entities.py`, `registry.py`, `repository.py`, `schemas.py`, `service.py` |
| `intelligence/` | ML inference, risk scoring, DPI, MLflow tracker | `ml_service.py`, `risk_service.py`, `mqtt_dpi_service.py`, `mlflow_tracker.py` |
| `devices/` | Gestion des équipements IoT & télémétrie | `service.py`, `repository.py` |
| `analyst/` | Analyse IA via LLM + RAG (base de connaissances) | `analyst_service.py`, `llm_engine.py`, `knowledge_base.py` |
| `auth/` | Authentification JWT & audit | `service.py`, `models.py`, `audit.py` |
