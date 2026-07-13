# Rapport Technique de Stage

## Plateforme de Sécurité Industrielle PeakSoft Cyber-Guardian

**Stagiaire :** Meriem — Security Intelligence  
**Phases :** 1 & 2 — Fondation, Ingestion Sécurisée, IA & Dashboard React

---

# Partie I : Introduction

## 1.1 Contexte Industriel

L'Industrie 4.0 connecte des capteurs IoT (température, humidité) à des réseaux IP via le protocole MQTT. Cette ouverture expose les infrastructures critiques à des cyberattaques. Les solutions traditionnelles sont insuffisantes face aux attaques exploitant les protocoles IoT eux-mêmes.

**PeakSoft Cyber-Guardian** répond par une plateforme combinant :

- **3 capteurs IoT** : Weather, Fridge, Thermostat
- **Digital Twin** : Réplique virtuelle synchronisée des équipements
- **Deep Packet Inspection (DPI)** : 6 règles d'analyse temps réel du trafic MQTT
- **Machine Learning** : Détection d'anomalies par Isolation Forest
- **XAI** : Explicabilité des décisions via SHAP
- **Dashboard React** : Interface de supervision temps réel

## 1.2 Architecture Globale

```
+-------------------------------+
|   Capteurs IoT (MQTT)        |
|  Weather - Fridge - Thermostat|
+--------------+----------------+
               |
+--------------v----------------+
|   PeakSoft Intelligence       |
|   Layer (FastAPI/Python)      |
|                                |
|  +---------+  +-------------+ |
|  | MQTT    |  | ML Anomaly  | |
|  | DPI     |  | Detector    | |
|  | (6 rules)| | (IForest)   | |
|  +----+----+  +------+------+ |
|       |              |        |
|  +----v--------------v------+ |
|  |   Digital Twin State     | |
|  +----+---------------------+ |
+-------|------------------------+
        |
+-------v------------------------+
|  PostgreSQL + WebSocket API    |
|  + React Frontend (Vite)       |
+--------------------------------+
```

---

# Partie II : Phase 1 — Fondation & Ingestion Sécurisée

## 2.1 Architecture Base de Données

**Problème :** La duplication entre modèles Pydantic (API) et SQLAlchemy (BDD) crée une dérive de synchronisation.

**Solution : SQLModel + Domain-Driven Design**

```
app/
+-- domains/
    +-- devices/
    |   +-- models.py        # SQLModel (Device, Telemetry)
    |   +-- schemas.py       # Pydantic (validation API)
    |   +-- repository.py    # Accès aux données
    |   +-- service.py       # Logique métier
    +-- intelligence/
    |   +-- ml_service.py    # Isolation Forest + SHAP
    |   +-- mqtt_dpi_service.py  # Règles DPI
    +-- ml_models/
        +-- models.py        # Tables MLModel, ModelMetric
        +-- schemas.py
        +-- repository.py
        +-- service.py
```

**Choix techniques :**
- **SQLModel** : Modèle unifié Pydantic + SQLAlchemy — élimine la duplication
- **asyncpg** : Driver PostgreSQL asynchrone — pas de blocage de l'event loop
- **Repository Pattern** : Découplage logique métier / stockage
- **Fallback SQLite** : Détection automatique de PostgreSQL au démarrage

### Schéma relationnel

```
devices (id PK, name, device_type, digital_twin_state JSON, last_seen, risk_level)
   |
   +-- telemetry (id PK, device_id FK, timestamp, temperature, humidity, pressure, status)
   |
ml_models (id PK, name, model_type, sensor, hyperparameters JSON, features JSON)
   |
   +-- model_metrics (id PK, model_id FK, attack_type, taux_detection, score_moyen)
```

### Fichiers clés
- `iot-security-backend/app/domains/devices/models.py`
- `iot-security-backend/app/db/session.py`

---

## 2.2 MQTT Deep Packet Inspection (DPI)

**Problème :** Les messages MQTT transportent des données IoT non filtrées, vulnérables à l'injection.

**Solution :** 6 règles d'inspection appliquées à chaque message avant persistance :

| Règle | Code | Déclencheur | Action |
|-------|------|------------|--------|
| DPI-001 | `rule_attack_label` | Label "attack" dans le payload | Critique (level 3) |
| DPI-002 | `rule_noise_factor` | Facteur de bruit > 0.04 | Haute (level 2) |
| DPI-003 | `rule_packet_loss` | Perte de paquet simulée | Haute (level 2) |
| DPI-004 | `rule_out_of_range` | Valeur hors seuils capteur | Variable (1-3) |
| DPI-005 | `rule_generic_spike` | Valeur > 1000 | Haute (level 2) |
| DPI-006 | `rule_invalid_humidity` | Humidité < 0% ou > 100% | Basse (level 1) |

**Seuils par capteur (DPI-004) :**
```python
SENSOR_THRESHOLDS = {
    "weather":    {"temperature": (0, 60), "humidity": (0, 100), "pressure": (800, 1200)},
    "fridge":     {"Fridge_Temperature": (-5, 20)},
    "thermostat": {"current_temperature": (10, 50)},
}
```

