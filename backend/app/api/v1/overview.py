"""
Vue d'ensemble du dashboard : chiffres lus uniquement dans la base de données
==============================================================================
  GET /api/v1/overview      tous les indicateurs de la page « Vue d'ensemble »

Chaque bloc de la réponse porte, dans ``sources``, la table et la requête dont il provient,
pour que chaque chiffre affiché soit vérifiable directement en SQL. Aucun chiffre n'est lu dans
un fichier ni écrit en dur : une table vide donne un bloc vide (``None`` ou liste vide).

Tables lues : transmission_runs, transmission_model_results, devices, telemetry, ml_models,
model_metrics, users, audit_logs.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends
from sqlalchemy import desc, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.db.session import get_session
from app.domains.auth.audit import AuditLog
from app.domains.auth.models import User
from app.domains.auth.service import require_any_role
from app.domains.devices.models import Device, Telemetry
from app.domains.ml.entities import MLModel, ModelMetric
from app.domains.transmission import repository
from app.domains.transmission.models import TransmissionModelResult, TransmissionRun

logger = logging.getLogger(__name__)
router = APIRouter()

SOURCES = {
    "entrainements": "SELECT status, count(*), min(started_at), max(started_at) FROM transmission_runs WHERE source = 'web' GROUP BY status",
    "dernier_entrainement": "SELECT * FROM transmission_runs WHERE status = 'termine' AND source = 'reference' (sinon 'web') ORDER BY finished_at DESC LIMIT 1",
    "modeles": "SELECT * FROM transmission_model_results WHERE run_id = <dernier entraînement> ORDER BY is_best DESC, f1 DESC",
    "f2_et_validation": "transmission_runs.result_json -> 'modeles' -> <modèle> (val_*, point_fonctionnement, par_role)",
    "par_scenario": "transmission_model_results.per_attack et per_episode (meilleur modèle du dernier entraînement)",
    "historique": "SELECT r.*, m.* FROM transmission_runs r LEFT JOIN transmission_model_results m "
                  "ON m.run_id = r.id AND m.is_best WHERE r.status = 'termine' AND r.source = 'web' ORDER BY r.started_at",
    "donnees": "transmission_runs.n_rows, n_features, n_episodes, dataset (dernier entraînement)",
    "capteurs": "SELECT device_type, status, count(*) FROM devices GROUP BY device_type, status",
    "telemetrie": "SELECT count(*), count(DISTINCT device_id), min(timestamp), max(timestamp) FROM telemetry",
    "modeles_phase2": "SELECT count(*), max(trained_at) FROM ml_models ; SELECT count(*) FROM model_metrics",
    "comptes": "SELECT role, is_active, count(*) FROM users GROUP BY role, is_active",
    "audit": "SELECT count(*), max(created_at) FROM audit_logs",
}


def _iso(d: Optional[datetime]) -> Optional[str]:
    return d.isoformat(timespec="seconds") if d else None


def _model_row(m: TransmissionModelResult, detail: dict) -> dict[str, Any]:
    """Une ligne de transmission_model_results, complétée par F2 / validation (result_json du même run)."""
    return {
        "modele": m.model_key, "nom": m.nom, "type": m.model_type, "meilleur": m.is_best,
        "recall": m.recall, "precision": m.precision, "f1": m.f1, "f2": detail.get("f2"),
        "roc_auc": m.roc_auc, "avg_precision": m.avg_precision, "fpr": m.fpr,
        "fausses_alarmes_par_heure": m.fausses_alarmes_par_heure, "delai_median_min": m.delai_median_min,
        "episodes": m.episodes, "episodes_detectes": m.episodes_detectes, "seuil": m.threshold,
        "val_f1": m.val_f1, "val_recall": detail.get("val_recall"), "val_precision": detail.get("val_precision"),
        "val_fausses_alarmes_par_heure": detail.get("val_fausses_alarmes_par_heure"),
    }


def _target_points(detail: dict) -> list[dict[str, Any]]:
    """Point de fonctionnement unique du modèle (seuil + persistance) mesuré en validation et en test,
    avec et sans la règle de persistance (result_json -> modeles -> <modèle> -> par_role)."""
    op = detail.get("point_fonctionnement") or {}
    pr = detail.get("par_role") or {}
    out = []
    for niveau, role, lib in (("alarme", "val", "Validation · avec persistance"), ("alarme", "test", "Test · avec persistance"),
                              ("ligne", "test", "Test · mesure par mesure (sans persistance)")):
        t = (pr.get(niveau) or {}).get(role) or {}
        if not t:
            continue
        out.append({
            "cle": f"{niveau}_{role}", "libelle": lib, "seuil": op.get("seuil"),
            "recall": t.get("recall"), "precision": t.get("precision"), "f1": t.get("f1"), "f2": None,
            "fausses_alarmes_par_heure": t.get("fausses_alarmes_evenements_par_heure"),
            "delai_median_min": t.get("delai_median_min"),
        })
    return out


async def build_overview(session: AsyncSession) -> dict[str, Any]:
    # ── Entraînements (transmission_runs) ─────────────────────────────────────
    web = TransmissionRun.source == "web"
    status_rows = (await session.execute(
        select(TransmissionRun.status, func.count(), func.min(TransmissionRun.started_at),
               func.max(TransmissionRun.started_at)).where(web).group_by(TransmissionRun.status)
    )).all()
    par_statut = {s: n for s, n, _, _ in status_rows}
    firsts = [a for _, _, a, _ in status_rows if a]
    lasts = [b for _, _, _, b in status_rows if b]
    last_any = (await session.execute(
        select(TransmissionRun).where(web).order_by(desc(TransmissionRun.started_at), desc(TransmissionRun.id)).limit(1)
    )).scalars().first()
    entrainements = {
        "total": sum(par_statut.values()), "par_statut": par_statut,
        "premier": _iso(min(firsts)) if firsts else None, "dernier": _iso(max(lasts)) if lasts else None,
        "dernier_lancement": None if last_any is None else {
            "id": last_any.id, "debut": _iso(last_any.started_at), "fin": _iso(last_any.finished_at),
            "statut": last_any.status, "lance_par": last_any.launched_by, "duree_s": last_any.duration_s,
            "erreur": last_any.error,
        },
    }

    # ── Étude affichée (référence chargée en base, sinon dernier entraînement web) + ses modèles ──
    run = await repository.reference_run(session)
    dernier = None
    if run is not None:
        res = run.result_json or {}
        details = res.get("modeles") or {}
        rows = (await session.execute(
            select(TransmissionModelResult).where(TransmissionModelResult.run_id == run.id)
        )).scalars().all()
        rank = {k: i for i, k in enumerate(run.ranking or [])}          # ordre du classement de validation
        modeles = sorted((_model_row(m, details.get(m.model_key) or {}) for m in rows if m.model_key != "RF_v1"),
                         key=lambda r: (not r["meilleur"], rank.get(r["modele"], 99), -(r["f1"] or 0)))
        best_row = next((m for m in rows if m.is_best), None)
        par_scenario = []
        if best_row is not None:
            episodes = best_row.per_episode or {}
            for name, a in (best_row.per_attack or {}).items():
                e = episodes.get(name) or {}
                par_scenario.append({
                    "scenario": name, "lignes": a.get("n", 0), "detectees": a.get("detected", 0),
                    "taux": a.get("rate"), "episodes": e.get("n", 0), "episodes_detectes": e.get("detected", 0),
                    "delai_median_min": e.get("delai_median_min"),
                })
            par_scenario.sort(key=lambda s: (s["lignes"] == 0, -(s["taux"] or 0)))
        ds = run.dataset or {}
        dernier = {
            "id": run.id, "debut": _iso(run.started_at), "fin": _iso(run.finished_at), "duree_s": run.duration_s,
            "lance_par": run.launched_by, "source": run.source,
            "repetitions": ((res.get("etude") or {}).get("protocole") or {}).get("repetitions", 1),
            "critere": res.get("critere"), "meilleur_modele": run.best_model, "meilleur_f1": run.best_f1,
            "classement_validation": run.ranking or [], "cible_rappel": res.get("cible_rappel"),
            "modeles": modeles,
            "points_meilleur": _target_points(details.get(run.best_model) or {}) if run.best_model else [],
            "par_scenario": par_scenario,
            "donnees": {
                "fichier": ds.get("fichier"), "lignes": run.n_rows, "features": run.n_features,
                "episodes": run.n_episodes, "scenarios": len(run.scenarios or []),
                "train": ds.get("train"), "val": ds.get("val"), "test": ds.get("test"),
                "attaques_train": ds.get("attaques_train"), "attaques_val": ds.get("attaques_val"),
                "attaques_test": ds.get("attaques_test"), "prevalence": ds.get("prevalence"),
            },
        }

    # ── Historique : meilleur modèle de chaque entraînement terminé ──────────
    hist_rows = (await session.execute(
        select(TransmissionRun, TransmissionModelResult)
        .join(TransmissionModelResult, (TransmissionModelResult.run_id == TransmissionRun.id)
              & (TransmissionModelResult.is_best == True), isouter=True)  # noqa: E712
        .where(TransmissionRun.status == "termine", web)
        .order_by(TransmissionRun.started_at, TransmissionRun.id)
    )).all()
    historique = [{
        "id": r.id, "date": _iso(r.started_at), "duree_s": r.duration_s, "meilleur_modele": r.best_model,
        "f1": m.f1 if m else r.best_f1, "recall": m.recall if m else None, "precision": m.precision if m else None,
        "fausses_alarmes_par_heure": m.fausses_alarmes_par_heure if m else None,
        "delai_median_min": m.delai_median_min if m else None, "lignes": r.n_rows,
        "candidats": r.ranking or [],
    } for r, m in hist_rows]

    # ── Capteurs, télémétrie, modèles phase 2, comptes, audit ────────────────
    dev_rows = (await session.execute(
        select(Device.device_type, Device.status, func.count()).group_by(Device.device_type, Device.status)
    )).all()
    devices = (await session.execute(select(Device).order_by(Device.id))).scalars().all()
    tel = (await session.execute(
        select(func.count(), func.count(func.distinct(Telemetry.device_id)),
               func.min(Telemetry.timestamp), func.max(Telemetry.timestamp))
    )).one()
    mlm = (await session.execute(select(func.count(), func.max(MLModel.trained_at)))).one()
    n_metrics = (await session.execute(select(func.count()).select_from(ModelMetric))).scalar_one()
    user_rows = (await session.execute(
        select(User.role, User.is_active, func.count()).group_by(User.role, User.is_active)
    )).all()
    audit = (await session.execute(select(func.count(), func.max(AuditLog.created_at)))).one()

    par_role: dict[str, int] = {}
    for role, _active, n in user_rows:
        par_role[role] = par_role.get(role, 0) + n

    return {
        "entrainements": entrainements,
        "dernier_entrainement": dernier,
        "historique": historique,
        "capteurs": {
            "total": sum(n for _, _, n in dev_rows),
            "en_ligne": sum(n for _, s, n in dev_rows if s == "online"),
            "par_type": {t: sum(n for tt, _, n in dev_rows if tt == t) for t in sorted({t for t, _, _ in dev_rows})},
            "liste": [{"id": d.id, "nom": d.name, "type": d.device_type, "statut": d.status,
                       "emplacement": d.location, "vu_le": _iso(d.last_seen)} for d in devices],
        },
        "telemetrie": {"mesures": tel[0], "appareils": tel[1], "debut": _iso(tel[2]), "fin": _iso(tel[3])},
        "modeles_phase2": {"modeles": mlm[0], "dernier_entrainement": _iso(mlm[1]), "metriques_par_attaque": n_metrics},
        "comptes": {"total": sum(par_role.values()),
                    "actifs": sum(n for _, a, n in user_rows if a), "par_role": par_role},
        "audit": {"actions": audit[0], "derniere": _iso(audit[1])},
        "sources": SOURCES,
    }


@router.get("/overview")
async def overview(_user=Depends(require_any_role("operator")), session: AsyncSession = Depends(get_session)):
    return await build_overview(session)
