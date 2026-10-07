"""
Analyst API — Endpoints LLM/RAG
=================================
Endpoints :

  POST /api/v1/analyst/analyze          → Rapport complet d'une alerte
  POST /api/v1/analyst/ask              → Question libre en langage naturel
  POST /api/v1/analyst/recommendation   → Rapport de recommandation saisonnier
  POST /api/v1/analyst/report-pdf       → Rapport d'analyse en PDF
  POST /api/v1/analyst/phase2-period-report-pdf → Rapport Phase 2 en PDF
"""

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from typing import Optional
from io import BytesIO
from fpdf import FPDF
from app.domains.analyst.analyst_service import analyst_service
from app.api.deps import get_device_service
from app.domains.devices.service import DeviceService
from app.domains.auth.service import require_any_role
from app.core.config import settings

router = APIRouter()


# ── Schémas Pydantic ─────────────────────────────────────────────────────────

class AlertAnalysisRequest(BaseModel):
    """Contexte d'alerte pour l'analyse LLM/RAG."""

    device_id:    str   = Field(...,  description="ID du device concerné")
    rule_id:      str   = Field("",   description="Identifiant de la règle ou de la détection")
    rule_name:    str   = Field("",   description="Nom de la règle ou de la détection")
    rule_description: str = Field("", description="Description de l'événement")
    attack_type:  str   = Field("",   description="Type d'attaque suspecté")
    risk_score:   int   = Field(0,    ge=0, le=100, description="Score de risque 0-100")
    severity:     str   = Field("LOW", description="NONE|LOW|MEDIUM|HIGH|CRITICAL")
    sensor:       str   = Field("",   description="Capteur concerné (weather/fridge/thermostat)")
    question:     Optional[str] = Field(None, description="Question libre de l'opérateur")
    force_template: bool = Field(False, description="Forcer le moteur template (sans Ollama)")
    weather_temperature: Optional[float] = Field(None, description="Température extérieure")
    fridge_temperature: Optional[float] = Field(None, description="Température frigo")
    thermostat_temperature: Optional[float] = Field(None, description="Température thermostat")
    season: Optional[str] = Field(None, description="Saison en cours")
    month: Optional[int] = Field(None, description="Mois")
    label: Optional[int] = Field(None, description="Label attaque (0/1)")
    is_anomaly: Optional[bool] = Field(None, description="Anomalie détectée")
    normality_score: Optional[float] = Field(None, description="Score de normalité")

    class Config:
        json_schema_extra = {
            "example": {
                "device_id":    "dev-fridge-01",
                "rule_id":      "MITM_gel",
                "rule_name":    "Mesure du frigo répétée en boucle",
                "rule_description": "la dernière mesure du frigo est retransmise à l'identique",
                "attack_type":  "IoT_DDoS",
                "risk_score":   87,
                "severity":     "CRITICAL",
                "sensor":       "fridge",
                "question":     "Quels sont les risques pour la ligne de production ?",
            }
        }


class QuestionRequest(BaseModel):
    """Question libre pour le SOC Analyst."""
    question: str = Field(..., min_length=5, description="Question en langage naturel")
    device_type: Optional[str] = Field(None, description="Contexte du type de device (optionnel)")

    class Config:
        json_schema_extra = {
            "example": {
                "question": "Comment détecter une attaque MITM sur un capteur fridge ?",
                "device_type": "fridge",
            }
        }


class RecommendationRequest(BaseModel):
    """Demande de rapport de recommandation saisonnier."""
    season: str = Field(..., description="Saison (Hiver/Printemps/Été/Automne)")
    context: str = Field("phase1_ingestion", description="Contexte de la recommandation")


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/recommendation", summary="Rapport de recommandation saisonnier")
async def get_season_recommendation(
    request: RecommendationRequest,
    _user=Depends(require_any_role("operator")),
):
    """
    Génère un rapport de recommandation de sécurité pour une saison donnée.
    Utilise un moteur template déterministe avec des conseils adaptés à chaque saison.
    """
    result = await analyst_service.generate_recommendation(
        season=request.season,
        context=request.context,
    )
    return result

