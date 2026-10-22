# PeakSoft Security Platform (VigiloChain)

Plateforme de **détection d'intrusions IoT** pour la chaîne du froid pharmaceutique
(Industrie 4.0). Trois capteurs — frigo (le produit, 2–8 °C), thermostat (la salle)
et météo (l'extérieur) — sont suivis en deux temps :

- **Phase 1 — Ingestion temps réel** : les mesures des trois capteurs (MQTT ou rejeu du flux
  saisonnier) sont diffusées en direct au dashboard par WebSocket.
- **Phase 2 — Machine Learning** : 4 détecteurs non supervisés entraînés sur le seul
  comportement normal, expliqués par SHAP, traduits en impact pharma (GMP / Annexe 11).

Projet de Fin d'Études — Data Science & Cybersécurité IoT.

## Architecture

```
├── backend/                 API FastAPI + ML + services
│   ├── app/
│   │   ├── main.py          point d'entrée (lifespan : BDD, seed, MQTT, Modbus)
│   │   ├── api/v1/          routes REST (auth, phase2, transmission, shap, pharma, analyst…)
│   │   ├── core/            configuration (.env) et chemins canoniques (paths.py)
│   │   ├── db/              session (PostgreSQL → repli SQLite), seed
│   │   ├── domains/         auth, devices, intelligence (OCSVM, risque), transmission, analyst (RAG + LLM)
│   │   └── services/        MQTT (agrégation 3 capteurs), Modbus, streaming WebSocket
│   ├── scripts/
│   │   ├── build_dataset.py construit data/ depuis les traces brutes TON_IoT
│   │   ├── train_models.py  entraîne et compare les 4 modèles → models/
│   │   ├── transmission_real.py    attaques de transmission sur les traces réelles (protocole, 20 répétitions)
│   │   ├── transmission_models.py  4 modèles supervisés, seuils, validation croisée, SHAP → models/transmission_reel/
│   │   └── transmission_study.py   même étude sur une année simulée (banc d'essai, hypothèses déclarées)
│   └── tests/               pytest
├── frontend/                dashboard React 19 + Vite + TypeScript + Tailwind
├── notebook/Raw/            traces brutes TON_IoT (Normal + 9 types d'attaque)
├── notebook/transmission/   4 notebooks : prétraitement, injection des attaques, 4 modèles supervisés, SHAP
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

## Les 4 modèles (jeu de test, seuil choisi sur la validation)

| Modèle | Principe | ROC-AUC | F1 | Faux positifs |
|---|---|---|---|---|
| OCSVM_Multivarie | frontière One-Class SVM sur 21 features | 0.921 | 0.863 | 0.02 % |
| Autoencodeur_PCA | erreur de reconstruction (PCA, 95 % de variance) | 0.901 | 0.856 | 0.01 % |
| Forecasting_LSTM | 3 LSTM prédisent chaque capteur à partir des 2 autres | 0.886 | 0.859 | 0.25 % |
| GNN_Correlation | graphe de corrélations glissantes entre capteurs | 0.837 | 0.535 | 8.9 % |

Détail par type d'attaque : `models/resultats_comparaison_final.json`.

## Attaques de transmission (traces réelles)

Volet « injection et MITM entre le capteur et le broker » sur les seules traces réelles
TON_IoT (62 h fusionnées à 5 s), sans année simulée. Quatre modèles **supervisés** :
Random Forest, XGBoost, Régression Logistique, MLP.

**Protocole** (`backend/scripts/transmission_real.py`, `transmission_models.py`) :

- Découpage 70/15/15 **non aléatoire** par blocs d'une heure entrelacés (cycle de 20 blocs :
  14 train / 3 val / 3 test), recalculé à l'entraînement par `block_split` (pas de colonne
  `split` dans le CSV). Chaque épisode d'attaque (15 à 25 min) tient dans un bloc : aucune
  attaque n'est coupée entre deux rôles.
- **Prévalence** : un épisode dans chaque bloc d'entraînement (~36 % d'attaques mesurées : les
  modèles supervisés ont besoin d'exemples), dans 2 blocs sur 5 en validation et en test
  (13,4 % et 13,5 % mesurés). La précision et le F1 dépendent de la prévalence : à 33 %
  d'attaques partout, le seuil « max F1 » glisse vers « tout signaler » et la précision est
  flatteuse (version précédente : précision 0,94 au test).
- **9 scénarios**, dont les biais −0,5 et −1 °C, gardés comme limite connue et mesurés scénario
  par scénario (rappel, épisodes détectés, délai).
- **20 répétitions** = les 20 rotations du cycle (le cycle avance d'un bloc par répétition) :
  chaque heure sert 3 fois de test et 3 fois de validation ; résultats cumulés.
- **Deux seuils**, choisis sur la validation de chaque répétition : « max F1 » et **« rappel
  cible »** (0,90 par défaut, aussi 0,80 et 0,95) = le seuil le plus haut qui atteint ce
  rappel sur la validation. Mode « rappel d'abord » : rater une attaque coûte plus qu'une
  fausse alerte.
- **Choix du modèle sur la validation uniquement** (F2 de validation au rappel cible) ; le
  test ne fait que confirmer (`comparer_supervises.py` affiche les deux).
- **Validation croisée de confirmation** : `StratifiedGroupKFold` avec le **bloc d'une heure**
  comme groupe (une attaque et les lignes normales qui partagent ses fenêtres glissantes
  restent du même côté), comparée au `StratifiedKFold` naïf, gardé comme contre-exemple.
- **Déséquilibre des classes** : `class_weight`, `scale_pos_weight`, `sample_weight` ; **pas de
  SMOTE** : sur une série temporelle, des points interpolés entre deux lignes d'attaque
  fabriqueraient des fenêtres glissantes qui n'existent pas, et le sur-échantillonnage ne
  change pas la prévalence réelle, qui seule fixe la précision. Le levier est le seuil.
- Ordre des métriques partout : rappel, fausses alertes/heure, délai, précision, F1/F2.

**Résultats** (20 répétitions, test cumulé, `models/transmission_reel/comparaison_modeles.json`) :
le Random Forest est retenu sur la validation (F2 0,562 au rappel cible 0,90 ; XGBoost 0,558).

| Random Forest, test | rappel | FA/h | délai médian | précision | F1 | F2 |
| --- | --- | --- | --- | --- | --- | --- |
| seuil rappel cible 0,90 | 0,873 | 18,6 | 0,1 min | 0,227 | 0,361 | 0,557 |
| seuil max F1 | 0,656 | 3,2 | 2,2 min | 0,771 | 0,709 | 0,676 |

Viser 90 % de rappel coûte cher : environ 46 % des lignes normales sont alors signalées.
Au seuil max F1, les petits biais ne sont signalés que sur 22,9 % (−0,5 °C) et 44,2 % (−1 °C)
de leurs lignes, pour 3 % des lignes normales : **non détectables de façon fiable en 15–25 min
à ce niveau de bruit** (σ ≈ 3,4 °C par mesure). L'étude complémentaire
`transmission_biais_long.py` (blocs de 4 h, épisodes de 1 à 3 h, seuil ≤ 1 fausse alerte/h sur
la validation) montre qu'ils deviennent détectables en une heure environ : biais −0,5 °C
détecté avant 60 min dans 14 épisodes sur 15 (délai médian 20 min), −1 °C dans 15 sur 15
(délai médian 9,5 min), sur 30 épisodes de test seulement.

Validation croisée (répétition 0, rappel / précision moyens, seuil 0,5) : Random Forest
0,622 / 0,863 groupée par bloc, contre 0,983 / 0,994 en naïf (fuite).

- `notebook/transmission/01…04` : exploration et prétraitement, injection des 9 scénarios,
  4 modèles (validation croisée naïve et groupée, deux seuils, courbe précision-rappel), SHAP.
- Page **Transmission** du dashboard : entraînement des 4 modèles en direct (WebSocket
  `/api/v1/transmission/train-ws`), sélecteur de rappel cible, résultats validation et test,
  courbe précision-rappel, détection par scénario, validation croisée, biais longs, SHAP et
  rapport pour l'opérateur (`GET /api/v1/transmission/report`, consigne par alerte via `POST`).

```bash
cd backend
nice -n 10 .venv/bin/python scripts/transmission_models.py      # ~1 h 55 sur 3 cœurs (dont SHAP ~70 min, SKIP_SHAP=1)
nice -n 10 .venv/bin/python scripts/transmission_real.py        # détecteurs non supervisés, ~31 min
nice -n 10 .venv/bin/python scripts/transmission_biais_long.py  # ~9 min
.venv/bin/python scripts/comparer_supervises.py                  # classement sur la validation
```

Les trois scripts sont indépendants (seul `transmission_models.py` écrit le jeu de données).

## Tests

```bash
backend/.venv/bin/python -m pytest      # depuis la racine
cd frontend && npx tsc -b && npm run build
```

## Stack

- **Backend** : FastAPI, SQLModel, PostgreSQL / SQLite, scikit-learn, PyTorch, SHAP
- **Frontend** : React 19, Vite 8, TypeScript, Tailwind 4, Radix UI, Recharts
- **IoT** : MQTT (gmqtt), Modbus (pymodbus)
