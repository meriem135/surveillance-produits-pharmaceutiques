# PeakSoft Security Platform

Plateforme de **détection d'intrusions IoT** pour environnements SCADA industriels.
Projet de Fin d'Études — Data Science & Cybersécurité.

## Architecture

```
├── backend/              ← API FastAPI + ML + services
│   ├── app/
│   │   ├── main.py       ← Point d'entrée
│   │   ├── api/v1/       ← Routes REST
│   │   ├── core/         ← Configuration
│   │   ├── db/           ← Session BDD + BaseRepository
│   │   ├── domains/      ← Logique métier par domaine
│   │   │   ├── ml/           ← ML: entities, registry, repository, schemas, service
│   │   │   ├── intelligence/ ← ML inference, risk scoring, DPI, MLflow tracker
│   │   │   ├── devices/      ← Gestion des équipements IoT & télémétrie
│   │   │   ├── analyst/      ← LLM + RAG (base de connaissances)
│   │   │   ├── auth/         ← Authentification JWT & audit
│   │   ├── services/     ← MQTT, Modbus, WebSocket, streaming temps réel
│   │   └── models/       ← Modèles ML exportés (joblib)
│
├── frontend/             ← Dashboard React + Vite + TypeScript
│   └── src/
│       ├── pages/        ← Pages de l'application
│       ├── components/   ← Composants réutilisables
│       ├── hooks/        ← Hooks personnalisés
│       └── contexts/     ← Contextes (thème)
│
├── notebooks/            ← Notebooks Jupyter (recherche)
│   └── phase2/           ← Modélisation ML, Optuna, SHAP
│
├── data/                 ← Données (raw, processed, generated)
├── models/               ← Modèles ML versionnés (joblib + hyperparams)
└── scripts/              ← Scripts utilitaires
    ├── seed/             ← Peuplement BDD
    ├── simulate/         ← Simulateurs MQTT/Modbus
    └── evaluate/         ← Évaluation & benchmark
```

## Stack

- **Backend** : FastAPI, SQLModel, PostgreSQL (fallback SQLite), scikit-learn, SHAP
- **Frontend** : React 19, Vite 8, TypeScript, Tailwind 4, Radix UI, Recharts
- **ML** : One-Class SVM, Autoencodeur, LSTM, SHAP, MLflow, Optuna
- **IoT** : MQTT (paho/gmqtt), Modbus (pymodbus)
- **DevOps** : Docker, GitHub Actions

## Lancement rapide

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

## Auteur

Projet réalisé dans le cadre du PFE — Data Science & Cybersécurité IoT.
