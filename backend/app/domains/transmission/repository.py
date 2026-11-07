# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/domains/transmission/repository.py
#   LECTURE / ÉCRITURE DES TABLES transmission_* : enregistrer un entraînement, historique,
#   étude de référence.
# ══════════════════════════════════════════════════════════════════════════
"""Persistance des entraînements « attaques de transmission » (PostgreSQL, repli SQLite)."""
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import delete, desc, insert, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.domains.transmission.models import (
    TransmissionAlert, TransmissionDatasetRow, TransmissionEpisode, TransmissionLearningPoint, TransmissionMetric,
    TransmissionModelResult, TransmissionPrediction, TransmissionRun, TransmissionShap, utcnow,
)

DETAIL_TABLES = (TransmissionMetric, TransmissionShap, TransmissionDatasetRow, TransmissionEpisode,
                 TransmissionPrediction, TransmissionAlert, TransmissionLearningPoint)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] start_run
#   Rôle   : Crée la ligne d'un nouvel entraînement (statut « en cours »).
#   Entrée : session ; username ; user_id
#   Sortie : id de l'entraînement
# ──────────────────────────────────────────────────────────────────────
async def start_run(session: AsyncSession, username: Optional[str] = None, user_id: Optional[int] = None,
                    source: str = "web") -> int:
    """Crée la ligne de l'entraînement. Un seul entraînement tourne à la fois : une ligne restée
    « en_cours » vient d'un arrêt du serveur pendant un entraînement précédent."""
    if source == "web":
        await session.execute(update(TransmissionRun).where(TransmissionRun.status == "en_cours",
                                                            TransmissionRun.source == "web")
                              .values(status="interrompu", error="Serveur arrêté pendant l'entraînement"))
    run = TransmissionRun(launched_by=username, user_id=user_id, source=source)
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run.id


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] finish_run
#   Rôle   : Enregistre le résultat d'un entraînement terminé (une ligne par modèle).
#   Entrée : session ; run_id ; out
#   Sortie : rien
# ──────────────────────────────────────────────────────────────────────
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
    run.result_json = {k: v for k, v in out.items() if not k.startswith("_")}
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


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] fail_run
#   Rôle   : Marque un entraînement en erreur.
#   Entrée : session ; run_id ; error
#   Sortie : rien
# ──────────────────────────────────────────────────────────────────────
async def fail_run(session: AsyncSession, run_id: int, error: str) -> None:
    run = await session.get(TransmissionRun, run_id)
    if run is None:
        return
    run.finished_at = utcnow()
    run.duration_s = round((run.finished_at - run.started_at).total_seconds(), 1)
    run.status = "erreur"
    run.error = error[:2000]
    await session.commit()


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] latest_result
#   Rôle   : Résultat du dernier entraînement terminé.
#   Entrée : session ; source
#   Sortie : dictionnaire ou None
# ──────────────────────────────────────────────────────────────────────
async def latest_result(session: AsyncSession, source: str = "web") -> Optional[dict]:
    """Résultat du dernier entraînement terminé (même forme que entrainement_web.json), ou None."""
    run = (await session.execute(
        select(TransmissionRun).where(TransmissionRun.status == "termine", TransmissionRun.source == source)
        .order_by(desc(TransmissionRun.finished_at), desc(TransmissionRun.id)).limit(1)
    )).scalars().first()
    if run is None or not run.result_json:
        return None
    return {**run.result_json, "run_id": run.id, "source": "postgresql"}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _iso
