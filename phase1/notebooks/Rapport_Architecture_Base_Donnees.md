# Rapport : Architecture de la Base de Données IoT
## Explications pas à pas pour débutants

---

## Étape 1 : Comprendre le problème de la donnée

**Problème :** On a 3 notebooks qui génèrent et analysent des données IoT :
- Notebook 1 (génération) : produit 1,3 million de lignes CSV
- Notebook 2 (ML) : charge 13 fichiers CSV, les nettoie, les transforme
- Notebook 3 (détection) : charge des fichiers CSV + `.log` pour détecter les attaques

**Problème 2 :** Notre backend FastAPI a besoin de servir ces données en temps réel
via une API REST. Comment gérer l'accès efficace aux 45 000+ enregistrements de
télémétrie sans recharger des CSV à chaque requête ?

**Problème 3 :** On a 4 modèles ML (Isolation Forest) entraînés — comment savoir
lequel est utilisé, ses performances, sa version ?

**Solution :** Une base de données SQL avec 4 tables interconnectées.

---

## Étape 2 : Pourquoi PostgreSQL (et pas autre chose) ?

### Le choix PostgreSQL

| Base | Pourquoi on l'a choisie | Pourquoi pas les autres |
|------|------------------------|------------------------|
| **PostgreSQL** | JSON natif (`Column(JSON)` pour `digital_twin_state`), open-source, largement utilisé en entreprise | — |
| MySQL | — | Moins bon support JSON, moins adapté aux données IoT hétérogènes |
| MongoDB | — | On n'a pas besoin de document-store NoSQL ; nos données sont relationnelles (device → telemetry → model) |
| SQLite seul | — | Pas de connexions concurrentes, pas de pool de requêtes, pas adapté à un serveur multi-utilisateur |
| InfluxDB / TimescaleDB | — | Seraient justifiés pour des milliards de points, pas pour 45 000 |

**Architecture retenue :** PostgreSQL via Docker (port 5432) + **fallback automatique
vers SQLite** pour la démonstration sans Docker.

---

## Étape 3 : Le mécanisme de fallback automatique (PostgreSQL → SQLite)

### Comment ça marche ?

```python
# Fichier : app/db/session.py

# 1. On essaie de se connecter à PostgreSQL
database_url = settings.DATABASE_URL  # postgresql+asyncpg://iot_user:pass@localhost:5432/iot_security

# 2. On regarde si le port 5432 répond
def is_postgres_running(host="localhost", port=5432):
    try:
        with socket.create_connection((host, port), timeout=1):
            return True   # PostgreSQL tourne → on l'utilise
    except OSError:
        return False      # PostgreSQL pas disponible → fallback

# 3. Si PostgreSQL n'est pas joignable → on bascule sur SQLite
if "postgresql" in database_url and not is_postgres_running(db_host, db_port):
    database_url = "sqlite+aiosqlite:///Data/Processed/iot_security.db"
    print("[!] PostgreSQL not running. Falling back to local SQLite.")
```

**Résultat :**
- En démo / soutenance : SQLite (aucune installation requise)
- En production : Docker + PostgreSQL (pool de 10 connexions, timeout automatique)

**Pourquoi ça marche :** SQLAlchemy fait abstraction du moteur SQL — le même code
Python fonctionne avec PostgreSQL comme avec SQLite. Seule l'URL de connexion change.

### Différence de configuration

| Paramètre | PostgreSQL | SQLite |
|-----------|-----------|--------|
| Pool de connexions | 10 connexions simultanées | Pas de pool (connexion unique) |
| Reconnexion auto | `pool_pre_ping=True` | Pas nécessaire |
| Timeout connexion | `pool_recycle=3600s` | Pas nécessaire |
| Driver | `asyncpg` | `aiosqlite` |

---

## Étape 4 : Les 4 tables de la base de données

### Table 1 : `devices` — Les équipements IoT

