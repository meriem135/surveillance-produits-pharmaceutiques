"""Vue d'ensemble : chaque chiffre vient de la base, une base vide donne des blocs vides."""
import asyncio
from datetime import datetime
from types import SimpleNamespace

import httpx
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel

from app.api.v1 import overview as api
from app.db.session import get_session
from app.domains.auth.models import User
from app.domains.auth.service import get_current_user
from app.domains.devices.models import Device, Telemetry
from app.domains.transmission import repository

OUT = {
    "generated_at": "2026-10-22T13:00:00", "duree_s": 425.0, "meilleur": "RandomForest", "cible_rappel": 0.9,
    "classement_validation": ["RandomForest", "XGBoost"],
    "dataset": {"fichier": "d.csv", "lignes": 44443, "features": 35, "episodes": 51, "train": 100, "val": 20,
                "test": 20, "attaques_test": 4},
    "modeles": {
        "RandomForest": {
            "nom": "Random Forest", "type": "supervisé", "f1": 0.76, "f2": 0.67, "precision": 0.96, "recall": 0.63,
            "fausses_alarmes_evenements_par_heure": 0.98, "delai_median_min": 6.2, "episodes": 4,
            "episodes_detectes": 4, "val_recall": 0.61,
            "per_attack": {"MITM_gel": {"n": 10, "detected": 4, "rate": 40.0},
                           "MITM_rejeu": {"n": 10, "detected": 7, "rate": 70.0},
                           "Injection_derive": {"n": 0, "detected": 0, "rate": 0.0}},
            "per_episode": {"MITM_gel": {"n": 1, "detected": 1, "delai_median_min": 7.4}},
            "point_fonctionnement": {"seuil": 0.7, "k": 6, "n": 12, "contrainte_tenue": True},
            "par_role": {"alarme": {"test": {"recall": 0.63, "precision": 0.96,
                                             "fausses_alarmes_evenements_par_heure": 0.98}},
                         "ligne": {"test": {"recall": 0.7, "precision": 0.8,
                                            "fausses_alarmes_evenements_par_heure": 2.4}}},
        },
        "XGBoost": {"nom": "XGBoost", "type": "supervisé", "f1": 0.63, "precision": 0.85, "recall": 0.51,
                    "per_attack": {}},
    },
}


async def _app_with(seed):
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await seed(s)

    async def session_override():
        async with Session() as s:
            yield s

    app = FastAPI()
    app.include_router(api.router, prefix="/api/v1")
    app.dependency_overrides[get_session] = session_override
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1, username="admin", role="admin")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/overview")
    await engine.dispose()
    return r


def test_empty_database_gives_empty_blocks():
    async def nothing(_s):
        return None

    r = asyncio.run(_app_with(nothing))
    assert r.status_code == 200
    d = r.json()
    assert d["entrainements"]["total"] == 0 and d["entrainements"]["dernier_lancement"] is None
    assert d["dernier_entrainement"] is None and d["historique"] == []
    assert d["capteurs"]["total"] == 0 and d["telemetrie"]["mesures"] == 0 and d["telemetrie"]["debut"] is None
    assert d["comptes"]["total"] == 0 and d["audit"]["actions"] == 0
    assert "transmission_runs" in d["sources"]["entrainements"]


def test_overview_reports_what_the_database_holds():
    async def seed(s):
        failed = await repository.start_run(s, "admin")
        await repository.fail_run(s, failed, "ValueError")
        first = await repository.start_run(s, "admin")
        await repository.finish_run(s, first, {**OUT, "modeles": {"RandomForest": {**OUT["modeles"]["RandomForest"], "f1": 0.57}}})
        second = await repository.start_run(s, "admin")
        await repository.finish_run(s, second, OUT)
        s.add(Device(id="fridge-01", name="Chambre froide", device_type="fridge", status="online", location="storage",
                     ip_address="10.0.0.2", mac_address="aa", risk_score=0, compliance_score=0,
                     compliance_status="ok", last_seen=datetime(2026, 10, 7), registered_at=datetime(2026, 10, 7)))
        s.add(Device(id="weather-01", name="Météo", device_type="weather", status="offline", location="outdoor",
                     ip_address="10.0.0.3", mac_address="bb", risk_score=0, compliance_score=0,
                     compliance_status="ok", last_seen=datetime(2026, 10, 7), registered_at=datetime(2026, 10, 7)))
        await s.commit()
        for sec in (1, 5):
            s.add(Telemetry(device_id="fridge-01", timestamp=datetime(2026, 10, 7, 17, 0, sec), metric_key="k",
                            metric_value={}))
        s.add(User(email="a@b.c", username="admin", hashed_password="x", role="admin", is_active=True,
                   created_at=datetime(2026, 10, 7)))
        await s.commit()

    r = asyncio.run(_app_with(seed))
    assert r.status_code == 200
    d = r.json()
    e = d["entrainements"]
    assert e["total"] == 3 and e["par_statut"] == {"erreur": 1, "termine": 2}
    last = d["dernier_entrainement"]
    assert last["meilleur_modele"] == "RandomForest" and last["meilleur_f1"] == 0.76 and last["cible_rappel"] == 0.9
    best = last["modeles"][0]
    assert best["meilleur"] and (best["recall"], best["f2"], best["fausses_alarmes_par_heure"]) == (0.63, 0.67, 0.98)
    assert [m["modele"] for m in last["modeles"]] == ["RandomForest", "XGBoost"]
    pts = {p["cle"]: p for p in last["points_meilleur"]}
    assert pts["alarme_test"]["fausses_alarmes_par_heure"] == 0.98 and pts["ligne_test"]["seuil"] == 0.7
    sc = last["par_scenario"]
    assert [s["scenario"] for s in sc] == ["MITM_rejeu", "MITM_gel", "Injection_derive"]  # absent du test en dernier
    assert sc[1]["episodes_detectes"] == 1 and sc[1]["delai_median_min"] == 7.4
    assert last["donnees"]["lignes"] == 44443 and last["donnees"]["scenarios"] == 3
    assert [h["f1"] for h in d["historique"]] == [0.57, 0.76]
    assert all(h["repetitions"] == 1 and h["mode"] == "tous_les_modeles" for h in d["historique"])
    assert d["capteurs"]["total"] == 2 and d["capteurs"]["en_ligne"] == 1
    assert d["capteurs"]["par_type"] == {"fridge": 1, "weather": 1}
    assert d["telemetrie"]["mesures"] == 2 and d["telemetrie"]["fin"] == "2026-10-07T17:00:05"
    assert d["comptes"] == {"total": 1, "actifs": 1, "par_role": {"admin": 1}}
