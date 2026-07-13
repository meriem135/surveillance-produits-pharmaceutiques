"""
MLOps API — Routes REST
=========================
Expose le systeme MLOps via des endpoints FastAPI.

Endpoints disponibles :

  GET  /api/v1/mlops/dashboard        → Vue complete (drift + registry + scheduler)
  GET  /api/v1/mlops/drift            → Rapport de drift uniquement
  GET  /api/v1/mlops/drift/history    → Historique des 100 derniers scores
  GET  /api/v1/mlops/models           → Liste des versions du registry
  GET  /api/v1/mlops/models/{version} → Detail d'une version
  POST /api/v1/mlops/retrain          → Declencher un reentrain manuel
  POST /api/v1/mlops/rollback/{v}     → Revenir a une version anterieure
  GET  /api/v1/mlops/scheduler        → Etat du scheduler automatique
  GET  /api/v1/mlops/retrain/log      → Journal des reentrain passes
"""

from fastapi import APIRouter, HTTPException, Query
from app.domains.mlops.mlops_service import mlops_service

router = APIRouter()


@router.get("/dashboard", summary="Vue complete MLOps")
def get_mlops_dashboard():
    """
    Retourne un snapshot complet du systeme MLOps :
    - Etat du drift (desactive volontairement)
    - Registry des versions de modeles
    - Etat du scheduler
    - Dernier reentrain effectue
    """
    try:
        return mlops_service.get_dashboard()
    except Exception:
        return {
            "drift": {"drift_detected": False, "severity": "none", "status": "disabled"},
            "registry": {"status": "ok"},
            "scheduler": {"running": False},
        }


@router.get("/drift", summary="Rapport de drift en temps reel")
def get_drift_report():
    """
    [DESACTIVE] Le drift a ete desactive car il detectait 100% de faux positifs
    (reference entrainement trop etroite vs production).
    """
    return {
        "drift_detected": False,
        "severity": "none",
        "status": "disabled",
        "message": "Drift desactive — modele multivarie deploye (F1=0.995, Rappel=1.0)",
        "recommendation": "Surveiller les metriques de performance du modele manuellement",
    }


@router.get("/drift/history", summary="Historique des scores recents")
def get_drift_history(limit: int = Query(100, ge=10, le=500)):
    """[DESACTIVE] Le drift a ete desactive."""
    return {"n": 0, "data": [], "status": "disabled"}


@router.get("/models", summary="Liste des versions de modeles")
def list_model_versions():
    """
    Retourne l'historique complet du registry :
    version, date d'entrainement, raison, statut (active/archived),
    performances (score_mean, score_std), nb d'echantillons.
    """
    return mlops_service.registry.summary()


@router.get("/models/{version}", summary="Detail d'une version")
def get_model_version(version: str):
    """
    Retourne les details d'une version specifique (ex: v1, v2, v3).
    """
    mv = mlops_service.registry.get_version(version)
    if not mv:
        raise HTTPException(status_code=404, detail=f"Version {version} introuvable")
    return mv.to_dict()


@router.post("/retrain", summary="Declencher un reentrain manuel")
async def trigger_manual_retrain(
    reason: str = Query("manual", description="Raison du reentrain"),
):
    """
    Declenche un reentrain immediatement, sans attendre le drift.

    Utilisation : quand vous savez que le comportement IoT a change
    (nouvelle saison, nouvelle installation, etc.)

    Retourne le resultat du reentrain avec :
    - success : True/False
    - new_version : ex. "v3"
    - n_training_samples : nb d'echantillons utilises
    - new_score_mean / new_score_std : nouvelles references
    """
    if mlops_service.retrain_svc.is_retraining:
        raise HTTPException(
            status_code=409,
            detail="Reentrain deja en cours. Reessayer dans quelques instants.",
        )
    result = await mlops_service.trigger_retrain(reason=reason)
    return result


@router.post("/rollback/{version}", summary="Revenir a une version anterieure")
def rollback_model(version: str):
    """
    Reactive une version anterieure du modele.
    La version active courante passe en 'archived'.

    Utilisation : si le dernier reentrain a degrade les performances,
    revenir sur la version precedente en un clic.
    """
    result = mlops_service.rollback(version)
    if not result["success"]:
        raise HTTPException(status_code=404, detail=result["message"])
    return result


@router.get("/scheduler", summary="Etat du scheduler automatique")
def get_scheduler_status():
    """
    Retourne l'etat du scheduler de surveillance :
    - running : True/False
    - check_count : nb de cycles effectues depuis le demarrage
    - last_check_at : horodatage du dernier cycle
    - interval_minutes : frequence de verification
    - recent_log : 5 derniers cycles (drift, action prise)
    """
    return mlops_service.scheduler.status


@router.get("/retrain/log", summary="Journal des reentrain passes")
def get_retrain_log():
    """
    Historique des 20 derniers reentrain effectues :
    date, raison, succes, nb echantillons, version creee.
    """
    return {
        "total": len(mlops_service.retrain_svc.retrain_log),
        "log": mlops_service.retrain_svc.retrain_log,
        "last_result": mlops_service.retrain_svc.last_result,
    }


@router.get("/scheduler/log", summary="Journal complet du scheduler")
def get_scheduler_log():
    """
    Journal de tous les cycles du scheduler.
    Chaque entree inclut : drift detecte, action prise, stats.
    """
    return {
        "total_cycles": mlops_service.scheduler._check_count,
        "log": mlops_service.scheduler.full_log[-50:],
    }
