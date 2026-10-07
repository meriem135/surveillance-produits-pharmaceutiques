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

from app.core.config import settings


# ── Configuration Ollama ──────────────────────────────────────────────────────
OLLAMA_BASE_URL = settings.OLLAMA_URL
OLLAMA_MODEL = settings.OLLAMA_MODEL
OLLAMA_TIMEOUT = 120.0         # secondes max pour la génération


async def _check_ollama_available() -> bool:
    """Vérifie si Ollama tourne en local."""
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            return resp.status_code == 200
    except Exception:
        return False


async def _call_ollama(prompt: str, system: str = "", max_tokens: Optional[int] = None, model: Optional[str] = None) -> str:
    """
    Appelle l'API Ollama pour générer une réponse.

    Args:
        prompt     : le prompt utilisateur (contexte RAG + question)
        system     : le rôle/instructions système pour le LLM
        max_tokens : limite de génération (None = défaut 400)
        model      : override du modèle Ollama (None = modèle configuré)

    Returns:
        Texte généré par le LLM, ou message d'erreur.
    """
    payload = {
        "model": model or OLLAMA_MODEL,
        "prompt": prompt,
        "system": system,
        "stream": False,
        "options": {
            "temperature": 0.2,    # Très faible = réponses factuelles, rapides et précises
            "top_p": 0.85,
            "num_predict": max_tokens if max_tokens is not None else 400,
            "num_ctx": 2048,       # Contexte réduit = plus rapide
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
        lines.append(f"**Règle :** `{rule_id}` — {rule_name}")
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

    # ── Contexte base de connaissances (RAG) ──────────────────────────────────
    if rag_documents:
        lines += [f"## {section_num}. Contexte de la Base de Connaissances", ""]
        section_num += 1
        for doc in rag_documents[:3]:
            cat_label = {
                "attack":      "⚔️  Attaque",
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
        elif any(w in all_text for w in ["seuil", "hors plage", "règle"]):
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
                for prefix in ["ATTAQUE :", "DESCRIPTION :", "SEUILS PAR TYPE DE CAPTEUR :"]:
                    if clean.upper().startswith(prefix.upper()):
                        clean = clean[len(prefix):].strip().lstrip("―-– ").strip()
                        break
                if clean.startswith("- ") or clean.startswith("INDICATEURS") or clean.startswith("IMPACT"):
                    continue
                if len(clean) > 5:
                    lines.append(f"• {clean}")

        lines.append("")
        lines.append("💡 *Pour aller plus loin, dites-moi quel capteur ou quelle attaque vous intéresse.*")
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
            lines.append("💡 *Pour une réponse plus précise, précisez le capteur ou le comportement observé.*")
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
    max_tokens: Optional[int] = None,
    model: Optional[str] = None,
) -> dict:
    """
    Génère l'analyse complète d'une alerte.

    Tente d'utiliser Ollama si disponible, sinon fallback template.

    Args:
        alert_context  : dict avec toutes les infos de l'alerte
        rag_documents  : documents récupérés par le Retriever
        question       : question libre optionnelle de l'opérateur
        force_template : forcer le mode template (pour les tests)
        max_tokens     : limite de tokens pour la réponse LLM (plus rapide)
        model          : override du modèle Ollama (None = configuré)

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
            system_prompt = """Assistant cybersécurité IoT. Réponses courtes et claires en français.
Maximum 150 mots. Actions concrètes. Pas d'introduction."""
            user_prompt = f"""Contexte:
{rag_context}

Question: {question}

Réponse courte et claire. max 150 mots."""
        else:
            # ── Mode Rapport (Ollama) ──────────────────────────────────────────
            system_prompt = """Expert cybersécurité IoT. Rapports courts, clairs, en français.
Structure : 1) Incident 2) Attaque probable 3) Risques 4) Recommandations.
Pas d'introduction. Actions concrètes numérotées. maximum 200 mots."""

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
            attack_type  = alert_context.get("attack_type", "inconnu")

            weather = alert_context.get("weather_temperature", "N/A")
            fridge  = alert_context.get("fridge_temperature", "N/A")
            thermo  = alert_context.get("thermostat_temperature", "N/A")
            season  = alert_context.get("season", "N/A")
            month   = alert_context.get("month", "N/A")
            label   = alert_context.get("label", "N/A")
            anomaly = alert_context.get("is_anomaly", False)
            normal  = alert_context.get("normality_score", "N/A")

            user_prompt = f"""Alerte: {device_name} ({device_type}) | Score: {risk_score}/100 | Règle: {rule_id}
Capteurs: weather={weather}°C, frigo={fridge}°C, thermostat={thermo}°C | Saison: {season}
Attaque: {attack_type} | Anomalie: {anomaly}

Contexte RAG:
{rag_context}

{"Question: " + question if question else ""}

Rapport court en Markdown: incident, attaque, risques, recommandations. max 200 mots."""

        report = await _call_ollama(user_prompt, system=system_prompt, max_tokens=max_tokens, model=model)

        # Si Ollama répond avec une erreur, fallback template
        if report.startswith("[Ollama"):
            report = _chat_response(question, rag_documents, alert_context) if (is_question_mode and question) else _build_template_report(alert_context, rag_documents, question)
            engine = "template"
            model  = "peaksoft-template-v1"
        else:
            engine = "ollama"
            model  = model or OLLAMA_MODEL

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
