# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/api/v1/transmission.py
#   ROUTES ENTRAÎNEMENT (/api/v1/transmission/...). Lancer un entraînement (admin), suivre sa
#   progression, historique, rapport pour l'opérateur, chiffres publics.
# ══════════════════════════════════════════════════════════════════════════
"""
API « attaques de transmission » (traces réelles)
=================================================
  GET  /api/v1/transmission/kpis            chiffres publics de la page d'accueil (sans session)
  GET  /api/v1/transmission/summary         état du jeu de données, référence, dernier entraînement
  GET  /api/v1/transmission/scenarios       les scénarios injectés
  POST /api/v1/transmission/train           entraîne les 6 modèles supervisés en arrière-plan (admin)
  GET  /api/v1/transmission/training-status   état + messages de progression (polling : ?depuis=<seq>)
  GET  /api/v1/transmission/results         résultats du dernier entraînement web
  GET  /api/v1/transmission/history         entraînements enregistrés en base, du plus récent au plus ancien
  GET  /api/v1/transmission/report          rapport de recommandation pour l'opérateur

Chaque entraînement web est enregistré en base (transmission_runs, transmission_model_results,
transmission_metrics, transmission_shap, et pour le dernier : jeu de données, scores, alertes, épisodes) ;
summary, results et report lisent le dernier entraînement en base, sinon les fichiers JSON.
  POST /api/v1/transmission/report          consigne pour une alerte précise
"""

from __future__ import annotations

import asyncio
import logging
import traceback

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.ml.progress import TrainingProgressManager
from app.db.session import AsyncSessionLocal, get_session
from app.domains.auth.service import require_any_role
from app.domains import parametres as settings_repo
from app.domains.transmission import repository, service

logger = logging.getLogger(__name__)

router = APIRouter()
progress_manager = TrainingProgressManager()
_training_task: asyncio.Task | None = None


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _emit
#   Rôle   : Enregistre un message de progression de l'entraînement (lu ensuite par la page).
#   Entrée : step, progress, message
#   Sortie : rien
# ──────────────────────────────────────────────────────────────────────
async def _emit(step: str, progress: int, message: str, **extra):
    await progress_manager.broadcast({"step": step, "progress": progress, "message": message, **extra})


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] AlertContext
#   Rôle   : Corps de la requête « consigne pour une alerte » : scénario, capteur, probabilité.
# ──────────────────────────────────────────────────────────────────────
class AlertContext(BaseModel):
    attack_type: str = Field(..., examples=["MITM_gel"])
    sensor: str | None = Field(None, examples=["fridge"])
    probability: float | None = Field(None, ge=0, le=1)
    top_features: list[str] = Field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] transmission_kpis
#   Rôle   : route API GET /transmission/kpis : chiffres publics de la page d'accueil.
#   Entrée : rien
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
@router.get("/transmission/kpis")
async def transmission_kpis():
    """Agrégats publics des résultats de référence (aucune donnée de compte ni de session)."""
    kpis = await asyncio.to_thread(service.public_kpis)
    if kpis is None:
        raise HTTPException(status_code=404, detail="Résultats de référence introuvables")
    return kpis


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _latest_from_db
#   Rôle   : Dernier entraînement terminé en base (None si aucun).
#   Entrée : session
#   Sortie : dictionnaire ou None
# ──────────────────────────────────────────────────────────────────────
async def _latest_from_db(session: AsyncSession) -> dict | None:
    """Dernier entraînement terminé en base ; None si aucun (ou base indisponible)."""
    try:
        return await repository.latest_result(session)
    except Exception:  # noqa: BLE001
        logger.exception("Lecture des entraînements de transmission en base impossible")
        return None


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] transmission_summary
#   Rôle   : route API GET /transmission/summary : résumé de l'étude.
#   Entrée : session
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
@router.get("/transmission/summary")
async def transmission_summary(_user=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    out = await asyncio.to_thread(service.summary)
    latest = await _latest_from_db(session)
    if latest:
        out["web"] = latest
    return out


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] transmission_scenarios
#   Rôle   : route API GET /transmission/scenarios : les 9 scénarios d'attaque.
#   Entrée : rien
#   Sortie : liste
# ──────────────────────────────────────────────────────────────────────
@router.get("/transmission/scenarios")
async def transmission_scenarios(_user=Depends(require_any_role("operator"))):
    return await asyncio.to_thread(service.scenarios)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] transmission_dataset_imported / upload / delete
