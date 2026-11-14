# PeakSoft Security Platform (VigiloChain)

Plateforme de **détection d'intrusions IoT** pour la chaîne du froid pharmaceutique
(Industrie 4.0). Trois capteurs — frigo (le produit, mesures de 1 à 14 °C), thermostat (la salle)
et météo (l'extérieur) — sont suivis en temps réel.

- **Attaques de transmission** (étude principale) : modèles supervisés sur les traces réelles avec
  attaques MITM / injection, réglage d'alerte orienté précision, temps réel et rapport opérateur.
- **Temps réel simulé** : les mesures enregistrées repassent une à une dans le modèle sauvegardé,
  comme un flux de capteurs (le dashboard interroge l'API REST chaque seconde). Il n'y a pas
  d'ingestion de vrais capteurs : la plateforme étudie les attaques MITM / injection du trajet
  capteur → broker MQTT sur des traces réelles, mais ne contient pas de client MQTT.

Projet de Fin d'Études — Data Science & Cybersécurité IoT.

## Architecture

```
├── backend/                 API FastAPI + ML + services
│   ├── app/
│   │   ├── main.py          point d'entrée (lifespan : BDD, seed, chargement de l'étude)
│   │   ├── api/v1/          routes REST (auth, etude, transmission, parametres, overview…)
│   │   ├── core/            configuration (.env) et chemins canoniques (paths.py)
│   │   ├── db/              session (PostgreSQL), seed
│   │   ├── domains/         auth, devices, intelligence (score de risque), ml (features), transmission
│   ├── scripts/
│   │   ├── build_dataset.py construit data/ depuis les traces brutes TON_IoT
│   │   ├── transmission_real.py    traces réelles, injection des attaques, découpage et zone de garde (aucun modèle)
│   │   ├── transmission_models.py  6 modèles supervisés, réglage d'alerte unique, diagnostic, SHAP → models/transmission_reel/
│   │   ├── transmission_alertes.py persistance des alertes, métriques alerte / épisode, choix du seuil
│   │   ├── transmission_recherche.py grille d'hyperparamètres (validation croisée groupée par bloc)
│   │   └── charger_base.py          charge l'étude dans PostgreSQL (tables transmission_*)
│   └── tests/               pytest
├── frontend/                dashboard React 19 + Vite + TypeScript + Tailwind
├── notebook/Raw/            traces brutes TON_IoT (Normal + 9 types d'attaque)
├── notebook/transmission/   4 notebooks : prétraitement, injection des attaques, 6 modèles supervisés, SHAP
├── docs/resultats_finaux.md résultats finaux (tableaux pour le rapport)
├── data/                    généré (dataset_fusionne.csv, flux de démo)
├── models/                  modèles entraînés + résultats JSON (versionnés)
└── Soutenance/              notes de soutenance
```

## Comprendre le backend (fichier par fichier)

### L'idée en 30 secondes

Le backend fait deux choses bien séparées :

1. **Les scripts (`backend/scripts/`) font l'étude, hors ligne.** Ils prennent les vraies mesures
   TON_IoT, y injectent des attaques, entraînent 6 modèles, choisissent le meilleur et écrivent les
   résultats dans `models/transmission_reel/` (fichiers `.json` et `.pkl`).
2. **L'application (`backend/app/`) sert le site.** Au démarrage, elle charge ces résultats dans la
   base de données, puis répond aux pages du dashboard (API REST FastAPI).

```
 traces TON_IoT (notebook/Raw)
        │  build_dataset.py        ← lit et nettoie les traces
        ▼
 transmission_real.py               ← fusionne les 3 capteurs, découpe train/val/test, injecte les attaques
        │
 transmission_models.py             ← features + 6 modèles + choix du réglage d'alerte + SHAP
        │  (utilise transmission_alertes.py pour la règle « k mesures sur n »)
        ▼
 models/transmission_reel/*.json, meilleur_modele.pkl
        │  charger_base.py         ← lancé automatiquement au démarrage de l'API
        ▼
 base de données (tables transmission_*)  ──►  API /api/v1/...  ──►  pages React
```

Chaque fichier Python commence par un bloc **`# [RÔLE DU FICHIER]`** (à quoi sert le fichier), et chaque
fonction ou classe porte un commentaire **`# [EN BREF]`** juste au-dessus (rôle, entrée, sortie, en français
simple). Pour les retrouver : chercher `RÔLE DU FICHIER` ou `EN BREF` dans l'éditeur.

### `backend/scripts/` — l'étude Machine Learning

| Fichier | À quoi il sert | Fonctions clés |
| --- | --- | --- |
| `build_dataset.py` | Lit les traces brutes TON_IoT, les nettoie ; construit aussi une année simulée et le flux de démo. | `load_normal_traces`, `generate_year`, `inject_attacks`, `main` |
| `transmission_real.py` | **Les données de l'étude** : fusionne les 3 capteurs toutes les 5 s, découpe en train / validation / test par blocs d'une heure, ajoute la zone de garde, injecte les 9 scénarios d'attaque. Ne contient aucun modèle. | `fuse_real`, `block_split`, `build_schedule`, `inject`, `replay_flags` |
| `transmission_models.py` | **Le cœur ML** : calcule les features, entraîne les 6 modèles sur 20 répétitions, choisit le réglage d'alerte, classe les modèles, diagnostic, courbe d'apprentissage, validation croisée, SHAP ; sauvegarde le meilleur modèle. | `engineer`, `make_model`, `fit_model`, `prepare_run`, `one_run`, `operating_point`, `summarize_model`, `rank_models`, `shap_summary`, `main` |
| `transmission_alertes.py` | **La règle d'alerte** : « alarme si au moins *k* des *n* dernières mesures dépassent le seuil », comptage des vraies / fausses alertes, choix du seuil (précision ≥ 90 %, ≤ 0,5 fausse alerte/h). | `debounce`, `count`, `pool`, `grid`, `choose`, `apply` |
| `transmission_recherche.py` | Cherche les meilleurs hyperparamètres de chaque modèle (petite grille, validation croisée groupée par bloc, train seulement). | `main` |
| `comparer_supervises.py` | Affiche le tableau comparatif des 6 modèles dans le terminal. | `main` |
| `transmission_biais_long.py` | Étude complémentaire : à partir de quelle durée les petits biais (−0,5 / −1 °C) deviennent détectables. | `main`, `one_run` |
| `charger_base.py` | Copie les résultats JSON de l'étude dans la base de données (tables lues par le site). | `load` |

**Le parcours d'une répétition** (`one_run` dans `transmission_models.py`) :
`build_schedule` place les attaques → `inject` falsifie les mesures → `engineer` calcule les features →
`block_split` répartit les lignes en train / val / test → `fit_model` entraîne chaque modèle sur le train →
`scores_of` donne une probabilité d'attaque par ligne. Après les 20 répétitions : `operating_point`
choisit le seuil sur la validation, `rank_models` classe les modèles, le test confirme.

### `backend/app/` — l'application web (API)

| Fichier | À quoi il sert |
| --- | --- |
| `main.py` | Point d'entrée. Au démarrage : crée les tables, crée le compte admin, charge l'étude en base. Branche toutes les routes `/api/v1/...` et sert le dashboard compilé. |
| `core/config.py` | Les réglages lus dans `backend/.env` (base de données, secret JWT, compte admin, CORS). |
| `core/paths.py` | Tous les chemins de fichiers (data/, models/…) au même endroit. |
| `db/session.py` | Connexion à la base PostgreSQL. |
| `db/seed.py` | Données de départ : compte administrateur et paramètres par défaut. |
| `db/base_repository.py` | Opérations de base réutilisables (lire, créer, modifier, supprimer une ligne). |
| `api/deps.py` | Fabrique les services injectés dans les routes (FastAPI `Depends`). |

**Les routes (`app/api/v1/`)** — chaque fichier = un groupe d'URL :

| Fichier | URL | Rôle |
| --- | --- | --- |
| `auth.py` | `/api/v1/auth/...` (dont `auth/users`, `auth/audit-logs`) | Inscription, connexion (jeton JWT), profil, gestion des comptes et journal d'audit (admin). |
| `etude.py` | `/api/v1/etude/...` | Données des pages Jeu de données, Résultats, SHAP, Détection vs réalité, et **Temps réel** (`live/start`, `live/{id}/next`, `live/{id}`). |
| `transmission.py` | `/api/v1/transmission/...` | Lancer un entraînement (admin), suivre sa progression (`training-status`), historique, rapport opérateur, chiffres de la page d'accueil. |
| `overview.py` | `/api/v1/overview` | Indicateurs de la page Vue d'ensemble. |
| `parametres.py` | `/api/v1/parametres` | Lire / modifier les paramètres (précision minimale, fausses alertes tolérées, vitesse du temps réel). |

**La logique métier (`app/domains/`)** — les routes appellent ces fichiers :

| Dossier / fichier | À quoi il sert |
| --- | --- |
| `transmission/service.py` | Réutilise les scripts d'étude pour l'API : **entraînement web** (`train`), SHAP, rapport pour l'opérateur, résumé de l'étude. |
| `transmission/live.py` | **Temps réel** : `Streamer` fait passer les mesures une par une dans le modèle sauvegardé et suit les alertes. |
| `transmission/models.py` | Les **tables** de l'étude en base (`TransmissionRun`, `TransmissionMetric`, `TransmissionShap`, …). |
| `transmission/repository.py` | Lecture / écriture de ces tables (enregistrer un entraînement, historique, étude de référence). |
| `ml/features.py` | Les 21 features de base des capteurs (réutilisées par les scripts). |
| `ml/progress.py` | Garde les messages de progression de l'entraînement, lus par la page toutes les secondes. |
| `auth/` | Utilisateurs, mots de passe chiffrés (bcrypt), jetons JWT, rôles admin / opérateur, journal d'audit. |
| `devices/` | Équipements IoT et leurs mesures (télémétrie). |
| `intelligence/` | Score de risque des équipements (criticité, tendance). |
| `parametres.py` | Table et validation des paramètres modifiables par l'administrateur. |

**Les tests (`backend/tests/`)** vérifient le protocole (pas de fuite entre train / val / test, zone de
garde, règle k sur n), les droits (un opérateur ne peut pas gérer les comptes), l'enregistrement en base
et le temps réel. Lancer : `backend/.venv/bin/python -m pytest`.

## Lancement rapide

Linux / macOS :

```bash
./setup.sh              # venv, dépendances, dataset, entraînement des 6 modèles supervisés
cp backend/.env.example backend/.env   # puis définir JWT_SECRET_KEY et ADMIN_PASSWORD
./start_backend.sh      # http://localhost:8000  (PORT=8010 ./start_backend.sh si 8000 est pris)
./start_frontend.sh     # http://localhost:5173  (BACKEND_URL=http://localhost:8010 si besoin)
```

Windows : créer `backend\.venv`, `pip install -r backend\requirements-train.txt`, lancer
`scripts\build_dataset.py` puis `scripts\transmission_models.py` depuis `backend\`, puis
`start_backend.bat` et `start_frontend.bat`.

Le compte administrateur est créé au premier démarrage à partir de `ADMIN_USERNAME` /
`ADMIN_PASSWORD` ; l'inscription publique ne crée que des opérateurs.

Base de données : PostgreSQL (conteneur Docker).

## Avec Docker

Une image contient le dashboard compilé et l'API (un seul port) ; PostgreSQL tourne dans son
propre conteneur. Au premier démarrage, le jeu de données est reconstruit depuis `notebook/Raw`.

```bash
cp backend/.env.example backend/.env       # JWT_SECRET_KEY, ADMIN_PASSWORD, CORS_ORIGINS…
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env   # VIGILO_PORT=8010 pour changer de port
docker compose up -d --build                # http://localhost:8000/dashboard
docker compose exec app python -m pytest tests -q
docker compose logs -f app
```

Le port n'écoute que sur `127.0.0.1` : en production, un proxy (Caddy, nginx) le publie. Les volumes `data`, `models` et `pgdata` gardent le jeu de données,
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

Seuls les 6 modèles supervisés sont étudiés : Random Forest, Extra Trees, XGBoost,
HistGradientBoosting, Régression Logistique et MLP.

## Site : pages et rôles

Toutes les pages de l'étude lisent **PostgreSQL** (`/api/v1/etude/*`), jamais un fichier JSON.

| Section | Page | Contenu | Rôles |
| --- | --- | --- | --- |
| Surveillance | Vue d'ensemble | indicateurs clés lus en base | admin, opérateur |
| | Temps réel | les mesures passent une à une dans le modèle sauvegardé (polling REST `/api/v1/etude/live/*`) | admin, opérateur |
| | Détection vs réalité | alertes du modèle face aux épisodes réels, par rôle ; ajustement train / val / test | admin, opérateur |
| | Rapport d'alerte | consignes pour l'opérateur par type d'attaque | admin, opérateur |
| Modèle | Résultats | métriques train / val / test, classement, persistance, courbe d'apprentissage, validation croisée | admin, opérateur |
| | Explicabilité SHAP | importances globales et par scénario | admin, opérateur |
| | Jeu de données | KPI du jeu réel avec attaques | admin, opérateur |
| Administration | Entraînement | réentraîne le modèle retenu (répétition 0), progression mise à jour chaque seconde | admin |
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

- **Backend** : FastAPI, SQLModel, PostgreSQL, scikit-learn, PyTorch, SHAP
- **Frontend** : React 19, Vite 8, TypeScript, Tailwind 4, Radix UI, Recharts
- **Données IoT** : traces réelles TON_IoT (frigo, thermostat, météo), rejouées en temps réel simulé
