# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/scripts/shap_alertes.py
#   RATTRAPAGE DU SHAP PAR ALERTE pour un entraînement déjà en base (sans réentraîner) : relit le jeu de
#   données et les alertes du run, recalcule les features, explique chaque alerte avec le modèle en service
#   et remplit transmission_alert_shap. Les nouveaux entraînements le font eux-mêmes.
# ══════════════════════════════════════════════════════════════════════════
"""
Usage (dans Docker) :  docker compose exec app python scripts/shap_alertes.py [run_id]
Sans argument : dernier entraînement terminé (web, sinon référence). Idempotent : remplace l'existant.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))


async def main(run_id: int | None = None) -> None:
    import joblib
    import pandas as pd
    from sqlalchemy import delete, desc
    from sqlmodel import select

    from app.db.session import AsyncSessionLocal, init_db
    from app.domains.transmission import repository, service
    from app.domains.transmission.models import (
        TransmissionAlert, TransmissionAlertShap, TransmissionDatasetRow, TransmissionRun,
    )

    _, tm = service._scripts()
    await init_db()
    async with AsyncSessionLocal() as s:
        if run_id is None:
            run = (await s.execute(select(TransmissionRun).where(TransmissionRun.status == "termine")
                                   .order_by(desc(TransmissionRun.id)).limit(1))).scalars().first()
        else:
            run = await s.get(TransmissionRun, run_id)
        if run is None:
            print("Aucun entraînement terminé en base.")
            return
        alerts = (await s.execute(select(TransmissionAlert).where(TransmissionAlert.run_id == run.id)
                                  .order_by(TransmissionAlert.start_idx))).scalars().all()
        rows = (await s.execute(select(TransmissionDatasetRow).where(TransmissionDatasetRow.run_id == run.id)
                                .order_by(TransmissionDatasetRow.idx))).scalars().all()
    if not alerts or not rows:
        print(f"Run {run.id} : pas d'alertes ou de jeu de données en base.")
        return

    df = pd.DataFrame([{"datetime": r.ts, "weather_temp": r.weather_temp, "fridge_temp": r.fridge_temp,
                        "thermostat_temp": r.thermostat_temp, "fridge_cond": r.fridge_cond,
                        "thermo_status": r.thermo_status, "garde": r.garde, "label": r.label,
                        "attack_type": r.attack_type, "cible": r.cible} for r in rows])
    df, feats = tm.engineer(df)

    web = run.source == "web"
    pkl = service.OUT_DIR / ("modele_web.pkl" if web else "meilleur_modele.pkl")
    cfg = service._load_json(service.OUT_DIR / ("modele_web.json" if web else "meilleur_modele.json")) or {}
    if cfg.get("modele") != run.best_model or cfg.get("features") != feats:
        raise SystemExit(f"Le modèle en service ({cfg.get('modele')}) ne correspond pas au run {run.id} "
                         f"({run.best_model}) ou à ses features : rien écrit.")
    model = joblib.load(pkl)
    print(f"Run {run.id} ({run.source}) : {len(alerts)} alertes, modèle {run.best_model}, {len(feats)} features")
    res = service.alert_shap(model, df, feats, [{"start_idx": a.start_idx, "end_idx": a.end_idx} for a in alerts])

    async with AsyncSessionLocal() as s:
        await s.execute(delete(TransmissionAlertShap).where(TransmissionAlertShap.run_id == run.id))
        await repository._bulk(s, TransmissionAlertShap, [
            dict(run_id=run.id, model_key=run.best_model, libelle=service.feature_label(r["feature"]), **r)
            for r in res])
        await s.commit()
    print(f"transmission_alert_shap : {len(res)} lignes écrites pour {len(alerts)} alertes")


if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else None))
