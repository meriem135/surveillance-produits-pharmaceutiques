# PeakSoft Security Platform (VigiloChain)

Plateforme de **détection d'intrusions IoT** pour la chaîne du froid pharmaceutique
(Industrie 4.0). Trois capteurs — frigo (le produit, 2–8 °C), thermostat (la salle)
et météo (l'extérieur) — sont surveillés par deux couches :

- **Phase 1 — DPI temps réel** : 4 règles d'inspection sur chaque paquet MQTT, score de
  risque 0–100 et consigne opérateur.
- **Phase 2 — Machine Learning** : 4 détecteurs non supervisés entraînés sur le seul
  comportement normal, expliqués par SHAP, traduits en impact pharma (GMP / Annexe 11).

Projet de Fin d'Études — Data Science & Cybersécurité IoT.

## Architecture

```
├── backend/                 API FastAPI + ML + services
│   ├── app/
│   │   ├── main.py          point d'entrée (lifespan : BDD, seed, MQTT, Modbus)
│   │   ├── api/v1/          routes REST (auth, dpi, phase2, shap, pharma, analyst…)
│   │   ├── core/            configuration (.env) et chemins canoniques (paths.py)
│   │   ├── db/              session (PostgreSQL → repli SQLite), seed
│   │   ├── domains/         auth, devices, intelligence (DPI, OCSVM, risque), analyst (RAG + LLM)
│   │   └── services/        MQTT (agrégation 3 capteurs), Modbus, streaming WebSocket
│   ├── scripts/
│   │   ├── build_dataset.py construit data/ depuis les traces brutes TON_IoT
│   │   └── train_models.py  entraîne et compare les 4 modèles → models/
│   └── tests/               pytest
├── frontend/                dashboard React 19 + Vite + TypeScript + Tailwind
├── notebook/Raw/            traces brutes TON_IoT (Normal + 9 types d'attaque)
├── data/                    généré (dataset_fusionne.csv, flux de démo, SQLite, journal DPI)
├── models/                  modèles entraînés + résultats JSON (versionnés)
└── Soutenance/              notes de soutenance
```

## Lancement rapide

Linux / macOS :

```bash
./setup.sh              # venv, dépendances, dataset, entraînement des 4 modèles (~2 min)
cp backend/.env.example backend/.env   # puis définir JWT_SECRET_KEY et ADMIN_PASSWORD
./start_backend.sh      # http://localhost:8000  (PORT=8010 ./start_backend.sh si 8000 est pris)
./start_frontend.sh     # http://localhost:5173  (BACKEND_URL=http://localhost:8010 si besoin)
```

Windows : créer `backend\.venv`, `pip install -r backend\requirements-train.txt`, lancer
`scripts\build_dataset.py` puis `scripts\train_models.py` depuis `backend\`, puis
`start_backend.bat` et `start_frontend.bat`.

Le compte administrateur est créé au premier démarrage à partir de `ADMIN_USERNAME` /
`ADMIN_PASSWORD` ; l'inscription publique ne crée que des opérateurs.

Services optionnels (tous désactivables dans `.env`) : PostgreSQL (sinon SQLite),
broker Mosquitto (`ENABLE_MQTT`, `ENABLE_EDGE_SIMULATOR`), automate Modbus
(`ENABLE_MODBUS`), Ollama pour l'analyste IA (sinon rapports par templates),
OpenSearch/Wazuh.

## Les 4 modèles (jeu de test, seuil choisi sur la validation)

| Modèle | Principe | ROC-AUC | F1 | Faux positifs |
|---|---|---|---|---|
| OCSVM_Multivarie | frontière One-Class SVM sur 21 features | 0.921 | 0.863 | 0.02 % |
| Autoencodeur_PCA | erreur de reconstruction (PCA, 95 % de variance) | 0.901 | 0.856 | 0.01 % |
| Forecasting_LSTM | 3 LSTM prédisent chaque capteur à partir des 2 autres | 0.886 | 0.859 | 0.25 % |
| GNN_Correlation | graphe de corrélations glissantes entre capteurs | 0.837 | 0.535 | 8.9 % |

Détail par type d'attaque : `models/resultats_comparaison_final.json`.

## Tests

```bash
backend/.venv/bin/python -m pytest      # depuis la racine
cd frontend && npx tsc -b && npm run build
```

## Stack

- **Backend** : FastAPI, SQLModel, PostgreSQL / SQLite, scikit-learn, PyTorch, SHAP
- **Frontend** : React 19, Vite 8, TypeScript, Tailwind 4, Radix UI, Recharts
- **IoT** : MQTT (gmqtt), Modbus (pymodbus)
