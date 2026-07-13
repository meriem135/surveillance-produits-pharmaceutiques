# Architecture Industrie 4.0 et Détection d'Attaques

## Guide complet expliqué simplement

---

## Partie 1 : L'Architecture d'une usine 4.0

### Imagine une usine moderne

```
                    INTERNET
                       │
          ┌────────────┴────────────┐
          │                         │
    ┌─────▼─────┐           ┌──────▼──────┐
    │  Cloud    │           │  Fournisseur │
    │  (AWS/Azure)          │  (Siemens,   │
    │  Stockage,│           │   Schneider) │
    │  Analytics│           │  MàJ firmware│
    └─────┬─────┘           └──────┬───────┘
          │                        │
          │         RÉSEAU USINE   │
          │                        │
    ┌─────┴────────────────────────┴───────┐
    │           PASSERELLE IoT              │
    │    (Edge Gateway / Routeur 4G/5G)    │
    │    👉 Reçoit les données des capteurs │
    │    👉 Les envoie vers le Cloud/On-Prem│
    └────────────────┬─────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
   ┌────▼───┐  ┌────▼───┐  ┌────▼───┐
   │Capteur │  │Capteur │  │Capteur │
   │Temp.   │  │Pression│  │Humidité│
   │(MQTT)  │  │(MQTT)  │  │(MQTT)  │
   └────────┘  └────────┘  └────────┘
         WiFi / 5G / LoRaWAN / Zigbee
```

### Les 3 couches de l'usine 4.0

| Couche | C'est quoi ? | Exemple |
|---|---|---|
| **1. Capteurs (IoT)** | Des petits appareils qui mesurent des choses | Thermomètre WiFi, capteur pression 5G |
| **2. Réseau** | Internet / WiFi / 5G qui transporte les données | Routeur 4G, Box WiFi industriel |
| **3. IT/Cloud** | Des serveurs qui stockent et analysent | AWS, Azure, serveur local |

### Comment circulent les données ?

```
1. CAPTEUR (dans l'usine)
   ├── Mesure : température = 22.5°C
   ├── Formate : {"temperature": 22.5}
   └── Envoie via MQTT : factory/sensor-01/telemetry
        │
        ▼
2. PASSERELLE IoT (Edge Gateway)
   ├── Reçoit le message
   ├── Vérifie que le capteur est autorisé
   └── Transmet vers le serveur
        │
        ▼
3. SERVEUR (Cloud ou local)
   ├── Stocke dans la base de données
   ├── Analyse (ML, alertes)
   └── Affiche sur le dashboard
        │
        ▼
4. OPÉRATEUR (devant l'écran)
   └── Voit la température sur son dashboard
```

---

## Partie 2 : Les attaques possibles sur une usine 4.0

### Carte des attaques

```
                    ATTAQUANT (pirate)
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
    Attaque 1          Attaque 2        Attaque 3
    Sur le capteur     Sur le réseau    Sur le serveur
          │                │                │
          ▼                ▼                ▼
    Ex: Envoyer        Ex: Écouter      Ex: Pirater
    fausse valeur      les messages     la base de
    (temp=9999)        (vol de données) données
```

### Attaque 1 : Falsification du capteur

```
Comment ça marche ?
─────────────────
Le pirate envoie un faux message MQTT au serveur :
"temperature = 9999°C"

Pourquoi c'est grave ?
─────────────────
- Le serveur croit que le four est à 9999°C
- Il déclenche une procédure d'urgence (arrêt four)
- Production arrêtée, pertes financières
- Ou inversement : il masque une vraie surchauffe
```

### Attaque 2 : Écoute (espionnage)

```
Comment ça marche ?
─────────────────
Le pirate écoute le réseau WiFi et capture les messages :
"temperature = 22.5°C"
"pression = 8.5 bar"
"production = 145 pièces/jour"

Pourquoi c'est grave ?
─────────────────
- Vol de données industrielles (espionnage)
- Un concurrent sait exactement ce que tu fabriques
- Peut préparer une attaque plus ciblée
```

### Attaque 3 : Ransomware (prise en otage)

```
Comment ça marche ?
─────────────────
Le pirate crypte toutes les données du serveur.
Message : "Payez 100 000€ en Bitcoin pour récupérer vos données"

Pourquoi c'est grave ?
─────────────────
- Usine à l'arrêt total
- Pas de production possible
- Perte de données historiques
- Rançon souvent payée
```

### Attaque 4 : Attaque sur la passerelle (Edge)

