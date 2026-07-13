"""
LLM Engine — Moteur de génération de texte
============================================
Deux modes de fonctionnement :

MODE 1 — Ollama (LLM local, recommandé en production)
  - Modèle : mistral:7b ou llama3:8b (téléchargeable gratuitement)
  - Aucune donnée n'est envoyée à l'extérieur
  - Installation : https://ollama.ai
  - Commande : ollama pull mistral

MODE 2 — Template Engine (fallback automatique si Ollama indisponible)
  - Génère des rapports structurés basés sur des templates intelligents
  - Qualité élevée grâce au contexte RAG injecté
  - Fonctionne SANS aucune dépendance externe
  - Parfait pour les démonstrations et les environnements sans GPU

Le système détecte automatiquement si Ollama est disponible.
Si non → fallback transparent vers le moteur template.
"""

import httpx
import json
from datetime import datetime
from typing import Optional


# ── Configuration Ollama ──────────────────────────────────────────────────────
OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_MODEL = "phi:2.7b"     # phi:2.7b (léger, bonne qualité) ou tinyllama
OLLAMA_TIMEOUT = 180.0         # secondes max pour la génération


async def _check_ollama_available() -> bool:
    """Vérifie si Ollama tourne en local."""
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            return resp.status_code == 200
    except Exception:
        return False


async def _call_ollama(prompt: str, system: str = "") -> str:
    """
    Appelle l'API Ollama pour générer une réponse.

    Args:
        prompt : le prompt utilisateur (contexte RAG + question)
        system : le rôle/instructions système pour le LLM

    Returns:
        Texte généré par le LLM, ou message d'erreur.
    """
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "system": system,
        "stream": False,
        "options": {
            "temperature": 0.3,    # Faible = réponses factuelles et cohérentes
            "top_p": 0.9,
            "num_predict": 600,    # Limite la longueur pour éviter les dérives
        },
    }
    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("response", "").strip()
    except httpx.TimeoutException:
        return "[Ollama timeout — rapport généré par template]"
    except Exception as e:
        return f"[Ollama indisponible : {e} — rapport généré par template]"


# ── Template Engine (fallback professionnel) ─────────────────────────────────

def _severity_emoji(severity: str) -> str:
    return {
        "CRITICAL": "🔴",
        "HIGH": "🟠",
        "MEDIUM": "🟡",
        "LOW": "🟢",
        "NONE": "⚪",
    }.get(severity.upper(), "⚫")