@router.post("/analyze", summary="Rapport complet d'analyse d'une alerte")
async def analyze_alert(
    request: AlertAnalysisRequest,
    service: DeviceService = Depends(get_device_service),
    _user=Depends(require_any_role("operator")),
):
    """
    Génère un rapport de sécurité complet pour une alerte IoT.

    Le moteur RAG récupère automatiquement les documents pertinents
    (fiches d'attaques, capteurs, procédures de remédiation) et
    les injecte dans le contexte du LLM (Ollama si disponible,
    sinon moteur template intelligent).

    Le rapport inclut :
    - Identification du type d'attaque probable
    - Analyse du score de risque et de ses facteurs
    - Références aux standards IEC 62443 / ETSI EN 303645
    - Actions recommandées par ordre de priorité
    """
    # Récupérer les infos complètes du device depuis la DB
    device = await service.get_by_id(request.device_id)

    # Enrichir le contexte avec les infos device + cross-sensor
    alert_context: dict = {
        "device_id":    request.device_id,
        "device_name":  device.name          if device else request.device_id,
        "device_type":  device.device_type   if device else request.sensor or "unknown",
        "firmware":     device.firmware_version if device else None,
        "location":     device.location      if device else "inconnu",
        "rule_id":      request.rule_id,
        "rule_name":    request.rule_name,
        "rule_description": request.rule_description,
        "attack_type":  request.attack_type,
        "risk_score":   request.risk_score,
        "severity":     request.severity,
        "sensor":       request.sensor,
        "weather_temperature": request.weather_temperature,
        "fridge_temperature": request.fridge_temperature,
        "thermostat_temperature": request.thermostat_temperature,
        "season":       request.season,
        "month":        request.month,
        "label":        request.label,
        "is_anomaly":   request.is_anomaly,
        "normality_score": request.normality_score,
    }

    # Extraire les facteurs dominants du score de risque
    try:
        from app.domains.intelligence.risk_service import risk_engine
        history = risk_engine._get_history(request.device_id)
        if history.history:
            last_decomp = history.history[-1].get("decomposition", {})
            # Trier les facteurs par contribution décroissante
            alert_context["top_factors"] = [
                f"{k} ({v:.0f})"
                for k, v in sorted(last_decomp.items(), key=lambda x: x[1], reverse=True)
                if v > 5
            ][:4]
    except Exception:
        alert_context["top_factors"] = []

    result = await analyst_service.analyze_alert(
        alert_context=alert_context,
        question=request.question,
        force_template=request.force_template,
    )

    return result


def _clean_for_pdf(text: str) -> str:
    """Supprime les caractères non latins pour FPDF."""
    import re
    # Supprime les emojis et symboles Unicode hors BMP (plage 0x10000+)
    text = re.sub(r'[\U0001F300-\U0001FFFF]', '', text)
    # Supprime les symboles divers (plage 0x2000-0x2FFF)
    text = re.sub(r'[\u2000-\u2FFF]', '', text)
    # Supprime les pictogrammes (plage 0xFE00-0xFE0F)
    text = re.sub(r'[\uFE00-\uFE0F]', '', text)
    # Remplace les guillemets courbes et autres hors latin-1
    text = text.replace('\u2019', "'").replace('\u2018', "'")
    text = text.replace('\u201c', '"').replace('\u201d', '"')
    text = text.replace('\u2013', '-').replace('\u2014', '--')
    text = text.replace('\u2026', '...')
    # Nettoie les espaces multiples
    text = re.sub(r'  +', ' ', text).strip()
    # Supprime tout caractère hors latin-1
    text = text.encode('latin-1', errors='replace').decode('latin-1')
    return text

def _md_to_pdf_text(md: str) -> list[str]:
    """Convertit du Markdown basique en lignes de texte pour PDF."""
    lines = []
    for l in md.split("\n"):
        s = _clean_for_pdf(l)
        if not s:
            lines.append(("", "body"))
            continue
        # Titres
        if l.strip().startswith("## "):
            lines.append((_clean_for_pdf(l.strip()[3:]), "h2"))
        elif l.strip().startswith("# "):
            lines.append((_clean_for_pdf(l.strip()[2:]), "h1"))
        # Ligne de séparation
        elif l.strip().startswith("---"):
            lines.append(("-" * 60, "sep"))
        # Liste
        elif l.strip().startswith("- "):
            text = l.strip()[2:]
            text = text.replace("**", "")
            lines.append(("  - " + _clean_for_pdf(text), "body"))
        elif l.strip().startswith(("1.", "2.", "3.", "4.", "5.")):
            text = l.strip()[l.strip().index(" ")+1:]
            text = text.replace("**", "")
            lines.append(("  " + l.strip()[:2] + " " + _clean_for_pdf(text), "body"))
        else:
            text = l.replace("**", "")
            lines.append((_clean_for_pdf(text), "body"))
    return lines


