import os, json, joblib, numpy as np, pandas as pd
import asyncio
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Query
from typing import Optional

_executor = ThreadPoolExecutor(max_workers=2)

router = APIRouter()

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
MODELS_DIR = os.path.join(BASE, "phase2", "Data", "Processed", "models")
DATA_DIR = os.path.join(BASE, "phase2", "Data", "Processed")

_cache: dict = {}

FEATURE_MAP = {
    "weather": ["temperature", "diff_1", "roll_mean_10", "roll_std_10", "hour_sin", "hour_cos", "season_sin", "season_cos"],
    "fridge": ["fridge_temperature", "diff_1", "roll_mean_10", "roll_std_10", "hour_sin", "hour_cos", "season_sin", "season_cos", "condition_enc"],
    "thermostat": ["current_temperature", "diff_1", "roll_mean_10", "roll_std_10", "hour_sin", "hour_cos", "season_sin", "season_cos", "thermostat_status"],
}

TEMP_COL = {
    "weather": "temperature",
    "fridge": "fridge_temperature",
    "thermostat": "current_temperature",
}

SEASONS = {"hiver": 1, "printemps": 2, "ete": 3, "automne": 4}

def _ensure_cached(sensor: str):
    key = f"full_{sensor}"
    if key in _cache:
        return _cache[key]

    path = os.path.join(DATA_DIR, f"{sensor}_inferred.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        df = pd.DataFrame(raw)
        df["datetime"] = pd.to_datetime(df["datetime"])
        if "temperature" not in df.columns:
            os.remove(path)
        else:
            _cache[key] = df
            return df

    df = pd.read_csv(os.path.join(DATA_DIR, f"{sensor}_features_concat.csv"), parse_dates=["datetime"])
    df = df.sort_values("datetime").reset_index(drop=True)

    model_path = os.path.join(MODELS_DIR, f"if_concat_{sensor}.pkl")
    scaler_path = os.path.join(MODELS_DIR, f"scaler_concat_{sensor}.pkl")
    if os.path.exists(model_path) and os.path.exists(scaler_path):
        model = joblib.load(model_path)
        scaler = joblib.load(scaler_path)
        feature_cols = FEATURE_MAP[sensor]
        X = df[feature_cols].fillna(0).values
        X_s = scaler.transform(X)
        p = model.predict(X_s)
        s = -model.decision_function(X_s)
        df["prediction"] = np.where(p == -1, 1, 0)
        df["anomaly_score"] = s
    else:
        df["prediction"] = 0
        df["anomaly_score"] = 0.0

    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp_col = TEMP_COL[sensor]
    subset = df[["datetime", temp_col, "label", "prediction", "anomaly_score"]].copy()
    subset.rename(columns={temp_col: "temperature"}, inplace=True)
    subset["datetime"] = subset["datetime"].dt.strftime("%Y-%m-%dT%H:%M:%S")
    subset.to_json(path, orient="records", force_ascii=False)
    df["datetime"] = pd.to_datetime(df["datetime"])
    _cache[key] = df
    return df


@router.get("/phase2/timeline")
async def get_phase2_timeline(
    sensor: str = Query("weather", pattern="^(weather|fridge|thermostat)$"),
    season: Optional[str] = Query(None, pattern="^(hiver|printemps|ete|automne)$"),
    month: Optional[int] = Query(None, ge=1, le=12),
    day: Optional[int] = Query(None, ge=1, le=31),
    shift: Optional[str] = Query(None, pattern="^(matin|apres-midi|nuit)$"),
    day_type: Optional[str] = Query(None, pattern="^(ouvre|weekend)$"),
    start_hour: Optional[int] = Query(None, ge=0, le=23),
    end_hour: Optional[int] = Query(None, ge=0, le=23),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    limit: int = Query(5000, ge=100, le=100000),
):
    try:
        loop = asyncio.get_event_loop()
        df = await loop.run_in_executor(_executor, _ensure_cached, sensor)

        valid_mask = pd.Series(True, index=df.index)

        if season:
            season_val = SEASONS[season]
            df["_season"] = ((df["datetime"].dt.month % 12 + 3) // 3).map({1: 4, 2: 1, 3: 2, 4: 3})
            valid_mask &= (df["_season"] == season_val)

        if month:
            valid_mask &= (df["datetime"].dt.month == month)

        if day:
            valid_mask &= (df["datetime"].dt.day == day)

        if shift:
            h = df["datetime"].dt.hour
            if shift == "matin":
                valid_mask &= (h >= 6) & (h < 14)
            elif shift == "apres-midi":
                valid_mask &= (h >= 14) & (h < 22)
            elif shift == "nuit":
                valid_mask &= (h >= 22) | (h < 6)

        if day_type:
            dow = df["datetime"].dt.dayofweek
            if day_type == "ouvre":
                valid_mask &= (dow < 5)
            elif day_type == "weekend":
                valid_mask &= (dow >= 5)

        if start_hour is not None:
            valid_mask &= (df["datetime"].dt.hour >= start_hour)

        if end_hour is not None:
            valid_mask &= (df["datetime"].dt.hour <= end_hour)

        if start_date:
            valid_mask &= (df["datetime"] >= pd.Timestamp(start_date))

        if end_date:
            valid_mask &= (df["datetime"] <= pd.Timestamp(end_date))

        df_filtered = df[valid_mask].copy()

        if len(df_filtered) == 0:
            return {"error": "No data matching filters", "points": [], "summary": {}}

        step = max(1, len(df_filtered) // limit)
        df_sample = df_filtered.iloc[::step].reset_index(drop=True)

        points = []
        has_temp = "temperature" in df_sample.columns
        for _, row in df_sample.iterrows():
            temp_val = float(row["temperature"]) if has_temp and not pd.isna(row["temperature"]) else None
            points.append({
                "datetime": row["datetime"].isoformat(),
                "temperature": temp_val,
                "actual_label": int(row["label"]),
                "prediction": int(row["prediction"]),
                "anomaly_score": float(row["anomaly_score"]),
                "tp": int(row["label"] == 1 and row["prediction"] == 1),
                "fp": int(row["label"] == 0 and row["prediction"] == 1),
                "fn": int(row["label"] == 1 and row["prediction"] == 0),
                "tn": int(row["label"] == 0 and row["prediction"] == 0),
            })

        total = len(df_filtered)
        n_attack = int(df_filtered["label"].sum().item())
        n_normal = total - n_attack
        n_detected = int(((df_filtered["label"] == 1) & (df_filtered["prediction"] == 1)).sum().item())
        n_fp = int(((df_filtered["label"] == 0) & (df_filtered["prediction"] == 1)).sum().item())
        n_fn = int(((df_filtered["label"] == 1) & (df_filtered["prediction"] == 0)).sum().item())

        recall = n_detected / n_attack if n_attack > 0 else 0
        precision = n_detected / (n_detected + n_fp) if (n_detected + n_fp) > 0 else 0
        fpr = n_fp / n_normal if n_normal > 0 else 0

        return {
            "sensor": sensor,
            "points": points,
            "total_points": total,
            "summary": {
                "total": total,
                "normal": n_normal,
                "attack": n_attack,
                "detected": n_detected,
                "fp": n_fp,
                "fn": n_fn,
                "recall": round(recall, 4),
                "precision": round(precision, 4),
                "fpr": round(fpr, 4),
            },
            "filters_applied": {
                "season": season,
                "month": month,
                "day": day,
                "shift": shift,
                "day_type": day_type,
                "start_hour": start_hour,
                "end_hour": end_hour,
                "start_date": start_date,
                "end_date": end_date,
            },
        }
    except Exception as e:
        return {"error": str(e), "type": type(e).__name__}