#   Rôle   : routes /transmission/dataset : voir, IMPORTER (CSV de la forme de dataset_transmission_reel.csv) ou
#            oublier le jeu de données utilisé pour le prochain entraînement (admin).
# ──────────────────────────────────────────────────────────────────────
@router.get("/transmission/dataset")
async def transmission_dataset_imported(_user=Depends(require_any_role())):
    """Jeu de données importé depuis la page Entraînement (ou null)."""
    return {"importe": service.imported_dataset()}


@router.post("/transmission/dataset")
async def transmission_dataset_upload(file: UploadFile = File(...), _user=Depends(require_any_role())):
    if _training_task and not _training_task.done():
        raise HTTPException(status_code=409, detail="Un entraînement est en cours : réessayez après.")
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Le fichier doit être un .csv")
    try:
        info = await asyncio.to_thread(service.import_dataset, file.file, file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    finally:
        await file.close()
    return {"importe": info}


@router.delete("/transmission/dataset")
async def transmission_dataset_delete(_user=Depends(require_any_role())):
    """Oublie le jeu de données importé : l'entraînement revient au jeu de données du projet."""
    if _training_task and not _training_task.done():
        raise HTTPException(status_code=409, detail="Un entraînement est en cours : réessayez après.")
    await asyncio.to_thread(service.remove_imported_dataset)
    return {"importe": None}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] transmission_train
#   Rôle   : route API POST /transmission/train : LANCE UN ENTRAÎNEMENT en arrière-plan (admin) et
#            l'enregistre en base.
#   Entrée : admin connecté
#   Sortie : {status, depuis}
# ──────────────────────────────────────────────────────────────────────
@router.post("/transmission/train")
async def transmission_train(user=Depends(require_any_role()),
                             dataset: str = Query("projet", pattern="^(projet|importe)$")):
    """Lance l'entraînement du modèle retenu par l'étude de référence (hyperparamètres, seuil et
    persistance lus en base) sur une répétition ; progression sur /transmission/training-status.
    L'entraînement et ses métriques train / validation / test sont enregistrés en base."""
    global _training_task
    if _training_task and not _training_task.done():
        raise HTTPException(status_code=409, detail="Un entraînement est déjà en cours")
    use_import = dataset == "importe"
    if use_import and service.imported_dataset() is None:
        raise HTTPException(status_code=400, detail="Aucun jeu de données importé : importez d'abord un CSV.")
    progress_manager.clear()
    username, user_id = getattr(user, "username", None), getattr(user, "id", None)

    async def _db(action, *args):
        # La base ne doit jamais faire échouer l'entraînement : les fichiers JSON restent écrits.
        try:
            async with AsyncSessionLocal() as session:
                return await action(session, *args)
        except Exception:  # noqa: BLE001
            logger.exception("Enregistrement de l'entraînement de transmission en base impossible")
            return None

    async def _background():
        run_id = await _db(repository.start_run, username, user_id)
        try:
            cfg = await _db(settings_repo.get_all)
            ref = await _db(repository.latest_result, "reference")
            out = await service.train(_emit, ref, (cfg or {}).get("precision_min"), (cfg or {}).get("fa_max"),
                                      use_import=use_import)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            if run_id is not None:
                await _db(repository.fail_run, run_id, f"{type(e).__name__}: {e}")
            await _emit("error", 0, f"Erreur entraînement : {e}")
            return
        records = out.pop("_records", None)
        all_eps = out.pop("_all_episodes", None)
        if run_id is not None:
            await _db(repository.finish_run, run_id, out)
            await _db(repository.store_details, run_id, out, records, all_eps, service.feature_label)
            await _db(repository.prune_heavy_details, run_id)
            # Dernier message : les métriques sont en base, la page Résultats peut les afficher.
            await _emit("saved", 100, f"Résultats enregistrés en base (entraînement n° {run_id}).", run_id=run_id)

    _training_task = asyncio.create_task(_background())
    return {"status": "training_started", "depuis": progress_manager.last_seq}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] transmission_training_target
#   Rôle   : route API GET /transmission/training-target : quel modèle sera entraîné.
#   Entrée : session
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
@router.get("/transmission/training-target")
async def transmission_training_target(_user=Depends(require_any_role()), session: AsyncSession = Depends(get_session)):
    """Ce que l'entraînement web va entraîner : le modèle retenu par l'étude de référence en base."""
    c = service.reference_choice(await _reference_from_db(session))
    if c is None:
        return {"modele_retenu": None}
    return {"modele_retenu": {"cle": c["modele"], "nom": c["nom"], "seuil": c["seuil"], "k": c["k"], "n": c["n"],
                              "hyperparametres": c["hyperparameters"], "repetitions": c["repetitions"]}}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] transmission_training_status
