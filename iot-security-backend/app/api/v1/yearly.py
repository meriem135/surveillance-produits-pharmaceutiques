"""
API router for yearly IoT dashboard data (2019 generated dataset)
Provides aggregated data points for Recharts visualizations in React.
"""

import os, json
from datetime import datetime
from fastapi import APIRouter, Query
import numpy as np
import pandas as pd

router = APIRouter(prefix="/api/yearly", tags=["yearly-dashboard"])

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
CSV_PATH = os.path.join(BASE_DIR, "Data", "Generated", "generated_yearly_merged.csv")

# Fallback: try from current working directory
if not os.path.exists(CSV_PATH):
    alt = os.path.join(os.getcwd(), "..", "Data", "Generated", "generated_yearly_merged.csv")
    if os.path.exists(alt):
        CSV_PATH = os.path.abspath(alt)

_df = None

def get_df():
    global _df
    if _df is None:
        _df = pd.read_csv(CSV_PATH)
        _df["datetime"] = pd.to_datetime(_df["datetime"])
        _df["month"] = _df["datetime"].dt.month
        _df["hour"] = _df["datetime"].dt.hour
        _df["doy"] = _df["datetime"].dt.dayofyear
    return _df

MONTH_NAMES = ["Jan","Fev","Mar","Avr","Mai","Jun","Jul","Aou","Sep","Oct","Nov","Dec"]
COLORS = {"weather": "#5E81AC", "fridge": "#A3BE8C", "thermostat": "#BF616A"}

SENSOR_COL = {
    "weather": "temperature",
    "fridge": "fridge_temperature",
    "thermostat": "current_temperature",
}

SENSOR_LABEL = {
    "weather": "Weather",
    "fridge": "Fridge",
    "thermostat": "Thermostat",
}

@router.get("/kpi")
def get_kpi():
    df = get_df()
    norm = df[df["label"] == 0]
    atk = df[df["label"] == 1]
    return {
        "total_points": len(df),
        "normal_points": len(norm),
        "attack_points": len(atk),
        "attack_rate": round(len(atk) / len(df) * 100, 1),
        "interval_min": 5,
        "days_covered": 365,
        "sensors": 3,
        "attack_types": 9,
        "avg_temp_weather": round(df["temperature"].mean(), 1),
        "avg_temp_fridge": round(df["fridge_temperature"].mean(), 1),
        "avg_temp_thermostat": round(df["current_temperature"].mean(), 1),
        "min_temp_weather": round(df["temperature"].min(), 1),
        "max_temp_weather": round(df["temperature"].max(), 1),
    }

@router.get("/timeline")
def get_timeline(
    sensor: str = Query("weather", pattern="^(weather|fridge|thermostat)$"),
    start_doy: int = Query(1, ge=1, le=365),
    end_doy: int = Query(365, ge=1, le=365),
):
    df = get_df()
    col = SENSOR_COL[sensor]
    mask = (df["doy"] >= start_doy) & (df["doy"] <= end_doy)
    sdf = df[mask].copy()
    daily = sdf.groupby("doy")[col].agg(["mean", "min", "max"]).reset_index()
    atk_daily = sdf[sdf["label"] == 1].groupby("doy")[col].mean().reset_index()
    atk_daily.columns = ["doy", "attack_value"]
    result = daily.merge(atk_daily, on="doy", how="left")
    result["attack_value"] = result["attack_value"].where(result["attack_value"].notna(), None)
    return {
        "sensor": sensor,
        "label": SENSOR_LABEL[sensor],
        "color": COLORS[sensor],
        "data": result.to_dict(orient="records"),
    }

@router.get("/comparison")
def get_comparison(start_doy: int = Query(1), end_doy: int = Query(365)):
    df = get_df()
    mask = (df["doy"] >= start_doy) & (df["doy"] <= end_doy)
    sdf = df[mask]
    result = []
    for name, col, color in [
        ("weather", "temperature", "#5E81AC"),
        ("fridge", "fridge_temperature", "#A3BE8C"),
        ("thermostat", "current_temperature", "#BF616A"),
    ]:
        daily = sdf.groupby("doy")[col].mean().reset_index()
        for _, row in daily.iterrows():
            result.append({
                "doy": int(row["doy"]),
                "sensor": name,
                "label": SENSOR_LABEL[name],
                "value": round(row[col], 2),
                "color": color,
            })
    return {"data": result}

