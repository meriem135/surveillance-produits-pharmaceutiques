# Rapport de Stage — Résumé Exécutif

## PeakSoft Cyber-Guardian : Plateforme de Sécurité Industrielle

**Stagiaire :** Meriem — Security Intelligence  
**Période :** Phases 1 & 2  
**Société :** PeakSoft

---

## Contexte

L'Industrie 4.0 connecte des capteurs IoT (température, humidité) via le protocole MQTT, exposant les infrastructures critiques à des cyberattaques (DDoS, MITM, Ransomware, Injection). Le projet **PeakSoft Cyber-Guardian** répond à ce besoin par une plateforme combinant **Digital Twin**, **IA** et **dashboard React temps réel** pour détecter et analyser les menaces sur 3 capteurs : **Weather**, **Fridge**, **Thermostat**.

---

## Phase 1 : Fondation & Ingestion Sécurisée

### Objectif
Mettre en place la base de données, l'ingestion MQTT sécurisée, l'inspection DPI et le prétraitement ML.

### Réalisations

1. **Architecture base de données** — Modélisation SQLModel avec Domain-Driven Design et Repository Pattern, base PostgreSQL/SQLite avec fallback automatique.

2. **Service MQTT DPI (6 règles)** — Inspection temps réel des messages MQTT :
   - DPI-001 : Détection d'attaques explicites (label "attack")
   - DPI-002 : Comportements anormaux (facteur de bruit)
   - DPI-003 : Pertes de paquets simulées
   - DPI-004 : Valeurs hors plage par type de capteur
   - DPI-005 : Spikes génériques (valeur > 1000)
   - DPI-006 : Humidité invalide (< 0% ou > 100%)

3. **Simulateur temps réel** — Streaming asynchrone du dataset TON_IoT en temps réel via MQTT avec 3 modes (normal, attack, mixed) et lecture parallèle des 3 capteurs.

4. **EDA & Prétraitement** — Analyse de 13 fichiers CSV, nettoyage, feature engineering (Δt, moyennes mobiles, écart-types mobiles, encodage cyclique horaire) et normalisation StandardScaler.

---

## Phase 2 : Intelligence Artificielle & Dashboard React

### Objectif
Connecter le flux MQTT à un moteur de détection d'anomalies IA et visualiser le tout dans un dashboard React temps réel.

### Réalisations

1. **Infrastructure MQTT** — Broker Mosquitto Docker, client asynchrone (gmqtt) intégré au cycle de vie FastAPI, pipeline complet de parsing à persistance.

2. **Digital Twin temps réel** — Synchronisation de l'état des devices à chaque message MQTT, API d'historique, WebSocket pour push React.

3. **Dashboard React** — Interface temps réel (React 19, TypeScript, Vite, Tailwind CSS) avec KPIs, graphiques Recharts, panneau d'explicabilité SHAP, visualisation Digital Twin.

4. **Détection d'anomalies (Isolation Forest)** — 4 modèles entraînés avec 25 features temporelles :

   | Modèle | Features | Échantillons | Performance |
   |--------|----------|-------------|-------------|
   | Weather | 8 | 399 188 | **99.4%** |
   | Fridge | 6 | 383 368 | **98.5%** |
   | Thermostat | 5 | 291 182 | 33.2%* |
   | **Combiné** | **19** | **370 972** | **100%** |

   *\*Thermostat : faible variance naturelle (σ=2.4°C)*

5. **Explicabilité SHAP** — Les 3 features les plus contributrices sont exposées via API et dashboard pour chaque alerte.

6. **Concept Drift** — Surveillance de la dérive des distributions par test KS-2-sample avec alerte automatique.

---

## Technologies

| Domaine | Technologies |
|---------|-------------|
| Backend | Python 3.10+, FastAPI, SQLModel, SQLAlchemy |
| Base de données | PostgreSQL / SQLite (fallback automatique) |
| MQTT | Mosquitto, gmqtt |
| Machine Learning | scikit-learn (Isolation Forest), SHAP, scipy |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, Recharts |
| Streaming | WebSockets (FastAPI) |

---

## Résultats Clés

- **6 règles DPI** pour l'inspection temps réel du trafic IoT
- **Simulateur multi-capteurs** capable de streamer 3 devices simultanément
- **99%+ de détection moyenne** sur 9 types d'attaques (modèle combiné : 100%)
- **Digital Twin** synchronisé en temps réel
- **Explicabilité IA** via SHAP intégrée au dashboard
- **Dashboard React** complet avec visualisations temps réel et 4 thèmes (dark, cyberpunk, matrix, light)

---

*Document confidentiel — PeakSoft Security Platform — Juin 2026*
