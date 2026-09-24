# PARLER COMME UN EXPERT : INDUSTRIE 4.0, SCADA, MQTT & BROKER
# (toutes les notions reliées à mon projet PFE)

> Projet : détection d'attaques de **transmission MQTT** (Injection + MITM) sur 3 capteurs
> de la **chaîne du froid pharmaceutique** (2–8 °C) : Frigo / Thermostat / Météo.

---

# 1. L'INDUSTRIE 4.0

## 🎓 Définition d'expert
L'**Industrie 4.0** (*Fourth Industrial Revolution*, *Smart Manufacturing*) désigne la
transformation numérique de l'industrie par la convergence de l'**OT** (*Operational
Technology* — les machines) et de l'**IT** (*Information Technology* — les réseaux et
logiciels), autour de l'**IoT** (*Internet of Things*), des **systèmes
cyber-physiques**, du **cloud**, du **Big Data** et de l'**IA**. Objectif : une usine
**interopérable**, **connectée** et **pilotée par la donnée en temps réel**.

## 🧒 Explication simple
Imagine l'usine d'avant : un ouvrier notait les températures à la main et décidait
tout seul. L'Industrie 4.0, c'est **l'usine qui écoute toute seule** : les capteurs
parlent au réseau, les données remontent, et un programme (l'IA) analyse et alerte.

## 📜 Les 4 révolutions (pour impressionner le jury)
| Époque | Innovation | Ce qui change |
|---|---|---|
| 1.0 (1760) | Machine à vapeur | La mécanisation |
| 2.0 (1870) | Électricité + chaîne | La production de masse |
| 3.0 (1970) | Électronique + automates (PLC) | L'automatisation |
| **4.0 (2011+)** | **IoT, cloud, IA, systèmes cyber-physiques** | **L'usine intelligente connectée** |

## 🏭 Les 5 piliers
1. **IoT** — des objets connectés (capteurs, machines) qui produisent de la donnée
2. **Systèmes cyber-physiques** — le physique (frigo) et le numérique (son modèle) liés
3. **Interopérabilité** — les systèmes parlent entre eux (MQTT, OPC UA...)
4. **Big Data + IA** — traiter des volumes massifs pour décider (mon modèle !)
5. **Cloud / Edge** — calculer au plus près (edge) ou à distance (cloud)

## 🔗 Lien avec MON projet
- Mes 3 capteurs (frigo/thermostat/météo) sont des **objets IoT** publiant en MQTT
- Ma plateforme **acquitte, historise et analyse** la donnée en continu
- Mon modèle **IA entraîné sur le normal** = le pilier « IA pilotée par la donnée »
- Mon sujet exactement : **dans l'usine connectée, le flux de données est une cible**

## 🎤 Phrase à dire au jury
> *« L'Industrie 4.0 a connecté l'usine au réseau : les données sont devenues le
> nerf de la production. Mon PFE touche donc le cœur de ce sujet : dans une usine
> connectée, protéger le flux de données des capteurs, c'est protéger la décision
> elle-même. »*

---

# 2. SCADA

## 🎓 Définition d'expert
**SCADA** = ***Supervisory Control And Data Acquisition*** (« Supervision et
Acquisition des Données »). C'est l'**architecture logicielle de supervision** qui
**acquiert** les mesures terrain, les **affiche** (HMI), les **historise**
(*historian*), déclenche des **alarmes** et permet le **contrôle à distance**
(*supervision*) des processus industriels. Niveaux du modèle **Purdue**
(référence du **Purdue Reference Model for CIM**) : niveau 0 (capteurs/actuateurs)
→ 1 (PLC/RTU) → 2 (contrôle local) → 3 (supervision SCADA / MES)
→ 4-5 (ERP, cloud). Norme de sécurité associée : **IEC 62443** (*zones et conduits*).

## 🧨 Les briques
```
Capteurs/actuateurs (N0)  →  Automates PLC/RTU (N1-2)  →  RÉSEAU  →  SCADA / HMI (N3)
  (mon frigo, local, météo)   (acquisition, commande)             (écran de l'opérateur,
                                                                   historique, alarmes)
```
- **HMI** = *Human Machine Interface* — l'écran où l'opérateur voit « le frigo est à 7,2 °C »
- **RTU** = *Remote Terminal Unit* / **PLC** = *Programmable Logic Controller* — les automates
- **Historian** = la base qui conserve toutes les mesures (l'historique)

## ⚠️ Pourquoi c'est un sujet de sécurité
- Historiquement : réseaux **fermés** (bus série, Modbus sans authentification)
- Aujourd'hui : **convergence IT/OT** → le SCADA est exposé au réseau (Internet, Wi-Fi)
- Conséquence : un attaquant peut **fausser la donnée supervisée** → l'opérateur voit « vert » alors que le produit est en danger
- Les attaques historiques : **Stuxnet** (2010, usines nucléaires iraniennes), **TRITON** (2017, chimie), **Colonial Pipeline** (2021, pipeline carburant US)

## 🔗 Lien avec MON projet
- Ma plateforme fait office de **couche supervision** : elle reçoit les mesures MQTT, les affiche et alerme
- Mon attaque MITM **falsifie la donnée affichée** → l'opérateur croit que le frigo va bien → **danger pour le lot pharma (2–8 °C)**
- C'est exactement le risque SCADA : **la donnée mensongère paralyse la décision**

## 🎤 Phrase à dire au jury
> *« Dans une architecture SCADA, l'opérateur décide uniquement sur la donnée affichée. Si l'attaquant corrompt le flux MQTT, l'interface montre du vert pendant que le produit réellement chauffe. Mon système ne détecte pas une panne du frigo : il détecte le mensonge sur le réseau, avant que l'opérateur ne prenne une fausse décision. »*

---

# 3. LE PROTOCOLE MQTT

## 🎓 Définition d'expert
**MQTT** = ***Message Queuing Telemetry Transport*** — protocole de messagerie
**léger**, **asynchrone**, fonctionnant en ***publish/subscribe*** (publier/s'abonner),
conçu par **IBM (Andy Stanford-Clark) et Arcom (Arlen Nipper) en 1999** pour la
télémétrie de pipelines pétroliers par satellite. Standardisé par **OASIS (2014)**,
version **MQTT 5 (2019)**. Fonctionne en **couche application** au-dessus de **TCP/IP** :
port **1883** (clair) et **8883** (chiffré **TLS**).

## 🧨 Ses caractéristiques (les mots d'expert)
| Concept | Terme expert | Ce que c'est, simplement |
|---|---|---|
| **Publier / S'abonner** | *publish/subscribe*, modèle **découplé** | L'émiteur ne connaît pas le récepteur ; il publie sur un canal, les abonnés reçoivent |
| **Topic** | *topic* (hiérarchique) | Le « nom du canal » : `usine/frigo/temperature` (séparé par `/`) |
| **QoS 0/1/2** | *Quality of Service* | 0 = au plus une fois (best effort), 1 = au moins une fois (avec accusé), 2 = **exactement une fois** |
| **Retained** | *retained message* | Le broker garde le dernier message et l'envoie à tout nouvel abonné |
| **Last Will** | *Last Will and Testament (LWT)* | Message d'adieu envoyé automatiquement si le capteur se déconnecte brutalement |
| **Keep alive** | *keep alive / ping* | Battement de cœur pour détecter une perte de connexion |
| **Session** | *clean session / persistent session* | Faut-il conserver les messages non lus si l'abonné revient ? |

## 🤔 Pourquoi MQTT (et pas HTTP) ?
| | **HTTP** | **MQTT** |
|---|---|---|
| Modèle | Client/serveur, demande-réponse | Publish/subscribe, **découplé** (1 → N) |
| Overhead | Lourd (en-têtes, texte) | **Très léger** (~2 octets d'en-tête) |
| Convient à | Sites web | **Objets contraints, batterie, réseau faible** |
| Diffusion | Pas de « push » naturel | **Notification native** (push aux abonnés) |
| Latience | Élevée pour du temps réel | **Faible**, optimisé capteur→broker |

## 🔗 Lien avec MON projet
- Mes 3 capteurs **publient** leur température sur des topics MQTT
- Ma plateforme **s'abonne** et reçoit chaque mesure (flux temps réel)
- **C'est le transport même que l'attaquant vise** :
  - **Injection** = l'attaquant **publie lui-même** un faux message (il usurpe le capteur)
  - **MITM** = l'attaquant **s'interpose** entre le capteur et le broker, **bloque et répète**
- **MQTT de base = non chiffré, sans authentification stricte** → l'espace d'attaque existe
  → d'où **mon sujet de recherche**

## 🎤 Phrase à dire au jury
> *« MQTT est le protocole de référence de l'IoT industriel : léger, publish/subscribe,
> tolerant aux réseaux instables — c'est pour cela qu'il relie mes 3 capteurs à la
> plateforme. Mais sa philosophie historique est la performance, pas la sécurité :
> par défaut, le trafic circule en clair. Mon travail porte précisément sur la
> couche transport : détection d'attaques sur le flux MQTT lui-même. »*

---

# 4. LE BROKER MQTT

## 🎓 Définition d'expert
Le **broker MQTT** est le **serveur central de messagerie** du modèle publier/s'abonner.
Il **réceptionne les publications**, les **route** vers les abonnés intéressés selon
l'**arbre de topics**, gère les **sessions**, les messages **retenus**, les QoS et les
**Last Will**. Il est le **point de couplage** (et donc le **point de confiance
central**) de toute l'architecture. Exemples : **Mosquitto** (Eclipse), **EMQX**,
**HiveMQ**, **VerneMQ**, **ActiveMQ**.

## 🧒 Explication simple (l'analogie du bureau de poste)
```
Les capteurs  ──déposent──►  BROKER (la poste)  ──distribue──►  Les abonnés
  (émetteurs)               (reçoit, trie, livre)               (plateforme, HMI)
```
Le broker **ne produit pas** de données : il **achemine** et **garde**. C'est pour ça
que tout le monde en dépend.

## ⚠️ Pourquoi le broker est la cible n°1
1. **Point unique de confiance** : tous les messages passent par lui
2. **Table de routage** : le lire = voir toute l'usine ; le falsifier = tromper tout le monde
3. **Attaques possibles** : usurpation d'identité (fake publish), attaque *man-in-the-middle*
   sur le chemin capteur→broker, interception du trafic en clair, déni de service (DoS
   en submergeant les queues), scan des topics ouverts
4. **Disponibilité** : s'il tombe → plus de supervision → c'est aussi un enjeu DoS

## 🔗 Lien avec MON projet
- Dans ma démo, mon backend **s'abonne au broker** (services `mqtt_simulator` / `mqtt_service`)
- **Injection** = l'attaquant envoie **au broker** un faux message sur le topic du frigo
- **MITM** = l'attaquant s'insère **sur le chemin capteur → broker** et ne laisse pas passer
  la vraie donnée (il la gèle)
- **Défense** : TLS (8883), authentification forte, ACL par topic — **mais** mon angle
  est **par-delà la prévention** : **détection comportementale** par IA, parce que
  prévention seule insuffisante (clé partagée volée, config legacy...)

## 🎤 Phrase à dire au jury
> *« Le broker MQTT est le cœur du système : tout le trafic converge par lui. C'est
> à la fois son efficacité et sa vulnérabilité structurelle. Mon choix n'est donc pas
> de nier le chiffrement — je pars de l'hypothèse d'un adversaire qui a déjà contourné
> ou détourné le canal — mais d'ajouter une couche de détection de dernier recours :
> l'analyse comportementale des messages, validée par le vote de trois capteurs
> indépendants. »*

---

# 5. L'ARCHITECTURE COMPLÈTE DE MON PROJET (à dessiner au jury)

```
 [ FRIGO ]──┐                                     ┌── ABONNÉ : plateforme
  (capteur) │  publication MQTT                   │     └─ prétraitement (features)
 [ THERMO ]─┼──►  BROKER MQTT  ───────────────────┤     └─ modèle IA (normal only)
  (capteur) │   (topic: usine/+/temperature)      │     └─ vote 2 vs 1 (3 témoins)
 [ MÉTÉO ]──┘                                     └── ABONNÉ : SCADA / HMI (opérateur)

 ⚠️ ZONE D'ATTAQUE = le TRANSPORT (flèches) :
     • INJECTION → faux message publié vers le broker
     • MITM      → interception & gel du message en transit
     • DoS/DDoS  → saturation (rythme MQTT)   • Scanning → reconnaissance des topics
```

**Fil conducteur (30 s) :**
> *« L'Industrie 4.0 a connecté l'usine ; ma chaîne du froid pharmaceutique est
> supervisée par un système type SCADA ; les capteurs remontent leurs mesures via
> MQTT vers un broker central. Ce flux est le nerf du système — et donc la cible.
> J'ai modélisé deux attaques de transmission, Injection et MITM, injectées dans
> cinq jours de données réelles normales, et je les détecte par un modèle entraîné
> uniquement sur le normal, conforté par le vote de trois capteurs indépendants. »*

---

# 6. GLOSSAIRE EXPRESS (à glisser dans les réponses)

| Terme | Sens exact |
|---|---|
| **OT / IT** | Technologies opérationnelles (machines) / technologies de l'information (réseaux) |
| **IoT / IIoT** | Internet des objets / IoT industriel |
| **Cyber-physical system** | Système couplant physique et calcul numérique |
| **Interopérabilité** | Capacité de systèmes différents à communiquer |
| **Temps réel** | Traitement avec une contrainte de délai |
| **Publier / S'abonner** | Découplage émetteur ↔ récepteur via un broker |
| **Topic** | Adresse logique d'un canal MQTT (hiérarchique, `a/b/c`) |
| **QoS** | Niveau de garantie de livraison (0, 1, 2) |
| **TLS** | Transport Layer Security — chiffrement du transport (port 8883) |
| **ACL** | *Access Control List* — droits par topic |
| **DoS / DDoS** | Déni de service / distribué — saturer pour paralyser |
| **MITM** | *Man In The Middle* — s'interposer dans la communication |
| **Injection** | Injecter des données fausses dans le flux |
| **Scanning** | Reconnaissance active du réseau avant l'attaque |
| **Convergence IT/OT** | Les réseaux industriels ouverts sur l'IT → nouveaux risques |
| **IEC 62443** | Norme de sécurité des systèmes industriels de contrôle |
| **Purdue model** | Référence de découpage des niveaux industriels (0→5) |
| **DPI** | *Deep Packet Inspection* — inspection approfondie des paquets |
| **empreinte / comportement** | Signature dynamique d'un flux analysée par le modèle |

---

# 7. QUESTIONS PIÈGES DU JURY (avec réponses)

**Q1. Pourquoi MQTT plutôt que HTTP ?**
> *« MQTT est publish/subscribe : un capteur publie une fois, N abonnés reçoivent —
> découplage parfait pour du Many-to-One industririel. Son en-tête fait 2 octets,
> il gère QoS, retained et Last Will : conçu pour des objets à batterie sur réseau
> instable. HTTP, client/serveur, est bavard et sans notification native : inadapté
> à la remontée de milliers de mesures temps réel. »*

**Q2. MQTT est-il sécurisé ?**
> *« À lui seul, non : par défaut il chiffre pas (1883 en clair) et son
> authentification de base est faible. La parade standard est 8883 + TLS + certificats
> + ACL par topic. Mon postulat part justement de là : la prévention est nécessaire
> mais pas suffisante — je propose une détection complémentaire par IA, qui rattrape
> les cas où la clé ou le canal sont déjà compromis. »*

**Q3. SCADA vs IoT, quelle différence ?**
> *« SCADA est la couche historique de supervision (acquisition, HMI, alarmes,
> contrôle) des systèmes industriels. L'IIoT/Industrie 4.0 y ajoute la connexion
> cloud/edge, les capteurs IP, l'analytique temps réel. Aujourd'hui les deux se
> fondent : c'est la convergence IT/OT — et c'est exactement là que le transport
> MQTT devient la surface d'attaque. »*

**Q4. Où se placent vos attaques dans l'architecture ?**
> *« Sur la couche transport, entre les capteurs, le broker et la plateforme :
> Injection sur le chemin d'abonnement (fausse publication), MITM sur le chemin
> capteur → broker (interception et gel de la valeur). Aucun capteur n'est
> physiquement touché : la compromission est purement réseau. »*

**Q5. Pourquoi trois capteurs et pas un ?**
> *« Un témoin seul ne peut pas se vérifier : 46,6 % de fausses alertes sur le
> frigo en normal. Deux témoins donnent une contradiction sans verdict — 1 contre 1.
> Trois permettent le vote 2 contre 1 et garantissent qu'au moins une vérité reste
> si l'attaquant en corrompt deux. C'est le minimum logique pour trancher. »*

**Q6. Et le chiffrement ne suffit-il pas ?**
> *« Le chiffrement protège la confidentialité, pas l'intégrité du processus face à
> un émetteur déjà autorisé — et il ne protège pas si la clé est partagée ou si le
> broker est légitime mais détourné. En plus, il ne résout pas les attaques de
> logique (valeurs plausibles mais fausses). Ma détection agit indépendamment de
> la couche crypto : c'est une défense en profondeur. »*

**Q7. Quel est votre apport exact ?**
> *« Trois choses : (1) un pipeline reproductible d'injection d'attaques de
> transmission sur données réelles de chaîne du froid ; (2) un modèle entraîné
> exclusivement sur le normal — donc il détecte l'inconnu, pas une liste de signatures ;
> (3) une règle de corroboration multi-capteurs (vote 2/1) qui évite la fausse
> alerte et isole le capteur fautif. »*

---

# 8. LES MOTS « EXPERT » À GLISSER NATURELLEMENT

flux temps réel · télémétrie · couche transport · couche application ·
publish/subscribe · arbre de topics · point de confiance central ·
convergence IT/OT · surface d'attaque · défense en profondeur ·
détection comportementale · empreinte dynamique du flux ·
entraîné exclusivement sur la normale · corroboration multi-capteurs ·
vote majoritaire · faux négatif / faux positif · taux de fausse alerte ·
scénario d'attaque réaliste · reproductibilité (graine rng=42) ·
découpage des rôles témoins / accusé · postulat de menace (*threat model*)

---

# ⭐ LA PHRASE MAGIQUE FINALE (qui résume tout)

> **« L'Industrie 4.0 a donné des voix à nos machines ; SCADA écoute et décide ; MQTT
> et son broker transportent ces voix. Mon PFE pose une question simple : si quelqu'un
> prend la voix du frigo pour mentir, comment l'architecture s'en rend compte ? Ma
> réponse : trois témoins indépendants et un modèle appris sur le seul comportement
> normal. »** 😊
