# Phase 3 expliquée avec des exemples de la vie quotidienne

## Pourquoi j'ai besoin de la Phase 3 ?

---

## Exemple 1 : Les notifications du téléphone

### Sans Phase 3 (ce que font les usines aujourd'hui)

Tu reçois TOUTES les notifications, sans tri :

```
📱 08:00 - Météo : il va pleuvoir aujourd'hui
📱 08:05 - Facebook : Pierre a publié une photo
📱 08:10 - WhatsApp : Maman a envoyé un message
📱 08:12 - 🔴 URGENT : TA MAISON BRÛLE !!! 🔴
📱 08:15 - Instagram : like sur ta photo
📱 08:20 - Email : promotion Amazon
📱 08:25 - Twitter : nouveau tweet

→ Tu reçois 7 notifications en 25 minutes
→ Tu es habitué(e), tu ne regardes même plus
→ Tu rates l'alerte INCENDIE !!!
```

**Résultat :** Ta maison brûle parce que tu as trop de notifications.

### Avec Phase 3

Les notifications sont TRIÉES par importance :

```
📱 08:00 - (silencieux) Météo → ignoré, pas grave
📱 08:05 - (silencieux) Facebook → ignoré, pas grave
📱 08:10 - (silencieux) WhatsApp → ignoré, pas grave
📱 08:12 - 🔴🔴🔴 URGENT : TA MAISON BRÛLE !!! 🔴🔴🔴 → SONNE FORT
📱 08:15 - (silencieux) Instagram → ignoré, pas grave
📱 08:20 - (silencieux) Email → ignoré, pas grave
📱 08:25 - (silencieux) Twitter → ignoré, pas grave

→ Tu n'as vu QU'UNE SEULE notification
→ Celle qui compte VRAIMENT
→ Tu appelles les pompiers immédiatement !
```

**Phase 3 = le mode "Ne pas déranger" intelligent qui laisse passer seulement l'essentiel.**

---

## Exemple 2 : Les emails

### Sans Phase 3

```
Boîte de réception :
📧 1 - Newsletter
📧 2 - Pub
📧 3 - 🔴 Facture impayée - résiliation dans 24h 🔴
📧 4 - Notification LinkedIn
📧 5 - Réunion demain
📧 6 - Pub
📧 7 - Pub
📧 8 - 🔴 Votre compte sera supprimé 🔴
📧 9 - Newsletter
📧 10 - Pub

→ Tu vois 10 emails, tu ne sais pas quoi lire en premier
→ Tu fermes tout
→ Tu rates la facture impayée et la suppression de compte !
```

### Avec Phase 3

```
Boîte de réception triée par note de priorité :

🔴 NOTE 95/100 - Facture impayée - résiliation dans 24h ← 1er
🔴 NOTE 85/100 - Votre compte sera supprimé           ← 2ème
🟡 NOTE 35/100 - Réunion demain                       ← 3ème
🟢 NOTE 5/100  - Newsletter                           ← ignoré
🟢 NOTE 2/100  - Pub                                  ← ignoré

→ Tu vois les 2 urgences en premier
→ Tu agis : tu paies ta facture et tu sauves ton compte
```

**Phase 3 = classer les alertes de la plus grave à la moins grave.**

---

## Exemple 3 : Le médecin aux urgences

### Sans Phase 3

```
Des patients arrivent aux urgences :
1. Rhume
2. 🚑 Crise cardiaque 🚑
3. Mal de tête
4. Toux
5. 🚑 Accident grave 🚑
6. Petite coupure
7. Fièvre légère

→ Le médecin traite dans l'ordre d'arrivée
→ Le patient 1 (rhume) passe avant le patient 2 (crise cardiaque) !
→ Le patient 2 MEURT en attendant !
```

### Avec Phase 3

```
Les patients sont TRIÉS par urgence (triage) :

🔴 URGENCE VITALE - Patient 2 : Crise cardiaque → TRAITÉ EN 1ER
🔴 URGENCE VITALE - Patient 5 : Accident grave → TRAITÉ EN 2ÈME
🟡 Patient 7 : Fièvre légère → en attente
🟢 Patient 1 : Rhume → peut attendre
🟢 Patient 3 : Mal de tête → peut attendre
🟢 Patient 4 : Toux → peut attendre
🟢 Patient 6 : Petite coupure → peut attendre

→ Le médecin sauve d'abord ceux qui vont mourir
→ Les autres attendent, c'est pas grave
```

**Phase 3 = le triage qui sauve des vies.**

---

## Maintenant, dans MON PROJET

### Sans Phase 3

```
L'opérateur reçoit toutes les alertes des capteurs :

🚨 Capteur fridge : température anormale
🚨 Capteur weather : humidité anormale
🚨 Capteur thermostat : variation
🚨 Capteur fridge : légère anomalie
🚨 Capteur weather : pression change
🚨 Capteur fridge : température anormale
... 100 alertes par jour ...

→ L'opérateur en a marre, il ignore tout
→ Une vraie attaque grave arrive
→ IL NE RÉAGIT PAS ⚠️
```

### Avec Phase 3

```
L'opérateur reçoit les alertes TRIÉES par note :

🔴 NOTE 92/100 - Capteur fridge : température 85°C
                   → 40% anomalie détectée par IA
                   → 40% CVE connue sur ce firmware
                   → 20% capteur en état critique
                   → = ACTION IMMÉDIATE 🚨

🟡 NOTE 45/100 - Capteur weather : petite variation
                   → Surveillance, pas urgente

🟢 NOTE 12/100 - Capteur thermostat : normal
                   → Stocké, pas affiché

→ L'opérateur voit la seule alerte qui compte vraiment
→ Il agit immédiatement : il éteint le frigo avant l'explosion
```

