"""Étude en base (tables lues par les pages) et rôles administrateur / opérateur."""
import asyncio
from types import SimpleNamespace

import httpx
import numpy as np
import pandas as pd
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel

from app.api.v1 import auth as auth_api
from app.api.v1 import etude as etude_api
from app.api.v1 import parametres as param_api
from app.api.v1 import transmission as tx_api
from app.db.session import get_session
from app.domains import parametres  # noqa: F401 — enregistre la table app_settings
from app.domains.auth.service import get_current_user
from app.domains.transmission import repository, service
from app.domains.transmission.models import (
    TransmissionAlert, TransmissionDatasetRow, TransmissionEpisode, TransmissionMetric, TransmissionPrediction,
)

N = 3 * 720
ADMIN = SimpleNamespace(id=1, username="admin", role="admin", is_active=True)
OPERATOR = SimpleNamespace(id=2, username="operateur", role="operator", is_active=True)


def _metrics(recall):
    v = {"recall": recall, "precision": 0.95, "f1": 0.7, "fpr": 0.01, "tp": 50, "fp": 3, "fn": 20, "tn": 900,
         "part_attaques": 0.07, "heures_normales": 1.2, "alertes": 3, "fausses_alertes": 1,
         "fausses_alarmes_evenements_par_heure": 0.8, "episodes": 1, "episodes_detectes": 1,
         "delai_median_min": 2.0, "delai_p90_min": 2.0, "per_attack": {}, "per_episode": {}}
    return {r: dict(v) for r in ("train", "val", "test")}


OUT = {
    "meilleur": "HistGB", "classement_validation": ["HistGB", "RandomForest"], "duree_s": 12.0,
    "dataset": {"lignes": N, "features": 53, "episodes": 2, "zone_de_garde_min": 20.0},
    "critere": "rappel maximal sous précision ≥ 0.90 et ≤ 0.5 FA/h",
    "modeles": {k: {"nom": k, "type": "supervisé", "f1": 0.7, "precision": 0.95, "recall": r, "val_f1": 0.7,
                    "point_fonctionnement": {"seuil": 0.7, "k": 6, "n": 12, "contrainte_tenue": True},
                    "par_role": {"alarme": _metrics(r), "ligne": _metrics(r - 0.1),
                                 "auc": {"train": 1.0, "val": 0.9, "test": 0.88},
                                 "ap": {"train": 1.0, "val": 0.8, "test": 0.78}}}
                for k, r in (("HistGB", 0.62), ("RandomForest", 0.6))},
    "shap": {"modele": "HistGB", "n_lignes": 10, "global": [{"feature": "fridge_q90_15min", "importance": 0.3},
                                                          {"feature": "fridge_std_1min", "importance": 0.1}],
             "par_scenario": {"MITM_gel": [{"feature": "fridge_std_1min", "importance": 0.4}]}},
    "courbe_apprentissage": {"modele": "HistGB", "points": [
        {"part_train": 0.5, "lignes_train": 100, "ap_train": 1.0, "ap_val": 0.7},
        {"part_train": 1.0, "lignes_train": 200, "ap_train": 1.0, "ap_val": 0.8}]},
}


def _records():
    rng = np.random.default_rng(0)
    df = pd.DataFrame({"datetime": pd.date_range("2019-04-01", periods=N, freq="5s"),
                       "weather_temp": rng.uniform(20, 45, N), "fridge_temp": rng.uniform(1, 14, N),
                       "thermostat_temp": rng.uniform(25, 35, N), "fridge_cond": "low", "thermo_status": 0})
    df["fridge_true"], df["thermostat_true"] = df["fridge_temp"], df["thermostat_temp"]
    df["label"], df["attack_type"], df["cible"], df["garde"] = 0, "normal", "", False
    episodes = [{"name": "MITM_gel", "sensor": "fridge", "kind": "gel", "param": None, "start": 300, "end": 500,
                 "split": "train"},
                {"name": "MITM_gel", "sensor": "fridge", "kind": "gel", "param": None, "start": 1000, "end": 1200,
                 "split": "train"}]
    for e in episodes:
        df.loc[e["start"]:e["end"] - 1, ["label", "attack_type", "cible"]] = [1, e["name"], "fridge"]
        df.loc[e["end"]:e["end"] + 239, "garde"] = True
    scores = np.where(df["label"] == 1, 0.9, 0.1)
    scores[1500:1520] = 0.95                                 # une fausse alerte
    rec = service.study_records(df, episodes, 0, scores, {"seuil": 0.7, "k": 6, "n": 12})
    return {"df": df, **rec}


async def _app():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def session_override():
        async with Session() as s:
            yield s

    app = FastAPI()
    for r in (etude_api.router, param_api.router, tx_api.router, auth_api.router):
        app.include_router(r, prefix="/api/v1")
    app.dependency_overrides[get_session] = session_override
    return app, engine, Session