```sql
CREATE TABLE devices (
    id              TEXT PRIMARY KEY,      -- 'dev-001', 'dev-002'...
    name            TEXT,                  -- 'Temperature Sensor 1'
    device_type     TEXT,                  -- 'sensor', 'camera', 'gateway'...
    ip_address      TEXT,                  -- '192.168.1.101'
    mac_address     TEXT UNIQUE,           -- '00:1A:2B:3C:4D:5E'
    manufacturer    TEXT,                  -- 'Siemens', 'Hikvision'...
    firmware_version TEXT,                 -- 'v2.1.4'
    status          TEXT,                  -- 'online' / 'offline'
    location        TEXT,                  -- 'Paris-Factory-01'
    last_seen       DATETIME,             -- dernière apparition
    registered_at   DATETIME,             -- date d'enregistrement
    risk_score      INTEGER DEFAULT 0,    -- score de risque (0-100)
    compliance_score INTEGER DEFAULT 100, -- score de conformité
    compliance_status TEXT,               -- 'compliant' / 'non-compliant'
    digital_twin_state JSON               -- état temps réel du jumeau numérique
);
```

**Illustré par les données réelles :**

```
dev-001 | Temperature Sensor 1 | sensor | 192.168.1.101 | Siemens | en ligne
dev-002 | Security Camera 1    | camera | 192.168.1.102 | Hikvision | en ligne
dev-003 | Smart Thermostat     | thermostat | 192.168.1.103 | Honeywell | en ligne
dev-004 | Entry Point Controller | gate | 192.168.1.104 | Axis | en ligne
dev-005 | Industrial IoT Gateway | gateway | 192.168.1.105 | Cisco | en ligne
dev-006 | Backup Camera 2      | camera | 192.168.1.106 | Hikvision | hors ligne
```

**Colonne `digital_twin_state` (JSON) :**

```json
// Capteur Siemens (Paris)
{"temp": 22.5, "vibration": "normal", "power": "on"}

// Caméra Hikvision
{"stream_active": true, "encoding": "h264", "fps": 30}

// Thermostat Honeywell (Berlin)
{"set_temp": 21.0, "current_temp": 21.0, "mode": "heat"}
```

**Pourquoi du JSON ?** Chaque type d'équipement a des attributs différents.
Une caméra a `encoding` et `fps` ; un capteur a `temp` et `vibration`.
Le JSON permet de stocker ces données hétérogènes sans créer 15 colonnes vides.

---

### Table 2 : `telemetry` — L'historique des mesures

```sql
CREATE TABLE telemetry (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id    TEXT REFERENCES devices(id),  -- 'dev-001', 'dev-002'
    timestamp    DATETIME,                     -- quand la mesure a été prise
    metric_key   TEXT,                         -- 'temperature', 'behavioral_twin'
    metric_value JSON                          -- la mesure elle-même
);
```

**Données réelles : 45 371 lignes de télémétrie**

Chaque ligne stocke soit :
- Une mesure brute (`temperature: 22.5`, `humidity: 65%`)
- Un snapshot complet du jumeau numérique (`metric_key = 'behavioral_twin'`) contenant
  l'état de tous les registres à un instant T

**Index :**
- `(device_id, timestamp DESC)` → retrouver rapidement les dernières mesures d'un device
- `(device_id, metric_key)` → filtrer par type de métrique

---

### Table 3 : `ml_models` — Les modèles de détection d'anomalies

```sql
CREATE TABLE ml_models (
    id                  TEXT PRIMARY KEY,    -- 'if-weather-v1', 'if-fridge-v1'
    name                TEXT,                -- 'Isolation Forest - Weather'
    model_type          TEXT,                -- 'isolation_forest'
    sensor              TEXT,                -- 'weather', 'fridge', 'thermostat', 'combine'
    version             TEXT,                -- '1.0.0'
    hyperparameters     JSON,               -- voir ci-dessous
    features            JSON,               -- liste des features
    feature_count       INTEGER,            -- nombre de features
    training_samples    INTEGER,            -- nombre d'échantillons d'entraînement
    contamination       REAL,               -- taux de contamination attendu
    n_estimators        INTEGER,            -- nombre d'arbres Isolation Forest
    anomaly_rate_normal REAL,               -- taux d'anomalie sur données normales
    score_moyen_normal  REAL,               -- score moyen de décision
    status              TEXT,               -- 'trained', 'deployed', 'archived'
    trained_at          DATETIME,           -- date d'entraînement
    model_path          TEXT,               -- chemin vers le .joblib
    scaler_path         TEXT                -- chemin vers le scaler .joblib
);
```

