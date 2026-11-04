"""
Charge l'étude de référence dans PostgreSQL (tables lues par les pages du site)
===============================================================================
Lit les sorties RÉELLES du pipeline (transmission_models.py) :
  models/transmission_reel/comparaison_modeles.json   métriques train/val/test de chaque modèle,
                                                     point de fonctionnement, courbe d'apprentissage
  models/transmission_reel/shap_transmission_reel.json SHAP du meilleur modèle arborescent
  models/transmission_reel/scores_repetition0.npz     scores de chaque modèle, répétition 0
  data/processed/dataset_transmission_reel.csv        jeu de données (répétition 0)
  data/processed/episodes_transmission_reel.json      épisodes (répétition 0) ; les 19 autres
                                                     répétitions sont recalculées (planning déterministe)
et remplit : transmission_runs (source = « reference »), transmission_model_results,
transmission_metrics, transmission_shap, transmission_learning_curve, transmission_dataset,
transmission_episodes, transmission_predictions, transmission_alerts.

L'ancienne étude de référence est supprimée avant le chargement (idempotent).
Usage :  cd backend && .venv/bin/python scripts/charger_base.py [--si-besoin]
         (dans Docker : docker compose exec app python scripts/charger_base.py)
--si-besoin : ne recharge que si la base n'a pas déjà cette version de l'étude.
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))


async def load(only_if_needed: bool = False, log=print) -> dict | None:
    import numpy as np
    import pandas as pd
    from sqlalchemy import desc
    from sqlmodel import select

    from app.db.session import AsyncSessionLocal, init_db
    from app.domains.transmission import repository, service
    from app.domains.transmission.models import TransmissionRun

    pooled = service._load_json(service.POOLED_RESULTS)
    if not pooled or pooled.get("version", 1) < 3:
        log("charger_base : comparaison_modeles.json absent ou d'une ancienne version — rien à charger")
        return None
    scores_path = service.OUT_DIR / "scores_repetition0.npz"
    if not (service.DATASET_PATH.exists() and service.EPISODES_PATH.exists() and scores_path.exists()):
        log("charger_base : jeu de données, épisodes ou scores de la répétition 0 absents — rien à charger")
        return None
    await init_db()
    async with AsyncSessionLocal() as session:
        if only_if_needed:
            run = (await session.execute(
                select(TransmissionRun).where(TransmissionRun.source == "reference", TransmissionRun.status == "termine")
                .order_by(desc(TransmissionRun.id)).limit(1))).scalars().first()
            if run is not None and (run.dataset or {}).get("generated_at") == pooled.get("generated_at"):
                return {"deja_charge": run.id}
    t0 = time.time()
    tr, tm = service._scripts()
    df = pd.read_csv(service.DATASET_PATH, parse_dates=["datetime"], keep_default_na=False)
    df["garde"] = df["garde"].astype(str).str.lower().eq("true")
    episodes = json.load(open(service.EPISODES_PATH, encoding="utf-8"))
    best = pooled["meilleur_modele"]
    scores = np.load(scores_path)[best]
    if len(scores) != len(df):
        raise RuntimeError("scores_repetition0.npz ne correspond pas au jeu de données")
    op = pooled["resultats"][best]["point_fonctionnement"]
    records = service.study_records(df, episodes, 0, scores, op)
    n_runs = pooled["protocole"]["repetitions"]
    all_eps = [{**e, "run": r} for r in range(n_runs)
               for e in tr.build_schedule(len(df), np.random.default_rng(tr.SEED + r), r, roles=("train", "val", "test"))]
    shap = service._load_json(service.POOLED_SHAP) or pooled.get("shap")
    ds = {"generated_at": pooled.get("generated_at"), "lignes": int(len(df)), "features": len(pooled["features"]),
          "episodes": len(episodes), "repetitions": n_runs, "prevalence": pooled.get("prevalence"),
          "zone_de_garde_min": tr.GUARD * tr.STEP_MINUTES, "fichier": service.DATASET_PATH.name}
    light = {k: v for k, v in pooled.items() if k not in ("resultats",)}
    out = {"meilleur": best, "modeles": {k: service._compact(v) for k, v in pooled["resultats"].items()},
           "classement_validation": pooled["classement_validation"], "duree_s": pooled.get("duree_s"),
           "dataset": ds, "shap": {**(shap or {}), "modele": pooled.get("modele_shap")} if shap else None,
           "courbe_apprentissage": pooled.get("courbe_apprentissage"), "etude": light,
           "critere": op.get("critere"), "generated_at": pooled.get("generated_at")}
    async with AsyncSessionLocal() as session:
        removed = await repository.delete_runs(session, "reference")
        run_id = await repository.start_run(session, "charger_base.py", None, source="reference")
        await repository.finish_run(session, run_id, out)
        run = await session.get(TransmissionRun, run_id)
        run.started_at = datetime.fromisoformat(pooled["generated_at"])
        await session.commit()
        counts = await repository.store_details(session, run_id, out, {"df": df, **records}, all_eps,
                                                service.feature_label)
    log(f"charger_base : étude de référence chargée (run {run_id}, {removed} ancienne(s) supprimée(s)) en "
        f"{time.time() - t0:.0f} s : " + ", ".join(f"{k} {v:,}" for k, v in counts.items()))
    return {"run_id": run_id, **counts}


if __name__ == "__main__":
    asyncio.run(load("--si-besoin" in sys.argv))