#   Rôle   : Date en texte avec « Z ».
#   Entrée : d
#   Sortie : texte
# ──────────────────────────────────────────────────────────────────────
def _iso(d: Optional[datetime]) -> Optional[str]:
    """UTC naïf en base : suffixe Z pour un affichage correct en heure locale."""
    return d.isoformat(timespec="seconds") + "Z" if d else None


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] history
#   Rôle   : Liste des entraînements, du plus récent au plus ancien.
#   Entrée : session ; limit
#   Sortie : liste
# ──────────────────────────────────────────────────────────────────────
async def history(session: AsyncSession, limit: int = 20) -> list[dict[str, Any]]:
    """Entraînements, du plus récent au plus ancien, avec les métriques de chaque modèle."""
    runs = (await session.execute(
        select(TransmissionRun).where(TransmissionRun.source == "web")
        .order_by(desc(TransmissionRun.started_at), desc(TransmissionRun.id)).limit(limit)
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
        "jeu_de_donnees": (r.dataset or {}).get("fichier"), "importe": bool((r.dataset or {}).get("importe")),
    } for r in runs]


# ── Détails de l'étude : métriques par rôle, SHAP, jeu de données, prédictions, alertes ──

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _f
#   Rôle   : Convertit en nombre décimal (ou None).
#   Entrée : v
#   Sortie : float ou None
# ──────────────────────────────────────────────────────────────────────
def _f(v):
    return None if v is None else float(v)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] delete_details
#   Rôle   : Supprime les détails (métriques, SHAP…) d'un entraînement.
#   Entrée : session ; run_id
#   Sortie : rien
# ──────────────────────────────────────────────────────────────────────
async def delete_details(session: AsyncSession, run_id: int) -> None:
    for table in DETAIL_TABLES:
        await session.execute(delete(table).where(table.run_id == run_id))


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] delete_runs
#   Rôle   : Supprime tous les entraînements d'une source.
#   Entrée : session ; source
#   Sortie : nombre supprimé
# ──────────────────────────────────────────────────────────────────────
async def delete_runs(session: AsyncSession, source: str) -> int:
    """Supprime les entraînements d'une source (ex. l'étude de référence avant rechargement)."""
    ids = (await session.execute(select(TransmissionRun.id).where(TransmissionRun.source == source))).scalars().all()
    for rid in ids:
        await delete_details(session, rid)
        await session.execute(delete(TransmissionModelResult).where(TransmissionModelResult.run_id == rid))
        await session.execute(delete(TransmissionRun).where(TransmissionRun.id == rid))
    await session.commit()
    return len(ids)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] delete_run
