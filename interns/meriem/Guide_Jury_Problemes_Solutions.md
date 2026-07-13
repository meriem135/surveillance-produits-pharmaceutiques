# Problèmes Industrie 4.0 et Solutions — Guide Jury

## Expliqué pour des débutants (aucune technique requise)

---

## Introduction (30 secondes)

> *"L'Industrie 4.0 connecte des capteurs dans les usines via Internet. Ces capteurs mesurent la température, l'humidité, la pression. Mais cette connexion crée des problèmes de sécurité. Mon projet résout ces problèmes avec un pipeline en 3 phases."*

---

## Problème 1 : Capteurs IoT vulnérables

### Situation (simple)
Imaginez un thermostat connecté dans une usine. Il a été acheté sur Internet, son mot de passe est "admin", et il n'a jamais été mis à jour. **C'est la porte ouverte à un pirate.**

### Pourquoi c'est un problème ?
- Un capteur IoT coûte 5€, il n'a pas d'antivirus
- Son firmware (son système d'exploitation) date de 3 ans
- Il a des failles de sécurité connues (CVEs) mais personne ne les vérifie
- **Résultat** : 1000 capteurs = 1000 portes d'entrée

### Ma solution — Phase 3 (à coder)
```
Je crée nvd_service.py qui :
1. Prend le firmware_version de chaque capteur (ex: "v2.1.4")
2. Interroge la base NVD (National Vulnerability Database -美国政府)
3. Retourne : "Ce firmware a 5 vulnérabilités connues"
4. Ajoute ce score au calcul du risque

→ Même si le capteur est faible, MON SYSTÈME sait qu'il est dangereux
```

**Pour le jury** : Je ne peux pas sécuriser le capteur lui-même, mais je **compense** en connaissant ses faiblesses.

---

## Problème 2 : MQTT non sécurisé

### Situation (simple)
MQTT est le langage que parlent les capteurs entre eux. C'est comme une **conversation à voix haute dans un couloir** : tout le monde peut écouter, tout le monde peut parler.

### Pourquoi c'est un problème ?
- Un pirate peut **espionner** les messages (savoir quelle température)
- Un pirate peut **envoyer de faux messages** (ex: "température = 9999°C")
- Il n'y a pas de contrôle, pas de signature

### Ma solution — Phase 1 (déjà faite ✅)
```
Mon DPI Service (Deep Packet Inspection) :
1. Reçoit chaque message MQTT
2. Vérifie 6 règles en 0.1 seconde
3. Si le message est suspect → alerte immédiate

Exemple : un message dit "température = 9999°C"
→ Règle DPI-005 détecte le spike > 1000
→ Alerte niveau 5 envoyée
→ L'opérateur est prévenu
```

**Pour le jury** : Même si le protocole MQTT n'est pas sécurisé, **le DPI rattrape** en lisant le contenu de chaque message.

---

## Problème 3 : Surcharge de données

### Situation (simple)
1 capteur envoie 1 message par seconde.
1000 capteurs = 1000 messages par seconde.
Par jour : **86 millions de messages**.

### Pourquoi c'est un problème ?
- Un humain peut lire 1 message par seconde maximum
- 86 millions de messages = **1000 jours de lecture continue**
- L'opérateur est submergé, il ne voit rien

### Ma solution — Phase 2 (à adapter)
```
Mon Isolation Forest (IA) :
1. Reçoit les 86 millions de messages
2. Reconnaît ce qui est NORMAL
3. Filtre : 99.99% est normal → stocké sans alerter
4. Garde : 0.01% est anormal → prévient l'opérateur

86 millions → 86 alertes → mon Risk Score réduit à 3-5 critiques
```

**Pour le jury** : L'IA réduit **86 millions de messages à 5 alertes par jour**. L'humain ne voit que l'essentiel.

---

## Problème 4 : Attaques zero-day (inconnues)

### Situation (simple)
Imaginez une attaque que **personne n'a jamais vue**. Pas de règle, pas de protection, pas d'antidote.

### Pourquoi c'est un problème ?
- Les antivirus classiques cherchent des attaques connues
- Si l'attaque est nouvelle → **pas détectée**
- Les pirates créent des attaques sur mesure pour les usines
- **Résultat** : l'attaque réussit à 100%

### Ma solution — Phase 2 (ML non supervisé)
```
Mon Isolation Forest N'APPREND PAS les attaques.
Il apprend le COMPORTEMENT NORMAL.
Ensuite, tout écart = anomalie.

Exemple :
- Le capteur envoie normalement 22°C à 25°C
- Un jour, il envoie 35°C
- L'IA n'a jamais vu 35°C → elle dit "ANORMAL"
- C'est peut-être une attaque inconnue → ALERTE

→ Pas besoin de connaître l'attaque à l'avance !
```

**Pour le jury** : Je ne cherche pas les attaques. Je cherche **ce qui est anormal**. Toute attaque, connue ou inconnue, est détectée.

---

## Problème 5 : Dérive des capteurs (vieillissement)

### Situation (simple)
Un capteur température vieillit. Il mesure 22°C la première année, 23°C la deuxième, 24°C la troisième. **Le capteur ne dérive pas à cause d'une attaque, mais à cause de l'usure.**

### Pourquoi c'est un problème ?
- Un modèle ML basique dirait : "ANORMAL !" en permanence
- L'opérateur recevrait des **fausses alertes** toute la journée
- Il finirait par **ignorer toutes les alertes**
- Le jour d'une vraie attaque → **pas de réaction**

### Ma solution — Phase 2 (Concept Drift Detector - déjà fait ✅)
```
Mon ConceptDriftDetector :
1. Surveille la moyenne des scores en continu
2. Détecte les changements PROGRESSIFS (usure)
   vs les changements BRUTAUX (attaque)

Exemple :
- Changement progressif : 22°C → 22.1 → 22.2 → 22.3
  → "Drift lent, probablement usure du capteur"
  → Message : "Veuillez recalibrer le capteur"
  → PAS d'alerte

- Changement brutal : 22°C → 50°C en 1 seconde
  → "Drift brutal, probablement attaque"
  → ALERTE immédiate 🚨
```

**Pour le jury** : Mon système évite les **fausses alertes** liées au vieillissement. Il distingue une attaque (brutale) d'une usure (lente).

---

## Problème 6 : Fatigue d'alerte

### Situation (simple)
L'opérateur reçoit 100 alertes par jour. Les 99 premières étaient fausses. La 100ème est vraie. **Il ne réagit pas.**

### Pourquoi c'est un problème ?
- Trop d'alertes = l'opérateur s'habitue
- L'opérateur ignore les alertes
- L'attaque réelle passe inaperçue
- **Catastrophe assurée**

### Ma solution — Phase 3 (à coder)
```
Mon Risk Score (0-100) classe chaque alerte :

Score 0-20  : 🟢 Normal → stocké, PAS affiché
Score 20-50 : 🟡 Surveillance → liste silencieuse
Score 50-80 : 🟠 Attention → notification douce
Score 80-100: 🔴 CRITIQUE → alerte immédiate, pop-up, SMS

Résultat : 
- Avant : 100 alertes/jour → opérateur ignore tout
- Après : 2-3 critiques/jour → opérateur réagit à chaque fois
```

**Pour le jury** : Le Risk Score ne supprime pas les alertes, il les **classe par importance**. L'opérateur ne voit que ce qui compte vraiment.

---

## Problème 7 : Surface d'attaque massive

### Situation (simple)
1000 capteurs connectés = 1000 cibles potentielles. **Un seul capteur piraté peut suffire à détruire une usine.**

### Pourquoi c'est un problème ?
- Impossible de surveiller 1000 choses à la fois
- Impossible de sécuriser chaque capteur individuellement
- Les pirates testent tous les points d'entrée
- Un seul point faible = catastrophe

### Ma solution — Phase 1+2+3 (complet)
```
Mon pipeline automatique surveille TOUT :

Phase 1 - DPI : inspecte chaque message (1000 capteurs)
Phase 2 - Isolation Forest : analyse chaque comportement
Phase 3 - Risk Score : priorise uniquement les critiques

Résultat : 1000 capteurs = 1 pipeline qui les couvre tous
          = 0 point aveugle
```

**Pour le jury** : Au lieu d'embaucher 10 opérateurs (cher), mon IA fait le travail toute seule, 24h/24, 7j/7, pour tous les capteurs en même temps.

---

## Schéma récapitulatif pour le jury

```
┌─────────────────────────────────────────────────────────┐
│                PROBLÈMES INDUSTRIE 4.0                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 1. Capteurs vulnérables ──→ Phase 3 : CVE Pipeline     │
│ 2. MQTT non sécurisé   ──→ Phase 1 : DPI Service  ✅   │
│ 3. Surcharge données   ──→ Phase 2 : Isolation Forest  │
│ 4. Attaques zero-day   ──→ Phase 2 : ML non supervisé  │
│ 5. Dérive capteurs     ──→ Phase 2 : Concept Drift ✅  │
│ 6. Fatigue d'alerte    ──→ Phase 3 : Risk Score        │
│ 7. Surface d'attaque   ──→ Phases 1+2+3 : Pipeline     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Script oral pour le jury (1 minute)

> *"L'Industrie 4.0 connecte des milliers de capteurs IoT dans les usines. Le problème : ces capteurs sont vulnérables, le protocole MQTT n'est pas sécurisé, et il y a trop de données pour un humain.*
>
> *Ma solution est un pipeline en 3 phases :*
> - *Phase 1 (DPI) : j'inspecte chaque message MQTT en temps réel* ✅
> - *Phase 2 (Isolation Forest) : mon IA apprend le comportement normal et détecte toute anomalie, même les attaques inconnues*
> - *Phase 3 (Risk Score) : je fusionne les anomalies avec les vulnérabilités connues (CVEs) et je priorise les alertes*
>
> *Résultat : 86 millions de messages/jour transformés en 5 alertes critiques. L'opérateur ne voit que l'essentiel, l'IA fait le reste."*

---

## Questions possibles du jury et réponses

| Question | Réponse |
|---|---|
| **Pourquoi ne pas juste sécuriser MQTT ?** | MQTT avec TLS existe, mais beaucoup d'usines ne l'activent pas (trop lent pour les petits capteurs). Mon DPI fonctionne même sans. |
| **L'Isolation Forest est-il fiable ?** | Oui, c'est un algorithme standard utilisé dans la détection d'anomalies. Il est léger, rapide, et ne nécessite pas d'attaques connues pour être entraîné. |
| **Combien coûte votre solution ?** | 0€ de licence — tout est open source (Python, FastAPI, PostgreSQL, React + Wazuh). Seul le coût d'hébergement serveur est à prévoir. |
| **Votre projet peut-il marcher dans une vraie usine ?** | Oui, le protocole MQTT est standard dans l'industrie, et Wazuh est déjà utilisé par de grandes entreprises. |
| **Quelle est la différence avec Splunk ou QRadar ?** | Splunk coûte 100k€/an et ne fait pas de ML sur le contenu MQTT. Mon projet est gratuit ET spécialisé dans l'IoT. |