#   Rôle   : route API GET /transmission/training-status : PROGRESSION de l'entraînement (appelé chaque
#            seconde par la page).
#   Entrée : depuis : dernier message lu
#   Sortie : {running, messages, seq}
# ──────────────────────────────────────────────────────────────────────
@router.get("/transmission/training-status")
async def transmission_training_status(
    depuis: int = Query(0, ge=0, description="Renvoie les messages de progression dont seq > depuis"),
    _user=Depends(require_any_role("operator")),
):
    """Interrogée toutes les secondes par la page Entraînement pendant un entraînement."""
    running = bool(_training_task and not _training_task.done())
    return {"running": running, "latest": progress_manager._latest_status,
            "messages": progress_manager.since(depuis), "seq": progress_manager.last_seq}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] transmission_results
#   Rôle   : route API GET /transmission/results : résultats du dernier entraînement.
#   Entrée : session
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
@router.get("/transmission/results")
async def transmission_results(_user=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    results = await _latest_from_db(session) or service._load_json(service.WEB_RESULTS)
    if not results:
        raise HTTPException(status_code=404, detail="Aucun entraînement web : lancez POST /transmission/train")
    return results


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] transmission_history
#   Rôle   : route API GET /transmission/history : historique des entraînements.
#   Entrée : limit
#   Sortie : liste
# ──────────────────────────────────────────────────────────────────────
@router.get("/transmission/history")
async def transmission_history(limit: int = Query(20, ge=1, le=200), _user=Depends(require_any_role("operator")),
                               session: AsyncSession = Depends(get_session)):
    """Entraînements enregistrés en base (du plus récent au plus ancien) avec les métriques de chaque modèle."""
    return {"runs": await repository.history(session, limit)}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] transmission_run_delete
#   Rôle   : route API DELETE /transmission/history/{run_id} : supprime un entraînement de la base
#            (métriques, SHAP, résultats…) (administrateur).
#   Entrée : run_id
#   Sortie : {supprime: run_id}
# ──────────────────────────────────────────────────────────────────────
@router.delete("/transmission/history/{run_id}")
async def transmission_run_delete(run_id: int, _user=Depends(require_any_role()),
                                  session: AsyncSession = Depends(get_session)):
    if _training_task and not _training_task.done():
        raise HTTPException(status_code=409, detail="Un entraînement est en cours : réessayez après.")
    if not await repository.delete_run(session, run_id):
        raise HTTPException(status_code=404, detail="Entraînement introuvable.")
    return {"supprime": run_id}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] transmission_report
#   Rôle   : route API GET /transmission/report : rapport pour l'opérateur.
#   Entrée : session
#   Sortie : rapport
# ──────────────────────────────────────────────────────────────────────
@router.get("/transmission/report")
async def transmission_report(_user=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    latest = await _latest_from_db(session)
    ref = await _reference_from_db(session)
    if ref and ref.get("modeles"):
        return await asyncio.to_thread(service.operator_report, ref["modeles"], ref.get("shap"),
                                       "étude de référence (base de données)")
    if latest and latest.get("modeles"):
        return await asyncio.to_thread(service.operator_report, latest["modeles"], latest.get("shap"),
                                       "dernier entraînement web (base de données)")
    return await asyncio.to_thread(service.operator_report)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _reference_from_db
#   Rôle   : Résultat de l'étude de référence en base.
#   Entrée : session
#   Sortie : dictionnaire ou None
# ──────────────────────────────────────────────────────────────────────
async def _reference_from_db(session: AsyncSession) -> dict | None:
    try:
        return await repository.latest_result(session, "reference")
    except Exception:  # noqa: BLE001
        logger.exception("Lecture de l'étude de référence en base impossible")
        return None


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] transmission_alert_report
#   Rôle   : route API POST /transmission/report : consigne pour une alerte précise.
#   Entrée : ctx : scénario, capteur…
#   Sortie : consigne
# ──────────────────────────────────────────────────────────────────────
@router.post("/transmission/report")
async def transmission_alert_report(ctx: AlertContext, _user=Depends(require_any_role("operator"))):
    return service.alert_recommendation(ctx.attack_type, ctx.sensor, ctx.probability, ctx.top_features)
