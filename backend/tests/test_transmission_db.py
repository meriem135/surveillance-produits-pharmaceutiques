"""Entraînements de transmission en base : enregistrement, historique et lecture par l'API."""
import asyncio
from types import SimpleNamespace

import httpx
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel

from app.api.v1 import transmission as api
from app.db.session import get_session
from app.domains.auth.service import get_current_user
from app.domains.transmission import repository

OUT = {
    "generated_at": "2026-10-07T18:00:00", "duree_s": 31.5, "meilleur": "RandomForest",
    "classement_validation": ["RandomForest", "IsolationForest"],
    "dataset": {"lignes": 44443, "features": 49, "episodes": 31},
    "modeles": {
        "IsolationForest": {"nom": "Isolation Forest", "type": "non supervisé", "f1": 0.42, "precision": 0.41,
                            "recall": 0.44, "fpr": 0.1, "val_f1": 0.44, "episodes": 6, "episodes_detectes": 5,
                            "per_attack": {"MITM_gel": {"n": 10, "detected": 8, "rate": 80.0}}},
        "RandomForest": {"nom": "Random Forest", "type": "supervisé", "f1": 0.66, "precision": 0.75, "recall": 0.59,
                         "fpr": 0.01, "val_f1": 0.66, "roc_auc": 0.87, "episodes": 6, "episodes_detectes": 6,
                         "delai_median_min": 1.9,
                         "per_attack": {"MITM_gel": {"n": 10, "detected": 9, "rate": 90.0},
                                        "Injection_biais_0.5": {"n": 10, "detected": 1, "rate": 10.0}}},
    },
    "courbe_random_forest": [{"arbres": 30, "f1_validation": 0.6, "auc_validation": 0.8}], "shap": None,
}


async def _sessions():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    return engine, async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


def test_a_finished_run_is_stored_with_one_row_per_model():
    async def scenario():
        engine, Session = await _sessions()
        async with Session() as s:
            run_id = await repository.start_run(s, "admin", None)
            await repository.finish_run(s, run_id, OUT)
            latest = await repository.latest_result(s)
            runs = await repository.history(s)
        await engine.dispose()
        return run_id, latest, runs

    run_id, latest, runs = asyncio.run(scenario())
    assert latest["meilleur"] == "RandomForest" and latest["run_id"] == run_id and latest["source"] == "postgresql"
    assert latest["courbe_random_forest"] == OUT["courbe_random_forest"]
    [run] = runs
    assert (run["statut"], run["lance_par"], run["lignes"], run["meilleur_f1"]) == ("termine", "admin", 44443, 0.66)
    assert run["scenarios"] == ["Injection_biais_0.5", "MITM_gel"]
    best = [m for m in run["modeles"] if m["meilleur"]]
    assert [m["modele"] for m in best] == ["RandomForest"] and len(run["modeles"]) == 2
    assert best[0]["fpr"] == 0.01 and best[0]["detection_par_scenario"] == {"MITM_gel": 90.0, "Injection_biais_0.5": 10.0}


def test_failed_and_interrupted_runs_keep_their_status():
    async def scenario():
        engine, Session = await _sessions()
        async with Session() as s:
            first = await repository.start_run(s, "admin")
            second = await repository.start_run(s, "admin")  # le premier n'a jamais fini (serveur arrêté)
            await repository.fail_run(s, second, "ValueError: jeu vide")
            runs = await repository.history(s)
            latest = await repository.latest_result(s)
        await engine.dispose()
        return first, second, runs, latest

    first, second, runs, latest = asyncio.run(scenario())
    by_id = {r["id"]: r for r in runs}
    assert by_id[first]["statut"] == "interrompu"
    assert by_id[second]["statut"] == "erreur" and "jeu vide" in by_id[second]["erreur"]
    assert latest is None  # aucun entraînement terminé : l'API retombe sur les fichiers JSON


def test_history_and_results_endpoints_read_the_database():
    async def scenario():
        engine, Session = await _sessions()
        async with Session() as s:
            run_id = await repository.start_run(s, "admin")
            await repository.finish_run(s, run_id, OUT)

        async def session_override():
            async with Session() as s:
                yield s

        app = FastAPI()
        app.include_router(api.router, prefix="/api/v1")
        app.dependency_overrides[get_session] = session_override
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1, username="admin", role="admin")
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            history = await client.get("/api/v1/transmission/history")
            results = await client.get("/api/v1/transmission/results")
        await engine.dispose()
        return history, results

    history, results = asyncio.run(scenario())
    assert history.status_code == 200 and history.json()["runs"][0]["meilleur_modele"] == "RandomForest"
    assert results.status_code == 200 and results.json()["source"] == "postgresql"
    assert results.json()["modeles"]["RandomForest"]["f1"] == 0.66