---

## Schéma simple pour le jury

```
SANS PHASE 3 :

CAPTEURS ──→ 100 ALERTES/JOUR ──→ OPÉRATEUR IGNORE TOUT
                                      │
                                      ❌ Catastrophe !

AVEC PHASE 3 :

CAPTEURS ──→ PHASE 1 (Filtre) ──→ PHASE 2 (IA)
                                      │
                                      ▼
                                 PHASE 3 (Note 0-100)
                                      │
                         ┌────────────┼────────────┐
                         ▼            ▼            ▼
                    Note 0-20     Note 20-80   Note 80-100
                    Stocké       Surveillance   🔴 ALERTE
                    (ignoré)     (surveillé)    (ACTION !)
```

---

## En résumé

| Phase | C'est quoi ? | Exemple de la vie |
|---|---|---|
| **Phase 1** | Filtre les messages évidents | Le videur qui vérifie les cartes d'identité |
| **Phase 2** | Détecte les comportements anormaux | Le chien de garde qui aboie sur un inconnu |
| **Phase 3** | **Note sur 100 pour prioriser** | **Le triage aux urgences du médecin** |

> **Sans Phase 3 :** 100 alertes = 0 réaction. L'opérateur ignore tout.
>
> **Avec Phase 3 :** L'opérateur voit seulement les 2-3 alertes critiques par jour. Il agit.

---

## Annexe Technique — Comment la Phase 3 calcule le risque

### Formule mathématique

```
Risk = 0.30 × f_ML + 0.25 × f_CVE + 0.15 × f_DPI + 0.10 × f_Crit + 0.10 × f_Vel + 0.10 × f_Temp
```

Où chaque `f` est normalisé entre 0 et 100.

### Les 6 facteurs détaillés

| Facteur | Poids | Source | Normalisation |
|---|---|---|---|
| `f_ML` (Anomalie IA) | 30% | Isolation Forest `score_samples()` | Score < -0.5 → 90-100 / Score > 0 → 0-50 |
| `f_CVE` (Vulnérabilités) | 25% | NVD API + EPSS | CVSS × 10 (max 100) |
| `f_DPI` (Alertes temps réel) | 15% | DPI Service (6 règles) | Sigmoid(nb_alertes) + severity/15×50 |
| `f_Crit` (Criticité) | 10% | Type + emplacement | fridge=80, weather=50, production=90... |
| `f_Vel` (Vélocité) | 10% | Dérivée du risque | Sigmoid(pente×10) × 100 |
| `f_Temp` (Historique) | 10% | EWMA des scores passés | α=0.3, moyenne exponentielle |

### Pourquoi Monte Carlo ?

Les poids des facteurs ne sont pas parfaits. On simule 1000 variations aléatoires autour des poids pour obtenir un **intervalle de confiance à 90%**.

Exemple : "Risque = 72 [IC 90%: 63-81]" → on est sûr à 90% que le vrai risque est entre 63 et 81.

### Pourquoi EWMA (Exponential Weighted Moving Average) ?

Plutôt que la moyenne classique qui donne le même poids à toutes les observations, l'EWMA donne plus de poids aux observations récentes :

```
EWMA(t) = α × Score(t) + (1-α) × EWMA(t-1)
```

Avec α=0.3, un score d'il y a 10 pas de temps ne pèse plus que 3% dans la moyenne.

### Détection d'anomalie de risque (Risk-on-Risk)

En plus de détecter les anomalies *dans les données*, la Phase 3 détecte quand le **risque lui-même** a un comportement anormal. On calcule un Z-score sur la vélocité du risque :

- Z > 2 : le risque augmente anormalement vite → alerte
- Z < -2 : le risque chute anormalement vite → peut indiquer un capteur mort

### Analyse de corrélation inter-devices

Si le risque du Fridge et du Thermostat augmentent ensemble (corrélation > 0.7), cela peut indiquer :
1. Une **attaque coordonnée** sur plusieurs capteurs
2. Un **problème environnemental** (ex: incendie) qui affecte tous les capteurs

La Phase 3 calcule automatiquement ces corrélations.

### Prédiction du risque futur

Utilise une **extrapolation polynomiale** du trend avec intervalles de confiance croissants :

```
CI(t+n) = Volatilité_historique × √(1+n) × 1.645
```

Plus on prédit loin, plus l'intervalle est large (incertitude croissante).

### Endpoints API de la Phase 3

| Endpoint | Description |
|---|---|
| `GET /api/v1/risks/{id}` | Risk score complet + décomposition |
| `GET /api/v1/risks/{id}/history` | Historique EWMA |
| `GET /api/v1/risks/{id}/anomaly` | Détection d'anomalie de risque |
| `GET /api/v1/risks/{id}/decompose` | Décomposition trend + volatilité |
| `GET /api/v1/risks/{id}/forecast` | Prédiction future |
| `POST /api/v1/risks/{id}/what-if` | Simulation d'actions correctives |
| `POST /api/v1/risks/correlation` | Corrélation entre devices |
| `GET /api/v1/risks/summary` | Vue globale |
| `GET /api/v1/risks/weights` | Poids configurables |
| `GET /api/v1/cves/{type}` | CVEs par type de capteur |
