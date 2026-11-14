# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/api/v1/etude.py
#   ROUTES DE L'ÉTUDE (/api/v1/etude/...). Données des pages Jeu de données, Résultats, SHAP,
#   Détection vs réalité et Temps réel, lues en base.
# ══════════════════════════════════════════════════════════════════════════
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
  POST   /api/v1/etude/live/start      temps réel : démarre une lecture (rôle, point de départ)
  GET    /api/v1/etude/live/{id}/next  paquet de mesures suivant, passé dans le modèle sauvegardé (polling)
  DELETE /api/v1/etude/live/{id}       arrête la lecture

Toutes les routes : opérateur ou administrateur. Chaque réponse liste dans `sources` les tables
et requêtes d'où viennent les chiffres. Aucun chiffre lu dans un fichier JSON ni écrit en dur.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, case, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.db.session import get_session
from app.domains import parametres
from app.domains.auth.models import User
from app.domains.auth.service import require_any_role
from app.domains.transmission import live, repository
from app.domains.transmission.models import (
    TransmissionAlert, TransmissionAlertShap, TransmissionDatasetRow as D, TransmissionEpisode as E, TransmissionLearningPoint,
    TransmissionMetric as M, TransmissionModelResult, TransmissionPrediction as P, TransmissionRun, TransmissionShap,
)

logger = logging.getLogger(__name__)
router = APIRouter()
ROLES = ("train", "val", "test")


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _run
#   Rôle   : Trouve l'étude à afficher (référence, sinon dernier entraînement web) ; erreur 404 si aucune.
#   Entrée : session
#   Sortie : TransmissionRun
# ──────────────────────────────────────────────────────────────────────
async def _run(session: AsyncSession) -> TransmissionRun:
    run = await repository.reference_run(session)
    if run is None:
        raise HTTPException(status_code=404, detail="Aucune étude en base : lancer scripts/charger_base.py "
                                                    "ou un entraînement")
    return run


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _run_detection
#   Rôle   : Entraînement affiché par la page Détection : le DERNIER entraînement lancé depuis le site (celui
#            de l'utilisateur), sinon l'étude de référence ; erreur 404 si aucun.
#   Entrée : session
#   Sortie : TransmissionRun
# ──────────────────────────────────────────────────────────────────────
async def _run_detection(session: AsyncSession) -> TransmissionRun:
    run = (await session.execute(
        select(TransmissionRun).where(TransmissionRun.status == "termine", TransmissionRun.source == "web")
        .order_by(TransmissionRun.finished_at.desc(), TransmissionRun.id.desc()).limit(1))).scalars().first()
    return run if run is not None else await _run(session)


# Les réponses ci-dessous ne dépendent que de l'étude affichée (lignes figées une fois l'étude
# chargée) : cache mémoire par (route, run, fin du run, paramètres). Un nouveau run change la clé.
_CACHE: dict[tuple, dict] = {}
_CACHE_MAX = 32


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _cached
#   Rôle   : Garde en mémoire les réponses déjà calculées pour aller plus vite.
#   Entrée : key : clé ; compute : calcul
#   Sortie : réponse
# ──────────────────────────────────────────────────────────────────────
async def _cached(key: tuple, compute) -> dict:
    hit = _CACHE.get(key)
    if hit is not None:
        return hit
    out = await compute()
    if len(_CACHE) >= _CACHE_MAX:
        _CACHE.pop(next(iter(_CACHE)))
    _CACHE[key] = out
    return out


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _run_info
#   Rôle   : Résumé d'une étude : date, meilleur modèle, classement, protocole.
#   Entrée : run
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
def _run_info(run: TransmissionRun) -> dict[str, Any]:
    rj = run.result_json or {}
    etude = rj.get("etude") or {}
    return {"id": run.id, "source": run.source, "date": run.started_at.isoformat(timespec="seconds") + "Z",
            "meilleur_modele": run.best_model, "classement_validation": run.ranking, "critere": rj.get("critere"),
            "protocole": etude.get("protocole"), "prevalence": etude.get("prevalence") or (run.dataset or {}).get("prevalence"),
            "repetitions": (etude.get("protocole") or {}).get("repetitions") or rj.get("repetitions") or 1,
            "lignes": run.n_rows, "features": run.n_features, "liste_features": etude.get("features") or rj.get("features"),
            "zone_de_garde_min": (run.dataset or {}).get("zone_de_garde_min")}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] etude_run
