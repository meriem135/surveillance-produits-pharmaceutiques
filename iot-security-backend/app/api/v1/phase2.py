import json, os, sqlite3
from fastapi import APIRouter
import joblib
import numpy as np

router = APIRouter()

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
RESULTS_PATH = os.path.join(BASE, "phase2", "Data", "Processed", "models", "resultats_comparaison_final.json")
SCORES_PATH = os.path.join(BASE, "phase2", "Data", "Processed", "models", "gnn_forecast_scores.pkl")
DB_PATH = os.path.join(BASE, "Data", "Processed", "iot_security.db")


@router.get("/phase2/results")
async def get_phase2_results():
    if not os.path.exists(RESULTS_PATH):
        return {"error": "Results file not found"}
    with open(RESULTS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data


@router.get("/phase2/attack-metrics")
async def get_attack_metrics():
    if not os.path.exists(DB_PATH):
        return {"error": "Database not found", "metrics": []}
    try:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        cur = con.execute("""
            SELECT m.id, m.model_id, ml.name AS model_name, ml.sensor AS model_sensor,
                   m.attack_type, m.capteur, m.n_total, m.n_anomalies,
                   m.taux_detection, m.score_moyen, m.roc_auc, m.avg_precision,
                   m.precision_normal, m.recall_normal, m.f1_normal,
                   m.precision_attaque, m.recall_attaque, m.f1_attaque
            FROM model_metrics m
            LEFT JOIN ml_models ml ON ml.id = m.model_id
            ORDER BY m.attack_type, m.model_id
        """)
        rows = [dict(r) for r in cur.fetchall()]
        con.close()
        return {"metrics": rows}
    except Exception as e:
        return {"error": str(e), "metrics": []}


@router.get("/phase2/gnn-forecast-scores")
async def get_gnn_forecast_scores():
    if not os.path.exists(SCORES_PATH):
        return {"error": "Scores file not found"}
    try:
        d = joblib.load(SCORES_PATH)
        return {
            "gnn": {
                "timestamps": [str(ts) for ts in d["gnn_timestamps"]],
                "scores": [float(x) for x in d["gnn_scores"]],
                "labels": [int(x) for x in d["gnn_labels"]],
                "edges": {k: [float(x) for x in v] for k, v in d["edge_series"].items()},
            },
            "forecast": {
                "scores": [float(x) for x in d["forecast_scores"]],
                "labels": [int(x) for x in d["forecast_labels"]],
                "residuals": {k: [float(x) for x in v] for k, v in d["residuals"].items()},
            },
        }
    except Exception as e:
        return {"error": str(e)}
