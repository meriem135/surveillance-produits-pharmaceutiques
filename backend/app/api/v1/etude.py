"""
Étude « attaques de transmission » lue en base : une route par page du site
===========================================================================
  GET /api/v1/etude/run          l'étude affichée (référence chargée par scripts/charger_base.py,
                                 sinon le dernier entraînement web) : protocole, critère, classement
  GET /api/v1/etude/dataset      KPI du jeu de données (transmission_dataset, transmission_episodes)
  GET /api/v1/etude/metrics      métriques train / val / test de chaque modèle (transmission_metrics,
                                 transmission_model_results, transmission_learning_curve)
  GET /api/v1/etude/shap         importances SHAP (transmission_shap)
  GET /api/v1/etude/timeline     détection vs réalité dans le temps (transmission_dataset ⋈
                                 transmission_predictions, transmission_alerts, transmission_episodes)
  GET /api/v1/etude/live/info    modèle en service et réglage d'alerte
  WS  /api/v1/etude/live?token=… temps réel : les mesures passent dans le modèle sauvegardé

Toutes les routes : opérateur ou administrateur. Chaque réponse liste dans `sources` les tables
et requêtes d'où viennent les chiffres. Aucun chiffre lu dans un fichier JSON ni écrit en dur.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import and_, case, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.db.session import AsyncSessionLocal, get_session
from app.domains import parametres
from app.domains.auth.models import User
from app.domains.auth.service import decode_access_token, require_any_role
from app.domains.transmission import live, repository
from app.domains.transmission.models import (
    TransmissionAlert, TransmissionDatasetRow as D, TransmissionEpisode as E, TransmissionLearningPoint,
    TransmissionMetric as M, TransmissionModelResult, TransmissionPrediction as P, TransmissionRun, TransmissionShap,
)

logger = logging.getLogger(__name__)
router = APIRouter()
ROLES = ("train", "val", "test")


async def _run(session: AsyncSession) -> TransmissionRun:
    run = await repository.reference_run(session)
    if run is None:
        raise HTTPException(status_code=404, detail="Aucune étude en base : lancer scripts/charger_base.py "
                                                    "ou un entraînement")
    return run


def _run_info(run: TransmissionRun) -> dict[str, Any]:
    rj = run.result_json or {}
    etude = rj.get("etude") or {}
    return {"id": run.id, "source": run.source, "date": run.started_at.isoformat(timespec="seconds"),
            "meilleur_modele": run.best_model, "classement_validation": run.ranking, "critere": rj.get("critere"),
            "protocole": etude.get("protocole"), "prevalence": etude.get("prevalence") or (run.dataset or {}).get("prevalence"),
            "repetitions": (etude.get("protocole") or {}).get("repetitions", 1),
            "lignes": run.n_rows, "features": run.n_features, "liste_features": etude.get("features") or rj.get("features"),
            "zone_de_garde_min": (run.dataset or {}).get("zone_de_garde_min")}


@router.get("/etude/run")
async def etude_run(_u=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    run = await _run(session)
    return {**_run_info(run), "sources": {"run": "SELECT * FROM transmission_runs WHERE source = 'reference' "
                                                  "AND status = 'termine' ORDER BY finished_at DESC LIMIT 1"}}


# ── Jeu de données ───────────────────────────────────────────────────────────

@router.get("/etude/dataset")
async def etude_dataset(_u=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    run = await _run(session)
    rid = run.id
    ev = func.sum(case((D.evaluee, 1), else_=0))
    att = func.sum(D.label)
    att_ev = func.sum(case((and_(D.evaluee, D.label == 1), 1), else_=0))
    rows = (await session.execute(select(D.role, func.count(), ev, att, att_ev, func.min(D.ts), func.max(D.ts))
                                  .where(D.run_id == rid).group_by(D.role))).all()
    par_role = {r: {"lignes": int(n), "evaluees": int(e or 0), "attaques": int(a or 0),
                    "attaques_evaluees": int(ae or 0), "part_attaques": round((ae or 0) / e, 4) if e else None,
                    "heures": round(n * 5 / 3600, 1)} for r, n, e, a, ae, _, _ in rows}
    total = (await session.execute(select(func.count(), func.min(D.ts), func.max(D.ts), att, ev)
                                   .where(D.run_id == rid))).one()
    stats = {}
    for name, col in (("frigo", D.fridge_true), ("frigo_transmis", D.fridge_temp), ("thermostat", D.thermostat_true),
                      ("thermostat_transmis", D.thermostat_temp), ("meteo", D.weather_temp)):
        mn, mx, av = (await session.execute(select(func.min(col), func.max(col), func.avg(col))
                                            .where(D.run_id == rid))).one()
        av2 = (await session.execute(select(func.avg(col * col)).where(D.run_id == rid))).scalar()
        sd = max(0.0, float(av2) - float(av) ** 2) ** 0.5 if av2 is not None else None
        stats[name] = {"min": round(float(mn), 2), "max": round(float(mx), 2), "moyenne": round(float(av), 2),
                       "ecart_type": round(sd, 2) if sd is not None else None}
    sc_rows = (await session.execute(select(D.attack_type, D.role, func.count()).where(D.run_id == rid, D.label == 1)
                                     .group_by(D.attack_type, D.role))).all()
    ep_rows = (await session.execute(select(E.scenario, E.capteur, E.role, func.count(),
                                            func.avg(E.end_idx - E.start_idx))
                                     .where(E.run_id == rid, E.repetition == 0)
                                     .group_by(E.scenario, E.capteur, E.role))).all()
    scen: dict[str, dict] = {}
    for s, role, n in sc_rows:
        d = scen.setdefault(s, {"scenario": s, "lignes": {}, "episodes": {}, "capteur": None, "duree_moy_min": None})
        d["lignes"][role] = int(n)
    for s, cap, role, n, dur in ep_rows:
        d = scen.setdefault(s, {"scenario": s, "lignes": {}, "episodes": {}, "capteur": cap, "duree_moy_min": None})
        d["capteur"] = cap
        d["episodes"][role] = int(n)
        d["duree_moy_min"] = round(float(dur) * 5 / 60, 1)
    n_ep_all = (await session.execute(select(func.count()).where(E.run_id == rid))).scalar()
    reps = (await session.execute(select(func.count(func.distinct(E.repetition))).where(E.run_id == rid))).scalar()
    # Série temporelle allégée : moyenne par tranche de 2 min (24 mesures)
    bucket = (D.idx // 24).label("b")
    serie = (await session.execute(
        select(bucket, func.min(D.ts), func.avg(D.fridge_temp), func.avg(D.fridge_true), func.avg(D.thermostat_temp),
               func.avg(D.weather_temp), func.max(D.label), func.min(D.role))
        .where(D.run_id == rid).group_by(bucket).order_by(bucket))).all()
    episodes = (await session.execute(select(E).where(E.run_id == rid, E.repetition == 0).order_by(E.start_idx))).scalars().all()
    return {
        "run": _run_info(run),
        "total": {"lignes": int(total[0]), "debut": total[1].isoformat(), "fin": total[2].isoformat(),
                  "heures": round(total[0] * 5 / 3600, 1), "attaques": int(total[3] or 0), "evaluees": int(total[4] or 0),
                  "exclues_zone_de_garde": int(total[0] - (total[4] or 0)), "episodes_rep0": len(episodes),
                  "episodes_toutes_repetitions": int(n_ep_all or 0), "repetitions": int(reps or 0), "pas_s": 5},
        "par_role": par_role, "capteurs": stats,
        "par_scenario": sorted(scen.values(), key=lambda d: d["scenario"]),
        "serie": [{"ts": t.isoformat(), "frigo": round(float(f), 2), "frigo_reel": round(float(fr), 2),
                   "thermostat": round(float(th), 2), "meteo": round(float(w), 2), "attaque": int(lab), "role": role}
                  for _, t, f, fr, th, w, lab, role in serie],
        "episodes": [{"scenario": e.scenario, "role": e.role, "debut": e.start_ts.isoformat(), "fin": e.end_ts.isoformat(),
                      "capteur": e.capteur} for e in episodes],
        "sources": {
            "par_role": "SELECT role, count(*), sum(evaluee), sum(label) FROM transmission_dataset WHERE run_id = :run GROUP BY role",
            "capteurs": "SELECT min/max/avg(fridge_true, fridge_temp, thermostat_true, thermostat_temp, weather_temp) FROM transmission_dataset",
            "par_scenario": "SELECT attack_type, role, count(*) FROM transmission_dataset WHERE label = 1 GROUP BY 1, 2 ; "
                            "SELECT scenario, capteur, role, count(*) FROM transmission_episodes WHERE repetition = 0 GROUP BY 1, 2, 3",
            "serie": "SELECT idx / 24, avg(fridge_temp), avg(fridge_true), … FROM transmission_dataset GROUP BY 1",
        },
    }


# ── Métriques ────────────────────────────────────────────────────────────────

def _metric(m: M) -> dict:
    return {"seuil": m.seuil, "k": m.k, "n": m.n, "recall": m.recall, "precision": m.precision, "f1": m.f1,
            "fpr": m.fpr, "roc_auc": m.roc_auc, "avg_precision": m.avg_precision, "tp": m.tp, "fp": m.fp,
            "fn": m.fn, "tn": m.tn, "part_attaques": m.part_attaques, "heures_normales": m.heures_normales,
            "alertes": m.alertes, "fausses_alertes": m.fausses_alertes,
            "fausses_alertes_par_heure": m.fausses_alertes_par_heure, "episodes": m.episodes,
            "episodes_detectes": m.episodes_detectes, "delai_median_min": m.delai_median_min,
            "delai_p90_min": m.delai_p90_min, "per_attack": m.per_attack, "per_episode": m.per_episode}


@router.get("/etude/metrics")
async def etude_metrics(_u=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    run = await _run(session)
    rows = (await session.execute(select(M).where(M.run_id == run.id).order_by(M.model_key, M.niveau, M.role))).scalars().all()
    res = (await session.execute(select(TransmissionModelResult).where(TransmissionModelResult.run_id == run.id))).scalars().all()
    lc = (await session.execute(select(TransmissionLearningPoint).where(TransmissionLearningPoint.run_id == run.id)
                                .order_by(TransmissionLearningPoint.part_train))).scalars().all()
    detail = (run.result_json or {}).get("modeles") or {}
    modeles: dict[str, dict] = {}
    for r in res:
        d = detail.get(r.model_key) or {}
        modeles[r.model_key] = {"modele": r.model_key, "nom": r.nom, "meilleur": r.is_best,
                                "hyperparametres": r.hyperparameters, "point_fonctionnement": d.get("point_fonctionnement"),
                                "diagnostic": d.get("diagnostic"), "courbe_pr": d.get("courbe_pr"),
                                "duree_entrainement_s": d.get("duree_entrainement_s"), "alarme": {}, "ligne": {}}
    for m in rows:
        modeles.setdefault(m.model_key, {"modele": m.model_key, "alarme": {}, "ligne": {}})[m.niveau][m.role] = _metric(m)
    etude = (run.result_json or {}).get("etude") or {}
    return {
        "run": _run_info(run),
        "modeles": modeles,
        "classement_validation": run.ranking,
        "courbe_apprentissage": {"modele": lc[0].model_key if lc else None,
                                 "points": [{"part_train": p.part_train, "lignes_train": p.lignes_train,
                                             "ap_train": p.ap_train, "ap_val": p.ap_val, "f1_train": p.f1_train,
                                             "f1_val": p.f1_val} for p in lc]},
        "validation_croisee": etude.get("validation_croisee"),
        "sources": {
            "modeles": "SELECT * FROM transmission_metrics WHERE run_id = :run (niveau alarme / ligne, rôle train / val / test)",
            "hyperparametres": "SELECT model_key, hyperparameters, is_best FROM transmission_model_results WHERE run_id = :run",
            "courbe_apprentissage": "SELECT * FROM transmission_learning_curve WHERE run_id = :run ORDER BY part_train",
            "validation_croisee": "transmission_runs.result_json -> 'etude' -> 'validation_croisee'",
        },
    }


# ── SHAP ─────────────────────────────────────────────────────────────────────

@router.get("/etude/shap")
async def etude_shap(_u=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    run = await _run(session)
    rows = (await session.execute(select(TransmissionShap).where(TransmissionShap.run_id == run.id)
                                  .order_by(TransmissionShap.portee, TransmissionShap.rang))).scalars().all()
    out: dict[str, list] = {}
    for r in rows:
        out.setdefault(r.portee, []).append({"rang": r.rang, "feature": r.feature, "libelle": r.libelle,
                                             "importance": r.importance})
    shap_json = (run.result_json or {}).get("shap") or {}
    return {"run": _run_info(run), "modele": rows[0].model_key if rows else None,
            "n_lignes": shap_json.get("n_lignes"), "repetitions": shap_json.get("repetitions"),
            "global": out.pop("global", []), "par_scenario": out,
            "sources": {"shap": "SELECT * FROM transmission_shap WHERE run_id = :run ORDER BY portee, rang"}}


# ── Détection vs réalité ─────────────────────────────────────────────────────

@router.get("/etude/timeline")
async def etude_timeline(role: str = Query("test", pattern="^(train|val|test|all)$"), minutes: int = Query(1, ge=1, le=10),
                         _u=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    run = await _run(session)
    rid = run.id
    step = 12 * minutes
    bucket = (D.idx // step).label("b")
    q = (select(bucket, func.min(D.ts), func.max(P.score), func.max(case((P.alarme, 1), else_=0)),
                func.max(D.label), func.avg(D.fridge_temp), func.avg(D.thermostat_temp), func.min(D.role),
                func.min(case((D.evaluee, 1), else_=0)))
         .join(P, and_(P.run_id == D.run_id, P.idx == D.idx)).where(D.run_id == rid))
    if role != "all":
        q = q.where(D.role == role)
    serie = (await session.execute(q.group_by(bucket).order_by(bucket))).all()
    eq = select(E).where(E.run_id == rid, E.repetition == 0)
    aq = select(TransmissionAlert).where(TransmissionAlert.run_id == rid)
    if role != "all":
        eq, aq = eq.where(E.role == role), aq.where(TransmissionAlert.role == role)
    episodes = (await session.execute(eq.order_by(E.start_idx))).scalars().all()
    alerts = (await session.execute(aq.order_by(TransmissionAlert.start_idx))).scalars().all()
    best = run.best_model
    mrows = (await session.execute(select(M).where(M.run_id == rid, M.model_key == best))).scalars().all()
    fit = {r: {} for r in ROLES}
    for m in mrows:
        fit[m.role][m.niveau] = {"tp": m.tp, "fp": m.fp, "fn": m.fn, "tn": m.tn, "recall": m.recall,
                                 "precision": m.precision, "f1": m.f1, "avg_precision": m.avg_precision,
                                 "fausses_alertes_par_heure": m.fausses_alertes_par_heure,
                                 "episodes": m.episodes, "episodes_detectes": m.episodes_detectes,
                                 "delai_median_min": m.delai_median_min, "per_episode": m.per_episode}
    par_sc: dict[str, dict] = {}
    for e in episodes:
        d = par_sc.setdefault(e.scenario, {"scenario": e.scenario, "episodes": 0, "detectes": 0, "delais": []})
        d["episodes"] += 1
        if e.detecte:
            d["detectes"] += 1
            d["delais"].append(e.delai_min)
    for d in par_sc.values():
        dl = sorted(x for x in d.pop("delais") if x is not None)
        d["delai_median_min"] = dl[len(dl) // 2] if dl else None
    seuil = mrows[0].seuil if mrows else None
    return {
        "run": _run_info(run), "role": role, "modele": best, "seuil": seuil, "pas_minutes": minutes,
        "serie": [{"ts": t.isoformat(), "score_max": round(float(s), 4), "alarme": int(a), "attaque": int(lab),
                   "frigo": round(float(f), 2), "thermostat": round(float(th), 2), "role": r, "evaluee": bool(ev)}
                  for _, t, s, a, lab, f, th, r, ev in serie],
        "episodes": [{"scenario": e.scenario, "capteur": e.capteur, "role": e.role, "debut": e.start_ts.isoformat(),
                      "fin": e.end_ts.isoformat(), "duree_min": round((e.end_idx - e.start_idx) * 5 / 60, 1),
                      "detecte": e.detecte, "delai_min": e.delai_min} for e in episodes],
        "alertes": [{"role": a.role, "debut": a.start_ts.isoformat(), "fin": a.end_ts.isoformat(),
                     "duree_min": a.duree_min, "score_max": a.score_max, "vraie": a.vraie, "scenario": a.scenario}
                    for a in alerts],
        "par_scenario": sorted(par_sc.values(), key=lambda d: d["scenario"]),
        "ajustement": fit,
        "sources": {
            "serie": "SELECT d.idx / :pas, max(p.score), max(p.alarme), max(d.label) FROM transmission_dataset d "
                     "JOIN transmission_predictions p ON p.run_id = d.run_id AND p.idx = d.idx WHERE d.role = :role GROUP BY 1",
            "episodes": "SELECT * FROM transmission_episodes WHERE repetition = 0 AND role = :role",
            "alertes": "SELECT * FROM transmission_alerts WHERE role = :role",
            "ajustement": "SELECT * FROM transmission_metrics WHERE model_key = <meilleur> (train / val / test)",
        },
    }


# ── Temps réel ───────────────────────────────────────────────────────────────

@router.get("/etude/live/info")
async def etude_live_info(_u=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    src = await live.stream_source(session)
    if src is None:
        raise HTTPException(status_code=404, detail="Modèle sauvegardé ou jeu de données en base introuvable")
    cfg = await parametres.get_all(session)
    return {**live.info(src), "vitesse_defaut": cfg["vitesse_temps_reel"],
            "sources": {"mesures": "SELECT * FROM transmission_dataset WHERE run_id = :run ORDER BY idx",
                        "modele": "models/transmission_reel/meilleur_modele.pkl (modèle entraîné sauvegardé)"}}


async def _ws_user(token: str | None) -> User | None:
    payload = decode_access_token(token or "")
    if not payload or not payload.get("sub"):
        return None
    async with AsyncSessionLocal() as session:
        user = await session.get(User, int(payload["sub"]))
    return user if user is not None and user.is_active and user.role in ("admin", "operator") else None


@router.websocket("/etude/live")
async def etude_live(websocket: WebSocket, token: str | None = None):
    """Messages du client : {"action": "start", "role": "test", "vitesse": 24, "depuis": idx}, {"action": "pause"},
    {"action": "reprendre"}, {"action": "vitesse", "vitesse": 60}, {"action": "stop"}."""
    await websocket.accept()
    if await _ws_user(token) is None:
        await websocket.send_json({"type": "erreur", "message": "Session invalide"})
        await websocket.close(code=4401)
        return
    async with AsyncSessionLocal() as session:
        src = await live.stream_source(session)
    if src is None:
        await websocket.send_json({"type": "erreur", "message": "Modèle ou jeu de données introuvable"})
        await websocket.close()
        return
    await websocket.send_json({"type": "info", **live.info(src)})
    streamer, paused, speed = None, False, 24
    try:
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_json(), timeout=0.05 if streamer and not paused else None)
            except asyncio.TimeoutError:
                msg = None
            if msg:
                act = msg.get("action")
                if act == "start":
                    role = msg.get("role") if msg.get("role") in ROLES else "test"
                    speed = max(1, min(200, int(msg.get("vitesse") or speed)))
                    streamer, paused = live.Streamer(src, role, int(msg.get("depuis") or 0)), False
                elif act == "pause":
                    paused = True
                elif act == "reprendre":
                    paused = False
                elif act == "vitesse":
                    speed = max(1, min(200, int(msg.get("vitesse") or speed)))
                elif act == "stop":
                    streamer = None
                    await websocket.send_json({"type": "arret"})
                continue
            if streamer is None or paused:
                continue
            payload = await asyncio.to_thread(streamer.next_batch, speed)
            await websocket.send_json(payload)
            if streamer.done():
                streamer = None
                continue
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        return
    except Exception:  # noqa: BLE001
        logger.exception("Flux temps réel interrompu")