def test_reference_study_is_stored_and_pages_read_the_tables():
    async def scenario():
        app, engine, Session = await _app()
        async with Session() as s:
            rid = await repository.start_run(s, "charger_base.py", None, source="reference")
            await repository.finish_run(s, rid, OUT)
            counts = await repository.store_details(s, rid, OUT, _records(), None, service.feature_label)
            sql = {t.__tablename__: (await s.execute(select(func.count()).select_from(t))).scalar()
                   for t in (TransmissionDatasetRow, TransmissionPrediction, TransmissionAlert, TransmissionEpisode,
                             TransmissionMetric)}
            false_alerts = (await s.execute(select(func.count()).where(TransmissionAlert.vraie.is_(False)))).scalar()
        app.dependency_overrides[get_current_user] = lambda: OPERATOR
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            pages = {p: await c.get(f"/api/v1/etude/{p}") for p in ("run", "dataset", "metrics", "shap")}
            timeline = await c.get("/api/v1/etude/timeline", params={"role": "train"})
            history = await c.get("/api/v1/transmission/history")
        await engine.dispose()
        return counts, sql, false_alerts, pages, timeline, history

    counts, sql, false_alerts, pages, timeline, history = asyncio.run(scenario())
    assert counts["transmission_dataset"] == sql["transmission_dataset"] == N
    assert sql["transmission_predictions"] == N and sql["transmission_metrics"] == 2 * 2 * 3
    assert all(r.status_code == 200 for r in pages.values()) and timeline.status_code == 200
    ds = pages["dataset"].json()
    assert ds["total"]["lignes"] == N and ds["total"]["attaques"] == 400
    assert ds["total"]["exclues_zone_de_garde"] > 2 * 240 - 1      # garde après les épisodes + début de bloc
    m = pages["metrics"].json()
    assert m["modeles"]["HistGB"]["alarme"]["test"]["recall"] == 0.62 and m["classement_validation"][0] == "HistGB"
    assert [p["part_train"] for p in m["courbe_apprentissage"]["points"]] == [0.5, 1.0]
    sh = pages["shap"].json()
    assert sh["global"][0]["feature"] == "fridge_q90_15min" and sh["global"][0]["libelle"].startswith("quantile 90")
    t = timeline.json()
    assert len(t["episodes"]) == 2 and all(e["detecte"] for e in t["episodes"])
    assert sum(not a["vraie"] for a in t["alertes"]) == false_alerts == 1
    assert history.json()["runs"] == []                            # l'historique ne montre que les entraînements web


def test_operator_cannot_manage_users_settings_or_trainings():
    async def scenario():
        app, engine, _ = await _app()
        out = {}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            app.dependency_overrides[get_current_user] = lambda: OPERATOR
            out["op_read"] = await c.get("/api/v1/parametres")
            out["op_put"] = await c.put("/api/v1/parametres", json={"fa_max": 1.0})
            out["op_train"] = await c.post("/api/v1/transmission/train")
            out["op_users"] = await c.get("/api/v1/auth/users")
            out["op_create"] = await c.post("/api/v1/auth/users", json={"email": "x@y.z", "username": "x",
                                                                       "password": "Secret123!", "role": "admin"})
            app.dependency_overrides[get_current_user] = lambda: ADMIN
            out["ad_put"] = await c.put("/api/v1/parametres", json={"fa_max": 1.0, "precision_min": 0.85})
            out["ad_bad"] = await c.put("/api/v1/parametres", json={"fa_max": 50})
            out["ad_read"] = await c.get("/api/v1/parametres")
        await engine.dispose()
        return out

    out = asyncio.run(scenario())
    assert out["op_read"].status_code == 200
    for k in ("op_put", "op_train", "op_users", "op_create"):
        assert out[k].status_code == 403, k
    assert out["ad_put"].status_code == 200 and out["ad_bad"].status_code == 422
    assert out["ad_read"].json()["valeurs"]["fa_max"] == 1.0 and out["ad_read"].json()["valeurs"]["precision_min"] == 0.85


def test_live_streamer_applies_threshold_and_persistence_and_tracks_true_and_false_alerts():
    from app.domains.transmission import live

    class Model:
        def predict_proba(self, X):
            return np.column_stack([1 - X[:, 0], X[:, 0]])

    n = 200
    label = np.zeros(n, dtype=int); label[50:90] = 1
    score = np.where(label == 1, 0.9, 0.1); score[150:170] = 0.95          # une fausse alerte
    df = pd.DataFrame({"datetime": pd.date_range("2019-04-01", periods=n, freq="5s"), "fridge_temp": 5.0,
                       "thermostat_temp": 28.0, "weather_temp": 30.0, "label": label,
                       "attack_type": np.where(label == 1, "MITM_gel", "normal"), "role": "test", "evaluee": True,
                       "idx": np.arange(n)})
    src = {"run_id": 1, "df": df, "X": score.reshape(-1, 1).astype(np.float32), "model": Model(),
           "cfg": {"modele": "HistGB", "nom": "HGB", "seuil": 0.7, "k": 6, "n": 12}}
    s = live.Streamer(src, "test")
    events = []
    while not s.done():
        out = s.next_batch(37)
        events += out["evenements"]
    starts = [e for e in events if e["type"] == "debut"]
    ends = [e for e in events if e["type"] == "fin"]
    assert [e["idx"] for e in starts] == [55, 155]                       # 6e mesure au-dessus du seuil
    assert [e["vraie"] for e in ends] == [True, False]
    assert out["stats"]["alertes"] == 2 and out["stats"]["fausses"] == 1 and out["progression"] == 1.0
