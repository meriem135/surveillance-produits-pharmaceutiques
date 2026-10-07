"""Persistance des entraînements « attaques de transmission » (PostgreSQL, repli SQLite)."""
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import desc, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.domains.transmission.models import TransmissionModelResult, TransmissionRun, utcnow


async def start_run(session: AsyncSession, username: Optional[str] = None, user_id: Optional[int] = None) -> int:
    """Crée la ligne de l'entraînement. Un seul entraînement tourne à la fois : une ligne restée
    « en_cours » vient d'un arrêt du serveur pendant un entraînement précédent."""
    await session.execute(update(TransmissionRun).where(TransmissionRun.status == "en_cours")
                          .values(status="interrompu", error="Serveur arrêté pendant l'entraînement"))
    run = TransmissionRun(launched_by=username, user_id=user_id)
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run.id


async def finish_run(session: AsyncSession, run_id: int, out: dict) -> None:
    """Enregistre le résultat de service.train() : l'entraînement et un résultat par modèle."""
    run = await session.get(TransmissionRun, run_id)
    if run is None:
        return
    best = out.get("meilleur")
    modeles: dict[str, dict] = out.get("modeles") or {}
    ds = out.get("dataset") or {}
    run.finished_at = utcnow()
    run.status = "termine"
    run.duration_s = out.get("duree_s")
    run.n_rows, run.n_features, run.n_episodes = ds.get("lignes", 0), ds.get("features", 0), ds.get("episodes", 0)
    run.dataset = ds
    run.scenarios = sorted({s for m in modeles.values() for s in (m.get("per_attack") or {})})
    run.best_model = best
    run.best_f1 = (modeles.get(best) or {}).get("f1")
    run.ranking = out.get("classement_validation") or []
    run.result_json = out
    for key, m in modeles.items():
        session.add(TransmissionModelResult(
            run_id=run_id, model_key=key, nom=m.get("nom", key), model_type=m.get("type", ""), is_best=key == best,
            f1=m.get("f1"), precision=m.get("precision"), recall=m.get("recall"), roc_auc=m.get("roc_auc"),
            avg_precision=m.get("avg_precision"), fpr=m.get("fpr"), val_f1=m.get("val_f1"), threshold=m.get("threshold"),
            fausses_alarmes_par_heure=m.get("fausses_alarmes_evenements_par_heure"), episodes=m.get("episodes"),
            episodes_detectes=m.get("episodes_detectes"), delai_median_min=m.get("delai_median_min"),
            hyperparameters=m.get("hyperparameters") or {}, per_attack=m.get("per_attack") or {},
            per_episode=m.get("per_episode") or {},
        ))
    await session.commit()


async def fail_run(session: AsyncSession, run_id: int, error: str) -> None:
    run = await session.get(TransmissionRun, run_id)
    if run is None:
        return
    run.finished_at = utcnow()
    run.duration_s = round((run.finished_at - run.started_at).total_seconds(), 1)
    run.status = "erreur"
    run.error = error[:2000]
    await session.commit()


async def latest_result(session: AsyncSession) -> Optional[dict]:
    """Résultat du dernier entraînement terminé (même forme que entrainement_web.json), ou None."""
    run = (await session.execute(
        select(TransmissionRun).where(TransmissionRun.status == "termine")
        .order_by(desc(TransmissionRun.finished_at), desc(TransmissionRun.id)).limit(1)
    )).scalars().first()
    if run is None or not run.result_json:
        return None
    return {**run.result_json, "run_id": run.id, "source": "postgresql"}


def _iso(d: Optional[datetime]) -> Optional[str]:
    return d.isoformat(timespec="seconds") if d else None


async def history(session: AsyncSession, limit: int = 20) -> list[dict[str, Any]]:
    """Entraînements, du plus récent au plus ancien, avec les métriques de chaque modèle."""
    runs = (await session.execute(
        select(TransmissionRun).order_by(desc(TransmissionRun.started_at), desc(TransmissionRun.id)).limit(limit)
    )).scalars().all()
    if not runs:
        return []
    rows = (await session.execute(
        select(TransmissionModelResult).where(TransmissionModelResult.run_id.in_([r.id for r in runs]))
        .order_by(TransmissionModelResult.run_id, TransmissionModelResult.id)
    )).scalars().all()
    by_run: dict[int, list[dict]] = {}
    for m in rows:
        by_run.setdefault(m.run_id, []).append({
            "modele": m.model_key, "nom": m.nom, "type": m.model_type, "meilleur": m.is_best,
            "f1": m.f1, "precision": m.precision, "recall": m.recall, "roc_auc": m.roc_auc, "fpr": m.fpr,
            "val_f1": m.val_f1, "fausses_alarmes_par_heure": m.fausses_alarmes_par_heure,
            "episodes": m.episodes, "episodes_detectes": m.episodes_detectes, "delai_median_min": m.delai_median_min,
            "detection_par_scenario": {k: v.get("rate") for k, v in (m.per_attack or {}).items()},
        })
    return [{
        "id": r.id, "debut": _iso(r.started_at), "fin": _iso(r.finished_at), "statut": r.status,
        "lance_par": r.launched_by, "duree_s": r.duration_s, "lignes": r.n_rows, "features": r.n_features,
        "episodes": r.n_episodes, "scenarios": r.scenarios, "meilleur_modele": r.best_model, "meilleur_f1": r.best_f1,
        "classement_validation": r.ranking, "erreur": r.error, "modeles": by_run.get(r.id, []),
    } for r in runs]