@router.get("/attack-timeline")
def get_attack_timeline():
    df = get_df()
    atk_daily = df[df["label"] == 1].groupby("doy").size().reset_index(name="count")
    norm_daily = df[df["label"] == 0].groupby("doy").size().reset_index(name="count")
    return {
        "attacks": atk_daily.to_dict(orient="records"),
        "normal": norm_daily.to_dict(orient="records"),
        "injection_dates": ["2019-02-15", "2019-06-15", "2019-10-15"],
    }

@router.get("/seasonal")
def get_seasonal(sensor: str = Query("weather", pattern="^(weather|fridge|thermostat)$")):
    df = get_df()
    col = SENSOR_COL[sensor]
    seasons = {"winter": [1, 2, 12], "spring": [3, 4, 5], "summer": [6, 7, 8], "autumn": [9, 10, 11]}
    color_map = {"winter": "#5E81AC", "spring": "#A3BE8C", "summer": "#EBCB8B", "autumn": "#D08770"}
    result = []
    for season, months in seasons.items():
        sdf = df[df["month"].isin(months)]
        profile = sdf.groupby("hour")[col].agg(["mean", "std"]).reset_index()
        for _, row in profile.iterrows():
            result.append({
                "season": season,
                "hour": int(row["hour"]),
                "mean": round(row["mean"], 2),
                "std": round(row["std"], 2),
                "color": color_map[season],
            })
    return {"sensor": sensor, "label": SENSOR_LABEL[sensor], "data": result}

@router.get("/monthly")
def get_monthly(sensor: str = Query("weather", pattern="^(weather|fridge|thermostat)$")):
    df = get_df()
    col = SENSOR_COL[sensor]
    monthly = df.groupby("month")[col].agg(["mean", "min", "max", "std"]).reset_index()
    result = []
    for _, row in monthly.iterrows():
        result.append({
            "month": int(row["month"]),
            "month_name": MONTH_NAMES[int(row["month"]) - 1],
            "mean": round(row["mean"], 2),
            "min": round(row["min"], 2),
            "max": round(row["max"], 2),
            "std": round(row["std"], 2),
        })
    return {"sensor": sensor, "label": SENSOR_LABEL[sensor], "color": COLORS[sensor], "data": result}

@router.get("/monthly-comparison")
def get_monthly_comparison():
    df = get_df()
    result = []
    for name, col, color in [
        ("weather", "temperature", "#5E81AC"),
        ("fridge", "fridge_temperature", "#A3BE8C"),
        ("thermostat", "current_temperature", "#BF616A"),
    ]:
        monthly = df.groupby("month")[col].mean().reset_index()
        for _, row in monthly.iterrows():
            result.append({
                "month": int(row["month"]),
                "month_name": MONTH_NAMES[int(row["month"]) - 1],
                "sensor": name,
                "label": SENSOR_LABEL[name],
                "value": round(row[col], 2),
                "color": color,
            })
    return {"data": result}

@router.get("/distribution")
def get_distribution(sensor: str = Query("weather", pattern="^(weather|fridge|thermostat)$")):
    df = get_df()
    col = SENSOR_COL[sensor]
    norm = df[df["label"] == 0][col].values
    atk = df[df["label"] == 1][col].values
    hist_norm, edges = np.histogram(norm, bins=40)
    hist_atk, _ = np.histogram(atk, bins=edges)
    bin_centers = (edges[:-1] + edges[1:]) / 2
    return {
        "sensor": sensor,
        "label": SENSOR_LABEL[sensor],
        "color": COLORS[sensor],
        "normal": [{"x": round(float(bc), 2), "y": int(hn)} for bc, hn in zip(bin_centers, hist_norm)],
        "attack": [{"x": round(float(bc), 2), "y": int(ha)} for bc, ha in zip(bin_centers, hist_atk)],
    }

@router.get("/fridge-condition")
def get_fridge_condition():
    df = get_df()
    overall = df["temp_condition"].value_counts().to_dict()
    by_month = df.groupby(["month", "temp_condition"]).size().unstack(fill_value=0)
    by_month_pct = by_month.div(by_month.sum(axis=1), axis=0) * 100
    result = {"overall": {}, "monthly": []}
    for cond, count in overall.items():
        result["overall"][cond] = {
            "count": int(count),
            "pct": round(count / len(df) * 100, 1),
            "color": {"high": "#BF616A", "medium": "#EBCB8B", "low": "#A3BE8C"}.get(cond, "#4C566A"),
        }
    for month in range(1, 13):
        row = {"month": month, "month_name": MONTH_NAMES[month - 1]}
        for cond in ["high", "medium", "low"]:
            val = float(by_month_pct.loc[month, cond]) if cond in by_month_pct.columns else 0
            row[cond] = round(val, 1)
        result["monthly"].append(row)
    return result