### Fichiers clés
- `iot-security-backend/app/domains/intelligence/mqtt_dpi_service.py`
- `iot-security-backend/app/services/mqtt_service.py`

---

## 2.3 Simulateur de Streaming Temps Réel

**Problème :** Le dataset TON_IoT est statique (CSV). Besoin d'un flux continu pour tester DPI et ML.

**Solution : Simulateur Asynchrone Multi-Capteurs**

- **Architecture asyncio** : Une coroutine par device, parallélisée via `asyncio.gather`
- **3 modes** : `normal`, `attack`, `mixed`
- **Mapping CSV réel** : Les fichiers TON_IoT sont lus et streamés avec délai configurable
- **Topics MQTT** : `factory/{device_id}/telemetry`

```bash
python scripts/mqtt_simulator_ton_iot.py \
    --host localhost --port 1883 \
    --mode mixed --delay-min 0.5 --delay-max 2.0
```

### Fichier clé
- `iot-security-backend/scripts/mqtt_simulator_ton_iot.py`

---

## 2.4 Exploration & Prétraitement (EDA)

### Exploration
| Capteur | Lignes | Caractéristiques |
|---------|--------|------------------|
| Weather | 399 189 | Température 20-50°C, pression négative aberrante → exclue |
| Fridge | 383 369 | Cycle high/low (56%/44%), température 1-14°C |
| Thermostat | 291 183 | Température stable 25-35°C, ON 89% du temps |

**Corrélations inter-capteurs :** Weather vs Fridge r = -0.94, Weather vs Thermostat r = -0.97

### Feature Engineering (25 features)

| Feature | Formule | Rôle |
|---------|---------|------|
| Δt (diff) | X(t) - X(t-1) | Détection des changements brusques |
| Moyenne mobile | moyenne(X(t-9)...X(t)) | Lissage du bruit capteur |
| Écart-type mobile | σ(X(t-9)...X(t)) | Mesure de volatilité |
| Heure sin/cos | sin(2π×h/24), cos(2π×h/24) | Encodage cyclique |
| Z-score | (x - μ) / σ | Normalisation StandardScaler |

### Fichiers clés
- `notebooks/1_EDA_Exploration_Capteurs_IoT_executed.ipynb`
- `scripts/phase2_preprocess.py`

---

# Partie III : Phase 2 — Intelligence Artificielle & Dashboard

## 3.1 Infrastructure MQTT

### Broker Mosquitto
- Déploiement Docker avec persistance des messages
- RBAC préparé via fichier de mots de passe

### Client MQTT Asynchrone (gmqtt)
Intégré au cycle de vie FastAPI via `lifespan` :
- Abonnement au pattern `factory/+/telemetry`
- Parsing des topics → extraction `device_id`
- Normalisation des timestamps UTC
- Validation des clés étrangères

### Pipeline de Message
```
MQTT brut → Parsing JSON → Extraction device_id
  → Normalisation timestamp → Inspection DPI (6 règles)
  → Persistance asynchrone (PostgreSQL)
  → Mise à jour Digital Twin
  → Push WebSocket vers React
```

### Fichiers clés
- `iot-security-backend/app/services/mqtt_service.py`
- `iot-security-backend/app/main.py`

---

## 3.2 Digital Twin — Synchronisation Temps Réel

**Principe :** Mise à jour transactionnelle de `Device.digital_twin_state` (JSON) et `Device.last_seen` à chaque message MQTT, dans la même transaction que l'insertion de télémétrie.

**API :**
- `GET /devices/{id}/telemetry` → 50 dernières mesures
- `WS /ws/stream` → Push temps réel vers React

---

## 3.3 Dashboard React

**Stack :** React 19 + TypeScript + Vite + Tailwind CSS + Recharts + Framer Motion

### Composants
| Composant | Rôle |
|-----------|------|
| `DashboardPage.tsx` | Vue principale (Digital Twin + simulateur) |
| `KpiGrid.tsx` | KPIs (température, humidité, score ML) |
| `TimelineChart.tsx` | Graphiques d'évolution temporelle |
| `XaiPanel.tsx` | Panneau d'explicabilité SHAP |
| `AttackSimulator.tsx` | Simulation d'attaques (DDoS, MITM, Ransomware) |
| `TwinStatus.tsx` | État du Digital Twin |
| `AlertTable.tsx` | Tableau des alertes DPI |
| `ThemeContext.tsx` | 4 thèmes : dark, cyberpunk, matrix, light |

### Flux de données
```
Capteurs IoT (MQTT) → FastAPI → DPI + ML + SHAP
  → PostgreSQL → WebSocket → React (Recharts)
```

