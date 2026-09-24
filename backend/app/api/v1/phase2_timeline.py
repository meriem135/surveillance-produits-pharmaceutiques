import os, json, joblib, numpy as np, pandas as pd
import asyncio
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Query
from typing import Optional

_executor = ThreadPoolExecutor(max_workers=2)

router = APIRouter()

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
DATA_DIR = os.path.join(BASE, "phase2", "Data", "Processed")
MODELS_ROOT = os.path.join(DATA_DIR, "models")

_cache: dict = {}

MV_FEATURE_COLS = [
    "weather_temp", "fridge_temp", "thermostat_temp",
    "weather_diff_1", "weather_roll_mean_10", "weather_roll_std_10",
    "fridge_diff_1", "fridge_roll_mean_10", "fridge_roll_std_10",
    "thermostat_diff_1", "thermostat_roll_mean_10", "thermostat_roll_std_10",
    "weather_fridge_diff", "weather_thermostat_diff", "fridge_thermostat_diff",
    "hour_sin", "hour_cos", "season_sin", "season_cos",
    "fridge_cond_enc", "thermo_status",
]

SEASONS = {"hiver": 1, "printemps": 2, "ete": 3, "automne": 4}


def _num(v):
    try:
        f = float(v)
        return round(f, 4) if f == f else None
    except Exception:
        return None


_attack_cache = {"df": None}


def _load_attack_dataset():
    """Version enrichie du dataset pour le dataset des attaques : lit
    merged_3_sensors.csv (21 features) et y ajoute prediction/anomaly_score
    calculés par _ensure_cached (fusion sur datetime)."""
    if _attack_cache["df"] is not None:
        return _attack_cache["df"]

    mv_path = os.path.join(DATA_DIR, "merged_3_sensors.csv")
    if not os.path.exists(mv_path):
        _attack_cache["df"] = None
        return None

    df = pd.read_csv(mv_path, parse_dates=["datetime"])
    df = df.sort_values("datetime").reset_index(drop=True)

    base = _ensure_cached()
    if base is not None:
        base = base[["datetime", "prediction", "anomaly_score"]].copy()
        df = df.merge(base, on="datetime", how="left")
        df["prediction"] = df["prediction"].fillna(0).astype(int)
        df["anomaly_score"] = df["anomaly_score"].fillna(0.0)

    df["label"] = df["label"].astype(int)
    _attack_cache["df"] = df
    return df