@router.post("/report-pdf", summary="Télécharger le rapport en PDF")
async def report_pdf(
    request: AlertAnalysisRequest,
    service: DeviceService = Depends(get_device_service),
    _user=Depends(require_any_role("operator")),
):
    """
    Génère le même rapport d'analyse mais le retourne en PDF téléchargeable.
    """
    device = await service.get_by_id(request.device_id)
    alert_context = {
        "device_id":    request.device_id,
        "device_name":  device.name          if device else request.device_id,
        "device_type":  device.device_type   if device else request.sensor or "unknown",
        "firmware":     device.firmware_version if device else None,
        "location":     device.location      if device else "inconnu",
        "rule_id":      request.rule_id,
        "rule_name":    request.rule_name,
        "rule_description": request.rule_description,
        "attack_type":  request.attack_type,
        "risk_score":   request.risk_score,
        "severity":     request.severity,
        "sensor":       request.sensor,
        "weather_temperature": request.weather_temperature,
        "fridge_temperature": request.fridge_temperature,
        "thermostat_temperature": request.thermostat_temperature,
        "season":       request.season,
        "month":        request.month,
        "label":        request.label,
        "is_anomaly":   request.is_anomaly,
        "normality_score": request.normality_score,
    }

    result = await analyst_service.analyze_alert(
        alert_context=alert_context,
        question=request.question,
        force_template=request.force_template,
    )
    report_md = result.get("report", "")

    # Génération PDF via fpdf2
    pdf = FPDF()
    pdf.add_page()
    pdf.add_font("Arial", "", r"C:\Windows\Fonts\arial.ttf")
    pdf.add_font("Arial", "B", r"C:\Windows\Fonts\arialbd.ttf")
    pdf.set_auto_page_break(auto=True, margin=20)

    for text, style in _md_to_pdf_text(report_md):
        if style == "h1":
            pdf.set_font("Arial", "B", 14)
            pdf.set_text_color(220, 50, 50)
            pdf.multi_cell(0, 8, text, new_x="LMARGIN", new_y="NEXT")
            pdf.ln(2)
        elif style == "h2":
            pdf.set_font("Arial", "B", 12)
            pdf.set_text_color(60, 140, 230)
            pdf.multi_cell(0, 7, text, new_x="LMARGIN", new_y="NEXT")
            pdf.ln(1)
        elif style == "sep":
            pdf.set_draw_color(100, 100, 100)
            pdf.line(10, pdf.get_y(), 200, pdf.get_y())
            pdf.ln(3)
        else:
            pdf.set_font("Arial", "", 10)
            pdf.set_text_color(200, 200, 200)
            pdf.multi_cell(0, 5.5, text, new_x="LMARGIN", new_y="NEXT")

    buf = BytesIO()
    pdf.output(buf)
    buf.seek(0)

    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=rapport_{request.rule_id}_{request.device_id}.pdf"},
    )


@router.post("/ask", summary="Question libre au SOC Analyst IA")
async def ask_question(
    request: QuestionRequest,
    _user=Depends(require_any_role("operator")),
):
    """
    Pose une question en langage naturel au moteur d'analyse.

    Exemples de questions :
    - "Quels sont les signes d'une attaque DDoS sur un capteur weather ?"
    - "Comment réagir si le score de risque est critique ?"
    - "Que signifie une attaque MITM par rejeu ?"
    - "Quelles CVE affectent les passerelles IoT ?"
    - "Quel standard s'applique pour les mots de passe par défaut ?"
    """
    device_context = {}
    if request.device_type:
        device_context["device_type"] = request.device_type

    result = await analyst_service.ask(
        question=request.question,
        device_context=device_context,
    )
    return result


