"""
API REST pour la configuration et le monitoring du service DPI
Permet de lister, activer/désactiver, modifier les seuils et voir les stats
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from app.domains.intelligence.mqtt_dpi_service import dpi_service
from app.domains.auth.service import require_any_role

router = APIRouter(prefix="/api/dpi", tags=["dpi"])


class RuleUpdate(BaseModel):
    enabled: Optional[bool] = None
    severity: Optional[int] = None
    conditions: Optional[dict] = None


@router.get("/stats")
def get_stats():
    """Statistiques temps réel du service DPI (messages, alertes, latence)"""
    return dpi_service.stats.snapshot()


@router.get("/recent-alerts")
def get_recent_alerts(limit: int = Query(20, ge=1, le=100)):
    """Historique des dernières alertes DPI (avec détail capteur + recommandation)"""
    return {"alerts": dpi_service.stats.get_recent_alerts(limit)}


@router.get("/rules")
def list_rules():
    """Liste toutes les règles DPI avec leur état actuel"""
    return {"rules": dpi_service.get_rules(), "total": len(dpi_service.get_rules())}


@router.put("/rules/{rule_id}")
def update_rule(
    rule_id: str,
    update: RuleUpdate,
    _user=Depends(require_any_role()),
):
    """Modifier une règle (activer/désactiver, changer sévérité, seuils)"""
    updates = {k: v for k, v in update.dict().items() if v is not None}
    ok = dpi_service.update_rule(rule_id, updates)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Règle {rule_id} introuvable")
    return {"status": "updated", "rule_id": rule_id, "updates": updates}


@router.post("/rules/reload")
def reload_rules(_user=Depends(require_any_role())):
    """Recharger les règles depuis le fichier YAML sans redémarrer"""
    dpi_service.reload_rules()
    return {"status": "reloaded", "count": len(dpi_service.get_rules())}


@router.post("/reset")
def reset_stats(_user=Depends(require_any_role())):
    """Réinitialiser les statistiques et l'historique des alertes DPI"""
    dpi_service.stats.reset()
    return {"status": "reset", "total_messages": 0, "total_alerts": 0}
