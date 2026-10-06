"""
API « attaques de transmission » (traces réelles)
=================================================
  GET  /api/v1/transmission/summary         état du jeu de données, référence, dernier entraînement
  GET  /api/v1/transmission/scenarios       les 9 scénarios injectés
  POST /api/v1/transmission/train           entraîne les 4 modèles candidats en arrière-plan
  WS   /api/v1/transmission/train-ws        progression en direct (courbe du Random Forest incluse)
  GET  /api/v1/transmission/training-status
  GET  /api/v1/transmission/results         résultats du dernier entraînement web
  GET  /api/v1/transmission/report          rapport de recommandation pour l'opérateur
  POST /api/v1/transmission/report          consigne pour une alerte précise
"""

from __future__ import annotations

import asyncio
import json
import traceback

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from app.api.v1.phase2 import _TrainingProgressManager
from app.domains.auth.service import require_any_role
from app.domains.transmission import service

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


@router.get("/transmission/summary")
async def transmission_summary(_user=Depends(require_any_role("operator"))):
    return await asyncio.to_thread(service.summary)


@router.get("/transmission/scenarios")
async def transmission_scenarios(_user=Depends(require_any_role("operator"))):
    return await asyncio.to_thread(service.scenarios)


@router.post("/transmission/train")
async def transmission_train(_user=Depends(require_any_role())):
    """Lance l'entraînement des 4 modèles candidats ; progression sur /transmission/train-ws."""
    global _training_task
    if _training_task and not _training_task.done():
        raise HTTPException(status_code=409, detail="Un entraînement est déjà en cours")
    progress_manager.clear()

    async def _background():
        try:
            await service.train(_emit)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            await _emit("error", 0, f"Erreur entraînement : {e}")

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
async def transmission_results(_user=Depends(require_any_role("operator"))):
    results = service._load_json(service.WEB_RESULTS)
    if not results:
        raise HTTPException(status_code=404, detail="Aucun entraînement web : lancez POST /transmission/train")
    return results


@router.get("/transmission/report")
async def transmission_report(_user=Depends(require_any_role("operator"))):
    return await asyncio.to_thread(service.operator_report)


@router.post("/transmission/report")
async def transmission_alert_report(ctx: AlertContext, _user=Depends(require_any_role("operator"))):
    return service.alert_recommendation(ctx.attack_type, ctx.sensor, ctx.probability, ctx.top_features)