```
Comment ça marche ?
─────────────────
Le pirate pirate la passerelle IoT (le routeur).
Il bloque tous les messages des capteurs.

Pourquoi c'est grave ?
─────────────────
- L'opérateur ne voit plus rien
- Usine aveugle
- Ne sait pas si les machines fonctionnent
- Risque d'accident
```

### Attaque 5 : Zero-day (inconnue)

```
Comment ça marche ?
─────────────────
Le pirate découvre une faille dans le firmware du capteur
que PERSONNE ne connaît encore.
Il l'exploite sans être détecté.

Pourquoi c'est grave ?
─────────────────
- Aucune règle existante ne détecte cette attaque
- Les antivirus classiques ne voient rien
- L'attaque peut durer des mois sans être découverte
```

---

## Partie 3 : Comment les usines voient les attaques aujourd'hui

### Méthode 1 : Les logs (la plus courante)

```
L'usine enregistre tout dans des fichiers journaux (logs) :

08:00:01 | capteur-01 | 22.5°C | OK
08:00:02 | capteur-02 | 8.5 bar | OK
08:00:03 | capteur-01 | 22.6°C | OK
... 86 millions de lignes par jour ...

→ Personne ne lit ces logs
→ On les garde "au cas où"
→ Après une attaque, on les analyse pour comprendre
→ Trop tard, l'attaque a déjà eu lieu
```

**Limite :** On détecte l'attaque APRÈS, pas pendant.

### Méthode 2 : Les seuils (SI/ALORS)

```
Règle dans le système :
SI temperature > 80°C ALORS alerte

Problème :
- Attaque lente : 22→30→40→50→60°C → PAS D'ALERTE
- Attaque par modification du seuil : le pirate change 80°C en 120°C
- L'opérateur reçoit l'alerte 30 minutes après le début
```

### Méthode 3 : Le SIEM (Wazuh, Splunk)

```
C'est un logiciel qui analyse les logs automatiquement :

Logs ──→ Wazuh (SIEM gratuit)
           │
           ├── Cherche des mots-clés : "error", "attack", "fail"
           ├── Compare avec des règles connues
           └── Alerte si quelque chose correspond

Exemple de règle Wazuh :
"Si 10 connexions échouées en 1 minute → alerte brute-force"
```

**Limite :** Ne détecte que les attaques **connues** dont on a écrit la règle.

### Méthode 4 : L'opérateur humain

```
Un humain regarde des écrans toute la journée :

┌──────────────────────────────────────┐
│         TABLEAU DE BORD              │
│                                      │
│  Température : 22.5°C 🟢            │
│  Pression : 8.5 bar 🟢              │
│  Humidité : 65% 🟢                  │
│  Production : 145 pièces 🟢         │
│  ... 50 autres voyants...           │
└──────────────────────────────────────┘

L'opérateur regarde 2 secondes, voit du vert, continue.
```

**Limite :** Un humain ne peut pas surveiller 1000 capteurs en même temps.

---

## Partie 4 : Pourquoi ces méthodes ne marchent pas

| Méthode | Détecte attaque connue ? | Détecte attaque inconnue ? | Détecte attaque lente ? | Temps réel ? |
|---|---|---|---|---|
| **Logs** | ❌ (trop tard) | ❌ | ❌ | ❌ |
| **Seuils fixes** | ✅ | ❌ | ❌ | ✅ |
| **SIEM (Wazuh)** | ✅ | ❌ | ❌ | ✅ |
| **Opérateur humain** | ⚠️ (parfois) | ❌ | ❌ | ⚠️ |
| **Mon projet (IA)** | ✅ | ✅ | ✅ | ✅ |

---

## Partie 5 : Comment MON projet détecte les attaques

### Mon pipeline complet