# ── Phase 2 — Rapport ML Multivarié ─────────────────────────────────────────

class Phase2PeriodReportRequest(BaseModel):
    """Filtres pour le rapport de période Phase 2 (IF Multivarié)."""
    year:       Optional[str] = Field(None, description="Année (ex: 2019)")
    season:     Optional[str] = Field(None, description="hiver|printemps|ete|automne")
    month:      Optional[int] = Field(None, ge=1, le=12)
    day:        Optional[int] = Field(None, ge=1, le=31)
    shift:      Optional[str] = Field(None, description="matin|apres-midi|nuit")
    day_type:   Optional[str] = Field(None, description="ouvre|weekend")
    start_hour: Optional[int] = Field(None, ge=0, le=23)
    end_hour:   Optional[int] = Field(None, ge=0, le=23)
    start_date: Optional[str] = Field(None, description="Date début (YYYY-MM-DD)")
    end_date:   Optional[str] = Field(None, description="Date fin (YYYY-MM-DD)")


class PointReportRequest(BaseModel):
    """Une ligne de la table « Contenu du Dataset » à expliquer par le LLM."""
    timestamp: str = Field(..., description="Timestamp ISO du point à expliquer (ex: 2019-01-02T03:04:05)")
    question: Optional[str] = Field(None, description="Question libre optionnelle de l'opérateur")


# Cache en mémoire simple : timestamp → résultat LLM (évite de re-générer
# le rapport d'une ligne déjà consultée dans la table du dataset).
_point_report_cache: dict[str, dict] = {}


def _is_acceptable_report(report: str, causes: list[dict], pharma: dict) -> bool:
    """True si le texte LLM est réellement un rapport : en français, sur le sujet,
    pas une régurgitation du prompt. Sinon → on servira le rapport propre."""
    text = report.strip()
    if not (60 <= len(text) <= 700):
        return False
    lt = text.lower()
    echo_probes = [
        "je suis un opérateur",
        "règle :", "règle:", "shap-point",
        "causes shap", "capteurs au point",
        "alerte :", "alerte:",
        "question:", "consigne", "recopier",
        "[ollama", "template", "système",
    ]
    if any(p in lt for p in echo_probes):
        return False
    features = [c.get("interpretation") or c.get("feature") for c in causes]
    features = [f for f in features if f]
    action_words = ["contrôler", "vérifier", "contrôl", "vérif", "surveiller", "recroiser"]
    domain_words = [
        "capteur", "thermostat", "frigo", "météo", "humidité", "température",
        "attaque", "anomalie", "anormal", "injection", "opérateur", "mqtt",
        "shap", "risque", "impact", "pourquoi", "actions", "action",
    ]
    return (
        any(w in lt for w in action_words + domain_words)
        or any(f.lower() in lt for f in features)
    )


def _build_simple_report(pharma: dict, causes: list[dict]) -> str:
    """Rapport simple déterministe (lisible) quand le LLM n'est pas exploitable."""
    causes_lines = "\n".join(
        f"- {c.get('interpretation') or c.get('feature')} (contribution SHAP {c.get('shap_value')})"
        for c in causes
    ) or "- Aucune cause SHAP dominante"
    actions_lines = "\n".join(f"{i+1}. {a}" for i, a in enumerate((pharma.get("actions") or [])[:4]))
    return (
        "**Pourquoi ce point est signalé :**\n"
        f"{pharma.get('why', 'Point signalé par le modèle OCSVM / label du dataset.')}\n\n"
        f"**Causes SHAP dominantes :**\n{causes_lines}\n\n"
        f"**Ce que l'ouvrier doit faire :**\n{actions_lines}\n\n"
        "*Rapport simple (template) — Ollama indisponible ou hors sujet.*"
    )