def _build_template_report(
    alert_context: dict,
    rag_documents: list[dict],
    question: Optional[str] = None,
) -> str:
    """
    Génère un rapport professionnel structuré sans LLM.

    Le rapport s'adapte au contexte de l'alerte :
    - Type d'attaque suspectée
    - Score de risque et sévérité
    - Informations de drift MLOps
    - Cohérence inter-capteurs
    - Documents RAG les plus pertinents
    """
    device_id    = alert_context.get("device_id", "inconnu")
    device_name  = alert_context.get("device_name", device_id)
    device_type  = alert_context.get("device_type", "inconnu")
    risk_score   = alert_context.get("risk_score", 0)
    severity     = alert_context.get("severity", "NONE")
    rule_id      = alert_context.get("rule_id", "")
    rule_name    = alert_context.get("rule_name", "")
    rule_desc    = alert_context.get("rule_description", "")
    attack_type  = alert_context.get("attack_type", "")
    sensor       = alert_context.get("sensor", device_type)
    ts           = alert_context.get("timestamp", datetime.now().isoformat())
    top_factors  = alert_context.get("top_factors", [])
    drift_info   = alert_context.get("drift_info", {})
    cross_sensor = alert_context.get("cross_sensor_info", {})
    n_sensors    = cross_sensor.get("n_sensors_alert", 0)
    weather_t    = alert_context.get("weather_temperature")
    fridge_t     = alert_context.get("fridge_temperature")
    thermo_t     = alert_context.get("thermostat_temperature")
    season       = alert_context.get("season", "")
    month        = alert_context.get("month", "")
    label        = alert_context.get("label", "")
    is_anomaly   = alert_context.get("is_anomaly", False)
    norm_score   = alert_context.get("normality_score", "")

    icon = _severity_emoji(severity)

    # Seuils par capteur pour les recommandations terrain
    SENSOR_THRESHOLDS = {
        "weather":    {"label": "température extérieure", "delta_max": "14°C", "norm": "5-35°C selon saison"},
        "fridge":     {"label": "température frigo",      "delta_max": "5°C",  "norm": "2-8°C"},
        "thermostat": {"label": "température ambiante",   "delta_max": "16°C", "norm": "18-30°C selon saison"},
        "multi-sensor": {"label": "multi-capteurs",       "delta_max": "5°C",  "norm": "variable"},
    }
    st = SENSOR_THRESHOLDS.get(sensor, SENSOR_THRESHOLDS["multi-sensor"])

    # ── En-tête ───────────────────────────────────────────────────────────────
    lines = [
        f"# {icon} Rapport de Sécurité IoT — {severity}",
        f"**Horodatage :** {ts}",
        f"**Équipement :** {device_name} ({device_id}) — Type : {device_type}",
        f"**Score de risque :** {risk_score}/100 — Sévérité : **{severity}**",
        "",
    ]

    # ── Événement déclencheur ─────────────────────────────────────────────────
    lines += ["## 1. Événement Déclencheur", ""]
    if rule_id:
        lines.append(f"**Règle DPI :** `{rule_id}` — {rule_name}")
    if rule_desc:
        lines.append(f"**Description :** {rule_desc}")
    if attack_type:
        lines.append(f"**Type d'attaque suspecté :** `{attack_type}`")
    lines.append("")

    # ── Données capteurs (temps réel) ─────────────────────────────────────────
    has_sensor_data = any(x is not None for x in [weather_t, fridge_t, thermo_t])
    if has_sensor_data:
        lines += ["## 2. Données Capteurs (temps réel)", ""]
        if weather_t is not None:
            lines.append(f"- **Température extérieure (weather) :** {weather_t}°C")
        if fridge_t is not None:
            lines.append(f"- **Température frigo (fridge) :** {fridge_t}°C")
        if thermo_t is not None:
            lines.append(f"- **Température thermostat :** {thermo_t}°C")
        if season:
            lines.append(f"- **Saison :** {season} (mois {month})")
        if norm_score is not None:
            lines.append(f"- **Score normalité :** {norm_score}%")
        if label is not None:
            lines.append(f"- **Label attaque :** {label}")
        lines.append("")

    # ── Analyse du risque ─────────────────────────────────────────────────────
    section_num = 3
    lines += [f"## {section_num}. Analyse du Score de Risque", ""]
    section_num += 1
    if top_factors:
        lines.append("**Facteurs dominants :**")
        for i, f in enumerate(top_factors[:4], 1):
            lines.append(f"  {i}. {f}")
    lines.append("")

    # ── Cohérence inter-capteurs ──────────────────────────────────────────────
    if n_sensors >= 2:
        lines += [f"## {section_num}. Cohérence Inter-Capteurs", ""]
        section_num += 1
        sensor_details = cross_sensor.get("sensor_details", {})
        alert_score    = cross_sensor.get("alert_score", 0)
        interpretation = cross_sensor.get("interpretation", "")

        lines.append(
            f"🚨 **{n_sensors} capteurs anormaux simultanément** "
            f"(score = {alert_score:.0f}/100)"
        )
        lines.append(interpretation)
        lines.append("")
        lines.append("| Capteur | Taux anomalie | Statut |")
        lines.append("|---------|--------------|--------|")
        for s_id, s_data in sensor_details.items():
            rate   = s_data.get("anomaly_rate_pct", 0)
            status = "🔴 ALERTE" if s_data.get("is_alerting") else "✅ Normal"
            lines.append(f"| {s_id} | {rate:.1f}% | {status} |")
        lines.append("")
        lines.append(
            "> 💡 **Corrélation multi-capteurs** : plusieurs capteurs en anomalie "
            "simultanée est un indicateur fort d'attaque coordonnée (DDoS, "
            "ransomware, ou compromission réseau)."
        )
        lines.append("")
    # ── Contexte base de connaissances (RAG) ──────────────────────────────────
    if rag_documents:
        lines += [f"## {section_num}. Contexte de la Base de Connaissances", ""]
        section_num += 1
        for doc in rag_documents[:3]:
            cat_label = {
                "attack":      "⚔️  Attaque",
                "dpi":         "🔍 Règle DPI",
                "sensor":      "📡 Capteur",
                "remediation": "🛠️  Remédiation",
                "standard":    "📋 Standard",
            }.get(doc["category"], "📄 Document")

            lines.append(
                f"### {cat_label} — {doc['title']} "
                f"*(pertinence: {doc['relevance_score']:.0%})*"
            )
            # Extraire les lignes les plus informatives du contenu
            content_lines = [
                l.strip() for l in doc["content"].split("\n")
                if l.strip() and not l.strip().startswith("ATTAQUE :") and len(l.strip()) > 10
            ]
            for cl in content_lines[:6]:
                lines.append(f"> {cl}")
            lines.append("")

    # ── Recommandations opérateur ──────────────────────────────────────────────
    lines += [f"## {section_num}. Que faire ? (Recommandations)", ""]
    section_num += 1

    # Message simple selon le niveau de risque
    if risk_score >= 80:
        lines.append("🔴 **URGENT — Une action immédiate est nécessaire.**")
    elif risk_score >= 60:
        lines.append("🟠 **SURVEILLANCE — Restez attentif, une vérification est conseillée.**")
    else:
        lines.append("🟢 **OK — Aucune action urgente, surveillance normale.**")
    lines.append("")

    # Recommandations spécifiques selon la règle DPI déclenchée
    temp_info = ""
    if weather_t is not None and fridge_t is not None and thermo_t is not None:
        temp_info = f" (weather={weather_t}°C, frigo={fridge_t}°C, thermostat={thermo_t}°C)"

    if rule_id == "DPI-001":
        lines += [
            "**🔍 Que s'est-il passé ?**",
            f"Une **variation brutale de température** a été détectée sur le capteur **{sensor}**{temp_info}.",
            "Cela peut être un capteur défaillant, un problème de câblage, ou une intrusion.",
            "",
            "**✅ À faire (par ordre) :**",
            f"1. 👀 **Inspecter le capteur {sensor}** — Regarder si le câble est endommagé, si le boîtier est humide.",
            f"2. 📊 **Vérifier l'historique** — Cette variation est-elle isolée ou répétée ? Si répétée → capteur à changer.",
            f"3. 🔄 **Comparer** — Si un autre capteur proche donne la même valeur → le problème est réel.",
            f"4. 📝 **Décision** — Capteur OK → fausse alerte. Problème confirmé → remplacer le capteur.",
        ]
    elif rule_id == "DPI-004":
        season_advice = ""
        if season == "Hiver":
            season_advice = "En hiver, les températures basses sont normales, mais une valeur anormalement haute peut indiquer un défaut d'isolation ou un chauffage bloqué."
        elif season == "Été":
            season_advice = "En été, les températures hautes sont normales, mais une valeur anormalement basse peut indiquer un capteur en panne ou une climatisation en dysfonctionnement."

        lines += [
            "**📊 Que s'est-il passé ?**",
            f"Une valeur **anormale pour la saison** a été détectée{temp_info}.",
            season_advice,
            "",
            "**✅ À faire (par ordre) :**",
            f"1. 👀 **Vérifier le capteur {sensor}** — Nettoyer, vérifier l'usure.",
            f"2. 🌡️ **Contrôle croisé** — Les autres capteurs donnent-ils des valeurs cohérentes ?",
            f"3. 📈 **Tendance** — La valeur dérive depuis longtemps (usure) ou a brutalement changé (panne) ?",
            f"4. 📝 **Décision** — Usure → maintenance programmée. Rupture brutale → intervention rapide.",
        ]
    elif rule_id == "DPI-005":
        lines += [
            "**📈 Que s'est-il passé ?**",
            f"Un **pic de température > 42°C** a été détecté{temp_info}.",
            "Une telle température est anormale dans un environnement intérieur.",
            "",
            "**⚠️ RISQUE INCENDIE — Vérifier immédiatement :**",
            f"1. 🔥 **Inspection visuelle** — Y a-t-il de la fumée, une odeur de brûlé ?",
            f"2. 🔌 **Vérifier le capteur** — Court-circuit possible (câble endommagé, oxydation).",
            f"3. 🌬️ **Environnement** — Source de chaleur proche ? Ventilation en panne ?",
            f"4. 📝 **Décision** — Pas d'incendie → capteur défaillant à remplacer.",
        ]
    else:
        lines += [
            "**✅ À faire :**",
            f"1. 👀 **Inspecter le capteur {sensor}** sur {device_name}.",
            "2. 📊 **Consulter les alertes récentes** pour voir si un pattern se dégage.",
            "3. 📝 **Documenter l'observation** dans le rapport de maintenance.",
        ]

    # ── Réponse à une question libre ─────────────────────────────────────────
    if question:
        lines += [
            "",
            f"## {section_num}. Réponse à votre Question",
            "",
            f"**Question :** *{question}*",
            "",
        ]
        # Chercher la réponse dans les documents RAG
        answered = False
        for doc in rag_documents[:2]:
            content_lower = doc["content"].lower()
            question_words = [w.lower() for w in question.split() if len(w) > 3]
            if any(w in content_lower for w in question_words):
                lines.append(f"D'après la base de connaissances ({doc['title']}) :")
                relevant_lines = [
                    l.strip() for l in doc["content"].split("\n")
                    if l.strip() and any(w in l.lower() for w in question_words)
                ]
                for rl in relevant_lines[:4]:
                    lines.append(f"> {rl}")
                answered = True
                break
        if not answered:
            lines.append(
                "Information non disponible dans la base de connaissances locale. "
                "Consulter la documentation IEC 62443 ou contacter l'équipe sécurité."
            )

    # ── Pied de page ──────────────────────────────────────────────────────────
    lines += [
        "",
        "---",
        f"*Rapport généré par Peaksoft Security Platform — "
        f"RAG Knowledge Base v1.0 — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*",
    ]

    return "\n".join(lines)


