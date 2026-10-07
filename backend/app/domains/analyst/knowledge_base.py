"""
Knowledge Base — Corpus de référence pour le RAG
=================================================
Contient tous les documents de connaissance du domaine IoT/ICS :
  - Fiches des 9 types d'attaques IoT détectées par les modèles
  - Seuils des capteurs et comportements normaux
  - Procédures de remédiation par type d'attaque
  - Standards IEC 62443 / ETSI EN 303645 (extraits clés)

Structure d'un document :
    {
        "id"       : identifiant unique
        "category" : "attack" | "sensor" | "remediation" | "standard"
        "title"    : titre court
        "tags"     : liste de mots-clés pour le matching
        "content"  : texte complet (utilisé pour la vectorisation TF-IDF)
    }
"""

KNOWLEDGE_DOCUMENTS = [

    # ══════════════════════════════════════════════════════════════════════════
    # ATTAQUES IoT — Une fiche par type
    # ══════════════════════════════════════════════════════════════════════════

    {
        "id": "ATK-001",
        "category": "attack",
        "title": "Attaque DDoS IoT (Distributed Denial of Service)",
        "tags": ["ddos", "denial", "service", "flood", "traffic", "saturation", "debit"],
        "content": """
ATTAQUE : IoT_DDoS — Déni de service distribué
DESCRIPTION : L'attaquant utilise un botnet pour submerger le capteur ou la passerelle
de requêtes simultanées. Le device ne peut plus traiter les données légitimes.
INDICATEURS DÉTECTION :
  - Taux de messages MQTT anormalement élevé (>100 msg/s)
  - Latence réseau soudainement >500ms
  - Score d'anomalie OCSVM > +20 (au-delà du seuil calibré — anomalie forte)
  - Capteur Weather : détection 100% (température/humidité saturées)
  - Capteur Fridge : détection 97.8%
IMPACT : Perte de visibilité totale sur le capteur. Risque de cascade si
plusieurs devices sont ciblés simultanément.
FAUX POSITIFS : Pointes de charge lors de mises à jour firmware. Vérifier
si d'autres capteurs sont également affectés (corrélation inter-capteurs).
SCORE DE RISQUE ATTENDU : 75-95/100 selon la criticité du device.
NORME : IEC 62443-4-2 SR 7.2 — Protection contre les DoS.
        """,
    },

    {
        "id": "ATK-002",
        "category": "attack",
        "title": "Attaque DoS IoT (Denial of Service simple)",
        "tags": ["dos", "denial", "service", "single", "source", "saturation"],
        "content": """
ATTAQUE : IoT_DoS — Déni de service depuis une seule source
DESCRIPTION : Une seule machine inonde le capteur IoT de requêtes. Moins
puissant qu'un DDoS mais plus facile à tracer.
INDICATEURS DÉTECTION :
  - Source IP unique avec volume anormal
  - Score d'anomalie OCSVM positif, proche du seuil calibré (+20)
  - Capteur Weather : détection 100%
  - Capteur Fridge : détection 99.8%
  - Capteur Thermostat : détection 51.9% (instabilité thermique)
DIFFÉRENCE AVEC DDoS : Origine unique = plus facile à bloquer en firewall.
SCORE DE RISQUE ATTENDU : 65-85/100.
NORME : IEC 62443-4-2 SR 7.1 — Contrôle du trafic réseau.
        """,
    },

    {
        "id": "ATK-003",
        "category": "attack",
        "title": "Attaque MITM (Man-in-the-Middle)",
        "tags": ["mitm", "man", "middle", "intercept", "modification", "eavesdrop", "spy"],
        "content": """
ATTAQUE : IoT_MITM — Homme du milieu
DESCRIPTION : L'attaquant se positionne entre le capteur et la passerelle.
Il peut lire ET modifier les données en transit. Très dangereux car les
données semblent légitimes côté réception.
INDICATEURS DÉTECTION :
  - Légères variations inhabituelles des valeurs (data tampering)
  - Certificats TLS invalides ou expirés
  - Score d'anomalie OCSVM : anomalie modérée (score positif, sous le seuil +20)
  - Capteur Weather : détection 100%
  - Capteur Fridge : détection 100%
  - Corrélation inter-capteurs : valeurs incohérentes (ex: frigo 'normal'
    mais température extérieure 'anormale' ne correspondent pas)
IMPACT : Compromission de l'intégrité des données. Décisions métier
basées sur des données falsifiées.
SCORE DE RISQUE ATTENDU : 70-90/100 (impact sur intégrité = critique).
NORME : IEC 62443-4-2 SR 3.1 — Intégrité des communications.
        """,
    },

    {
        "id": "ATK-004",
        "category": "attack",
        "title": "Attaque XSS IoT (Injection de scripts)",
        "tags": ["xss", "script", "injection", "cross", "site", "payload", "code"],
        "content": """
ATTAQUE : IoT_XSS — Injection de scripts dans les mesures
DESCRIPTION : L'attaquant injecte des payloads malicieux dans les champs
de données du capteur (topic MQTT, valeurs JSON). Peut altérer l'interface
de gestion ou propager vers d'autres systèmes.
INDICATEURS DÉTECTION :
  - Champs de données contenant des caractères spéciaux (<, >, script)
  - Valeurs numériques remplacées par des chaînes
  - Capteur Weather : détection 100%
  - Capteur Fridge : détection 99.6%
SCORE DE RISQUE ATTENDU : 60-80/100.
NORME : IEC 62443-4-2 SR 3.5 — Validation des entrées.
        """,
    },

    {
        "id": "ATK-005",
        "category": "attack",
        "title": "Attaque Backdoor IoT",
        "tags": ["backdoor", "access", "remote", "unauthorized", "control", "shell", "admin"],
        "content": """
ATTAQUE : IoT_Backdoor — Accès distant non autorisé
DESCRIPTION : L'attaquant a installé un accès persistant sur le device IoT
(via firmware corrompu ou exploit CVE). Il peut prendre le contrôle total
à distance sans être détecté par les contrôles habituels.
INDICATEURS DÉTECTION :
  - Connexions sortantes vers des IPs inconnues
  - Ports ouverts inhabituels (Telnet 23, SSH 22 si non prévu)
  - Capteur Weather : détection 100%
  - Capteur Fridge : détection 98.6%
  - CVE liées au firmware : risque CVE élevé dans le score de risque
IMPACT : Contrôle total du device. Possibilité d'espionnage industriel.
SCORE DE RISQUE ATTENDU : 80-100/100 (accès non autorisé = critique).
NORME : IEC 62443-4-2 SR 1.1 — Identification et authentification.
        """,
    },

    {
        "id": "ATK-006",
        "category": "attack",
        "title": "Attaque Injection de données IoT",
        "tags": ["injection", "fake", "data", "false", "forge", "spoof", "manipulate"],
        "content": """
ATTAQUE : IoT_Injection — Injection de fausses données
DESCRIPTION : L'attaquant injecte de fausses mesures dans le flux de données
du capteur (ex: température de -50°C pour déclencher des alarmes, ou au
contraire des valeurs normales pour masquer une anomalie réelle).
INDICATEURS DÉTECTION :
  - Valeurs hors plage physiquement possible pour le capteur
  - Transitions de valeurs physiquement impossibles (saut de 40°C en 1 seconde)
  - diff_1 (température différentielle) anormalement élevé
  - Capteur Weather : détection 99.4%
  - Capteur Fridge : détection 99.8%
  - Modèle combiné : détection 100%
SCORE DE RISQUE ATTENDU : 65-85/100.
NORME : IEC 62443-4-2 SR 3.5 — Validation des données capteurs.
        """,
    },

    {
        "id": "ATK-007",
        "category": "attack",
        "title": "Attaque Password Brute Force IoT",
        "tags": ["password", "brute", "force", "credential", "login", "auth", "guess"],
        "content": """
ATTAQUE : IoT_Password — Force brute sur les identifiants
DESCRIPTION : L'attaquant tente de deviner le mot de passe du device IoT
(interface web, SSH, MQTT broker) par essais successifs.
INDICATEURS DÉTECTION :
  - Multiples tentatives de connexion échouées en rafale
  - Trafic réseau vers port 22/23/80/8080 anormalement dense
  - Capteur Weather : détection 100%
  - Capteur Fridge : détection 98.5%
SCORE DE RISQUE ATTENDU : 55-75/100 (si le mot de passe est faible, 90+).
NORME : IEC 62443-4-2 SR 1.7 — Politique de mots de passe.
ETSI EN 303645 Provision 5.1 — Pas de mots de passe universels par défaut.
        """,
    },

    {
        "id": "ATK-008",
        "category": "attack",
        "title": "Attaque Ransomware IoT",
        "tags": ["ransomware", "encrypt", "ransom", "lock", "crypto", "bitcoin"],
        "content": """
ATTAQUE : IoT_Ransomware — Rançongiciel sur device IoT
DESCRIPTION : Un malware chiffre les données ou le firmware du capteur IoT
et demande une rançon. Peut paralyser toute une ligne de production.
INDICATEURS DÉTECTION :
  - Activité disque anormale (I/O spikes)
  - Valeurs capteur bloquées (toujours la même valeur = chiffrement)
  - Capteur Weather : détection 97.5%
  - Capteur Fridge : détection 93.8% (le plus vulnérable)
  - Modèle combiné : détection 100%
IMPACT : Arrêt total du capteur. Coût financier élevé. Temps de reprise long.
SCORE DE RISQUE ATTENDU : 85-100/100 (critique).
NORME : IEC 62443-4-2 SR 7.3 — Sauvegarde et récupération.
        """,
    },

    {
        "id": "ATK-009",
        "category": "attack",
        "title": "Attaque Scanning réseau IoT",
        "tags": ["scan", "port", "network", "discovery", "nmap", "reconnaissance", "probe"],
        "content": """
ATTAQUE : IoT_Scanning — Reconnaissance réseau
DESCRIPTION : L'attaquant scanne le réseau IoT pour identifier les devices,
leurs ports ouverts, leurs versions de firmware. C'est généralement la
première étape avant une attaque ciblée.
INDICATEURS DÉTECTION :
  - Requêtes vers de nombreuses IPs/ports différents
  - Faible impact sur les valeurs capteur (scanning perturbe peu la température)
  - Capteur Weather : détection 74.2% (le plus difficile à détecter)
  - Capteur Fridge : détection 99.4%
  - Modèle combiné : détection 100%
PARTICULARITÉ : C'est l'attaque la plus difficile à détecter avec Weather seul
car le scan réseau n'affecte pas directement la température.
SCORE DE RISQUE ATTENDU : 40-65/100 (précurseur d'attaque plus sévère).
NORME : IEC 62443-4-2 SR 6.2 — Surveillance du trafic réseau.
        """,
    },

    # ══════════════════════════════════════════════════════════════════════════
    # COMPORTEMENT NORMAL DES CAPTEURS
    # ══════════════════════════════════════════════════════════════════════════

    {
        "id": "SENSOR-001",
        "category": "sensor",
        "title": "Comportement normal capteur Weather (Météo)",
        "tags": ["weather", "temperature", "humidity", "normal", "baseline", "capteur"],
        "content": """
CAPTEUR WEATHER — Comportement normal (dataset 2019, 399 188 mesures)
PLAGES NORMALES :
  - Température : -20°C à +60°C (variance élevée, normale pour l'extérieur)
  - Humidité    : 0% à 100%
  - Pression    : 870 à 1085 hPa (exclue de l'analyse — valeurs aberrantes connues)
FEATURES CLÉS (modèle multivarié One-Class SVM) :
  - temp_diff_1       : variation en 1 pas (sauts > 5°C = suspect)
  - temp_roll_mean_10 : moyenne mobile 10 pts (dérive = suspect)
  - temp_roll_std_10  : écart-type mobile (volatilité soudaine = suspect)
  - hour_sin/cos      : encodage cyclique heure (comportement jour/nuit)
TAUX ANOMALIE NATURELLE : 3% (nu=0.03 du One-Class SVM)
PERFORMANCE DÉTECTION : 100% sur 7/9 attaques, 74.2% sur scanning.
        """,
    },

    {
        "id": "SENSOR-002",
        "category": "sensor",
        "title": "Comportement normal capteur Fridge (Réfrigérateur industriel)",
        "tags": ["fridge", "refrigerateur", "temperature", "compressor", "normal", "baseline"],
        "content": """
CAPTEUR FRIDGE — Comportement normal (dataset 2019, 383 368 mesures)
PLAGES NORMALES :
  - Température   : -30°C à +20°C
  - État compresseur : high / low (temp_condition)
FEATURES CLÉS :
  - fridge_temperature    : valeur brute
  - fridge_diff_1         : variation (sauts > 3°C = suspect)
  - fridge_roll_mean_10   : dérive thermique (> 2°C/heure = suspect)
  - temp_condition_encoded: 1=high, 0=low — signal très fort
SIGNAL FORT : temp_condition (état du compresseur) est l'indicateur
le plus discriminant. Une attaque force souvent le compresseur en
mode 'high' en permanence.
TAUX ANOMALIE NATURELLE : 5%
PERFORMANCE DÉTECTION : > 93% sur toutes les attaques (très fiable).
        """,
    },

    {
        "id": "SENSOR-003",
        "category": "sensor",
        "title": "Comportement normal capteur Thermostat",
        "tags": ["thermostat", "temperature", "hvac", "normal", "stable", "weak"],
        "content": """
CAPTEUR THERMOSTAT — Comportement normal (dataset 2019, 291 182 mesures)
PLAGES NORMALES :
  - Température régulée : +10°C à +45°C (variance FAIBLE, σ=2.4°C)
  - État : ON (89% du temps) / OFF (11%)
LIMITATION IMPORTANTE :
  Ce capteur est difficile à utiliser seul pour la détection d'attaques.
  Sa température est régulée → très stable → peu de signal utile.
  Rappel DDoS : seulement 5% (quasi aucune détection en isolement).
UTILISATION RECOMMANDÉE : Toujours combiner avec Weather et/ou Fridge.
  Le modèle Combiné (3 capteurs) atteint 100% sur 8/9 attaques.
PERFORMANCE DÉTECTION SEUL : 5% à 54% selon l'attaque (non fiable seul).
        """,
    },

    # ══════════════════════════════════════════════════════════════════════════
    # PROCÉDURES DE REMÉDIATION
    # ══════════════════════════════════════════════════════════════════════════

    {
        "id": "REM-001",
        "category": "remediation",
        "title": "Procédure de remédiation — Score de risque CRITIQUE (80-100)",
        "tags": ["remediation", "critical", "urgent", "action", "isolate", "escalate"],
        "content": """
PROCÉDURE CRITIQUE (Score 80-100) — Action immédiate requise
ÉTAPE 1 — ISOLEMENT (< 5 minutes) :
  - Déconnecter le device du réseau industriel
  - Bloquer le topic MQTT correspondant au device
  - Alerter l'équipe de sécurité OT/IT

ÉTAPE 2 — INVESTIGATION (< 30 minutes) :
  - Capturer les logs réseau des 30 dernières minutes
  - Vérifier les CVE connues pour ce firmware
  - Analyser la corrélation avec les autres capteurs

ÉTAPE 3 — REMÉDIATION (< 2 heures) :
  - Mettre à jour le firmware si CVE identifiée
  - Réinitialiser les identifiants du device
  - Vérifier l'intégrité des données collectées

ÉTAPE 4 — RETOUR EN SERVICE :
  - Tester le device en mode sandbox avant reconnexion
  - Documenter l'incident dans le SIEM
        """,
    },

    {
        "id": "REM-002",
        "category": "remediation",
        "title": "Procédure de remédiation — Score de risque ÉLEVÉ (60-79)",
        "tags": ["remediation", "high", "watch", "monitor", "patch", "update"],
        "content": """
PROCÉDURE ÉLEVÉE (Score 60-79) — Surveillance renforcée
ÉTAPE 1 — SURVEILLANCE (< 15 minutes) :
  - Activer la journalisation détaillée pour ce device
  - Augmenter la fréquence de collecte de métriques

ÉTAPE 2 — VÉRIFICATION (< 1 heure) :
  - Vérifier les CVE et planifier le patch firmware
  - Analyser les alertes des dernières 24h
  - Valider la cohérence des données capteur

ÉTAPE 3 — PLANIFICATION :
  - Programmer la mise à jour firmware lors de la prochaine fenêtre
  - Mettre en place des règles de firewall préventives
        """,
    },

    {
        "id": "REM-003",
        "category": "remediation",
        "title": "Procédure de remédiation — Surveillance de la performance du modèle IA",
        "tags": ["remediation", "model", "retrain", "ia"],
        "content": """
SURVEILLANCE MODÈLE IA — Fiabilité des prédictions
CONTEXTE : Le modèle One-Class SVM est entraîné sur un jeu de données fixe
(2019). Sa performance est surveillée à chaque entraînement via la page
Résultats.

ÉTAPE 1 — ÉVALUATION :
  - Consulter la page Résultats pour l'historique des entraînements
  - Vérifier les métriques (F1, recall, ROC-AUC) du modèle actif

ÉTAPE 2 — DÉCISION :
  - Si une nouvelle version entraîne une dégradation des métriques
  : vérifier l'entraînement et ses hyperparamètres

ÉTAPE 3 — APRÈS UN NOUVEL ENTRAÎNEMENT :
  - Comparer les métriques du nouvel entraînement avec le précédent
  - En cas de régression : relancer un entraînement avec des hyperparamètres ajustés
        """,
    },

    # ══════════════════════════════════════════════════════════════════════════
    # STANDARDS IEC 62443 / ETSI EN 303645
    # ══════════════════════════════════════════════════════════════════════════

    {
        "id": "STD-001",
        "category": "standard",
        "title": "IEC 62443-4-2 — Exigences de sécurité pour les composants IoT industriels",
        "tags": ["iec", "62443", "standard", "compliance", "industrial", "security", "ot"],
        "content": """
STANDARD IEC 62443-4-2 — Composants IoT industriels

SR 1.1 — Identification et authentification :
  Tous les devices doivent s'authentifier avant toute communication.
  Mots de passe complexes requis. Pas de credentials par défaut.

SR 1.7 — Politique de mots de passe fort :
  Longueur minimum 8 caractères. Rotation périodique obligatoire.
  Blocage après N tentatives échouées (protection brute force).

SR 3.1 — Intégrité des communications :
  Chiffrement TLS 1.2+ sur toutes les communications. Validation
  des certificats. Protection contre MITM obligatoire.

SR 3.5 — Validation des entrées :
  Toutes les données reçues doivent être validées avant traitement.
  Plages de valeurs physiques vérifiées (protection injection).

SR 6.2 — Surveillance continue :
  Journalisation de tous les accès. Détection d'anomalies requise.
  Alertes en temps réel pour les événements de sécurité critiques.

SR 7.1 — Disponibilité et résilience :
  Protection contre les attaques DoS/DDoS. Mécanismes de reprise.

SR 7.2 — Gestion des ressources :
  Limitation du trafic. QoS pour les communications critiques.

SR 7.3 — Sauvegarde et récupération :
  Sauvegardes régulières du firmware et de la configuration.
  Procédures de restauration documentées et testées.
        """,
    },

    {
        "id": "STD-002",
        "category": "standard",
        "title": "ETSI EN 303645 — Sécurité des appareils IoT grand public",
        "tags": ["etsi", "303645", "consumer", "iot", "baseline", "privacy", "default"],
        "content": """
STANDARD ETSI EN 303645 — Exigences de base IoT

Provision 5.1 — Pas de mots de passe universels par défaut :
  Chaque device doit avoir des credentials uniques ou forcer
  le changement de mot de passe à la première utilisation.

Provision 5.2 — Moyen de signalement des vulnérabilités :
  Contact de sécurité public. Processus de divulgation responsable.

Provision 5.3 — Mises à jour logicielles régulières :
  Mécanisme de mise à jour automatique sécurisé. Signature des firmwares.

Provision 5.4 — Stockage sécurisé des données sensibles :
  Credentials et clés cryptographiques stockés dans un environnement
  sécurisé (TPM, secure element).

Provision 5.5 — Communications sécurisées :
  TLS obligatoire. Validation des certificats. Épinglage de certificats
  recommandé pour les communications critiques.

Provision 5.6 — Surface d'attaque minimale :
  Désactiver tous les services non utilisés. Ports fermés par défaut.

Provision 5.8 — Protection des données personnelles :
  Principe de minimisation. Chiffrement des données au repos.
        """,
    },
]


def get_all_documents() -> list[dict]:
    """Retourne tous les documents de la base de connaissances."""
    return KNOWLEDGE_DOCUMENTS


def get_documents_by_category(category: str) -> list[dict]:
    """Filtre par catégorie : attack, sensor, remediation, standard."""
    return [d for d in KNOWLEDGE_DOCUMENTS if d["category"] == category]


def get_document_by_id(doc_id: str) -> dict | None:
    """Retourne un document par son ID."""
    for d in KNOWLEDGE_DOCUMENTS:
        if d["id"] == doc_id:
            return d
    return None
