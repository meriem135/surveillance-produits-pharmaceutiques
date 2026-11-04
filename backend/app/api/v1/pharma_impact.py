"""Impact Pharma — rapport opérateur d'un point du dataset (phase 2)
=====================================================================
La page « Impact pharma » et son analyse globale (GET /pharma/impact) ont été retirées du
dashboard ; seul reste le rapport opérateur d'un point (POST /pharma/point-report), utilisé par
les pages SHAP de la phase 2 et par l'analyste IA.

Ancien en-tête : Analyse des attaques du dataset sur chaque capteur
====================================================================
Industrie 4.0 pharmaceutique : comment les attaques du dataset influencent
chaque capteur IoT et comment elles impactent les **stocks** et la
**production** de produits pharmaceutiques.

Trois briques, toutes issues des données réelles du projet :

1. **Signature dataset (dataset_fusionne.csv)** — le dataset d'entraînement
   des modèles ML : comparaison ligne de base "normal" vs lignes "attaque"
   par capteur (décalage de moyenne en sigma, inflation d'écart-type,
   explosion de volatilité `roll_std_10`, % hors bande ±3σ, taux de sauts).
   C'est l'empreinte vraiment observée dans les données que voient les modèles.

2. **Empreinte mesurée par type d'attaque × capteur** — calculée sur les
   traces d'attaque brutes (`Data/Raw/Attaque/<type>`) comparées à la ligne
   de base normale (`Data/Raw/Normal`) : volatilité glissante, ratio
   d'écart-type, dérive, sauts, séquences monotones (signature ransomware).

3. **Impact métier pharmaceutique** — projection des effets de chaque type
   d'attaque sur le stock, la production et la qualité (GMP / Annex 11 /
   21 CFR Part 11), combinant le mode opératoire (disponibilité, intégrité,
   confidentialité) et l'empreinte mesurée sur les capteurs.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel


router = APIRouter()



SENSOR_LABELS = {"weather": "Météo", "fridge": "Frigo / Chambre froide", "thermostat": "Thermostat"}

# ── Candidats de colonnes température dans les fichiers bruts ──────────────

# ── Dossiers bruts d'attaque → identifiant de type ────────────────────────

# ── Catalogue métier pharmaceutique par type d'attaque ────────────────────
# base : socle d'impact métier (0-100) avant pondération par l'empreinte mesurée.
PHARMA_CATALOG = {
    "ddos": {
        "name": "Inondation DDoS MQTT",
        "category": "Disponibilité (Denial of Service)",
        "severity": "critique",
        "severity_weight": 1.0,
        "description": "Saturation du broker/shared de télémétrie : la supervision de la chaîne du froid et des lignes devient aveugle.",
        "mode": {"disponibilite": 100, "integrite": 15, "confidentialite": 20},
        "stock_base": 60, "production_base": 74,
        "stock_batches_base": 40, "production_hours_base": 16,
        "products": "Médicaments thermostatés (vaccins, insulines, biosimilaires) sans supervision de chambre froide ; lots partis sans contrôle.",
        "stock_effect": "Rupture de traçabilité des entrepôts : sorties non enregistrées, perte des courbes T° → lots écartés au contrôle qualité.",
        "production_effect": "Perte de contrôle des lignes de conditionnement : arrêt préventif, perte des données d'encours (lot tracé).",
        "regulatory": ["EU GMP Annexe 11 §1.6 (fiabilité des enregistrements)", "GDP Art. 9.2 (intégrité de la chaîne du froid)"],
        "mitigation": ["Rate limiting & ACL sur le broker MQTT", "Supervision de secours (buffering local + registres)", "Réplication du serveur de supervision"],
    },
    "dos": {
        "name": "Déni de service (DoS)",
        "category": "Disponibilité (Denial of Service)",
        "severity": "élevée",
        "severity_weight": 0.8,
        "description": "Interruption ciblée des flux de télémétrie d'un ou plusieurs capteurs (courtes rafales).",
        "mode": {"disponibilite": 90, "integrite": 25, "confidentialite": 10},
        "stock_base": 48, "production_base": 62,
        "stock_batches_base": 25, "production_hours_base": 10,
        "products": "Pertes courtes de monitoring — risque de perdre un dépassement de seuil (alarme T° non remontée).",
        "stock_effect": "Fenêtres d'aveugle sur les chambres froides → données manquantes à investiguer (CAPA).",
        "production_effect": "Micro-coupures de supervision des procédés, reprise des enregistrements incertaine.",
        "regulatory": ["EU GMP Annexe 11 §5.1 (capitalisation des alarmes)", "21 CFR Part 11 §11.10 (données électroniques complètes)"],
        "mitigation": ["Seuil de perte de paquets avec déclenchement d'alerte", "Redondance MQTT (2 brokers)", "Enregistrement local des capteurs"],
    },
    "injection": {
        "name": "Injection de données (T° extrêmes)",
        "category": "Intégrité des données",
        "severity": "critique",
        "severity_weight": 1.0,
        "description": "Des valeurs de température fausses sont injectées dans la télémétrie (chambre froide, lignes).",
        "mode": {"disponibilite": 20, "integrite": 100, "confidentialite": 10},
        "stock_base": 84, "production_base": 70,
        "stock_batches_base": 70, "production_hours_base": 8,
        "products": "Falsification des lectures T° → un lot de vaccins peut sembler hors spec (destruction) ou conforme alors qu'il est compromis (santé publique).",
        "stock_effect": "Décisions de conformité faussées : destruction de bons lots et libération de mauvais lots (impact patient).",
        "production_effect": "Paramètres de procédé corrompus → reprise de fabrication, non-conformités.",
        "regulatory": ["EU GMP Annexe 11 §7.1 (intégrité des données)", "21 CFR Part 11 §11.10 (confidentialité/inviolabilité des enregistrements)", "Obligation d'enquête CAPA et notification des excédents"],
        "mitigation": ["Validation entrante (bornes physiques, schéma JSON)", "Corrélation inter-capteurs", "Redondance des capteurs de température"],
    },
    "mitm": {
        "name": "Homme du milieu (MitM)",
        "category": "Confidentialité / Intégrité",
        "severity": "critique",
        "severity_weight": 1.0,
        "description": "Interception et possible réécriture des flux MQTT entre capteurs et supervision.",
        "mode": {"disponibilite": 25, "integrite": 60, "confidentialite": 90},
        "stock_base": 70, "production_base": 74,
        "stock_batches_base": 45, "production_hours_base": 12,
        "products": "Formules de procédés et recettes copiées (espionnage industriel) ; données de lots réécrites.",
        "stock_effect": "Vol des quantités en stock / recettes ; réécriture des mouvements de stock.",
        "production_effect": "Ordres de fabrication falsifiés → mauvaise production, perte de lots.",
        "regulatory": ["Secrets d'affaires & propriété industrielle", "EU GMP Annexe 11 §12 (auditabilité)", "Règlement (UE) 2019/881 (Cybersecurity Act)"],
        "mitigation": ["TLS/WSS mutualisé sur MQTT", "Émpreintes de dispositifs (X.509 par capteur)", "Détection d'incohérences inter-capteurs"],
    },
    "backdoor": {
        "name": "Backdoor & exfiltration",
        "category": "Accès persistant / Exfiltration",
        "severity": "critique",
        "severity_weight": 1.0,
        "description": "Accès distant persistant, exfiltration de données cachées dans la télémétrie ou prise de contrôle.",
        "mode": {"disponibilite": 40, "integrite": 50, "confidentialite": 95},
        "stock_base": 74, "production_base": 78,
        "stock_batches_base": 50, "production_hours_base": 14,
        "products": "Compromission durable du système de supervision → données produits volées, contrôles modifiés à retard de cause.",
        "stock_effect": "Exfiltration des niveaux de stock, des prix, des recettes ; manipulation silencieuse des seuils.",
        "production_effect": "Modification discrète des setpoints de procédé → lots non conformes non détectés.",
        "regulatory": ["KI/KD (sécurité des infrastructures critiques)", "EU GMP Annexe 11 §3.4 (audit trail)", "NIS2 (secteur santé)"],
        "mitigation": ["Cloisonnement réseau (ségrégation OT)", "Surveillance et inspection des flux sortants", "Rotation des credentials & durcissement"],
    },
    "ransomware": {
        "name": "Ransomware / extorsion",
        "category": "Destructif",
        "severity": "critique",
        "severity_weight": 1.0,
        "description": "Chiffrement des données de production/stock et des courbes de validation, extorsion, valeurs corruptives croissantes.",
        "mode": {"disponibilite": 95, "integrite": 90, "confidentialite": 100},
        "stock_base": 88, "production_base": 92,
        "stock_batches_base": 80, "production_hours_base": 48,
        "products": "Blocage de la GPAO/ERP : traçabilité des lots perdue, historique de validation chiffré → arrêt long, rappel/notification.",
        "stock_effect": "Immobilisation des stocks, perte des mouvements et des courbes T°, destruction/relibération à la restauration.",
        "production_effect": "Lignes à l'arrêt complet, reprise coûteuse, risque réglementaire et pénal.",
        "regulatory": ["EU GMP Annexe 11 §3.2 (restauration/découverte après sinistre)", "Obligation de notification (NIS2 / incident)", "Continuité d'activité (BCP)"],
        "mitigation": ["Sauvegardes hors-ligne + restauration testée", "Isolation OT/IT et EDR", "Plan de continuité (BCP) des lignes critiques"],
    },
    "scanning": {
        "name": "Scan réseau / reconnaissance",
        "category": "Reconnaissance",
        "severity": "moyenne",
        "severity_weight": 0.45,
        "description": "Exploration des topics MQTT et de la topologie pour préparer une attaque.",
        "mode": {"disponibilite": 5, "integrite": 5, "confidentialite": 45},
        "stock_base": 26, "production_base": 28,
        "stock_batches_base": 5, "production_hours_base": 2,
        "products": "Préparatoire : pas d'impact immédiat produit mais cartographie des vulnérabilités.",
        "stock_effect": "Aucun impact direct ; signe avant-coureur d'une intrusion (à durcir).",
        "production_effect": "Aucun impact direct ; révision du plan de sécurité OT recommandée.",
        "regulatory": ["Anticipation NIS2 (détection proactive)", "Journalisation (EU GMP Annexe 11 §9)"],
        "mitigation": ["ACL topics MQTT, désactivation des wildcards", "Détection de scans (surveillance des connexions)", "Honeypots"],
    },
    "password": {
        "name": "Force brute MQTT / mots de passe",
        "category": "Credential",
        "severity": "élevée",
        "severity_weight": 0.8,
        "description": "Test de mots de passe faibles sur le broker MQTT et les comptes de supervision.",
        "mode": {"disponibilite": 15, "integrite": 40, "confidentialite": 85},
        "stock_base": 52, "production_base": 58,
        "stock_batches_base": 20, "production_hours_base": 6,
        "products": "En cas de succès, accès à la supervision = porte d'entrée vers l'altération des données produits.",
        "stock_effect": "Accès non autorisé aux niveaux de stock, aux commandes et paramètres.",
        "production_effect": "Prise de contrôle potentielle des setpoints de production.",
        "regulatory": ["EU GMP Annexe 11 §3.3 (gestion des accès)", "Politique d'authentification renforcée (NIS2)"],
        "mitigation": ["MFA + certificats clients", "Verrouillage après échecs, journalisation des connexions", "Rotation périodique des secrets"],
    },
    "xss": {
        "name": "Injection XSS / payloads",
        "category": "Intégrité des données",
        "severity": "moyenne",
        "severity_weight": 0.5,
        "description": "Payloads HTML/JS injectés dans la télémétrie, exploitables dans les interfaces de supervision.",
        "mode": {"disponibilite": 15, "integrite": 55, "confidentialite": 35},
        "stock_base": 42, "production_base": 44,
        "stock_batches_base": 12, "production_hours_base": 4,
        "products": "Altération des vues opérateur → fausses lectures des paramètres de stock/qualité.",
        "stock_effect": "Affichages falsifiés, erreurs de saisie et de libération de lots.",
        "production_effect": "Tableaux de bord de ligne corrompus, décisions opérateur biaisées.",
        "regulatory": ["EU GMP Annexe 11 §7.1 (intégrité)", "OWASP / exigence de durcissement des IHM"],
        "mitigation": ["Sanitisation & validation JSON schema", "Echappement des sorties HTML", "Mises à jour des interfaces"],
    },
}

# ── Rôles métier des capteurs en industrie pharmaceutique ─────────────────
SENSOR_ROLE = {
    "weather": {
        "role": "Logistique & environnement externe (intempéries, quais de réception)",
        "domain": "logistics",
        "product_impact": "Risques de rupture de la chaîne du froid pendant le transport (réception/expédition).",
        "stock_weight": 0.45, "production_weight": 0.20,
    },
    "fridge": {
        "role": "Zone de stock — chambre froide (matières premières & produits finis thermosensibles)",
        "domain": "stock",
        "product_impact": "Non-respect de la plage +2…+8°C → perte de puissance/vaccins, destruction de lots, excursions.",
        "stock_weight": 0.95, "production_weight": 0.10,
    },
    "thermostat": {
        "role": "Ligne de production — salles blanches & procédés de fabrication",
        "domain": "production",
        "product_impact": "Dérive des paramètres de procédé → lots non conformes, retards de production.",
        "stock_weight": 0.15, "production_weight": 0.90,
    },
}


# ═══════════════════════════════════════════════════════════════════════════
#  Rapport opérateur industriel (template déterministe) — point du dataset
# ═══════════════════════════════════════════════════════════════════════════

# Actions communes à tout point signalé
_CORE_CHECKS = [
    "Recroiser la valeur avec la MES brute du capteur et la moyenne mobile (fenêtre 10).",
    "Vérifier la corrélation inter-capteurs (weather↔thermostat, fridge↔thermostat) pour écarter une injection de données.",
    "Contrôler l'horodatage et l'absence de perte / rejet de paquets MQTT (broker).",
    "Consigner l'écart dans le registre CAPA avec l'heure exacte (audit trail).",
]

# Template d'action quand le type d'attaque n'est pas labellisé dans le
# dataset fusionné (colonne `label` uniquement) — honnête et non supposé.
_GENERIC_ANOMALY = {
    "name": "Comportement anormal (non typé)",
    "category": "Intégrité / Disponibilité des données",
    "severity": "élevée",
    "severity_weight": 0.8,
    "description": "Point anormal détecté par le modèle OCSVM ; le type d'attaque n'est pas labellisé dans le dataset fusionné.",
    "mode": {"disponibilite": 40, "integrite": 70, "confidentialite": 20},
    "stock_base": 55, "production_base": 62,
    "production_effect": "Paramètres de procédé hors du pattern attendu — investigation d'écart requise avant libération de lot.",
    "stock_effect": "Excursion de température suspecte — vérification manuelle de la chambre froide requise.",
    "products": "Produits thermosensibles ou lots en cours — pas de libération sans validation QA.",
    "regulatory": ["EU GMP Annexe 11 (audit trail & gestion des alarmes)", "21 CFR Part 11 §11.10 (données électroniques)"],
    "mitigation": ["Renforcer la validation des bornes physiques des capteurs", "Corrélation inter-capteurs sur les 3 voies", "Supervision continue des alarmes en salle"],
}

_DOMAIN_CHECKS = {
    "production": [
        "Vérifier le setpoint de la zone / bloc concerné et la calibration du thermostat de ligne.",
        "Mettre les lots en cours de la zone sous statut Quarantaine tant que l'écart n'est pas clos.",
        "Initier une investigation d'écart (Deviation / CAPA) si un paramètre de procédé est hors bornes.",
        "Revoir les enregistrements de procédé (BPR) pour la période impactée.",
        "Valider la reprise de ligne après contrôle (health check équipement).",
    ],
    "stock": [
        "Contrôler manuellement la température de la chambre froide (plage cible 2–8 °C).",
        "Enregistrer l'excursion de température et son timestamp (monitoring continu — Annexe 11 §2).",
        "Mettre les produits thermosensibles sous quarantaine ; évaluation QA avant libération.",
        "Vérifier les alarmes, portes et dataloggers de la chaîne du froid.",
    ],
    "logistics": [
        "Vérifier les conditions aux quais de réception / expédition et les enregistreurs de transport.",
        "Reconstituer l'historique « temps réel » (source externe) pour écarter un événement météo réel versus une injection.",
    ],
}

_REGULATORY = {
    "production": ["EU GMP Annexe 11 (fiabilité des enregistrements, audit trail)", "21 CFR Part 11 §11.10 (données électroniques)", "IEC 62443 / NIS2 (OT)"],
    "stock": ["EU GMP Annexe 11 §2 (monitoring de température)", "EU GDP Art. 9.2 (intégrité de la chaîne du froid)", "21 CFR Part 11 (signatures électroniques)"],
    "logistics": ["EU GDP Art. 9 (transport & réception)", "Contrôles des équipements de transport", "EU GMP Annexe 11 (journalisation)"],
}

_DISPOSITIONS = {
    "critique": ("Action immédiate", "Zone / lot concernés mis en quarantaine, investigation CAPA sous 72 h, notification qualité / RSSI."),
    "élevée": ("Surveillance renforcée", "Vérification physique des relevés par l'opérateur, recontrôle qualité avant libération des lots concernés."),
    "moyenne": ("Contrôle additionnel", "Contrôle qualité restreint et enregistrement du point pour suivi de tendance."),
    "faible": ("Aucune action", "Point de référence normal (baseline). Aucune dérive détectée sur les capteurs principaux."),
}


class PharmaReportRequest(BaseModel):
    sensor: str = "thermostat"            # weather | fridge | thermostat
    attack_id: Optional[str] = None       # id du catalogue (ddos…xss)
    risk_score: Optional[float] = None    # 0-100 (ex: score SHAP projeté)
    is_anomaly: Optional[bool] = False
    label: Optional[int] = 0
    severity: Optional[str] = None        # override
    season: Optional[str] = None
    device: Optional[str] = None
    sensor_values: Optional[dict] = None  # {weather, fridge, thermostat}
    top_causes: Optional[list] = None     # liste SHAP brutes (point du dataset)
    ai_context: Optional[dict] = None

    class Config:
        extra = "ignore"


@router.post("/pharma/point-report")
async def get_pharma_point_report(body: PharmaReportRequest):
    """Rapport opérateur industriel pharmaceutique pour UN point du dataset.

    Template déterministe (catalogue métier + rôle capteur + gravité dérivée).
    Ne fait pas appel au LLM ici — le diagnostic IA est servi séparément par
    `/api/v1/analyst/analyze` avec le contexte `ai_context` fourni.
    """
    sensor = body.sensor if body.sensor in SENSOR_ROLE else "thermostat"
    role = SENSOR_ROLE[sensor]
    domain = role["domain"]
    label_lo = SENSOR_LABELS[sensor]
    if body.attack_id in PHARMA_CATALOG:
        atype = body.attack_id
        cat = PHARMA_CATALOG[atype]
    else:
        atype = None
        cat = _GENERIC_ANOMALY

    # ── Gravité dérivée ──
    if body.severity:
        severity = body.severity if body.severity in _DISPOSITIONS else "moyenne"
    elif body.label == 1 and body.is_anomaly:
        severity = "critique"
    elif body.is_anomaly or (body.risk_score is not None and body.risk_score >= 60):
        severity = "élevée"
    elif body.label == 1:
        severity = "moyenne"
    else:
        severity = "faible"

    risk = round(float(body.risk_score or 0.0), 1)
    if body.risk_score is None and body.label == 1:
        risk = 65.0 if body.is_anomaly else 50.0

    # ── Expliabilité : pourquoi ce point est signalé ──
    why = "Point de référence normal : aucun signal anormal détecté par le modèle."
    causes_text = []
    if body.top_causes:
        for c in body.top_causes:
            lab = c.get("feature", c.get("feature_value", ""))
            interp = str(c.get("interpretation", "") or "")
            causes_text.append(f"{lab}: {interp}")
    if body.is_anomaly:
        why = "Le modèle OCSVM considère ce point anormal ; les contributions SHAP « vers anomalie » ci-dessous expliquent l'écart."
    elif body.label == 1:
        why = "Point labellisé « attaque » dans le dataset (label=1) mais non détecté par le modèle à ce niveau de score — à surveiller."

    # ── Vecteur d'action par domaine (production vs stock vs logistique) ──
    actions = list(_CORE_CHECKS) + list(_DOMAIN_CHECKS[domain])

    # ── Impact orienté production / stock selon le capteur dominant ──
    w_prod, w_stock = {
        "production": (0.80, 0.35),
        "stock": (0.30, 0.80),
        "logistics": (0.55, 0.55),
    }[domain]
    if cat:
        delt = {1.0: 1.5, 0.8: 1.1, 0.5: 0.7}[cat.get("severity_weight", 0.5)]
        production_impact = round(min(99, cat["production_base"] * w_prod + 12 * delt * w_prod))
        stock_impact = round(min(99, cat["stock_base"] * w_stock + 12 * delt * w_stock))
        effect_main = cat["production_effect"] if domain == "production" else cat["stock_effect"]
    else:
        production_impact = round(min(99, 15 + risk * 0.25))
        stock_impact = round(min(99, 15 + risk * 0.25))
        effect_main = "Aucun type d'attaque identifié — comportement anormal à classifier manuellement."

    disposition_label, disposition_desc = _DISPOSITIONS[severity]

    # ── Contexte CVE du capteur (NVD + EPSS) ──
    try:
        from app.domains.intelligence.nvd_service import nvd_service
        summary = await nvd_service.get_device_vulnerability_summary(sensor)
        cve_block = {
            "available": True,
            "sensor": sensor,
            "risk_score": float(summary["overall_vulnerability_score"]),
            "total_cves": int(summary["total_cves"]),
            "critical_count": int(summary["critical_count"]),
            "high_count": int(summary["high_count"]),
            "medium_count": int(summary["medium_count"]),
            "low_count": int(summary["low_count"]),
            "source": "NVD (National Vulnerability Database) + EPSS (FIRST.org)",
            "top_cves": summary["top_cves"],
        }
    except Exception as exc:
        cve_block = {"available": False, "error": f"CVE indisponible ({exc})"}

    return {
        "report": "ok",
        "guardian": "template_pharma_v1",
        "sensor": sensor,
        "sensor_label": label_lo,
        "domain": domain,
        "domain_label": {
            "production": "Ligne de production (salles blanches & procédés)",
            "stock": "Zone de stock (chambre froide, produits thermosensibles)",
            "logistics": "Logistique & environnement externe (quais)",
        }[domain],
        "sensor_role": role["role"],
        "product_impact": role["product_impact"],
        "attack_id": atype,
        "attack_name": cat["name"] if cat else None,
        "attack_category": cat["category"] if cat else None,
        "severity": severity,
        "risk_score_per_100": int(round(risk)),
        "label": body.label,
        "is_anomaly": bool(body.is_anomaly),
        "season": body.season,
        "device": body.device,
        "sensor_values": body.sensor_values or {},
        "why": why,
        "shap_causes_summary": causes_text[:6],
        "impact": {
            "production_impact": production_impact,
            "stock_impact": stock_impact,
            "effect": effect_main,
        },
        "actions": actions,
        "disposition": {"label": disposition_label, "description": disposition_desc},
        "regulatory": _REGULATORY[domain] + (cat["regulatory"] if cat else []),
        "mitigation": cat["mitigation"] if cat else [],
        "ai_context_enabled": body.ai_context is not None,
        "cve": cve_block,
    }