def _chat_response(
    question: str,
    rag_documents: list[dict],
    alert_context: Optional[dict] = None,
) -> str:
    question_lower = question.lower()
    device_type = (alert_context or {}).get("sensor", "") or (alert_context or {}).get("device_type", "")
    device_name = (alert_context or {}).get("device_name", "")
    rule_id = (alert_context or {}).get("rule_id", "")

    # Architecture documentaire avancée
    from collections import defaultdict
    doc_map: dict[str, list[tuple[str, str]]] = defaultdict(list)  # category -> [(title, content_line), ...]
    for doc in rag_documents:
        for line in doc["content"].split("\n"):
            s = line.strip()
            if s and len(s) > 20:
                doc_map[doc.get("category", "general")].append((doc["title"], s))

    # Mots-clés de la question enrichis par contexte
    keywords = {w.lower() for w in question.split() if len(w) > 3}
    if device_type:
        keywords.add(device_type.lower())
    if rule_id:
        keywords.add(rule_id.lower())
    if "resoud" in question_lower or "solution" in question_lower or "faire" in question_lower:
        keywords.update(["action", "intervention", "vérifier", "contrôler", "inspecter", "tester", "remédiation"])
    if "pourquoi" in question_lower or "cause" in question_lower or "origine" in question_lower:
        keywords.update(["cause", "déclenché", "anomalie", "détection", "détecté"])
    if "employe" in question_lower or "travail" in question_lower or "poste" in question_lower:
        keywords.update(["procédure", "recommandation", "surveillance", "maintenance"])

    # Récupérer les lignes pertinentes
    # On construit un score par document : nombre de lignes qui matchent
    doc_scores: dict[str, tuple[float, list[str]]] = {}  # title -> (score, [matching_lines])
    for cat, entries in doc_map.items():
        for title, text in entries:
            text_lower = text.lower()
            score = sum(1 for kw in keywords if kw in text_lower)
            if score > 0:
                if title not in doc_scores:
                    doc_scores[title] = (0.0, [])
                prev_score, prev_lines = doc_scores[title]
                doc_scores[title] = (prev_score + score, prev_lines + [text.strip()])

    # Trier les documents par score
    sorted_docs = sorted(doc_scores.items(), key=lambda x: -x[1][0])

    if sorted_docs:
        lines = []
        # Ouverture conversationnelle
        all_text = " ".join(sorted_docs[0][1][1]).lower()
        if any(w in all_text for w in ["attaque", "ddos", "dos", "ransomware", "backdoor", "mitm"]):
            lines.append("Je vois qu'il s'agit d'une alerte de type attaque informatique. Voici ce que je sais :")
        elif any(w in all_text for w in ["seuil", "hors plage", "dpi-004", "dpi-001", "règle"]):
            lines.append("Cette alerte a été déclenchée par une règle de détection. Je vous explique la situation :")
        elif any(w in all_text for w in ["remédiation", "procédure", "action"]):
            lines.append("Voici la procédure à suivre dans ce cas :")
        elif any(w in all_text for w in ["comportement normal"]):
            lines.append("Voici les informations de référence pour ce capteur :")
        else:
            lines.append("Voici ce que j'ai trouvé dans ma base de connaissances :")
        lines.append("")

        for doc_title, (doc_score, doc_lines) in sorted_docs[:3]:
            for clean in doc_lines[:4]:
                # Nettoyer les préfixes courants
                for prefix in ["ATTAQUE :", "DESCRIPTION :", "SEUILS PAR TYPE DE CAPTEUR :", "RÈGLE DPI-004", "RÈGLE DPI-001", "RÈGLE DPI-002", "RÈGLE DPI-003"]:
                    if clean.upper().startswith(prefix.upper()):
                        clean = clean[len(prefix):].strip().lstrip("―-– ").strip()
                        break
                if clean.startswith("- ") or clean.startswith("INDICATEURS") or clean.startswith("IMPACT"):
                    continue
                if len(clean) > 5:
                    lines.append(f"• {clean}")

        lines.append("")
        lines.append("💡 *Pour aller plus loin, dites-moi quel capteur ou quelle règle DPI vous intéresse.*")
    else:
        lines = []
        if device_type:
            lines.append("Je n'ai pas d'information spécifique sur ce sujet, mais dans votre contexte voici comment agir :")
            lines.append("")
            if "weather" in device_type:
                lines.append("• Vérifiez les conditions météo réelles (orage, canicule) qui peuvent fausser les mesures du capteur extérieur.")
                lines.append("• Inspectez le câblage et l'alimentation du capteur.")
                lines.append("• Consultez l'historique des 24 dernières heures pour distinguer une tendance d'un pic isolé.")
                lines.append("• Regardez si d'autres capteurs du secteur ont émis des alertes similaires.")
            elif "fridge" in device_type:
                lines.append("• Vérifiez le cycle de dégivrage : un pic de température juste après est normal.")
                lines.append("• Contrôlez la fermeture des portes (joint, micro-switch).")
                lines.append("• Écoutez le compresseur : un bruit anormal nécessite une intervention mécanique.")
                lines.append("• Comparez avec la sonde de température interne de référence.")
            elif "thermostat" in device_type:
                lines.append("• Vérifiez si le chauffage ou la climatisation vient de démarrer (cycle normal).")
                lines.append("• Inspectez le câblage : oxydation ou faux contact donne des valeurs erratiques.")
                lines.append("• Testez la sonde avec un multimètre pour vérifier la valeur ohmique.")
                lines.append("• Consultez les alertes des autres capteurs dans le même secteur.")
            else:
                lines.append("• Vérifiez les logs du dispositif concerné.")
                lines.append("• Inspectez physiquement l'équipement (câblage, alimentation).")
                lines.append("• Consultez la base de connaissances Peaksoft pour les procédures standard.")
                lines.append("• Contactez l'équipe de maintenance si le problème persiste.")
            lines.append("")
            lines.append("💡 *Pour une réponse plus précise, précisez le capteur, la règle DPI ou le comportement observé.*")
        else:
            lines.append(
                "Je n'ai pas trouvé d'information correspondant à votre question dans ma base de connaissances. "
                "Essayez de reformuler ou consultez la documentation IEC 62443."
            )
    lines += ["", "---", "*Assistant IA Peaksoft — Réponse instantanée*"]
    return "\n".join(lines)


