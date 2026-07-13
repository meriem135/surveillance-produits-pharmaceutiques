"""
Analyst API — Endpoints LLM/RAG
=================================
Endpoints :

  POST /api/v1/analyst/analyze          → Rapport complet d'une alerte
  POST /api/v1/analyst/ask              → Question libre en langage naturel
  GET  /api/v1/analyst/kb/status        → État de la base de connaissances
  GET  /api/v1/analyst/kb/documents     → Liste des documents disponibles
  GET  /api/v1/analyst/kb/search        → Recherche directe dans la KB
  POST /api/v1/analyst/cache/clear      → Vider le cache d'analyses
"""

from fastapi import APIRouter, HTTPException, Query, Depends, Response
from pydantic import BaseModel, Field
from typing import Optional
from io import BytesIO
from fpdf import FPDF
from app.domains.analyst.analyst_service import analyst_service
from app.domains.analyst.knowledge_base import get_all_documents, get_document_by_id
from app.domains.analyst.retriever import retriever
from app.api.deps import get_device_service
from app.domains.devices.service import DeviceService

router = APIRouter()


# ── Schémas Pydantic ─────────────────────────────────────────────────────────

class AlertAnalysisRequest(BaseModel):
    """Contexte d'alerte pour l'analyse LLM/RAG."""

    device_id:    str   = Field(...,  description="ID du device concerné")
    rule_id:      str   = Field("",   description="ID de la règle DPI déclenchée")
    rule_name:    str   = Field("",   description="Nom de la règle DPI")
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
                "rule_id":      "DPI-001",
                "rule_name":    "Label attaque explicite",
                "rule_description": "payload contient label=attack",
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


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/analyze", summary="Rapport complet d'analyse d'une alerte")
async def analyze_alert(
    request: AlertAnalysisRequest,
    service: DeviceService = Depends(get_device_service),
):
    """
    Génère un rapport de sécurité complet pour une alerte IoT.

    Le moteur RAG récupère automatiquement les documents pertinents
    (fiches d'attaques, règles DPI, procédures de remédiation) et
    les injecte dans le contexte du LLM (Ollama si disponible,
    sinon moteur template intelligent).

    Le rapport inclut :
    - Identification du type d'attaque probable
    - Analyse du score de risque et de ses facteurs
    - État du modèle IA (drift MLOps si détecté)
    - Cohérence inter-capteurs
    - Références aux standards IEC 62443 / ETSI EN 303645
    - Actions recommandées par ordre de priorité
    """
    # Récupérer les infos complètes du device depuis la DB
    device = await service.get_by_id(request.device_id)

    # Enrichir le contexte avec les infos device + MLOps + cross-sensor
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

    # [DRIFT DESACTIVE] Le contexte MLOps (drift_penalty, cross_sensor) est neutralise
    # pour eviter les faux positifs. A reactiver si degradation du modele constatee.
    alert_context["drift_info"] = {}
    alert_context["cross_sensor_info"] = {}
    alert_context["drift_detected"] = False
    alert_context["n_sensors_alert"] = 0

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
    alert_context["drift_info"] = {}
    alert_context["cross_sensor_info"] = {}
    alert_context["drift_detected"] = False
    alert_context["n_sensors_alert"] = 0

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
async def ask_question(request: QuestionRequest):
    """
    Pose une question en langage naturel au moteur d'analyse.

    Exemples de questions :
    - "Quels sont les signes d'une attaque DDoS sur un capteur weather ?"
    - "Comment réagir si le score de risque est critique ?"
    - "Que signifie la règle DPI-004 ?"
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


@router.get("/kb/status", summary="État de la base de connaissances")
def get_kb_status():
    """
    Retourne les statistiques de la base de connaissances RAG :
    - Nombre de documents par catégorie
    - Taille du vocabulaire TF-IDF
    - Taille du cache d'analyses
    - Configuration Ollama
    """
    return analyst_service.get_kb_status()


@router.get("/kb/documents", summary="Liste des documents de la KB")
def list_kb_documents(
    category: Optional[str] = Query(
        None,
        description="Filtrer : attack | dpi | sensor | remediation | standard",
    )
):
    """
    Liste tous les documents de la base de connaissances.
    Utile pour vérifier le contenu du corpus RAG.
    """
    docs = get_all_documents()
    if category:
        docs = [d for d in docs if d["category"] == category]
    return {
        "total": len(docs),
        "documents": [
            {"id": d["id"], "category": d["category"], "title": d["title"], "tags": d["tags"]}
            for d in docs
        ],
    }


@router.get("/kb/documents/{doc_id}", summary="Détail d'un document KB")
def get_kb_document(doc_id: str):
    """Retourne le contenu complet d'un document de la base de connaissances."""
    doc = get_document_by_id(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document {doc_id} introuvable")
    return doc


@router.get("/kb/search", summary="Recherche sémantique dans la KB")
def search_kb(
    q: str = Query(..., min_length=3, description="Requête de recherche"),
    top_k: int = Query(5, ge=1, le=20),
    category: Optional[str] = Query(None),
):
    """
    Recherche sémantique dans la base de connaissances via TF-IDF.

    Retourne les documents les plus pertinents pour la requête,
    triés par score de similarité cosinus décroissant.

    Exemples :
    - q="DDoS température weather"
    - q="IEC 62443 mot de passe"
    - q="frigo panne isolation"
    """
    results = retriever.retrieve(q, top_k=top_k, category_filter=category)
    return {
        "query": q,
        "results": results,
        "total_found": len(results),
    }


@router.post("/cache/clear", summary="Vider le cache des analyses")
def clear_analysis_cache():
    """
    Vide le cache en mémoire des analyses générées.
    Utile après une mise à jour de la base de connaissances
    ou après un réentraînement du modèle ML.
    """
    analyst_service.clear_cache()
    return {"message": "Cache vidé", "timestamp": __import__("datetime").datetime.now().isoformat()}


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


@router.post("/phase2-period-report", summary="Rapport ML Multivarié (Phase 2)")
async def phase2_period_report(request: Phase2PeriodReportRequest):
    """
    Génère un rapport de période pour la Phase 2 basé sur
    le modèle Isolation Forest Multivarié (3 capteurs fusionnés).

    Sans LLM — utilise les vrais labels et prédictions du modèle.
    Rapport en français simple pour opérateur usine.
    """
    filters = request.model_dump(exclude_none=True)
    from app.domains.analyst.ml_report_generator import generate_report
    report = generate_report(filters)
    return {"report": report, "engine": "template", "model": "IF_Multivarie"}


@router.post("/phase2-period-report-pdf", summary="Télécharger le rapport Phase 2 en PDF")
async def phase2_period_report_pdf(request: Phase2PeriodReportRequest):
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