@router.post("/point-report", summary="Rapport LLM par ligne du dataset (SHAP + action opérateur)")
async def get_point_report_llm(
    request: PointReportRequest,
    _user=Depends(require_any_role("operator")),
):
    """
    Rapport simple par ligne de la table « Contenu du Dataset » :
      1. Explication SHAP → pourquoi ce point est une attaque (causes dominantes)
      2. Recommandation → ce que l'ouvrier / opérateur doit faire

    Réutilise l'explication SHAP ponctuelle (`/api/shap/point`) et le contexte
    métier pharmaceutique (`/api/v1/pharma/point-report`), puis fait générer
    le rapport par le LLM (Ollama, modèle rapide `tinyllama`) avec fallback
    template déterministe si Ollama est indisponible ou trop lent.
    """
    from app.api.v1.shap_analysis import get_shap_point
    from app.api.v1.pharma_impact import get_pharma_point_report, PharmaReportRequest
    from app.domains.analyst.llm_engine import generate_analysis

    cached = _point_report_cache.get(request.timestamp)
    if cached:
        return cached

    point = get_shap_point(timestamp=request.timestamp)
    if not point.get("available"):
        return {"error": point.get("error", "SHAP indisponible pour ce point.")}

    sov = point.get("sensor_values") or {}
    pharma_body = PharmaReportRequest(
        sensor=point.get("dominant_sensor") or "thermostat",
        attack_id=None,
        risk_score=point.get("risk_score_per_100"),
        is_anomaly=point.get("is_anomaly"),
        label=point.get("label"),
        season=point.get("season"),
        sensor_values=sov,
        top_causes=point.get("top_causes", [])[:5],
    )
    pharma = await get_pharma_point_report(pharma_body)

    # ── Contexte CVE pour le LLM ──
    cve_ctx = pharma.get("cve") or {}
    cve_lines = []
    if cve_ctx.get("available") and cve_ctx.get("total_cves", 0) > 0:
        for c in (cve_ctx.get("top_cves") or [])[:3]:
            cve_lines.append(
                f"- {c.get('cve_id')} ({c.get('cvss_severity') or 'UNKNOWN'}, "
                f"CVSS {c.get('cvss_score') or 'N/A'}, risque {round(float(c.get('risk_score') or 0))}/100)"
            )
    cve_context = {
        "available": bool(cve_lines),
        "risk_score": round(float(cve_ctx.get("risk_score") or 0)),
        "total_cves": int(cve_ctx.get("total_cves") or 0),
        "top_cves": cve_lines,
    }

    causes = point.get("top_causes", [])[:5]
    causes_text = "\n".join(
        f"- {c.get('interpretation') or c.get('feature')} (feature={c.get('feature')}, "
        f"valeur={c.get('feature_value')}, contribution SHAP={c.get('shap_value')})"
        for c in causes
    )

    if point.get("label") == 1 and point.get("is_anomaly"):
        severity = "CRITICAL"
    elif point.get("is_anomaly"):
        severity = "HIGH"
    else:
        severity = "MEDIUM"

    alert_context = {
        "question_mode": True,
        "device_id": f"dataset-point-{point.get('index', 0)}",
        "device_name": f"Point dataset {point.get('timestamp')}",
        "device_type": point.get("dominant_sensor") or "multi-sensor",
        "rule_id": "SHAP-POINT",
        "rule_name": f"Point du dataset {point.get('timestamp')}",
        "rule_description": f"{pharma.get('why', '')}\nCauses SHAP du point:\n{causes_text}",
        "attack_type": pharma.get("attack_name") or "Comportement anormal",
        "risk_score": int(point.get("risk_score_per_100") or 0),
        "severity": severity,
        "sensor": point.get("dominant_sensor") or "multi-sensor",
        "weather_temperature": sov.get("weather"),
        "fridge_temperature": sov.get("fridge"),
        "thermostat_temperature": sov.get("thermostat"),
        "season": point.get("season"),
        "month": point.get("month"),
        "label": point.get("label"),
        "is_anomaly": point.get("is_anomaly"),
        "normality_score": point.get("anomaly_score"),
        "cve_context": cve_context,
    }

    cve_prompt = (
        f"Contexte CVE du capteur ({pharma.get('sensor_label')}) : "
        f"{cve_context['total_cves']} CVE matchées, score vulnérabilité {cve_context['risk_score']}/100.\n"
        + ("\n".join(cve_context["top_cves"]) or "- Aucune CVE pertinente.")
        + "\n\n"
    ) if cve_context["available"] else ""

    default_question = (
        f"Je suis un opérateur de l'industrie pharmaceutique (domaine: {pharma.get('domain_label')}, "
        f"capteur: {pharma.get('sensor_label')}). Capteurs au point: "
        f"Weather={sov.get('weather')}°C, Frigo={sov.get('fridge')}°C, Thermostat={sov.get('thermostat')}°C. "
        f"Causes SHAP:\n{causes_text}\n\n"
        f"{cve_prompt}"
        f"Rédige un rapport SIMPLE et COURT en français, pour un ouvrier/opérateur non expert. "
        f"Format exact en 2 parties, mot-clef au début de chaque partie :\n"
        f"'Pourquoi :' puis l'explication en langage clair des causes SHAP ci-dessus "
        f"(quel capteur dévie, quel capteur est l'objet probable de l'attaque).\n"
        f"'Actions :' puis 2-4 actions concrètes numérotées pour l'ouvrier.\n"
        f"Si des vulnérabilités CVE ont été listées ci-dessus, mentionne la plus importante "
        f"(ou le score CVE) dans 'Actions' : mettre à jour le firmware ou surveiller la faille.\n"
        f"Maximum 80 mots, uniquement en français, interdiction absolue de recopier cette consigne."
    )

    try:
        generation = await generate_analysis(
            alert_context=alert_context,
            rag_documents=[],
            question=request.question or default_question,
            force_template=False,
            max_tokens=160,
            model=settings.POINT_REPORT_MODEL,
        )
        report, engine, model = (
            generation["report"],
            generation["engine"],
            generation["model"],
        )
        if engine == "ollama" and (not _is_acceptable_report(report, causes, pharma) or report.startswith("[Ollama")):
            report = _build_simple_report(pharma, causes)
            engine = "template"
            model = "peaksoft-simple-v1"
    except Exception as e:
        report, engine, model = _build_simple_report(pharma, causes), "template", "peaksoft-simple-v1"
        _ = e

    result = {
        "report": report,
        "engine": engine,
        "model": model,
        "rag_docs_used": 0,
        "point": {
            "index": point.get("index"),
            "timestamp": point.get("timestamp"),
            "is_anomaly": point.get("is_anomaly"),
            "anomaly_score": point.get("anomaly_score"),
            "risk_score_per_100": point.get("risk_score_per_100"),
            "sensor_values": sov,
            "dominant_sensor": point.get("dominant_sensor"),
            "top_causes": causes,
        },
        "pharma": {
            "severity": pharma.get("severity"),
            "domain_label": pharma.get("domain_label"),
            "sensor_label": pharma.get("sensor_label"),
            "why": pharma.get("why"),
            "actions": pharma.get("actions"),
        },
    }
    if len(_point_report_cache) < 400:
        _point_report_cache[request.timestamp] = result
    return result


