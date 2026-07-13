"""
Seed script: register existing trained models (from notebooks) into the database.
Run: python scripts/seed_ml_models.py
"""
import os, sys, json, csv
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import AsyncSessionLocal, init_db
from app.domains.ml_models.models import MLModel, ModelMetric

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROCESSED_DIR = os.path.join(BASE_DIR, "Data", "Processed")
RESULTS_CSV = os.path.join(PROCESSED_DIR, "resultats_detection.csv")

MODELS_CONFIG = [
    {
        "id": "if-weather-v1",
        "name": "Isolation Forest - Weather",
        "model_type": "isolation_forest",
        "sensor": "weather",
        "version": "1.0.0",
        "hyperparameters": {"contamination": 0.05, "n_estimators": 200, "max_samples": "auto", "random_state": 42},
        "features": ["temperature", "humidity", "temp_diff_1", "humidity_diff_1", "temp_roll_mean_10", "temp_roll_std_10", "hour_sin", "hour_cos"],
        "feature_count": 8,
        "training_samples": 399188,
        "contamination": 0.05,
        "n_estimators": 200,
        "anomaly_rate_normal": 5.0,
        "score_moyen_normal": 0.0713,
        "status": "deployed",
        "model_path": "isolation_forest_weather.joblib",
        "scaler_path": "scaler_weather.joblib",
    },
    {
        "id": "if-fridge-v1",
        "name": "Isolation Forest - Fridge",
        "model_type": "isolation_forest",
        "sensor": "fridge",
        "version": "1.0.0",
        "hyperparameters": {"contamination": 0.05, "n_estimators": 200, "max_samples": "auto", "random_state": 42},
        "features": ["fridge_temperature", "temp_condition_encoded", "fridge_diff_1", "fridge_roll_mean_10", "hour_sin", "hour_cos"],
        "feature_count": 6,
        "training_samples": 383368,
        "contamination": 0.05,
        "n_estimators": 200,
        "anomaly_rate_normal": 5.0,
        "score_moyen_normal": 0.0871,
        "status": "deployed",
        "model_path": "isolation_forest_fridge.joblib",
        "scaler_path": "scaler_fridge.joblib",
    },
    {
        "id": "if-thermostat-v1",
        "name": "Isolation Forest - Thermostat",
        "model_type": "isolation_forest",
        "sensor": "thermostat",
        "version": "1.0.0",
        "hyperparameters": {"contamination": 0.05, "n_estimators": 200, "max_samples": "auto", "random_state": 42},
        "features": ["current_temperature", "thermostat_status", "thermo_diff_1", "hour_sin", "hour_cos"],
        "feature_count": 5,
        "training_samples": 291182,
        "contamination": 0.05,
        "n_estimators": 200,
        "anomaly_rate_normal": 5.0,
        "score_moyen_normal": 0.1484,
        "status": "deployed",
        "model_path": "isolation_forest_thermostat.joblib",
        "scaler_path": "scaler_thermostat.joblib",
    },
    {
        "id": "if-combine-v1",
        "name": "Isolation Forest - Combine (3 capteurs)",
        "model_type": "isolation_forest",
        "sensor": "combine",
        "version": "1.0.0",
        "hyperparameters": {"contamination": 0.05, "n_estimators": 200, "max_samples": "auto", "random_state": 42},
        "features": ["temperature", "humidity", "temp_diff_1", "humidity_diff_1", "temp_roll_mean_10", "temp_roll_std_10",
                     "fridge_temperature", "temp_condition_encoded", "fridge_diff_1", "fridge_roll_mean_10",
                     "current_temperature", "thermostat_status", "thermo_diff_1",
                     "hour_sin_x", "hour_cos_x", "hour_sin_y", "hour_cos_y", "hour_sin", "hour_cos"],
        "feature_count": 19,
        "training_samples": 370972,
        "contamination": 0.05,
        "n_estimators": 200,
        "anomaly_rate_normal": 5.0,
        "score_moyen_normal": 0.0797,
        "status": "deployed",
        "model_path": "isolation_forest_combine.joblib",
        "scaler_path": None,
    },
]


async def seed():
    await init_db()
    async with AsyncSessionLocal() as session:
        # Clear existing data to allow re-seed
        await session.execute(text("DELETE FROM model_metrics"))
        await session.execute(text("DELETE FROM ml_models"))
        await session.flush()

        for cfg in MODELS_CONFIG:
            model = MLModel(
                id=cfg["id"],
                name=cfg["name"],
                model_type=cfg["model_type"],
                sensor=cfg["sensor"],
                version=cfg["version"],
                hyperparameters=cfg["hyperparameters"],
                features=cfg["features"],
                feature_count=cfg["feature_count"],
                training_samples=cfg["training_samples"],
                contamination=cfg["contamination"],
                n_estimators=cfg["n_estimators"],
                anomaly_rate_normal=cfg["anomaly_rate_normal"],
                score_moyen_normal=cfg["score_moyen_normal"],
                status=cfg["status"],
                trained_at=datetime.now(timezone.utc),
                model_path=cfg["model_path"],
                scaler_path=cfg["scaler_path"],
            )
            session.add(model)
            print(f"[+] Registered model: {cfg['id']} - {cfg['name']}")

        # Import metrics from resultats_detection.csv
        if os.path.exists(RESULTS_CSV):
            with open(RESULTS_CSV, "r") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    capteur = row["capteur"].strip()
                    attaque = row["attaque"].strip()
                    # Map capteur name to model id
                    if "COMBINE" in capteur:
                        model_id = "if-combine-v1"
                    else:
                        model_id = f"if-{capteur.lower()}-v1"
                    metric = ModelMetric(
                        model_id=model_id,
                        attack_type=attaque,
                        capteur=capteur,
                        n_total=int(float(row["n_total"])),
                        n_anomalies=int(float(row["n_anomalies"])),
                        taux_detection=float(row["taux_detection"]),
                        score_moyen=float(row["score_moyen"]),
                    )
                    session.add(metric)
            print(f"[+] Imported metrics from {RESULTS_CSV}")
        else:
            print(f"[!] {RESULTS_CSV} not found, skipping metrics import")

        await session.commit()
    print("[OK] Seed complete!")


if __name__ == "__main__":
    asyncio.run(seed())