#   Rôle   : route API GET /etude/run : l'étude affichée (protocole, classement).
#   Entrée : session
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
@router.get("/etude/run")
async def etude_run(_u=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    run = await _run(session)
    return {**_run_info(run), "sources": {"run": "SELECT * FROM transmission_runs WHERE source = 'reference' "
                                                  "AND status = 'termine' ORDER BY finished_at DESC LIMIT 1"}}


# ── Jeu de données ───────────────────────────────────────────────────────────

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] etude_dataset
#   Rôle   : route API GET /etude/dataset : chiffres de la page Jeu de données.
#   Entrée : session
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
@router.get("/etude/dataset")
async def etude_dataset(_u=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    run = await _run_detection(session)
    return await _cached(("dataset", run.id, run.finished_at), lambda: _etude_dataset(session, run))


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _etude_dataset
#   Rôle   : Calcule les chiffres du jeu de données depuis les tables.
#   Entrée : session, run
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
async def _etude_dataset(session: AsyncSession, run: TransmissionRun) -> dict:
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

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _metric
#   Rôle   : Transforme une ligne de métriques en dictionnaire.
#   Entrée : m : ligne TransmissionMetric
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
def _metric(m: M) -> dict:
    return {"seuil": m.seuil, "k": m.k, "n": m.n, "recall": m.recall, "precision": m.precision, "f1": m.f1,
            "fpr": m.fpr, "roc_auc": m.roc_auc, "avg_precision": m.avg_precision, "tp": m.tp, "fp": m.fp,
            "fn": m.fn, "tn": m.tn, "part_attaques": m.part_attaques, "heures_normales": m.heures_normales,
            "alertes": m.alertes, "fausses_alertes": m.fausses_alertes,
            "fausses_alertes_par_heure": m.fausses_alertes_par_heure, "episodes": m.episodes,
            "episodes_detectes": m.episodes_detectes, "delai_median_min": m.delai_median_min,
            "delai_p90_min": m.delai_p90_min, "per_attack": m.per_attack, "per_episode": m.per_episode}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] etude_metrics