### Fichiers clés
- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/components/XaiPanel.tsx`
- `frontend/src/hooks/useTelemetry.ts`

---

## 3.4 Détection d'Anomalies — Isolation Forest

**Principe :** Les anomalies sont isolées rapidement par des coupes aléatoires (arbres de décision). Un point normal nécessite plus de coupes.

### Modèles Entraînés

| Modèle | Features | Échantillons | Performance |
|--------|----------|-------------|-------------|
| Weather | 8 | 399 188 | **99.4%** |
| Fridge | 6 | 383 368 | **98.5%** |
| Thermostat | 5 | 291 182 | 33.2% |
| **Combiné** | **19** | **370 972** | **100%** |

### Résultats par Attaque

| Attaque | Weather | Fridge | Combiné |
|---------|---------|--------|---------|
| DDoS | 100.0% | 97.8% | 100.0% |
| DoS | 100.0% | 99.8% | 100.0% |
| MITM | 100.0% | 100.0% | 100.0% |
| XSS | 100.0% | 99.6% | 100.0% |
| Backdoor | 100.0% | 98.6% | — |
| Injection | 99.4% | 99.8% | 100.0% |
| Password | 100.0% | 98.5% | 100.0% |
| Ransomware | 97.5% | 93.8% | 100.0% |
| Scanning | 74.2% | 99.4% | 100.0% |

**Analyse :**
- **Weather** : 100% sur 7/9 attaques — grande variance naturelle (20-50°C)
- **Fridge** : >93% sur toutes — variable `temp_condition` discriminante
- **Thermostat** : 5-54% — température trop stable (σ=2.4), ON 89%
- **Combiné** : 100% quand la fusion inter-capteurs est possible

### Pipeline Inférence Temps Réel
```
Nouvelle télémétrie → Feature engineering → Normalisation
  → Score Isolation Forest → SHAP explication
  → Décision (score < seuil) → Mise à jour Digital Twin
  → Notification dashboard
```

### Fichiers clés
- `iot-security-backend/app/domains/intelligence/ml_service.py`
- `iot-security-backend/scripts/train_anomaly_detector.py`

---

## 3.5 Explicabilité IA (SHAP)

**Problème :** Un modèle ML sans explication est inutilisable en sécurité industrielle.

**Solution :** SHAP TreeExplainer calcule la contribution de chaque feature :

```
Exemple : Alerte Weather
  → Température = 44.4°C (contribution : +0.32)
  → Δt = +8.2°C (contribution : +0.45 — saut brusque)
  → Score : -0.82 -> ANOMALIE
```

Les 3 features les plus contributrices sont exposées via `/api/shap/latest` et affichées dans le `XaiPanel.tsx`.

---

## 3.6 Concept Drift Monitoring

**Méthode :** Test KS-2-sample entre distribution d'entraînement et les 1000 dernières prédictions. Seuil : p-value < 0.05.

**API :** `GET /api/v1/drift/status` et `GET /api/v1/drift/history`

---

# Partie IV : API & Intégration

## WebSocket
- `WS /ws/stream` — Streaming temps réel (télémétrie + scores ML)

## REST API
| Endpoint | Description |
|----------|-------------|
| `GET /api/telemetry` | 150 dernières mesures |
| `GET /api/devices` | Tous les devices |
| `GET /api/shap/latest` | Dernière analyse SHAP |
| `POST /api/attack/toggle` | Simulation d'attaque |
| `GET /api/v1/devices/stats/summary` | Statistiques devices |
| `GET /api/v1/alerts` | Alertes DPI (filtrables) |
| `GET /api/v1/drift/status` | Statut de dérive conceptuelle |

---

# Partie V : Bilan & Perspectives

## 5.1 Résultats

| Domaine | Livrable | Statut |
|---------|----------|--------|
| Base de données | SQLModel + DDD + Repository | Ok |
| MQTT DPI | 6 règles d'inspection temps réel | Ok |
| Simulateur | Streaming asynchrone 3 capteurs | Ok |
| EDA | Analyse exploratoire complète | Ok |
| Feature Engineering | 25 features + normalisation | Ok |
| Broker MQTT | Mosquitto intégré Docker | Ok |
| Digital Twin | Synchronisation temps réel | Ok |
| Isolation Forest | 4 modèles, 99%+ détection | Ok |
| SHAP | Explicabilité des décisions IA | Ok |
| Concept Drift | Surveillance KS-test | Ok |
| Dashboard React | Interface temps réel (Vite + TS) | Ok |

## 5.2 Stack Technologique

- **Backend** : Python 3.10+, FastAPI, SQLModel, asyncpg
- **IA/ML** : scikit-learn, SHAP, scipy, joblib
- **Protocoles** : MQTT (gmqtt, Mosquitto)
- **Base** : PostgreSQL + SQLite (fallback)
- **Frontend** : React 19, TypeScript, Vite, Tailwind CSS, Recharts
- **Streaming** : WebSockets (FastAPI)

## 5.3 Perspectives (Phase 3)

- Pipeline CVE avec scoring prédictif
- Interface Threat Intelligence enrichie
- Durcissement sécurité (TLS/mTLS, RBAC)
- Tests d'intrusion sur scénarios d'attaque simulés

---

*Document confidentiel — PeakSoft Security Platform — Juin 2026*