def _build_mv_features(mv: pd.DataFrame) -> pd.DataFrame:
    dt = mv["datetime"]
    hour = dt.dt.hour + dt.dt.minute / 60
    doy = dt.dt.dayofyear
    mv["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    mv["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    mv["season_sin"] = np.sin(2 * np.pi * doy / 365)
    mv["season_cos"] = np.cos(2 * np.pi * doy / 365)
    for prefix, col in [("weather", "weather_temp"), ("fridge", "fridge_temp"), ("thermostat", "thermostat_temp")]:
        mv[f"{prefix}_diff_1"] = mv[col].diff(1)
        mv[f"{prefix}_roll_mean_10"] = mv[col].rolling(10, min_periods=1).mean()
        mv[f"{prefix}_roll_std_10"] = mv[col].rolling(10, min_periods=1).std(ddof=0)
    mv["weather_fridge_diff"] = mv["weather_temp"] - mv["fridge_temp"]
    mv["weather_thermostat_diff"] = mv["weather_temp"] - mv["thermostat_temp"]
    mv["fridge_thermostat_diff"] = mv["fridge_temp"] - mv["thermostat_temp"]
    # Constantes alignees sur l'inference de production (feature_engineer.py :
    # fridge_cond_enc=0, thermo_status=1). Le modele a ete entraine avec ces valeurs.
    mv["fridge_cond_enc"] = 0.0
    mv["thermo_status"] = 1.0
    return mv


def _ensure_cached():
    key = "full_multivarie"
    if key in _cache:
        return _cache[key]

    path = os.path.join(DATA_DIR, "multivarie_inferred_ocsvm.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        df = pd.DataFrame(raw)
        df["datetime"] = pd.to_datetime(df["datetime"])
        _cache[key] = df
        return df

    mv_path = os.path.join(DATA_DIR, "merged_3_sensors.csv")
    if not os.path.exists(mv_path):
        return None

    df = pd.read_csv(mv_path, parse_dates=["datetime"])
    df = df.sort_values("datetime").reset_index(drop=True)

    for col in ["weather_temp", "fridge_temp", "thermostat_temp"]:
        if col not in df.columns:
            alias = {"weather_temp": "temperature", "fridge_temp": "fridge_temperature", "thermostat_temp": "current_temperature"}
            if alias.get(col) in df.columns:
                df[col] = df[alias[col]]
            else:
                df[col] = 0.0

    if "label" not in df.columns:
        df["label"] = 0

    df = _build_mv_features(df)
    df = df.dropna(subset=MV_FEATURE_COLS).reset_index(drop=True)

    model_path = os.path.join(MODELS_ROOT, "ocsvm_multivarie.pkl")
    scaler_path = os.path.join(MODELS_ROOT, "scaler_ocsvm.pkl")
    if os.path.exists(model_path) and os.path.exists(scaler_path):
        model = joblib.load(model_path)
        scaler = joblib.load(scaler_path)
        X = df[MV_FEATURE_COLS].fillna(0).values
        X_s = scaler.transform(X)
        p = model.predict(X_s)
        s = -model.decision_function(X_s)
        df["prediction"] = np.where(p == -1, 1, 0)
        df["anomaly_score"] = s
    else:
        df["prediction"] = 0
        df["anomaly_score"] = 0.0

    os.makedirs(os.path.dirname(path), exist_ok=True)
    subset = df[["datetime", "weather_temp", "fridge_temp", "thermostat_temp", "label", "prediction", "anomaly_score"]].copy()
    subset["datetime"] = subset["datetime"].dt.strftime("%Y-%m-%dT%H:%M:%S")
    subset.to_json(path, orient="records", force_ascii=False)
    df["datetime"] = pd.to_datetime(df["datetime"])
    _cache[key] = df
    return df


@router.get("/phase2/attack-dataset")
async def get_attack_dataset(
    season: Optional[str] = Query(None, pattern="^(hiver|printemps|ete|automne)$"),
    month: Optional[int] = Query(None, ge=1, le=12),
    doy: Optional[int] = Query(None, ge=1, le=365),
    hour: Optional[int] = Query(None, ge=0, le=23),
    only_attacks: bool = Query(True, description="Ne renvoyer que les attaques bien detecTEES par le modele (label=1 ET prediction=1)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=5, le=200),
):
    """Liste paginée des points du dataset (attaques réelles par défaut),
    filtrable par saison / mois / jour (1-365) / heure — mêmes filtres que la page SHAP."""
    try:
        loop = asyncio.get_event_loop()
        df = await loop.run_in_executor(_executor, _load_attack_dataset)

        if df is None or "datetime" not in df.columns:
            return {"available": False, "error": "Données introuvables", "rows": [], "total": 0}

        df = df.copy()
        df["_doy"] = df["datetime"].dt.dayofyear
        df["_month"] = df["datetime"].dt.month
        df["_hour"] = df["datetime"].dt.hour

        valid_mask = pd.Series(True, index=df.index)

        if season:
            season_val = SEASONS[season]
            df["_season"] = ((df["datetime"].dt.month % 12 + 3) // 3).map({1: 4, 2: 1, 3: 2, 4: 3})
            valid_mask &= (df["_season"] == season_val)
        if month is not None:
            valid_mask &= (df["_month"] == month)
        if doy is not None:
            valid_mask &= (df["_doy"] == doy)
        if hour is not None:
            valid_mask &= (df["_hour"] == hour)
        if only_attacks and "label" in df.columns and "prediction" in df.columns:
            valid_mask &= (df["label"] == 1) & (df["prediction"] == 1)

        df_f = df[valid_mask]
        total = int(len(df_f))
        if total == 0:
            return {
                "available": True,
                "rows": [],
                "total": 0,
                "page": page,
                "page_size": page_size,
                "total_pages": 0,
                "filters_applied": {"season": season, "month": month, "doy": doy, "hour": hour, "only_attacks": only_attacks},
            }

        start = (page - 1) * page_size
        df_page = df_f.iloc[start:start + page_size]

        rows = []
        for _, row in df_page.iterrows():
            sensor_values = None
            if all(c in df.columns for c in ("weather_temp", "fridge_temp", "thermostat_temp")):
                sensor_values = {
                    "weather": _num(row.get("weather_temp")),
                    "fridge": _num(row.get("fridge_temp")),
                    "thermostat": _num(row.get("thermostat_temp")),
                }
            rows.append({
                "datetime": row["datetime"].isoformat(),
                "weather_temp": _num(row.get("weather_temp")),
                "fridge_temp": _num(row.get("fridge_temp")),
                "thermostat_temp": _num(row.get("thermostat_temp")),
                "weather_fridge_diff": _num(row.get("weather_fridge_diff")),
                "weather_thermostat_diff": _num(row.get("weather_thermostat_diff")),
                "fridge_thermostat_diff": _num(row.get("fridge_thermostat_diff")),
                "label": int(row.get("label", 0)),
                "prediction": int(row.get("prediction", 0)),
                "anomaly_score": _num(row.get("anomaly_score")),
                "sensor_values": sensor_values,
            })

        def _season_label(m):
            return {1: "hiver", 2: "hiver", 3: "printemps", 4: "printemps", 5: "printemps",
                    6: "ete", 7: "ete", 8: "ete", 9: "automne", 10: "automne", 11: "automne", 12: "hiver"}.get(m, "")

        summary = {}
        if "label" in df.columns and len(df_f) > 0:
            n_attack = int(df_f["label"].sum())
            n_normal = total - n_attack
            n_detected = int(((df_f["label"] == 1) & (df_f["prediction"] == 1)).sum()) if "prediction" in df.columns else 0
            summary = {
                "total": total,
                "normal": n_normal,
                "attack": n_attack,
                "detected": n_detected,
                "recall": round(n_detected / n_attack, 4) if n_attack > 0 else 0,
            }

        return {
            "available": True,
            "rows": rows,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, -(-total // page_size)),
            "summary": summary,
            "filters_applied": {"season": season, "month": month, "doy": doy, "hour": hour, "only_attacks": only_attacks},
        }
    except Exception as e:
        return {"available": False, "error": str(e), "type": type(e).__name__}


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
        df = await loop.run_in_executor(_executor, _ensure_cached)

        if df is None:
            return {"error": "Donnees introuvables (merged_3_sensors.csv)", "points": [], "summary": {}}

        temp_col = {"weather": "weather_temp", "fridge": "fridge_temp", "thermostat": "thermostat_temp"}[sensor]
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
        for _, row in df_sample.iterrows():
            temp_val = float(row[temp_col]) if temp_col in row and not pd.isna(row[temp_col]) else None
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
