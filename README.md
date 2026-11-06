# PeakSoft Security Platform (VigiloChain)

Plateforme de **détection d'intrusions IoT** pour la chaîne du froid pharmaceutique
(Industrie 4.0). Trois capteurs — frigo (le produit, 2–8 °C), thermostat (la salle)
et météo (l'extérieur) — sont suivis en temps réel.

- **Attaques de transmission** (étude principale) : modèles supervisés sur les traces réelles avec
  attaques MITM / injection, réglage d'alerte orienté précision, temps réel et rapport opérateur.
- **Ingestion temps réel** : les mesures des trois capteurs (MQTT ou rejeu du flux
  saisonnier) sont diffusées au dashboard par WebSocket.

Projet de Fin d'Études — Data Science & Cybersécurité IoT.

## Architecture

```
├── backend/                 API FastAPI + ML + services
│   ├── app/
│   │   ├── main.py          point d'entrée (lifespan : BDD, seed, MQTT, Modbus)
│   │   ├── api/v1/          routes REST (auth, etude, transmission, parametres, overview, analyst…)
│   │   ├── core/            configuration (.env) et chemins canoniques (paths.py)
│   │   ├── db/              session (PostgreSQL → repli SQLite), seed
│   │   ├── domains/         auth, devices, intelligence (OCSVM, risque), transmission, analyst (RAG + LLM)
│   │   └── services/        MQTT (agrégation 3 capteurs), Modbus
│   ├── scripts/
│   │   ├── build_dataset.py construit data/ depuis les traces brutes TON_IoT
│   │   ├── train_models.py  entraîne et compare les 4 modèles → models/
│   │   ├── transmission_real.py    traces réelles, injection des attaques, découpage et zone de garde
│   │   ├── transmission_models.py  6 modèles supervisés, réglage d'alerte unique, diagnostic, SHAP → models/transmission_reel/
│   │   ├── transmission_alertes.py persistance des alertes, métriques alerte / épisode, choix du seuil
│   │   ├── transmission_recherche.py grille d'hyperparamètres (validation croisée groupée par bloc)
│   │   ├── charger_base.py          charge l'étude dans PostgreSQL (tables transmission_*)
│   │   └── transmission_study.py   même étude sur une année simulée (banc d'essai, hypothèses déclarées)
│   └── tests/               pytest
├── frontend/                dashboard React 19 + Vite + TypeScript + Tailwind
├── notebook/Raw/            traces brutes TON_IoT (Normal + 9 types d'attaque)
├── notebook/transmission/   4 notebooks : prétraitement, injection des attaques, 6 modèles supervisés, SHAP
├── docs/resultats_finaux.md résultats finaux (tableaux pour le rapport)
├── data/                    généré (dataset_fusionne.csv, flux de démo, SQLite)
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

## Avec Docker

Une image contient le dashboard compilé et l'API (un seul port) ; PostgreSQL tourne dans son
propre conteneur. Au premier démarrage, le jeu de données est reconstruit depuis `notebook/Raw`.

```bash
cp backend/.env.example backend/.env       # JWT_SECRET_KEY, ADMIN_PASSWORD, CORS_ORIGINS, ENABLE_MQTT=false…
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env   # VIGILO_PORT=8010 pour changer de port
docker compose up -d --build                # http://localhost:8000/dashboard
docker compose exec app python -m pytest tests -q
docker compose logs -f app
```

Le port n'écoute que sur `127.0.0.1` : en production, un proxy (Caddy, nginx) le publie et doit
laisser passer les WebSockets. Les volumes `data`, `models` et `pgdata` gardent le jeu de données,
les modèles réentraînés et la base entre deux reconstructions.

## Attaques de transmission (traces réelles) — version 3

Volet « injection et MITM entre le capteur et le broker » sur les seules traces réelles TON_IoT
(62 h fusionnées à 5 s). Six modèles **supervisés** : Extra Trees, Random Forest, XGBoost,
HistGradientBoosting, Régression Logistique, MLP. Synthèse complète, tableaux prêts pour le rapport :
**[`docs/resultats_finaux.md`](docs/resultats_finaux.md)**.

**Protocole** (`backend/scripts/transmission_real.py`, `transmission_models.py`, `transmission_alertes.py`) :

- Découpage 70/15/15 **non aléatoire** par blocs d'une heure entrelacés (cycle de 20 blocs :
  14 train / 3 val / 3 test), recalculé à l'entraînement ; chaque épisode (15 à 25 min) tient dans un bloc.
- **Zone de garde de 20 min** (≥ plus longue fenêtre des features, 15 min, + 3 min de persistance) après
  chaque épisode **et** au début de chaque bloc qui change de rôle : aucune ligne apprise ou évaluée n'a de
  fenêtre qui traverse une frontière train / val / test (vérifié par
  `tests/test_transmission_protocol.py`). L'EWMA (mémoire non bornée) est retirée des features.
- **20 répétitions** = les 20 rotations du cycle (chaque heure sert 3 fois de test) ; résultats cumulés.
- **Un seul réglage d'alerte par modèle**, choisi sur la validation cumulée : un seuil et une règle de
  **persistance** (alerte si *k* des *n* dernières mesures dépassent le seuil), qui maximisent le rappel sous
  **précision ≥ 0,90** et **≤ 0,5 fausse alerte par heure**. Classement sur la validation (contrainte tenue,
  rappel, fausses alertes, délai) ; le test ne fait que confirmer.
- Hyperparamètres : petite grille en validation croisée **groupée par bloc** sur le seul train
  (`transmission_recherche.py`). Validation croisée naïve gardée comme contre-exemple.
- Déséquilibre : poids de classe, pas de SMOTE.

**Résultat** (test cumulé, 20 répétitions) : l'**Extra Trees** est retenu sur la validation ; réglage score ≥ 0,70
et 3 mesures sur 6 (30 s).

| Extra Trees, test | épisodes détectés | fausses alertes/h | précision | rappel | délai médian |
| --- | --- | --- | --- | --- | --- |
| version 3 (réglage unique) | 70/73 | 0,43 | 0,939 | 0,652 | 3,9 min |
| *avant : Random Forest, seuil max F1* | 71/73 | 3,22 | 0,771 | 0,656 | 2,2 min |
| *avant : Random Forest, rappel cible 0,90* | 73/73 | 18,55 | 0,227 | 0,873 | 0,1 min |

Diagnostic : les modèles arborescents sont parfaits sur leur train (AP 1,0) et cohérents entre validation et
test (AP 0,82 / 0,85) ; la courbe d'apprentissage monte encore avec la taille du train : limite de données, pas
sous-apprentissage. Détails, par scénario, SHAP, limites : `docs/resultats_finaux.md`.

```bash
cd backend
nice -n 10 .venv/bin/python scripts/transmission_recherche.py   # grille d'hyperparamètres (~25 min)
nice -n 10 .venv/bin/python scripts/transmission_models.py      # 20 répétitions, ~2 h 10 sur 3 cœurs
nice -n 10 .venv/bin/python scripts/transmission_biais_long.py  # étude complémentaire des biais longs, ~10 min
.venv/bin/python scripts/comparer_supervises.py                  # tableaux validation / test / train
.venv/bin/python scripts/charger_base.py                         # charge l'étude dans PostgreSQL
```

`transmission_real.py` (détecteurs non supervisés et statistiques, version précédente) reste disponible
mais n'est plus dans le comparatif.

## Site : pages et rôles

Toutes les pages de l'étude lisent **PostgreSQL** (`/api/v1/etude/*`), jamais un fichier JSON.

| Section | Page | Contenu | Rôles |
| --- | --- | --- | --- |
| Surveillance | Vue d'ensemble | indicateurs clés lus en base | admin, opérateur |
| | Temps réel | les mesures passent une à une dans le modèle sauvegardé (WebSocket `/api/v1/etude/live`) | admin, opérateur |
| | Détection vs réalité | alertes du modèle face aux épisodes réels, par rôle ; ajustement train / val / test | admin, opérateur |
| | Rapport d'alerte | consignes pour l'opérateur par type d'attaque | admin, opérateur |
| Modèle | Résultats | métriques train / val / test, classement, persistance, courbe d'apprentissage, validation croisée | admin, opérateur |
| | Explicabilité SHAP | importances globales et par scénario | admin, opérateur |
| | Jeu de données | KPI du jeu réel avec attaques | admin, opérateur |
| Administration | Entraînement | lance un entraînement (6 modèles, répétition 0), progression en direct | admin |
| | Paramètres | précision minimale, fausses alertes tolérées, vitesse du temps réel | admin |
| | Comptes, Journal d'audit | gestion des utilisateurs, traçabilité | admin |

Rôles : l'inscription publique ne crée que des **opérateurs** ; seul l'**administrateur** gère les comptes,
lance les entraînements et modifie les paramètres (403 sinon, testé dans `tests/test_etude_roles.py`).

## Base de données (tables de l'étude)

| Table | Contenu | Rempli par |
| --- | --- | --- |
| `transmission_runs` | une étude (`source` = `reference` ou `web`) : protocole, classement, résultat complet | `charger_base.py`, entraînement web |
| `transmission_model_results` | un modèle par étude (métriques du test, hyperparamètres) | idem |
| `transmission_metrics` | métriques par modèle × rôle (train / val / test) × niveau (mesure / alarme) | idem |
| `transmission_shap` | importances SHAP globales et par scénario | idem |
| `transmission_learning_curve` | courbe d'apprentissage du meilleur modèle | `charger_base.py` |
| `transmission_dataset` | le jeu de données (répétition 0) : 44 443 mesures, rôle, zone de garde | idem (+ dernier entraînement web) |
| `transmission_episodes` | les épisodes injectés (20 répétitions), détectés ou non | idem |
| `transmission_predictions` | score, signal et alarme du meilleur modèle pour chaque mesure | idem |
| `transmission_alerts` | les alertes levées (vraies ou fausses), avec début, fin, scénario | idem |
| `app_settings` | paramètres modifiables par l'administrateur | page Paramètres |

`scripts/charger_base.py` lit les sorties réelles du pipeline (`comparaison_modeles.json`,
`scores_repetition0.npz`, jeu de données, épisodes, SHAP) et remplace l'étude de référence ; il est lancé
automatiquement au démarrage de l'API quand la version en base diffère.

## Tests

```bash
backend/.venv/bin/python -m pytest      # depuis la racine
cd frontend && npx tsc -b && npm run build
```

## Stack

- **Backend** : FastAPI, SQLModel, PostgreSQL / SQLite, scikit-learn, PyTorch, SHAP
- **Frontend** : React 19, Vite 8, TypeScript, Tailwind 4, Radix UI, Recharts
- **IoT** : MQTT (gmqtt), Modbus (pymodbus)