#   Rôle   : route API GET /etude/metrics : page Résultats (métriques train / val / test de chaque modèle).
#   Entrée : session
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
@router.get("/etude/metrics")
async def etude_metrics(run_id: Optional[int] = Query(None, ge=1), _u=Depends(require_any_role("operator")),
                        session: AsyncSession = Depends(get_session)):
    if run_id is None:
        run = await _run(session)
    else:
        run = await session.get(TransmissionRun, run_id)
        if run is None or run.status != "termine":
            raise HTTPException(status_code=404, detail=f"Entraînement n° {run_id} introuvable ou non terminé")
    return await _cached(("metrics", run.id, run.finished_at), lambda: _etude_metrics(session, run))


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] etude_runs
#   Rôle   : route API GET /etude/runs : études et entraînements terminés (pour choisir lequel afficher
#            sur la page Résultats).
#   Sortie : {runs: [{id, source, date, meilleur_modele, jeu_de_donnees, importe}], defaut}
# ──────────────────────────────────────────────────────────────────────
@router.get("/etude/runs")
async def etude_runs(_u=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    runs = (await session.execute(select(TransmissionRun).where(TransmissionRun.status == "termine")
                                  .order_by(TransmissionRun.finished_at.desc(), TransmissionRun.id.desc())
                                  .limit(30))).scalars().all()
    default = await repository.reference_run(session)
    return {"defaut": default.id if default else None,
            "runs": [{"id": r.id, "source": r.source, "date": r.started_at.isoformat(timespec="seconds") + "Z",
                      "meilleur_modele": r.best_model, "lance_par": r.launched_by,
                      "jeu_de_donnees": (r.dataset or {}).get("fichier"),
                      "importe": bool((r.dataset or {}).get("importe"))} for r in runs]}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _etude_metrics
#   Rôle   : Calcule la réponse de la page Résultats.
#   Entrée : session, run
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
async def _etude_metrics(session: AsyncSession, run: TransmissionRun) -> dict:
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

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] etude_shap
#   Rôle   : route API GET /etude/shap : page Explicabilité SHAP.
#   Entrée : session
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
@router.get("/etude/shap")
async def etude_shap(_u=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    run = await _run(session)
    return await _cached(("shap", run.id, run.finished_at), lambda: _etude_shap(session, run))


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _etude_shap
#   Rôle   : Lit les importances SHAP en base.
#   Entrée : session, run
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
async def _etude_shap(session: AsyncSession, run: TransmissionRun) -> dict:
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

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] etude_timeline
#   Rôle   : route API GET /etude/timeline : page Détection vs réalité (alertes du modèle face aux vraies
#            attaques).
#   Entrée : role ; minutes
#   Sortie : séries temporelles
# ──────────────────────────────────────────────────────────────────────
@router.get("/etude/timeline")
async def etude_timeline(role: str = Query("test", pattern="^(train|val|test|all)$"), minutes: int = Query(1, ge=1, le=10),
                         _u=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    run = await _run_detection(session)
    return await _cached(("timeline", run.id, run.finished_at, role, minutes),
                         lambda: _etude_timeline(session, run, role, minutes))


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _etude_timeline
#   Rôle   : Calcule la frise temporelle (mesures, scores, alertes, épisodes).
#   Entrée : session, run, role, minutes
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
async def _etude_timeline(session: AsyncSession, run: TransmissionRun, role: str, minutes: int) -> dict:
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
    # SHAP par alerte : features qui ont poussé chaque alerte vers « attaque » (clé : début d'alerte)
    expl: dict[int, list] = {}
    if alerts:
        for r in (await session.execute(select(TransmissionAlertShap).where(
                TransmissionAlertShap.run_id == rid,
                TransmissionAlertShap.start_idx.in_([a.start_idx for a in alerts]))
                .order_by(TransmissionAlertShap.start_idx, TransmissionAlertShap.rang))).scalars().all():
            expl.setdefault(r.start_idx, []).append({"feature": r.feature, "libelle": r.libelle, "shap": r.shap,
                                                     "valeur": r.valeur, "valeur_normale": r.valeur_normale})
    mrows = (await session.execute(select(M).where(M.run_id == rid, M.model_key == best))).scalars().all()
    fit = {r: {} for r in ROLES}
    for m in mrows:
        fit[m.role][m.niveau] = {"tp": m.tp, "fp": m.fp, "fn": m.fn, "tn": m.tn, "recall": m.recall,
                                 "precision": m.precision, "f1": m.f1, "avg_precision": m.avg_precision,
                                 "fausses_alertes_par_heure": m.fausses_alertes_par_heure,
                                 "episodes": m.episodes, "episodes_detectes": m.episodes_detectes,
                                 "delai_median_min": m.delai_median_min, "per_episode": m.per_episode}
    # Toutes les répétitions (la détection n'est connue que pour celles d'un entraînement web) : liste et
    # tableau « par scénario » ; la frise et les alertes restent celles de la répétition 0.
    allq = select(E).where(E.run_id == rid, E.detecte.is_not(None))
    if role != "all":
        allq = allq.where(E.role == role)
    episodes_all = (await session.execute(allq.order_by(E.repetition, E.start_idx))).scalars().all()
    par_sc: dict[str, dict] = {}
    for e in episodes_all:
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
        "episodes_toutes": [{"repetition": e.repetition, "scenario": e.scenario, "capteur": e.capteur, "role": e.role,
                             "debut": e.start_ts.isoformat(), "fin": e.end_ts.isoformat(),
                             "duree_min": round((e.end_idx - e.start_idx) * 5 / 60, 1), "detecte": e.detecte,
                             "delai_min": e.delai_min} for e in episodes_all],
        "alertes": [{"role": a.role, "debut": a.start_ts.isoformat(), "fin": a.end_ts.isoformat(),
                     "duree_min": a.duree_min, "score_max": a.score_max, "vraie": a.vraie, "scenario": a.scenario,
                     "capteur": a.capteur, "explication": expl.get(a.start_idx, [])}
                    for a in alerts],
        "par_scenario": sorted(par_sc.values(), key=lambda d: d["scenario"]),
        "ajustement": fit,
        "sources": {
            "serie": "SELECT d.idx / :pas, max(p.score), max(p.alarme), max(d.label) FROM transmission_dataset d "
                     "JOIN transmission_predictions p ON p.run_id = d.run_id AND p.idx = d.idx WHERE d.role = :role GROUP BY 1",
            "episodes": "SELECT * FROM transmission_episodes WHERE repetition = 0 AND role = :role",
            "alertes": "SELECT a.*, s.* FROM transmission_alerts a LEFT JOIN transmission_alert_shap s "
                       "ON s.run_id = a.run_id AND s.start_idx = a.start_idx WHERE a.role = :role",
            "ajustement": "SELECT * FROM transmission_metrics WHERE model_key = <meilleur> (train / val / test)",
        },
    }


