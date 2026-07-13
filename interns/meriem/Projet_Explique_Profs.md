# Projet : Détection d'Intrusions par IA sur Capteurs IoT Industrie 4.0

## Présenté par : Meriem
## Track A — Security Intelligence

---

## Table des matières

1. [Contexte et Problématique](#1-contexte-et-problématique)
2. [Où sont envoyées les données capteur ?](#2-où-sont-envoyées-les-données-capteur)
3. [Comment l'industrie détecte les attaques aujourd'hui ?](#3-comment-lindustrie-détecte-les-attaques-aujourdhui)
4. [Limites des solutions actuelles](#4-limites-des-solutions-actuelles)
5. [Ma solution : Pipeline IA en 3 phases](#5-ma-solution--pipeline-ia-en-3-phases)
6. [Phase 1 : Deep Packet Inspection (DPI)](#6-phase-1--deep-packet-inspection-dpi)
7. [Phase 2 : Behavioral Twin & Machine Learning](#7-phase-2--behavioral-twin--machine-learning)
8. [Phase 3 : Risk Scoring Prédictif (CVE + IA)](#8-phase-3--risk-scoring-prédictif-cve--ia)
9. [Dashboard SOC](#9-dashboard-soc)
10. [Stack Technologique](#10-stack-technologique)
11. [Conclusion](#11-conclusion)

---

## 1. Contexte et Problématique

### L'Industrie 4.0

L'industrie 4.0 connecte des **milliers de capteurs** (température, humidité, pression) dans les usines via des protocoles légers comme **MQTT** (Message Queuing Telemetry Transport). Ces capteurs sont critiques pour la production :

- Un frigo industriel qui dérive → **produits avariés**
- Une pression qui augmente anormalement → **explosion / accident**
- Un capteur usurpé → **décision industrielle erronée**

### Le Problème de Sécurité

Ces capteurs IoT sont la **porte d'entrée des cyberattaques** car :
- Ils sont légers et peu sécurisés (pas d'antivirus possible)
- Ils tournent 24h/24 sans surveillance humaine
- Les attaques sont de plus en plus sophistiquées (DDoS, injection, backdoor, ransomware)

> **Problématique** : *Comment détecter en temps réel des cyberattaques sur des capteurs IoT industriels, y compris les attaques inconnues (zero-day), avec un système explicable et économique ?*

---

## 2. Où sont envoyées les données capteur ?

### Dans l'industrie classique

```
CAPTEUR PHYSIQUE (PT100, thermocouple, pressostat)
       │
       ▼
Convertisseur Analogique/Numérique (4-20mA, 0-10V)
       │
       ▼
PLC (Automate) - Programme Ladder
       │  (si temperature > seuil → action)
       │
       ▼
SCADA (Supervisory Control And Data Acquisition)
       │  ── Wonderware, Ignition, WinCC
       │  ── Affiche les valeurs sur un écran
       │  ── Opérateur regarde 8h/jour
       │
       ├──→ Historien (OSIsoft PI, Canary Labs)
       │     Stock les données pour audit
       │
       └──→ ⚠️ Système FERMÉ (air-gapped)
            Pas d'API, pas d'accès externe
```

**Conclusion** : Les données restent **dans l'usine**, sur des systèmes propriétaires verrouillés, sans API moderne.

### Dans mon projet

```
CAPTEUR IoT (fridge, thermostat, weather)
       │
       ▼
Passerelle IoT
       │
       ▼
Broker MQTT (Mosquitto)
       │  topic: factory/{device_id}/telemetry
       │  Format: JSON {"temperature": 22.5, "humidity": 65}
       │
       ▼
Backend FastAPI
       │
       ├──→ PostgreSQL / SQLite
       │     - Table devices: état capteur + digital_twin_state
       │     - Table telemetry: historique des valeurs
       │
       ├──→ API REST (GET/POST endpoints)
       │
       └──→ Dashboard React (temps réel)
```

**Innovation** : Stockage **open source** (PostgreSQL), API REST standard, format JSON lisible, accessible depuis n'importe où.

---

## 3. Comment l'industrie détecte les attaques aujourd'hui ?

### Méthode 1 : Seuils fixes (la plus répandue)

```ladder
// Programme PLC typique
SI temperature > 80°C ALORS
    ALARME "Surchauffe critique"
    ENVOI email à l'opérateur
FIN SI
```

**❌ Problème** : Une attaque **lente** (22°C → 25°C → 30°C → 40°C...) ne déclenche jamais le seuil des 80°C. L'attaque réussit.

### Méthode 2 : Opérateur humain

```
Opérateur assis devant 6 écrans
→ Regarde les courbes défiler
→ Si "ça a l'air bizarre" → il appelle un ingénieur
```

**❌ Problème** : Fatigue après 2h, peut surveiller max 50 capteurs, erreur humaine.

### Méthode 3 : Firewall industriel

```
CAPTEUR ────→ Firewall industriel (Cisco ISA) ────→ SCADA
              │
              └── Bloque les IP suspectes
```

**❌ Problème** : Bloque au niveau **réseau** (IP/port), ne regarde pas le **contenu** du message. Un message MQTT avec `temperature: 9999` passe si l'IP est autorisée.

### Méthode 4 : Audit périodique

```
Un ingénieur vient 1 fois par mois
→ Télécharge les logs du SCADA
→ Les analyse sur Excel
→ Fait un rapport PDF
```

**❌ Problème** : 30 jours de retard. Catastrophe déjà arrivée.

### Méthode 5 : SIEM (Splunk, IBM QRadar) — Solution chère

```
Logs ──→ Splunk / QRadar ──→ Règles de corrélation ──→ Alerte
```
**❌ Problème** : Coût 50k€ à 500k€/an. Ne fait pas de ML sur le contenu MQTT.

---

## 4. Limites des solutions actuelles

| Critère | Seuils fixes | Opérateur | Firewall | SIEM (Splunk) | **Mon projet** |
|---|---|---|---|---|---|
| **Temps réel** | ✅ | ❌ | ✅ | ✅ | ✅ |
| **Attaque inconnue (zero-day)** | ❌ | ⚠️ | ❌ | ❌ | ✅ |
| **Attaque lente** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Inspection contenu MQTT** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Explication décision** | ✅ | ✅ | ❌ | ❌ | ✅ (SHAP) |
| **Lien avec CVEs** | ❌ | ❌ | ❌ | ⚠️ (payant) | ✅ (NVD API) |
| **Coût** | ✅ Faible | ❌ Élevé | ⚠️ Moyen | ❌ 50k-500k€/an | ✅ Gratuit |
| **Open source** | ⚠️ | ✅ | ❌ | ❌ | ✅ |

> **Aucune solution actuelle ne combine inspection temps réel du contenu MQTT + ML non supervisé + scoring prédictif basé sur les CVEs + explication des décisions (SHAP) + open source.**

---

## 5. Ma solution : Pipeline IA en 3 phases

```
                    ╔══════════════════════╗
                    ║     L'USINE 4.0      ║
                    ║  Capteurs IoT (MQTT) ║
                    ║  fridge, weather,    ║
                    ║  thermostat          ║
                    ╚══════════╦═══════════╝
                               │
                    ┌──────────▼──────────┐
                    │   Phase 1           │
                    │   INGESTION + DPI   │
                    │   (Deep Packet      │
                    │    Inspection)      │
                    │   Temps réel        │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Phase 2           │
                    │   BEHAVIORAL TWIN   │
                    │   (Isolation Forest)│
                    │   ML non supervisé  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Phase 3           │
                    │   RISK PREDICTIF    │
                    │   (CVE + Anomalie)  │
                    │   Score 0-100       │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   DASHBOARD SOC     │
                    │   React + API       │
                    │   Temps réel        │
                    └─────────────────────┘
```

---

## 6. Phase 1 : Deep Packet Inspection (DPI)

### Problème résolu

Les capteurs envoient des milliers de messages MQTT par jour. Impossible de tout analyser manuellement.

### Solution

Service `mqtt_dpi_service.py` qui inspecte **chaque payload en temps réel** avec 6 règles :

| Règle | Déclencheur | Niveau alerte | Exemple |
|---|---|---|---|
| DPI-001 | Label "attack" explicite | 12 (Critique) | Payload avec `label: "attack"` |
| DPI-002 | Bruit anormal > 0.04 | 7 (Moyen) | Signal bruité = comportement suspect |
| DPI-003 | Perte de paquet simulée | 5 (Faible) | `packet_loss_sim: 1` |
| DPI-004 | Valeur hors plage capteur | 9 (Élevé) | Température frigo > 20°C |
| DPI-005 | Spike > 1000 | 5 (Faible) | Valeur numérique anormalement haute |
| DPI-006 | Humidité invalide | 6 (Moyen) | Humidité < 0% ou > 100% |

### Innovation

- Temps réel : alerte en **moins d'1 seconde**
- Format compatible **Wazuh** (SIEM open source)
- Singleton : pas de recréation du service à chaque message

---

## 7. Phase 2 : Behavioral Twin & Machine Learning

### Problème résolu

Les règles fixes détectent les attaques connues mais pas les **attaques inconnues (zero-day)**.

### Solution

**Isolation Forest** (modèle ML non supervisé) qui apprend le comportement **normal** de chaque capteur.

#### Principe

```
Données d'entraînement (normal uniquement)
         │
         ▼
Isolation Forest
├─ Apprend : température normale = 20-25°C
├─ Apprend : variation max = 2°C/heure
├─ Apprend : humidité normale = 40-70%
│
├─ Cas normal :
│   temperature = 22.5°C → anomaly_score = -0.45 → ✅ NORMAL
│
├─ Cas attaque lente (injection) :
│   temperature = 35°C → anomaly_score = -1.85 → ⚠️ ANORMAL
│   (détecté même si < seuil des 80°C !)
│
└─ Cas attaque massive (DDoS) :
    temperature = 30539°C → anomaly_score = -50 → 🚨 CRITIQUE
```

#### Concept Drift (surveillance du modèle)

```python
ConceptDriftDetector.compare(scores_recents, scores_reference)
│
├─ Distribution stable ? → "Pas de drift" ✅
└─ Distribution changée ? → "Drift détecté" ⚠️
    → Le capteur vieillit ou l'environnement a changé
    → Il faut ré-entraîner le modèle
```

#### SHAP (explicabilité)

```json
{
  "is_anomaly": true,
  "anomaly_score": -1.85,
  "top_causes": [
    {
      "feature": "temperature",
      "valeur": 35.2,
      "impact": -0.72,
      "interpretation": "Cette feature pousse vers ANORMAL"
    }
  ]
}
```

### Innovations

1. **Zero-day detection** : détecte toute déviation, pas besoin de connaître l'attaque
2. **Attaque lente détectée** : là où les seuils fixes échouent
3. **Concept Drift** : le modèle se surveille lui-même
4. **SHAP** : explique chaque décision ML → l'opérateur fait confiance

---

## 8. Phase 3 : Risk Scoring Prédictif (CVE + IA)

### Problème résolu

Une anomalie détectée → que faire ? Quel est le vrai risque ? Comment prioriser ?

### Solution

Fusion de **3 sources** en un score unique (0-100) :

```
┌─────────────────────┐
│  Behavioral Score   │  ← Isolation Forest (Phase 2)
│  (anomaly_score)    │    Normalisé entre 0 et 1
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  CVE Score          │  ← NVD API (National Vulnerability Database)
│  (cvss_score)       │    Match basé sur firmware_version du capteur
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Device State       │  ← digital_twin_state
│  (status, activité) │    Capteur en ligne/offline, actif/inactif
└──────────┬──────────┘
           │
           ▼
┌──────────────────────┐
│   RISK SCORE 0-100   │
│   = 40% behavioral   │
│   + 40% CVE          │
│   + 20% device state │
└──────────────────────┘
           │
           ▼
┌──────────────────────┐
│  Recommandation      │
│  Score > 80 → Action immédiate     │
│  Score 50-80 → Planifier correctif │
│  Score < 50 → Surveillance         │
└──────────────────────┘
```

### Exemple concret

```json
{
  "device_id": "fridge-01",
  "risk_score": 72,
  "components": {
    "behavioral_score": 0.85,
    "cve_score": 0.60,
    "device_state_risk": 0.30
  },
  "top_cves": [
    "CVE-2024-1234 (CVSS 9.1) - Remote code execution"
  ],
  "recommendation": "Mettre à jour firmware vers v2.1.5"
}
```

### Innovation

- **Score prédictif** (pas réactif) : anticipe l'attaque avant qu'elle n'arrive
- **Lien ML + CVEs** : aucune solution open source ne le fait
- **Priorisation** : l'opérateur sait quoi traiter en premier

---

## 9. Dashboard SOC

### Problème résolu

Les alertes brutes sont incompréhensibles pour un opérateur d'usine.

### Solution

Interface React avec graphiques en temps réel :

```
┌─────────────────────────────────────────────────┐
│              SECURITY OPERATIONS CENTER          │
├─────────────────────────────────────────────────┤
│ 📊 Vue d'ensemble                               │
│ Devices: 6    Alertes: 45k    Critiques: 12     │
│ Risk Score moyen: 45/100                        │
├─────────────────────────────────────────────────┤
│ 📡 Devices                         🚨 Alertes   │
│ ┌────────────────┐                ┌───────────┐ │
│ │ fridge-01   22°C│                │ 🔴 DPI-004│ │
│ │ weather    65%RH│                │ 🟡 DPI-002│ │
│ │ thermostat 21°C│                │ 🟢 DPI-003│ │
│ └────────────────┘                └───────────┘ │
├─────────────────────────────────────────────────┤
│ 📈 Graphiques : Risk Score par capteur          │
│ ████████████░░░░░░  fridge-01 : 72              │
│ ██████░░░░░░░░░░░░  weather-01 : 45             │
│ ██░░░░░░░░░░░░░░░░  thermostat-01 : 15          │
└─────────────────────────────────────────────────┘
```

### Innovation

- **Open source** (React + Elastic UI)
- Intégrable dans **Wazuh Dashboard** (SIEM gratuit)
- Temps réel, filtrable par device ou type d'attaque

---

## 10. Stack Technologique

| Composant | Technologie | Rôle |
|---|---|---|
| Backend API | **FastAPI (Python 3.10+)** | Serveur d'application REST |
| ML/AI | **scikit-learn** (Isolation Forest, SHAP) | Détection d'anomalies |
| Base de données | **PostgreSQL / SQLite** | Stockage devices + télémétrie |
| Messagerie | **MQTT (Mosquitto / gmqtt)** | Transport données capteurs |
| Frontend | **React + Elastic UI (EUI)** | Dashboard SOC |
| CVE Database | **NVD API (National Vulnerability Database)** | Vulnérabilités connues |
| SIEM | **Wazuh / OpenSearch** | Alerting et corrélation |
| Modèle ML déployé | **joblib** (pipeline_complete.joblib) | Modèle sérialisé |
| Conteneurisation | **Docker + Docker Compose** | Déploiement |

---

## 11. Conclusion

### Résumé des innovations

| # | Innovation | Problème résolu |
|---|---|---|
| 1 | **DPI Service** (6 règles temps réel) | Inspection contenu MQTT en < 1s |
| 2 | **Isolation Forest non supervisé** | Détection zero-day et attaques lentes |
| 3 | **Concept Drift Detector** | Le modèle se surveille lui-même |
| 4 | **SHAP Explainability** | L'opérateur comprend pourquoi c'est une anomalie |
| 5 | **Risk Scoring (CVE + ML)** | Score prédictif 0-100 avec priorisation |
| 6 | **Wazuh + Dashboard React** | Solution complète gratuite (open source) |

### En une phrase

> *"Un pipeline open source complet qui va du capteur IoT au dashboard SOC, avec inspection temps réel (DPI), Machine Learning non supervisé (Isolation Forest + SHAP), scoring prédictif basé sur les vulnérabilités connues (CVE + NVD), le tout gratuit et industrialisable pour l'Industrie 4.0."*

### Ce qui différencie mon projet des solutions existantes

| Capacité | Industrie classique | Mon projet |
|---|---|---|
| Inspection contenu MQTT | ❌ Non | ✅ DPI Service |
| ML temps réel local | ⚠️ Parfois (cloud payant) | ✅ Isolation Forest embarqué |
| Détection zero-day | ❌ Règles fixes uniquement | ✅ Déviation comportementale |
| Détection attaque lente | ❌ Seuils contournables | ✅ Apprentissage continu |
| Explication des décisions | ❌ Boîte noire | ✅ SHAP transparent |
| Lien anomalies + CVEs | ❌ Pas de lien | ✅ Risk Scoring fusionné |
| Coût | 50k€ - 500k€/an | ✅ Gratuit (open source) |

---

*Document rédigé par Meriem — Track A : Security Intelligence*
*PeakSoft Security Platform — Industrie 4.0 IoT*
