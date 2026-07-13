# Comment les usines 4.0 voient les attaques aujourd'hui

## Et comment mon projet change tout

---

## Partie 1 : Où vont les données capteur dans l'Industrie 4.0 ?

### Schéma simple

```
CAPTEUR IoT (température, pression, humidité)
    │
    │ Envoie via WiFi / 5G / LoRaWAN
    │ Protocole : MQTT, HTTP, CoAP
    │ Format : JSON {"temperature": 22.5}
    ▼
PASSERELLE IoT (Edge Gateway)
    │
    │ Routeur 4G/5G industriel
    │ Transmet vers le cloud ou serveur local
    ▼
CLOUD ou SERVEUR LOCAL
    │
    ├── Stocke dans une base de données
    │   (PostgreSQL, InfluxDB, MongoDB)
    │
    ├── Analyse avec des algorithmes
    │   (moyennes, seuils, parfois ML)
    │
    └── Affiche sur un dashboard web
        (Grafana, React, Node-RED)
         │
         ▼
OPÉRATEUR regarde son écran
    (PC, tablette, téléphone)
```

### Différence avec l'industrie 3.0 (ancienne)

| Critère | Industrie 3.0 (ancienne) | Industrie 4.0 (moderne) |
|---|---|---|
| **Capteurs** | Filaire (câble cuivre) | WiFi, 5G, sans fil |
| **Communication** | Modbus (nombres bruts) | MQTT (JSON lisible) |
| **Traitement** | PLC (automate local) | Cloud / serveur central |
| **Interface** | SCADA (logiciel usine) | Dashboard web (navigateur) |
| **Accès** | Sur place uniquement | Partout (mobile) |

---

## Partie 2 : Les 4 méthodes pour détecter les attaques

---

### Méthode 1 : Le Dashboard visuel (la plus courante)

#### Comment ça marche
L'opérateur regarde un écran avec des chiffres et des voyants :

```
┌──────────────────────────────────────────────┐
│          TABLEAU DE BORD USINE               │
│                                              │
│  Capteur température : 22.5°C  🟢           │
│  Capteur pression : 8.5 bar    🟢           │
│  Capteur humidité : 65%        🟢           │
│  Production : 145 pièces/jour  🟢           │
│  État : ✅ Tout va bien                      │
│                                              │
│  Si un voyant devient ROUGE →                │
│  l'opérateur appelle un technicien           │
└──────────────────────────────────────────────┘
```