# ── Point d'entrée principal ──────────────────────────────────────────────────

async def generate_analysis(
    alert_context: dict,
    rag_documents: list[dict],
    question: Optional[str] = None,
    force_template: bool = False,
) -> dict:
    """
    Génère l'analyse complète d'une alerte.

    Tente d'utiliser Ollama si disponible, sinon fallback template.

    Args:
        alert_context  : dict avec toutes les infos de l'alerte
        rag_documents  : documents récupérés par le Retriever
        question       : question libre optionnelle de l'opérateur
        force_template : forcer le mode template (pour les tests)

    Returns:
        {
            "report"   : texte du rapport (Markdown)
            "engine"   : "ollama" | "template"
            "model"    : nom du modèle utilisé (si Ollama)
            "rag_docs_used" : nombre de documents RAG utilisés
        }
    """
    use_ollama = False
    if not force_template:
        use_ollama = await _check_ollama_available()

    is_question_mode = alert_context.get("question_mode", False)

    if use_ollama:
        if is_question_mode and question:
            # ── Mode Chat (Ollama) ───────────────────────────────────────────
            rag_context = "\n\n".join(
                f"[{d['id']} — {d['title']}]\n{d['content'][:800]}"
                for d in rag_documents[:4]
            )
            system_prompt = """Tu es un assistant IA spécialisé en cybersécurité IoT/ICS.
Réponds aux questions de l'opérateur de façon concise, précise et en français.
Utilise UNIQUEMENT les informations de la base de connaissances fournies.
Sois naturel et conversationnel, comme ChatGPT."""
            user_prompt = f"""Contexte (base de connaissances) :
{rag_context}

Question de l'opérateur : {question}

Réponds à cette question de façon claire et conversationnelle, en t'appuyant sur le contexte ci-dessus."""
        else:
            # ── Mode Rapport (Ollama) ──────────────────────────────────────────
            system_prompt = """Tu es un expert en cybersécurité industrielle IoT/ICS.
Tu analyses des alertes de sécurité pour la plateforme Peaksoft.
Tu t'appuies UNIQUEMENT sur le contexte fourni (base de connaissances RAG).
Tes rapports sont structurés, factuels, TOUJOURS EN FRANÇAIS, et orientés action.
Tu inclus TOUJOURS une section \"Recommandations\" avec des actions concrètes.
Tu mentionnes toujours : le type d'attaque probable, l'impact, et les actions recommandées.
Ne jamais inventer des informations non présentes dans le contexte.
Ne jamais répondre en anglais. Commence directement par le rapport, sans introduction."""

            rag_context = "\n\n".join(
                f"[{d['id']} — {d['title']}]\n{d['content'][:800]}"
                for d in rag_documents[:4]
            )

            risk_score   = alert_context.get("risk_score", 0)
            severity     = alert_context.get("severity", "NONE")
            device_name  = alert_context.get("device_name", "inconnu")
            device_type  = alert_context.get("device_type", "inconnu")
            rule_id      = alert_context.get("rule_id", "")
            rule_name    = alert_context.get("rule_name", "")

            weather = alert_context.get("weather_temperature", "N/A")
            fridge  = alert_context.get("fridge_temperature", "N/A")
            thermo  = alert_context.get("thermostat_temperature", "N/A")
            season  = alert_context.get("season", "N/A")
            month   = alert_context.get("month", "N/A")
            label   = alert_context.get("label", "N/A")
            anomaly = alert_context.get("is_anomaly", False)
            normal  = alert_context.get("normality_score", "N/A")

            user_prompt = f"""ALERTE DE SÉCURITÉ À ANALYSER :
Device : {device_name} (type: {device_type})
Score de risque : {risk_score}/100 — Sévérité : {severity}
Règle DPI déclenchée : {rule_id} — {rule_name}

DONNÉES CAPTEURS (temps réel) :
- Température extérieure (weather) : {weather}°C
- Température frigo (fridge) : {fridge}°C
- Température thermostat : {thermo}°C
- Saison : {season} (mois {month})
- Label attaque : {label}
- Anomalie : {anomaly}
- Score normalité : {normal}%

CONTEXTE BASE DE CONNAISSANCES (RAG) :
{rag_context}

{"QUESTION DE L'OPÉRATEUR : " + question if question else ""}

Génère un rapport de sécurité professionnel en Markdown avec :
1. **Synthèse de l'incident** — décris précisément les valeurs anormales
2. **Type d'attaque probable** — en fonction des données réelles ci-dessus
3. **Analyse du risque** — pourquoi cette combinaison de valeurs est dangereuse
4. **Recommandations spécifiques** — actions concrètes basées sur les températures mesurées
5. **Références aux standards** (IEC 62443 / ETSI EN 303645)
{"6. Réponse directe à la question de l'opérateur" if question else ""}"""

        report = await _call_ollama(user_prompt, system=system_prompt)

        # Si Ollama répond avec une erreur, fallback template
        if report.startswith("[Ollama"):
            report = _chat_response(question, rag_documents, alert_context) if (is_question_mode and question) else _build_template_report(alert_context, rag_documents, question)
            engine = "template"
            model  = "peaksoft-template-v1"
        else:
            engine = "ollama"
            model  = OLLAMA_MODEL

    else:
        # ── Mode Template ─────────────────────────────────────────────────────
        if is_question_mode and question:
            report = _chat_response(question, rag_documents, alert_context)
        else:
            report = _build_template_report(alert_context, rag_documents, question)
        engine = "template"
        model  = "peaksoft-template-v1"

    return {
        "report": report,
        "engine": engine,
        "model": model,
        "rag_docs_used": len(rag_documents),
        "ollama_available": use_ollama,
    }
