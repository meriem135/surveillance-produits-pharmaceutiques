"""
API « attaques de transmission » (traces réelles)
=================================================
  GET  /api/v1/transmission/kpis            chiffres publics de la page d'accueil (sans session)
  GET  /api/v1/transmission/summary         état du jeu de données, référence, dernier entraînement
  GET  /api/v1/transmission/scenarios       les scénarios injectés
  POST /api/v1/transmission/train           entraîne les 6 modèles supervisés en arrière-plan (admin)
  WS   /api/v1/transmission/train-ws        progression en direct (courbe du Random Forest incluse)
  GET  /api/v1/transmission/training-status
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
import json
import logging
import traceback

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.phase2 import _TrainingProgressManager
from app.db.session import AsyncSessionLocal, get_session
from app.domains.auth.service import require_any_role
from app.domains import parametres as settings_repo
from app.domains.transmission import repository, service

logger = logging.getLogger(__name__)

router = APIRouter()
progress_manager = _TrainingProgressManager()
_training_task: asyncio.Task | None = None


async def _emit(step: str, progress: int, message: str, **extra):
    await progress_manager.broadcast({"step": step, "progress": progress, "message": message, **extra})


class AlertContext(BaseModel):
    attack_type: str = Field(..., examples=["MITM_gel"])
    sensor: str | None = Field(None, examples=["fridge"])
    probability: float | None = Field(None, ge=0, le=1)
    top_features: list[str] = Field(default_factory=list)


@router.get("/transmission/kpis")
async def transmission_kpis():
    """Agrégats publics des résultats de référence (aucune donnée de compte ni de session)."""
    kpis = await asyncio.to_thread(service.public_kpis)
    if kpis is None:
        raise HTTPException(status_code=404, detail="Résultats de référence introuvables")
    return kpis


async def _latest_from_db(session: AsyncSession) -> dict | None:
    """Dernier entraînement terminé en base ; None si aucun (ou base indisponible)."""
    try:
        return await repository.latest_result(session)
    except Exception:  # noqa: BLE001
        logger.exception("Lecture des entraînements de transmission en base impossible")
        return None


@router.get("/transmission/summary")
async def transmission_summary(_user=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    out = await asyncio.to_thread(service.summary)
    latest = await _latest_from_db(session)
    if latest:
        out["web"] = latest
    return out


@router.get("/transmission/scenarios")
async def transmission_scenarios(_user=Depends(require_any_role("operator"))):
    return await asyncio.to_thread(service.scenarios)


@router.post("/transmission/train")
async def transmission_train(user=Depends(require_any_role())):
    """Lance l'entraînement des 4 modèles supervisés ; progression sur /transmission/train-ws.
    L'entraînement et les métriques de chaque modèle sont enregistrés en base."""
    global _training_task
    if _training_task and not _training_task.done():
        raise HTTPException(status_code=409, detail="Un entraînement est déjà en cours")
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
            out = await service.train(_emit, (cfg or {}).get("precision_min"), (cfg or {}).get("fa_max"))
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            if run_id is not None:
                await _db(repository.fail_run, run_id, f"{type(e).__name__}: {e}")
            await _emit("error", 0, f"Erreur entraînement : {e}")
            return
        records = out.pop("_records", None)
        if run_id is not None:
            await _db(repository.finish_run, run_id, out)
            await _db(repository.store_details, run_id, out, records, None, service.feature_label)
            await _db(repository.prune_heavy_details, run_id)

    _training_task = asyncio.create_task(_background())
    return {"status": "training_started", "ws_url": "/api/v1/transmission/train-ws"}


@router.websocket("/transmission/train-ws")
async def transmission_train_ws(websocket: WebSocket):
    await progress_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data) if data else {}
            if msg.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        progress_manager.disconnect(websocket)


@router.get("/transmission/training-status")
async def transmission_training_status(_user=Depends(require_any_role("operator"))):
    running = bool(_training_task and not _training_task.done())
    return {"running": running, "latest": progress_manager._latest_status}


@router.get("/transmission/results")
async def transmission_results(_user=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    results = await _latest_from_db(session) or service._load_json(service.WEB_RESULTS)
    if not results:
        raise HTTPException(status_code=404, detail="Aucun entraînement web : lancez POST /transmission/train")
    return results


@router.get("/transmission/history")
async def transmission_history(limit: int = Query(20, ge=1, le=200), _user=Depends(require_any_role("operator")),
                               session: AsyncSession = Depends(get_session)):
    """Entraînements enregistrés en base (du plus récent au plus ancien) avec les métriques de chaque modèle."""
    return {"runs": await repository.history(session, limit)}


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


async def _reference_from_db(session: AsyncSession) -> dict | None:
    try:
        return await repository.latest_result(session, "reference")
    except Exception:  # noqa: BLE001
        logger.exception("Lecture de l'étude de référence en base impossible")
        return None


@router.post("/transmission/report")
async def transmission_alert_report(ctx: AlertContext, _user=Depends(require_any_role("operator"))):
    return service.alert_recommendation(ctx.attack_type, ctx.sensor, ctx.probability, ctx.top_features)