@router.get("/thermostat-status")
def get_thermostat_status():
    df = get_df()
    by_hour = df.groupby("hour")["thermostat_status"].mean().reset_index()
    by_hour.columns = ["hour", "active_pct"]
    by_hour["active_pct"] = (by_hour["active_pct"] * 100).round(1)
    by_month = df.groupby("month")["thermostat_status"].mean().reset_index()
    by_month.columns = ["month", "active_pct"]
    by_month["active_pct"] = (by_month["active_pct"] * 100).round(1)
    by_month["month_name"] = by_month["month"].apply(lambda m: MONTH_NAMES[m - 1])
    return {
        "by_hour": by_hour.to_dict(orient="records"),
        "by_month": by_month.to_dict(orient="records"),
    }

@router.get("/correlation")
def get_correlation():
    df = get_df()
    cols = ["temperature", "fridge_temperature", "current_temperature",
            "hour_sin", "hour_cos", "season_sin", "season_cos"]
    labels = ["Weather", "Fridge", "Thermostat", "Hour Sin", "Hour Cos", "Season Sin", "Season Cos"]
    corr = df[cols].corr(method="pearson").round(3)
    result = {"labels": labels, "matrix": []}
    for i, row_label in enumerate(labels):
        row_data = []
        for j, col_label in enumerate(labels):
            row_data.append(float(corr.iloc[i, j]))
        result["matrix"].append({"label": row_label, "values": row_data})
    return result

@router.get("/ml-performance")
def get_ml_performance():
    from sklearn.ensemble import IsolationForest
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import classification_report, confusion_matrix, roc_auc_score
    df = get_df()
    ml_feats = ["temperature", "fridge_temperature", "current_temperature",
                "hour_sin", "hour_cos", "season_sin", "season_cos"]
    normal = df[df["label"] == 0]
    train_n = normal.sample(min(20000, len(normal)), random_state=42)
    scaler = StandardScaler()
    X_train = scaler.fit_transform(train_n[ml_feats])
    iso = IsolationForest(contamination=0.05, n_estimators=200, random_state=42, n_jobs=-1)
    iso.fit(X_train)
    eval_n = normal.sample(min(5000, len(normal)), random_state=42)
    eval_a = df[df["label"] == 1].sample(min(5000, (df["label"] == 1).sum()), random_state=42)
    eval_df = pd.concat([eval_n, eval_a]).sample(frac=1, random_state=42)
    X_eval = scaler.transform(eval_df[ml_feats])
    y_true = eval_df["label"].values
    scores = -iso.score_samples(X_eval)
    y_pred = (iso.predict(X_eval) == -1).astype(int)
    cm = confusion_matrix(y_true, y_pred)
    roc_auc = round(roc_auc_score(y_true, scores), 3)
    rep = classification_report(y_true, y_pred, target_names=["Normal", "Attaque"], output_dict=True)
    fi = np.zeros(len(ml_feats))
    for est in iso.estimators_:
        fi += est.feature_importances_
    fi = (fi / len(iso.estimators_)).tolist()
    feat_imp = [{"feature": ml_feats[i], "importance": round(fi[i], 4)} for i in range(len(ml_feats))]
    feat_imp.sort(key=lambda x: x["importance"], reverse=True)
    return {
        "roc_auc": roc_auc,
        "confusion_matrix": {"tn": int(cm[0, 0]), "fp": int(cm[0, 1]),
                              "fn": int(cm[1, 0]), "tp": int(cm[1, 1])},
        "classification_report": rep,
        "feature_importance": feat_imp,
        "score_distribution": {
            "normal": [round(float(s), 4) for s in scores[y_true == 0][:200]],
            "attack": [round(float(s), 4) for s in scores[y_true == 1][:200]],
        },
    }

@router.get("/distributions-comparison")
def get_distributions_comparison():
    df = get_df()
    result = []
    for name, col, color in [
        ("weather", "temperature", "#5E81AC"),
        ("fridge", "fridge_temperature", "#A3BE8C"),
        ("thermostat", "current_temperature", "#BF616A"),
    ]:
        norm = df[df["label"] == 0][col].values
        atk = df[df["label"] == 1][col].values
        hn, edges = np.histogram(norm, bins=30)
        ha, _ = np.histogram(atk, bins=edges)
        centers = ((edges[:-1] + edges[1:]) / 2).tolist()
        result.append({
            "sensor": name,
            "label": SENSOR_LABEL[name],
            "color": color,
            "bin_centers": [round(c, 2) for c in centers],
            "normal": [int(v) for v in hn],
            "attack": [int(v) for v in ha],
        })
    return {"data": result}