**Les 4 modèles enregistrés :**

| ID | Capteur | Échantillons | Features | Score normal |
|----|---------|-------------|----------|-------------|
| `if-weather-v1` | Weather | 399 188 | 8 | 0.0713 |
| `if-fridge-v1` | Fridge | 383 368 | 6 | 0.0871 |
| `if-thermostat-v1` | Thermostat | 291 182 | 5 | 0.1484 |
| `if-combine-v1` | Combine (3) | 370 972 | 19 | 0.0797 |

**Exemple des hyperparamètres (stockés en JSON) :**
```json
{
  "contamination": 0.05,
  "n_estimators": 200,
  "max_samples": "auto",
  "random_state": 42
}
```

**Exemple des features (stockées en JSON) :**
```json
// Modèle Weather (8 features)
["temperature", "humidity", "temp_diff_1", "humidity_diff_1",
 "temp_roll_mean_10", "temp_roll_std_10", "hour_sin", "hour_cos"]

// Modèle Combine (19 features)
["temperature", "humidity", "temp_diff_1", "humidity_diff_1",
 "temp_roll_mean_10", "temp_roll_std_10",
 "fridge_temperature", "temp_condition_encoded", "fridge_diff_1",
 "fridge_roll_mean_10", "current_temperature", "thermostat_status",
 "thermo_diff_1", "hour_sin_x", "hour_cos_x", "hour_sin_y",
 "hour_cos_y", "hour_sin", "hour_cos"]
```

---

### Table 4 : `model_metrics` — Les performances contre les attaques

```sql
CREATE TABLE model_metrics (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id        TEXT REFERENCES ml_models(id),
    attack_type     TEXT,                -- 'IoT_DDoS', 'IoT_MITM', etc.
    capteur         TEXT,                -- 'WEATHER', 'FRIDGE', 'THERMOSTAT'
    n_total         INTEGER,            -- nombre total d'échantillons testés
    n_anomalies     INTEGER,            -- nombre d'anomalies détectées
    taux_detection  REAL,               -- taux de détection (0-100%)
    score_moyen     REAL,               -- score moyen d'anomalie
    roc_auc         REAL,               -- AUC ROC (optionnel)
    avg_precision   REAL,               -- précision moyenne (optionnel)
    precision_normal REAL,              -- précision sur classe normale
    recall_normal   REAL,               -- rappel sur classe normale
    f1_normal       REAL,               -- F1 sur classe normale
    precision_attaque REAL,             -- précision sur attaque
    recall_attaque  REAL,               -- rappel sur attaque
    f1_attaque      REAL                -- F1 sur attaque
);
```

**Données réelles : 34 métriques importées depuis `resultats_detection.csv`**

Exemple de ce que contient la table :
```
MODEL           ATTAQUE        TOTAL   ANOMALIES   TAUX    SCORE
if-weather-v1   IoT_DDoS       7 200   6 415       89.1%   -0.312
if-weather-v1   IoT_MITM       7 200   5 832       81.0%   -0.287
if-fridge-v1    IoT_DDoS       7 200   6 915       96.0%   -0.395
if-fridge-v1    IoT_XSS        7 200   6 628       92.1%   -0.364
if-thermostat-v1 IoT_backdoor  7 200   6 264       87.0%   -0.290
if-combine-v1   IoT_injection  7 200   6 768       94.0%   -0.412
...
```

---

## Étape 5 : Comment ces tables sont reliées

```
┌──────────────────┐        ┌──────────────────┐
│      devices     │        │    telemetry     │
├──────────────────┤        ├──────────────────┤
│ id (PK) ◄──┐    │        │ id (PK)          │
│ name       │    │        │ device_id (FK) ──┘
│ device_type│    │        │ timestamp        │
│ ...        │    │        │ metric_key       │
│ risk_score │    │        │ metric_value     │
└────────────┘    │        └──────────────────┘
                  │
┌──────────────────┤        ┌──────────────────┐
│   ml_models     │        │  model_metrics   │
├──────────────────┤        ├──────────────────┤
│ id (PK)         │        │ id (PK)          │
│ sensor          │        │ model_id (FK) ───┘
│ features        │        │ attack_type      │
│ model_path      │        │ taux_detection   │
│ scaler_path ◄───┼────────┤ score_moyen      │
└──────────────────┘        └──────────────────┘
```