@router.post("/phase2-period-report-pdf", summary="Télécharger le rapport Phase 2 en PDF")
async def phase2_period_report_pdf(
    request: Phase2PeriodReportRequest,
    _user=Depends(require_any_role("operator")),
):
    """
    Génère le même rapport Phase 2 mais le retourne en PDF téléchargeable.
    """
    filters = request.model_dump(exclude_none=True)
    from app.domains.analyst.ml_report_generator import generate_report
    report_md = generate_report(filters)

    pdf = FPDF()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=20)

    for text, style in _md_to_pdf_text(report_md):
        if style == "h1":
            pdf.set_font("Helvetica", "B", 14)
            pdf.set_text_color(220, 50, 50)
            pdf.multi_cell(0, 8, text)
            pdf.ln(2)
        elif style == "h2":
            pdf.set_font("Helvetica", "B", 12)
            pdf.set_text_color(60, 140, 230)
            pdf.multi_cell(0, 7, text)
            pdf.ln(1)
        elif style == "sep":
            pdf.set_draw_color(100, 100, 100)
            pdf.line(10, pdf.get_y(), 200, pdf.get_y())
            pdf.ln(3)
        else:
            pdf.set_font("Helvetica", "", 10)
            pdf.set_text_color(200, 200, 200)
            pdf.multi_cell(0, 5.5, text)

    pdf_bytes = pdf.output(dest='S').encode('latin-1')

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=rapport_phase2_multivarie.pdf"},
    )
