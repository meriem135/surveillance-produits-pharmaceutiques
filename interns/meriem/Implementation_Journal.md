# Meriem's Implementation Journal: Security Intelligence (Track A)

This journal documents the technical development and design decisions for the **Security Intelligence** layer of the PeakSoft Security Platform.

---

## 📘 How to Use This Document

- **Purpose**: Document *your* specific implementation steps, challenges, and architectural choices.
- **Scope**: Focus on MQTT telemetry, AI-driven threat detection, and the Security Operations UI.
- **Maintenance**: Update this as you progress through your tasks in `Meriem_Tasks.md`.

---

## 🏗️ Technical Domain: Security Intelligence

Your work powers the "Brain" of the platform, transforming raw telemetry into actionable security intelligence.

### Core Components
- **MQTT Service**: High-throughput ingestion and DPI.
- **Intelligence Domain**: AI models for risk prediction and anomaly detection.
- **Threat UI**: Real-time monitoring and incident response interface.

---

## 🛠️ Implementation Phases

### Phase 1: Security Intelligence Core ✅

#### Tâche 1 : MQTT DPI Service (`app/domains/intelligence/mqtt_dpi_service.py`)

- **What I Faced** :
  - Le fichier existant avait des règles basiques mais pas de structure claire, pas de gestion d'erreurs robuste, et un chemin Wazuh hardcodé incompatible Windows.
  - Les types de capteurs du dataset TON_IoT ont des colonnes spécifiques (ex: `Fridge_Temperature`, `current_temperature`) qui nécessitent un mapping par device.

- **What I Did** :
  - Refactorisé `MqttDPIService` avec 6 règles DPI numérotées (DPI-001 à DPI-006) :
    - DPI-001 : label "attack" explicite (dataset TON_IoT)
    - DPI-002 : noise factor > 0.04 (comportement anormal simulé)
    - DPI-003 : packet loss simulé
    - DPI-004 : valeurs hors plage par type de capteur (fridge, thermostat, weather, gps)
    - DPI-005 : spike générique (valeur > 1000)
    - DPI-006 : humidité invalide (générique)
  - Ajout d'un `SENSOR_THRESHOLDS` dict pour les seuils par device type.
  - Fallback Windows pour l'écriture du log Wazuh (écrit localement si `/var/ossec/` inaccessible).
  - Exposé un singleton `dpi_service` importable depuis `mqtt_service.py`.
  - Intégré dans `mqtt_service.py` : chaque message MQTT est inspecté par le DPI avant persistance.
  - 7 tests unitaires validés (logique pure, sans broker MQTT).

- **Why I Chose That** :
  - Règles basées sur les colonnes réelles du dataset TON_IoT (vérifiées sur les CSV).
  - Architecture singleton pour éviter de recréer le service à chaque message.
  - Séparation claire entre inspection (retourne un dict) et persistance (écriture log).

#### Tâche 2 : Simulateur de streaming temps réel (`scripts/mqtt_simulator_ton_iot.py`)

- **What I Faced** :
  - L'ancien simulateur avait une double définition de `main()` (bug Python silencieux).
  - Les noms de fichiers dans `SENSORS` ne correspondaient pas aux noms réels des CSV du dataset.
  - Pas de mode `--mode` pour contrôler normal/attack/mixed.
  - Boucle séquentielle (normal puis attack) au lieu de streaming parallèle.

- **What I Did** :
  - Réécrit avec un mapping précis des fichiers CSV réels du dataset TON_IoT.
  - Architecture asyncio : une coroutine par device, toutes en parallèle via `asyncio.gather`.
  - Boucle infinie par device (repart du début quand le fichier est épuisé).
  - 3 modes : `normal`, `attack`, `mixed` (défaut).
  - Arguments CLI : `--host`, `--port`, `--delay-min`, `--delay-max`, `--mode`.
  - Nettoyage des colonnes NaN/vides avant publication.

- **Why I Chose That** :
  - asyncio.gather permet de simuler plusieurs devices simultanément, ce qui est réaliste pour un réseau IoT Industry 4.0.
  - Le mode `mixed` publie à la fois des données normales et des attaques, ce qui permet de tester le DPI en conditions réelles.

### Phase 2: Behavioral Digital-Twin & AI Analysis
*Document your work on ML models and behavioral tracking here.*

### Phase 3: Threat Visualization & Response
*Document the implementation of the intelligence dashboard and alerting features here.*

---

## 🗺️ Code Map: Track A

- `iot-security-backend/app/services/mqtt_service.py`
- `iot-security-backend/app/domains/intelligence/`
- `wazuh-dashboard/plugins/iot-security/public/components/ThreatIntelligence.tsx`

---

## 📊 Notes & Research
*Add your research notes, model evaluations, or security research here.*
