"""
Analyst API — Endpoints LLM/RAG
=================================
Endpoints :

  POST /api/v1/analyst/analyze          → Rapport complet d'une alerte
  POST /api/v1/analyst/ask              → Question libre en langage naturel
  POST /api/v1/analyst/recommendation   → Rapport de recommandation saisonnier
  POST /api/v1/analyst/report-pdf       → Rapport d'analyse en PDF
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
    context: str = Field("ingestion_mqtt", description="Contexte de la recommandation")


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