```
    CAPTEURS IoT (fridge, weather, thermostat)
         │
         │ MQTT
         ▼
┌─────────────────────────────────────┐
│     PHASE 1 : DPI (Filtre)          │  ✅ Déjà fait
│                                     │
│  Vérifie chaque message en 0.1s :  │
│  - Valeur normale ?                 │
│  - Spike suspect ?                  │
│  - Label "attack" ?                 │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│     PHASE 2 : IA (Isolation Forest) │  ⏳ À adapter
│                                     │
│  Apprend le comportement normal :   │
│  - Température normale = 20-25°C   │
│  - Variation normale = 2°C/heure   │
│                                     │
│  Détecte les anomalies :            │
│  - 22°C → 35°C en 5 min → ALERTE   │
│  - 22°C → 22.1 → 22.2... → usure   │
│                                     │
│  SHAP explique POURQUOI c'est une   │
│  anomalie (transparence)            │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│     PHASE 3 : Risk Score            │  ⏳ À coder
│                                     │
│  Calcule une NOTE sur 100 :         │
│  - 40% anomalie IA (Phase 2)       │
│  - 40% vulnérabilités (CVEs)       │
│  - 20% état du capteur             │
│                                     │
│  Priorise :                         │
│  - 0-20 🟢 Normal                   │
│  - 20-50 🟡 Surveiller              │
│  - 50-80 🟠 Attention               │
│  - 80-100 🔴 CRITIQUE               │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│     DASHBOARD + ALERTE              │
│                                     │
│  L'opérateur voit :                 │
│  "Capteur fridge-01 : RISK 82 🚨   │
│   Cause : température anormale      │
│   CVE connue sur ce firmware        │
│   Recommandation : vérifier"        │
└─────────────────────────────────────┘
```

### Exemple concret : Les 5 attaques détectées

| Attaque | Comment mon projet la détecte |
|---|---|
| **1. Fausse valeur** (temp=9999) | Phase 1 : DPI-005 détecte le spike > 1000 → alerte immédiate |
| **2. Écoute passive** | Phase 1+2+3 ne peuvent pas empêcher l'écoute, mais le ML peut détecter que quelqu'un lit anormalement les données |
| **3. Ransomware** | Phase 2 : comportement anormal des capteurs (déconnexions, valeurs figées) → alerte |
| **4. Attaque sur passerelle** | Phase 2 : plus aucun message ne arrive → "silence anormal" → alerte |
| **5. Zero-day** | Phase 2 : l'IA détecte que le comportement est différent de la normale, même si elle n'a jamais vu cette attaque |

---

## Schéma récapitulatif pour le jury

```
┌──────────────────────────────────────────────────────────────┐
│                   USINE 4.0 (aujourd'hui)                    │
│                                                              │
│  Capteurs IoT ── WiFi/5G ──→ Passerelle ── Internet ──→ Cloud│
│       │                        │               │             │
│       │                        │               │             │
│       ▼                        ▼               ▼             │
│  ❌ Pas de sécurité      ❌ Pas de filtre    ⚠️ SIEM basique │
│  (mot de passe par       (n'importe qui     (règles fixes)   │
│   défaut)                 peut parler)                        │
└──────────────────────────────────────────────────────────────┘
                            │
                            │ MON PROJET AJOUTE :
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                    MA SOLUTION (3 phases)                     │
│                                                              │
│  Phase 1 : Filtre DPI → vérifie chaque message              │
│  Phase 2 : IA Isolation Forest → détecte toute anomalie     │
│  Phase 3 : Risk Score → priorise les alertes                │
│                                                              │
│  Résultat : L'opérateur voit l'essentiel, l'IA fait le reste│
└──────────────────────────────────────────────────────────────┘
```

---

## Ce que tu dois retenir pour le jury

### En 1 phrase
> *"Les usines 4.0 ont des capteurs connectés qui envoient des données non protégées, et personne ne peut tout surveiller. Mon projet ajoute une IA qui filtre, analyse et priorise automatiquement."*

### En 30 secondes
> *"Aujourd'hui, une usine 4.0 connecte des capteurs mais ne peut pas tout surveiller. Les solutions existantes (seuils, SIEM) ne détectent que les attaques connues.*
>
> *Mon projet ajoute un filtre (Phase 1), une IA qui apprend le comportement normal et détecte toute anomalie même inconnue (Phase 2), et un système de priorisation (Phase 3).*
>
> *Résultat : l'usine passe de 86 millions de messages illisibles à 5 alertes critiques par jour, avec des explications claires."*

### Les 5 mots techniques à connaître

| Mot | Signification simple |
|---|---|
| **IoT** | Des capteurs connectés à Internet |
| **MQTT** | Le langage que parlent les capteurs |
| **DPI** | Un filtre qui inspecte chaque message |
| **Isolation Forest** | Une IA qui détecte les anomalies |
| **Risk Score** | Une note sur 100 pour prioriser |

---

## Fichiers prêts pour tes profs

| Fichier | Contenu |
|---|---|
| `Pour_Debutants_Projet_Simple.md` | Tout expliqué hyper simplement |
| `Guide_Jury_Problemes_Solutions.md` | Questions/réponses pour le jury |
| `Problemes_Industrie4.0_et_Solutions.md` | 7 problèmes détaillés |
| `Projet_Explique_Profs.md` | Version complète |