#   Rôle   : Supprime UN entraînement web de la base (détails, résultats par modèle, ligne du run).
#   Entrée : session ; run_id
#   Sortie : True si supprimé, False si introuvable
# ──────────────────────────────────────────────────────────────────────
async def delete_run(session: AsyncSession, run_id: int) -> bool:
    found = (await session.execute(
        select(TransmissionRun.id).where(TransmissionRun.id == run_id, TransmissionRun.source == "web")
    )).scalars().first()
    if found is None:
        return False
    await delete_details(session, run_id)
    await session.execute(delete(TransmissionModelResult).where(TransmissionModelResult.run_id == run_id))
    await session.execute(delete(TransmissionRun).where(TransmissionRun.id == run_id))
    await session.commit()
    return True


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _bulk
#   Rôle   : Insère beaucoup de lignes d'un coup, par paquets de 5000.
#   Entrée : session ; table ; rows
#   Sortie : rien
# ──────────────────────────────────────────────────────────────────────
async def _bulk(session: AsyncSession, table, rows: list[dict], chunk: int = 5000) -> None:
    for i in range(0, len(rows), chunk):
        await session.execute(insert(table), rows[i:i + chunk])


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] store_details
#   Rôle   : ÉCRIT EN BASE ce que lisent les pages : métriques, SHAP, et si fourni jeu de données, scores,
#            alertes, épisodes.
#   Entrée : session ; run_id ; out ; records…
#   Sortie : rien
# ──────────────────────────────────────────────────────────────────────
async def store_details(session: AsyncSession, run_id: int, out: dict, records: Optional[dict] = None,
                        all_episodes: Optional[list[dict]] = None, feature_label=None) -> dict:
    """Écrit ce que les pages du site lisent : métriques train/val/test (niveaux ligne et alarme),
    SHAP, et — si `records` est fourni — le jeu de données, les scores du meilleur modèle, ses
    alertes et les épisodes (détectés ou non). Renvoie le nombre de lignes écrites par table."""
    best = out.get("meilleur")
    counts: dict[str, int] = {}
    metrics = []
    for key, m in (out.get("modeles") or {}).items():
        pr = m.get("par_role") or {}
        op = m.get("point_fonctionnement") or {}
        for niveau in ("alarme", "ligne"):
            for role, v in (pr.get(niveau) or {}).items():
                metrics.append(dict(
                    run_id=run_id, model_key=key, role=role, niveau=niveau, is_best=key == best,
                    seuil=_f(op.get("seuil")), k=op.get("k") if niveau == "alarme" else 1,
                    n=op.get("n") if niveau == "alarme" else 1,
                    recall=_f(v.get("recall")), precision=_f(v.get("precision")), f1=_f(v.get("f1")), fpr=_f(v.get("fpr")),
                    roc_auc=_f((pr.get("auc") or {}).get(role)), avg_precision=_f((pr.get("ap") or {}).get(role)),
                    tp=v.get("tp"), fp=v.get("fp"), fn=v.get("fn"), tn=v.get("tn"),
                    part_attaques=_f(v.get("part_attaques")), heures_normales=_f(v.get("heures_normales")),
                    alertes=v.get("alertes"), fausses_alertes=v.get("fausses_alertes"),
                    fausses_alertes_par_heure=_f(v.get("fausses_alarmes_evenements_par_heure")),
                    episodes=v.get("episodes"), episodes_detectes=v.get("episodes_detectes"),
                    delai_median_min=_f(v.get("delai_median_min")), delai_p90_min=_f(v.get("delai_p90_min")),
                    per_attack=v.get("per_attack") or {}, per_episode=v.get("per_episode") or {}))
    await _bulk(session, TransmissionMetric, metrics)
    counts["transmission_metrics"] = len(metrics)

    shap = out.get("shap") or {}
    rows = []
    label = feature_label or (lambda f: f)
    if shap:
        mk = shap.get("modele") or out.get("modele_shap") or best
        for portee, lst in [("global", shap.get("global") or [])] + list((shap.get("par_scenario") or {}).items()):
            for i, f in enumerate(lst, 1):
                rows.append(dict(run_id=run_id, model_key=mk, portee=portee, rang=i, feature=f["feature"],
                                 libelle=f.get("label") or label(f["feature"]), importance=float(f["importance"])))
    await _bulk(session, TransmissionShap, rows)
    counts["transmission_shap"] = len(rows)

    lc = out.get("courbe_apprentissage") or {}
    pts = [dict(run_id=run_id, model_key=lc.get("modele") or best, part_train=float(p["part_train"]),
                lignes_train=int(p["lignes_train"]), ap_train=float(p["ap_train"]), ap_val=float(p["ap_val"]),
                f1_train=_f(p.get("f1_train")), f1_val=_f(p.get("f1_val"))) for p in (lc.get("points") or [])]
    await _bulk(session, TransmissionLearningPoint, pts)
    counts["transmission_learning_curve"] = len(pts)

    if records is not None:
        df = records["df"]
        ts = [d.to_pydatetime() for d in __import__("pandas").to_datetime(df["datetime"])]
        split, ev = records["split"], records["evaluee"]
        cols = {c: df[c].to_numpy() for c in ("weather_temp", "fridge_temp", "thermostat_temp", "fridge_true",
                                              "thermostat_true", "fridge_cond", "thermo_status", "garde",
                                              "label", "attack_type", "cible")}
        data = [dict(run_id=run_id, idx=i, ts=ts[i], bloc=i // 720, role=str(split[i]), evaluee=bool(ev[i]),
                     weather_temp=float(cols["weather_temp"][i]), fridge_temp=float(cols["fridge_temp"][i]),
                     thermostat_temp=float(cols["thermostat_temp"][i]), fridge_true=float(cols["fridge_true"][i]),
                     thermostat_true=float(cols["thermostat_true"][i]), fridge_cond=str(cols["fridge_cond"][i]),
                     thermo_status=int(float(cols["thermo_status"][i] or 0)), garde=bool(cols["garde"][i]),
                     label=int(cols["label"][i]),
                     attack_type=str(cols["attack_type"][i]), cible=str(cols["cible"][i] or ""))
                for i in range(len(df))]
        await _bulk(session, TransmissionDatasetRow, data)
        counts["transmission_dataset"] = len(data)
        s, sig, al = records["scores"], records["signal"], records["alarme"]
        preds = [dict(run_id=run_id, model_key=best, idx=i, score=round(float(s[i]), 5), signal=bool(sig[i]),
                      alarme=bool(al[i])) for i in range(len(s))]
        await _bulk(session, TransmissionPrediction, preds)
        counts["transmission_predictions"] = len(preds)
        alerts = [dict(run_id=run_id, model_key=best, **{k: (v.to_pydatetime() if hasattr(v, "to_pydatetime") else v)
                                                        for k, v in a.items()}) for a in records["alertes"]]
        await _bulk(session, TransmissionAlert, alerts)
        counts["transmission_alerts"] = len(alerts)
        eps = []
        for e in records["episodes"]:
            eps.append(dict(run_id=run_id, repetition=0, scenario=e["name"], capteur=e["sensor"], mecanisme=e["kind"],
                            parametre=_f(e.get("param")), role=e["split"], start_idx=int(e["start"]),
                            end_idx=int(e["end"]), start_ts=e["start_ts"].to_pydatetime(),
                            end_ts=e["end_ts"].to_pydatetime(), detecte=e["detecte"], delai_min=_f(e["delai_min"])))
        for e in all_episodes or []:
            if e.get("run", 0) == 0:
                continue
            eps.append(dict(run_id=run_id, repetition=int(e["run"]), scenario=e["name"], capteur=e["sensor"],
                            mecanisme=e["kind"], parametre=_f(e.get("param")), role=e["split"],
                            start_idx=int(e["start"]), end_idx=int(e["end"]),
                            start_ts=ts[int(e["start"])], end_ts=ts[min(len(ts) - 1, int(e["end"]) - 1)],
                            detecte=e.get("detecte"), delai_min=_f(e.get("delai_min"))))
        await _bulk(session, TransmissionEpisode, eps)
        counts["transmission_episodes"] = len(eps)
    await session.commit()
    return counts


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] reference_run
#   Rôle   : L'étude affichée par le site : la référence, sinon le dernier entraînement web.
#   Entrée : session
#   Sortie : TransmissionRun ou None
# ──────────────────────────────────────────────────────────────────────
async def reference_run(session: AsyncSession) -> Optional[TransmissionRun]:
    """L'étude de référence chargée en base (scripts/charger_base.py), sinon le dernier entraînement web."""
    for source in ("reference", "web"):
        run = (await session.execute(
            select(TransmissionRun).where(TransmissionRun.status == "termine", TransmissionRun.source == source)
            .order_by(desc(TransmissionRun.finished_at), desc(TransmissionRun.id)).limit(1)
        )).scalars().first()
        if run is not None:
            return run
    return None


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] prune_heavy_details
#   Rôle   : Garde les lignes lourdes (jeu de données, scores) seulement pour le dernier entraînement.
#   Entrée : session ; keep_run_id ; source
#   Sortie : rien
# ──────────────────────────────────────────────────────────────────────
async def prune_heavy_details(session: AsyncSession, keep_run_id: int, source: str = "web") -> None:
    """Les lignes lourdes (jeu de données, scores, alertes, épisodes) ne sont gardées que pour le
    dernier entraînement d'une source ; les métriques et SHAP restent pour l'historique."""
    ids = (await session.execute(select(TransmissionRun.id).where(TransmissionRun.source == source,
                                                                 TransmissionRun.id != keep_run_id))).scalars().all()
    for table in (TransmissionDatasetRow, TransmissionPrediction, TransmissionAlert, TransmissionEpisode):
        if ids:
            await session.execute(delete(table).where(table.run_id.in_(ids)))
    await session.commit()