**Relations :**
1. `telemetry.device_id` → `devices.id` (1 device → N mesures)
2. `model_metrics.model_id` → `ml_models.id` (1 modèle → N métriques d'attaque)
3. `ml_models.scaler_path` pointe vers le scaler utilisé par le modèle

---

## Étape 6 : Les Migrations avec Alembic

**Problème :** Quand on modifie une table (ajout d'une colonne, changement de type),
il faut mettre à jour la base de données sans perdre les données existantes.

**Solution :** Alembic gère les versions de schéma.

```
iot-security-backend/
└── alembic/
    └── versions/
        ├── 001_initial_schema.py    ← création des 4 tables
        └── 002_add_ml_models.py     ← ajout des tables ML
```

**Comment appliquer une migration :**
```bash
alembic upgrade head     # Applique toutes les migrations en attente
alembic history          # Voir l'historique des migrations
alembic downgrade -1     # Revenir en arrière d'une version
```

**Pourquoi c'est important :**
- En développement : on peut modifier le schéma sans tout recréer
- En équipe : chaque développeur a la même structure de base
- En production : on peut déployer sans interruption de service

---

## Étape 7 : Les Scripts de Seed (peuplement initial)

**Problème :** Les tables sont vides à la création. Comment les remplir ?

**Solution :** 3 scripts de seed.

### Script 1 : `scripts/seed_devices.sql` (6 équipements)

Langage : SQL pur (exécuté via `psql` sur PostgreSQL ou directement SQLite).

```sql
INSERT INTO devices (id, name, device_type, ...)
VALUES
('dev-001', 'Temperature Sensor 1', 'sensor', ...),
('dev-002', 'Security Camera 1', 'camera', ...),
...
('dev-006', 'Backup Camera 2', 'camera', ...);
```

### Script 2 : `scripts/seed_ml_models.py` (4 modèles + 34 métriques)

Langage : Python + SQLAlchemy (fonctionne sur PostgreSQL ET SQLite).

Ce script :
1. Crée les 4 modèles ML dans la table `ml_models`
2. Importe les 34 métriques depuis `Data/Processed/resultats_detection.csv`
3. Utilise le même `AsyncSessionLocal` que le backend → même connexion

**Pourquoi Python et pas SQL ?** Les hyperparamètres et features sont des
objets JSON complexes. Python les sérialise naturellement.

### Script 3 : `scripts/seed_devices.py` (version Python)

Alternative au SQL pour les environnements sans `psql`.

---

## Étape 8 : Comment le backend utilise la base de données

### À chaque démarrage (`lifespan` → `init_db`)

```python
@app.asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()                    # 1. Crée les tables si elles n'existent pas
    asyncio.create_task(mqtt_service.start())    # 2. Démarre MQTT
    asyncio.create_task(modbus_service.start())  # 3. Démarre Modbus
    yield
    await close_db()                   # 4. Ferme la connexion à l'arrêt
```

### Requêtes typiques

**GET /api/devices** — Liste tous les équipements :
```python
statement = select(Device)
result = await db.execute(statement)
return result.scalars().all()
```

**GET /api/models** — Liste les modèles ML déployés :
```python
statement = select(MLModel).where(MLModel.status == "deployed")
result = await db.execute(statement)
return result.scalars().all()
```

**GET /api/telemetry** — Derniers 150 points du jumeau numérique :
```python
statement = (
    select(Telemetry)
    .where(Telemetry.metric_key == "behavioral_twin")
    .order_by(Telemetry.timestamp.desc())
    .limit(150)
)
result = await db.execute(statement)
return list(reversed(result.scalars().all()))
```

---

## Étape 9 : Récapitulatif — Le chemin complet de la donnée

```
┌─────────────────────────────────────────────────────────────────────┐
│                   1. DONNÉES BRUTES (CSV/LOG)                      │
│   Data/Raw/ ─── 5 jours réels + 9 types d'attaques                │
└──────────────────────┬──────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────────┐
│             2. NOTEBOOKS (Prétraitement & ML)                      │
│   notebooks/2_Preprocessing*.ipynb ──→ features_*.csv             │
│   notebooks/3_Detection*.ipynb    ──→ resultats_detection.csv     │
│   Notebooks génèrent isolation_forest_*.joblib                    │
└──────────────────────┬──────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────────┐
│            3. SEED SCRIPTS (scripts/seed_*.py)                     │
│   seed_ml_models.py ──→ lit les CSV .joblib et remplit la BDD     │
│   seed_devices.py   ──→ insère les 6 équipements                  │
└──────────────────────┬──────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────────┐
│              4. BASE DE DONNÉES (SQLite ou PostgreSQL)             │
│                                                                     │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐      │
│   │ devices  │   │telemetry │   │ml_models │   │ metrics  │      │
│   │ 6 lignes │   │45K lignes│   │ 4 lignes │   │34 lignes │      │
│   └────┬─────┘   └──────────┘   └────┬─────┘   └──────────┘      │
│        │                             │                            │
└────────┼─────────────────────────────┼──────────────────────────────┘
         ↓                             ↓
┌─────────────────────────────────────────────────────────────────────┐
│              5. BACKEND FASTAPI (app/main.py)                      │
│                                                                     │
│   GET /api/devices    ──→ JSON des 6 équipements                  │
│   GET /api/telemetry  ──→ 150 derniers points du jumeau           │
│   GET /api/models     ──→ 4 modèles ML avec leurs métriques       │
│   GET /api/shap/latest ──→ explication SHAP de la dernière mesure  │
│   GET /health         ──→ {"status": "healthy"}                   │
└──────────────────────┬──────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────────┐
│             6. DASHBOARD (React / static/index.html)               │
│   Affiche les équipements, la télémétrie, les alertes             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Étape 10 : Lancer le projet pas à pas

### Quand PostgreSQL n'est pas installé (SQLite automatique)

```bash
# 1. Installer les dépendances
pip install -r requirements.txt aiosqlite

# 2. Peupler la base de données
python scripts/seed_ml_models.py   # 4 modèles ML + 34 métriques
python scripts/seed_devices.py     # 6 équipements IoT

# 3. Lancer le serveur
uvicorn app.main:app --host 0.0.0.0 --port 8000
# → PostgreSQL pas trouvé, fallback vers SQLite automatique
```

### Quand PostgreSQL est disponible (via Docker)

```bash
# 1. Démarrer PostgreSQL
docker compose up -d

# 2. Appliquer les migrations
alembic upgrade head

# 3. Peupler
docker exec -i iot-postgres psql -U iot_user -d iot_security < scripts/seed_devices.sql
python scripts/seed_ml_models.py   # fonctionne aussi avec PostgreSQL

# 4. Lancer le serveur
uvicorn app.main:app --host 0.0.0.0 --port 8000
# → PostgreSQL trouvé, pool de 10 connexions
```

### Vérifier que tout fonctionne

```bash
# L'API répond
curl http://localhost:8000/health
# → {"status":"healthy"}

# Les équipements sont chargés
curl http://localhost:8000/api/devices
# → [{"id":"dev-001","name":"Temperature Sensor 1",...}, ...]

# La documentation est accessible
# → http://localhost:8000/docs
```

---

## Résumé final

| Élément | Ce qu'on a fait | Pourquoi |
|---------|----------------|----------|
| **PostgreSQL + SQLite** | Choix du moteur avec fallback automatique | Production = PostgreSQL, Démo = SQLite |
| **4 tables** | devices, telemetry, ml_models, model_metrics | Couvre tous les besoins : état des lieux, historique, ML |
| **JSON natif** | digital_twin_state, hyperparameters, features | Données hétérogènes sans multiplier les colonnes |
| **Alembic** | 2 migrations (schéma initial + ML) | Évolution du schéma sans perte de données |
| **3 scripts de seed** | seed_devices.sql, seed_devices.py, seed_ml_models.py | Peupler la base automatiquement |
| **Fallback automatique** | is_postgres_running() → SQLite si échec | Même code, deux environnements |
| **Pool de connexions** | 10 connexions (PostgreSQL) ou 1 (SQLite) | Performance adaptée au contexte |