#### Pourquoi ça ne marche pas
| Problème | Exemple |
|---|---|
| **Fatigue humaine** | Après 4h d'écran, l'opérateur regarde sans voir |
| **Trop de capteurs** | Impossible de surveiller 1000 capteurs en même temps |
| **Attaque lente** | 22°C → 25°C → 28°C... pas de rouge → pas d'action |
| **Fausse confiance** | "C'est vert donc c'est bon" (même si c'est faux) |
| **Pause café/pipi** | L'attaque arrive quand l'opérateur n'est pas là |

> **Conclusion** : L'humain est le maillon faible. Il ne peut pas surveiller 24h/24.

---

### Méthode 2 : Les alertes automatiques (email, SMS)

#### Comment ça marche
```
Règle dans le système :
SI temperature > 80°C ALORS
    Envoyer email : "Alerte température four"
    Envoyer SMS au 06XX XX XX XX
FIN SI
```

#### Pourquoi ça ne marche pas
| Problème | Exemple |
|---|---|
| **Seuil fixe contournable** | Un pirate peut modifier le seuil (80°C → 120°C) |
| **Attaque lente** | 22→30→40→50°C ne dépasse jamais 80°C → pas d'alerte |
| **Trop d'alertes** | L'opérateur reçoit 50 emails/jour → il ignore tout |
| **Faux positifs** | Capteur qui dévie = alerte inutile → fatigue d'alerte |
| **Pas de contexte** | "Alerte température" → mais quelle température ? Pourquoi ? |

> **Conclusion** : Les alertes sont soit trop nombreuses (ignorées), soit trop tardives.

---

### Méthode 3 : Les logs (historique)

#### Comment ça marche
Tout est enregistré dans des fichiers ou une base :

```
Table: historique_capteurs
┌──────────┬─────────────┬───────┬──────────┐
│ Heure    │ Capteur     │ Valeur│ Statut   │
├──────────┼─────────────┼───────┼──────────┤
│ 08:00:00 │ temperature │ 22.5  │ OK       │
│ 08:00:01 │ temperature │ 22.5  │ OK       │
│ 08:00:02 │ temperature │ 22.6  │ OK       │
│ ...      │ ...         │ ...   │ ...      │
│ 14:30:00 │ temperature │ 85.0  │ 🔴 ALERTE│
│ 14:30:01 │ temperature │ 90.0  │ 🔴 ALERTE│
└──────────┴─────────────┴───────┴──────────┘
```

#### Pourquoi ça ne marche pas
| Problème | Exemple |
|---|---|
| **Trop volumineux** | 86 millions de lignes/jour → personne ne lit |
| **Analyse après coup** | On consulte les logs APRÈS l'accident, pas pendant |
| **Pas d'analyse temps réel** | Les logs s'accumulent sans être analysés |
| **Stockage coûteux** | Garder 86M lignes/jour = beaucoup d'argent |

> **Conclusion** : Les logs servent uniquement à comprendre ce qui s'est passé, pas à prévenir.

---

### Méthode 4 : Le SIEM (Wazuh, Splunk) — pour les grandes usines

#### Comment ça marche
C'est un logiciel qui analyse automatiquement les logs avec des règles :

```
LOGS ──→ SIEM (Wazuh / Splunk)
           │
           ├── Règle 1 : "Si 10 connexions échouées en 1 min → brute-force"
           ├── Règle 2 : "Si mot-clé 'attack' dans le message → alerte"
           ├── Règle 3 : "Si connexion depuis IP inconnue → alerte"
           │
           └── Si une règle correspond → notification
```

#### Pourquoi ça ne marche pas
| Problème | Exemple |
|---|---|
| **Cher** | Splunk : 50k€ à 500k€/an. Wazuh : gratuit mais complexe |
| **Règles connues uniquement** | Détecte seulement ce qui est DÉJÀ dans les règles |
| **Pas de ML intégré** | Impossible de détecter une attaque jamais vue |
| **Configuration complexe** | Il faut écrire les règles à la main |
| **Pas adapté à l'IoT** | Conçu pour les logs réseau, pas pour les capteurs |

> **Conclusion** : Le SIEM est utile pour les attaques réseau connues, mais pas pour les anomalies subtiles sur capteurs IoT.

---

## Partie 3 : Tableau récapitulatif des 4 méthodes

| Critère | Dashboard | Alertes email | Logs | SIEM (Wazuh/Splunk) |
|---|---|---|---|---|
| **Détecte attaque connue** | ⚠️ (si opérateur regarde) | ✅ (si seuil correct) | ❌ (trop tard) | ✅ (si règle écrite) |
| **Détecte attaque inconnue** | ❌ | ❌ | ❌ | ❌ |
| **Détecte attaque lente** | ❌ | ❌ | ❌ | ❌ |
| **Temps réel** | ✅ | ✅ | ❌ | ✅ |
| **Coût** | Faible | Faible | Moyen | 0€ à 500k€ |
| **Fatigue humaine** | ❌ Élevée | ✅ Automatique | ✅ Automatique | ✅ Automatique |
| **Adapté aux capteurs IoT** | ⚠️ | ❌ | ⚠️ | ❌ |

> **Aucune méthode** ne détecte les attaques inconnues ou les attaques lentes sur capteurs IoT.

---

## Partie 4 : Comment MON projet détecte les attaques

### Mon pipeline en 3 phases

```
                    DONNÉES CAPTEURS
                           │
                           ▼
┌──────────────────────────────────────────────┐
│  PHASE 1 : DPI (Filtre)        ✅ DÉJÀ FAIT │
│                                              │
│  Comme un videur à l'entrée :               │
│  - Vérifie chaque message en 0.1 seconde    │
│  - 6 règles : valeur hors plage, spike,     │
│    label attack, bruit anormal, etc.        │
│  - Si suspect → alerte immédiate             │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│  PHASE 2 : IA Isolation Forest  ⏳ À ADAPTER │
│                                              │
│  Comme un chien de garde :                   │
│  - Apprend ce qui est NORMAL                 │
│  - Détecte TOUT ce qui est anormal           │
│  - Même les attaques JAMAIS VUES             │
│  - Explique POURQUOI (SHAP)                  │
│                                              │
│  Exemple :                                   │
│  "Température normale : 20-25°C"             │
│  "35°C ? Je n'ai jamais vu ça → ALERTE"     │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│  PHASE 3 : Risk Score         ⏳ À CODER    │
│                                              │
│  Comme un bulletin météo :                   │
│  - Note sur 100                              │
│  - 0-20 🟢 = normal                          │
│  - 20-50 🟡 = surveillance                   │
│  - 50-80 🟠 = attention                      │
│  - 80-100 🔴 = CRITIQUE                      │
│                                              │
│  Priorise les alertes pour l'opérateur       │
└──────────────────────────────────────────────┘
```

### Comparaison directe

| Attaque | Usine 4.0 classique | **Mon projet** |
|---|---|---|
| **Fausse valeur** (temp=9999°C) | ❌ Alerte si seuil > 80°C (mais 9999 ça dépasse) | ✅ Phase 1 : DPI détecte le spike en 0.1s |
| **Montée lente** (22→25→28→35°C) | ❌ Aucune méthode ne détecte | ✅ Phase 2 : IA voit que 35°C n'est pas normal |
| **Attaque inconnue** (zero-day) | ❌ Aucune règle existante | ✅ Phase 2 : IA détecte la déviation |
| **Ransomware** (capteurs figés) | ❌ "Tout est stable... trop stable" | ✅ Phase 2 : silence anormal = alerte |
| **50 alertes/jour** | ❌ Opérateur ignore tout | ✅ Phase 3 : seulement 2-3 critiques/jour |

---

## Schéma final pour le jury

```
┌─────────────────────────────────────────────────────────────┐
│                USINE 4.0 AUJOURD'HUI                        │
│                                                             │
│  Capteurs ──→ Cloud ──→ Dashboard ──→ Opérateur (rate ❌)  │
│                                                             │
│  Problèmes :                                                │
│  ❌ Trop de données pour un humain                           │
│  ❌ Alertes trop nombreuses (ignorées)                       │
│  ❌ Seuils fixes contournables                               │
│  ❌ Attaques inconnues non détectées                         │
├─────────────────────────────────────────────────────────────┤
│                AVEC MON PROJET                              │
│                                                             │
│  Capteurs ──→ IA (Phase 1+2+3) ──→ Opérateur (sait ✅)    │
│                                                             │
│  Solutions :                                                │
│  ✅ Phase 1 : Filtre chaque message (DPI)                   │
│  ✅ Phase 2 : IA apprend le normal, détecte l'anormal      │
│  ✅ Phase 3 : Risk Score priorise les alertes               │
│  ✅ L'opérateur ne voit que l'essentiel                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Ce que tu dis au jury (30 secondes)

> *"Aujourd'hui, les usines 4.0 reçoivent des millions de données de capteurs par jour. Pour détecter les attaques, elles utilisent 4 méthodes : un opérateur qui regarde un écran vert, des alertes email, des logs qu'on lit après l'accident, ou un SIEM cher qui ne détecte que les attaques connues.*
>
> *Aucune de ces méthodes ne détecte une attaque lente ou une attaque inconnue.*
>
> *Mon projet ajoute une IA en 3 phases : un filtre (Phase 1), un détecteur d'anomalies qui apprend le comportement normal (Phase 2), et un système de priorisation (Phase 3). Résultat : l'IA travaille 24h/24, l'humain ne voit que l'essentiel."*
