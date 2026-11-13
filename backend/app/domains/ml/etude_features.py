# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/domains/ml/etude_features.py
#   FEATURES MULTIVARIÉES (météo, frigo, thermostat) et seuil max-F1, utilisés par les scripts
#   d'étude (scripts/transmission_study.py). Repris de l'ancien module phase2.
# ══════════════════════════════════════════════════════════════════════════
import numpy as np
import pandas as pd
from sklearn.metrics import precision_recall_curve
from sklearn.preprocessing import LabelEncoder

FEATURE_COLS = [
    "weather_temp", "fridge_temp", "thermostat_temp",
    "weather_diff_1", "weather_roll_mean_10", "weather_roll_std_10",
    "fridge_diff_1", "fridge_roll_mean_10", "fridge_roll_std_10",
    "thermostat_diff_1", "thermostat_roll_mean_10", "thermostat_roll_std_10",
    "weather_fridge_diff", "weather_thermostat_diff", "fridge_thermostat_diff",
    "hour_sin", "hour_cos", "season_sin", "season_cos",
    "fridge_cond_enc", "thermo_status",
]


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    d = df.copy().sort_values("datetime").reset_index(drop=True)

    temp_cols = {
        "weather": "weather_temp",
        "fridge": "fridge_temp",
        "thermostat": "thermostat_temp",
    }
    for prefix, col in temp_cols.items():
        if col in d.columns:
            d[f"{prefix}_diff_1"] = d[col].diff(1)
            d[f"{prefix}_roll_mean_10"] = d[col].rolling(10, min_periods=1).mean()
            d[f"{prefix}_roll_std_10"] = d[col].rolling(10, min_periods=1).std(ddof=0)

    if "weather_temp" in d.columns and "fridge_temp" in d.columns:
        d["weather_fridge_diff"] = d["weather_temp"] - d["fridge_temp"]
    if "weather_temp" in d.columns and "thermostat_temp" in d.columns:
        d["weather_thermostat_diff"] = d["weather_temp"] - d["thermostat_temp"]
    if "fridge_temp" in d.columns and "thermostat_temp" in d.columns:
        d["fridge_thermostat_diff"] = d["fridge_temp"] - d["thermostat_temp"]

    dt = pd.to_datetime(d["datetime"])
    hour = dt.dt.hour + dt.dt.minute / 60
    doy = dt.dt.dayofyear
    d["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    d["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    d["season_sin"] = np.sin(2 * np.pi * doy / 365)
    d["season_cos"] = np.cos(2 * np.pi * doy / 365)

    # Encodage identique au notebook : LabelEncoder sur temp_condition, conversion numérique de
    # thermostat_status. Repli 0/1 si les colonnes sources sont absentes.
    if "fridge_cond" in d.columns:
        le = LabelEncoder()
        d["fridge_cond_enc"] = le.fit_transform(d["fridge_cond"].astype(str).fillna("unknown"))
    else:
        d["fridge_cond_enc"] = 0.0

    if "thermo_status" in d.columns:
        d["thermo_status"] = pd.to_numeric(d["thermo_status"], errors="coerce").fillna(0).astype(float)
    else:
        d["thermo_status"] = 1.0

    for c in FEATURE_COLS:
        if c not in d.columns:
            d[c] = 0.0
    d = d.replace([np.inf, -np.inf], np.nan)
    d[FEATURE_COLS] = d[FEATURE_COLS].fillna(0)
    return d


def best_f1_threshold(y_true, scores) -> float:
    """Seuil qui maximise le F1 sur la courbe Précision-Rappel."""
    y = np.asarray(y_true)
    s = np.nan_to_num(np.asarray(scores), nan=0.0)
    prec, rec, thr = precision_recall_curve(y, s)
    with np.errstate(divide="ignore", invalid="ignore"):
        f1s = 2 * prec * rec / (prec + rec + 1e-12)
    best = int(np.argmax(f1s[:-1])) if len(f1s) > 1 else 0
    return float(thr[best]) if len(thr) > best else 0.5
