"""
API REST pour la configuration et le monitoring du service DPI
Permet de lister, activer/désactiver, modifier les seuils et voir les stats
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from app.domains.intelligence.mqtt_dpi_service import dpi_service

router = APIRouter(prefix="/api/dpi", tags=["dpi"])


class RuleUpdate(BaseModel):
    enabled: Optional[bool] = None
    severity: Optional[int] = None
    conditions: Optional[dict] = None


@router.get("/rules")
def list_rules():
    """Liste toutes les règles DPI avec leur état actuel"""
    return {"rules": dpi_service.get_rules(), "total": len(dpi_service.get_rules())}


@router.put("/rules/{rule_id}")
def update_rule(rule_id: str, update: RuleUpdate):
    """Modifier une règle (activer/désactiver, changer sévérité, seuils)"""
    updates = {k: v for k, v in update.dict().items() if v is not None}
    ok = dpi_service.update_rule(rule_id, updates)
    if not ok:
        return {"error": f"Règle {rule_id} introuvable"}, 404
    return {"status": "updated", "rule_id": rule_id, "updates": updates}


@router.post("/rules/reload")
def reload_rules():
    """Recharger les règles depuis le fichier YAML sans redémarrer"""
    dpi_service.reload_rules()
    return {"status": "reloaded", "count": len(dpi_service.get_rules())}


@router.get("/stats")
def get_stats():
    """Statistiques temps réel du moteur DPI"""
    return dpi_service.stats.snapshot()


@router.get("/recent-alerts")
def get_recent_alerts(limit: int = 20):
    """Dernières alertes DPI avec type d'attaque et explication"""
    return {
        "alerts": dpi_service.stats.get_recent_alerts(limit=limit),
        "total": dpi_service.stats.total_alerts,
    }


BACKTEST_CACHE = {"results": None, "timestamp": None}


@router.get("/backtest")
def get_backtest_results(force_refresh: bool = False):
    """Résultats du backtesting DPI : précision, rappel, F1 par règle et par attaque"""
    import time
    if BACKTEST_CACHE["results"] is not None and not force_refresh:
        return {"status": "cached", "results": BACKTEST_CACHE["results"], "cached_at": BACKTEST_CACHE["timestamp"]}

    BACKTEST_CACHE["results"] = {"status": "not_available", "message": "Lancez scripts/dpi_backtest.py --summary pour générer les résultats"}
    BACKTEST_CACHE["timestamp"] = time.time()
    return BACKTEST_CACHE["results"]