# ── Temps réel ───────────────────────────────────────────────────────────────

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] etude_live_info
#   Rôle   : route API GET /etude/live/info : modèle et réglage utilisés par la page Temps réel.
#   Entrée : session
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
@router.get("/etude/live/info")
async def etude_live_info(_u=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    src = await live.stream_source(session)
    if src is None:
        raise HTTPException(status_code=404, detail="Modèle sauvegardé ou jeu de données en base introuvable")
    cfg = await parametres.get_all(session)
    return {**live.info(src), "vitesse_defaut": cfg["vitesse_temps_reel"],
            "sources": {"mesures": "SELECT * FROM transmission_dataset WHERE run_id = :run ORDER BY idx",
                        "modele": "models/transmission_reel/meilleur_modele.pkl (modèle entraîné sauvegardé)"}}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] LiveStart
#   Rôle   : Corps de la requête « démarrer le temps réel » : rôle à rejouer et ligne de départ.
# ──────────────────────────────────────────────────────────────────────
class LiveStart(BaseModel):
    role: str = "test"
    depuis: int = 0


# Lectures en cours (une par onglet ouvert) : le client les fait avancer par polling.
_LIVE: dict[str, dict] = {}
_LIVE_TTL_S = 600


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _live_prune
#   Rôle   : Supprime les lectures Temps réel abandonnées depuis plus de 10 min.
#   Entrée : rien
#   Sortie : rien
# ──────────────────────────────────────────────────────────────────────
def _live_prune() -> None:
    now = time.monotonic()
    for sid in [k for k, v in _LIVE.items() if now - v["vu"] > _LIVE_TTL_S]:
        _LIVE.pop(sid, None)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _live_get
#   Rôle   : Retrouve une lecture Temps réel (et vérifie qu'elle appartient à l'utilisateur).
#   Entrée : sid ; user
#   Sortie : lecture ou 404
# ──────────────────────────────────────────────────────────────────────
def _live_get(sid: str, user: User) -> dict:
    lecture = _LIVE.get(sid)
    if lecture is None or lecture["user_id"] != user.id:
        raise HTTPException(status_code=404, detail="Lecture introuvable ou expirée")
    lecture["vu"] = time.monotonic()
    return lecture


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] etude_live_start
#   Rôle   : route API POST /etude/live/start : DÉMARRE le temps réel et renvoie un identifiant de lecture.
#   Entrée : body : rôle, départ ; utilisateur
#   Sortie : {session, infos du modèle}
# ──────────────────────────────────────────────────────────────────────
@router.post("/etude/live/start")
async def etude_live_start(body: LiveStart, user: User = Depends(require_any_role("operator")),
                           session: AsyncSession = Depends(get_session)):
    """Démarre une lecture : les mesures du rôle choisi passeront dans le modèle sauvegardé."""
    _live_prune()
    src = await live.stream_source(session)
    if src is None:
        raise HTTPException(status_code=404, detail="Modèle ou jeu de données introuvable")
    role = body.role if body.role in ROLES else "test"
    sid = uuid.uuid4().hex
    _LIVE[sid] = {"streamer": live.Streamer(src, role, max(0, body.depuis)), "user_id": user.id,
                  "vu": time.monotonic(), "lock": asyncio.Lock()}
    return {"session": sid, **live.info(src)}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] etude_live_next
#   Rôle   : route API GET /etude/live/{id}/next : PAQUET SUIVANT de mesures passées dans le modèle (appelé
#            chaque seconde par la page).
#   Entrée : sid ; taille ; utilisateur
#   Sortie : points, alertes, statistiques
# ──────────────────────────────────────────────────────────────────────
@router.get("/etude/live/{sid}/next")
async def etude_live_next(sid: str, taille: int = Query(24, ge=1, le=200),
                          user: User = Depends(require_any_role("operator"))):
    """Paquet suivant de `taille` mesures (appelé chaque seconde par la page Temps réel)."""
    lecture = _live_get(sid, user)
    async with lecture["lock"]:
        streamer = lecture["streamer"]
        if streamer.done():
            return {"type": "mesures", "points": [], "evenements": [], "stats": dict(streamer.stats),
                    "progression": 1.0, "fini": True}
        payload = await asyncio.to_thread(streamer.next_batch, taille)
    if payload["fini"]:
        _LIVE.pop(sid, None)
    return payload


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] etude_live_stop
#   Rôle   : route API DELETE /etude/live/{id} : ARRÊTE la lecture.
#   Entrée : sid ; utilisateur
#   Sortie : {type: arret}
# ──────────────────────────────────────────────────────────────────────
@router.delete("/etude/live/{sid}")
async def etude_live_stop(sid: str, user: User = Depends(require_any_role("operator"))):
    lecture = _LIVE.get(sid)
    if lecture is not None and lecture["user_id"] == user.id:
        _LIVE.pop(sid, None)
    return {"type": "arret"}
