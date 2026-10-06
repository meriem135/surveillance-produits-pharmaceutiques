"""
Feature engineering multivarie — aligne sur ml_service.py (21 features)
======================================================================
Produit exactement les 21 colonnes attendues par le modele multivarie (OCSVM) :
  3 temperatures, 3 diff_1, 6 rolling (mean/std x 3),
  3 cross-sensor diffs, 4 cyclic (hour/season sin/cos),
  fridge_cond_enc, thermo_status
"""

import numpy as np
import pandas as pd
from collections import deque
from datetime import datetime

WINDOW = 10

MULTIVAR_FEATURE_COLS = [
    "weather_temp", "fridge_temp", "thermostat_temp",
    "weather_diff_1", "weather_roll_mean_10", "weather_roll_std_10",
    "fridge_diff_1", "fridge_roll_mean_10", "fridge_roll_std_10",
    "thermostat_diff_1", "thermostat_roll_mean_10", "thermostat_roll_std_10",
    "weather_fridge_diff", "weather_thermostat_diff", "fridge_thermostat_diff",
    "hour_sin", "hour_cos", "season_sin", "season_cos",
    "fridge_cond_enc", "thermo_status",
]

# Encodages categoriels identiques a ceux du dataset d'entrainement
# (scripts/build_dataset.py : temp_condition = "high" si frigo > 8 °C, encode
# par LabelEncoder -> high=0 / low=1 ; statut thermostat = 1 si |T - 24| > 1.5).
def fridge_cond_encoding(fridge_temp: float) -> float:
    return 0.0 if fridge_temp > 8.0 else 1.0


def thermo_status_encoding(thermostat_temp: float) -> float:
    return 1.0 if abs(thermostat_temp - 24.0) > 1.5 else 0.0


_weather_buf: deque = deque(maxlen=WINDOW)
_fridge_buf: deque = deque(maxlen=WINDOW)
_thermostat_buf: deque = deque(maxlen=WINDOW)


def _get_ts(row_or_now):
    if isinstance(row_or_now, datetime):
        return row_or_now
    if isinstance(row_or_now, pd.Timestamp):
        return row_or_now.to_pydatetime()
    return datetime.now()


def _cyclic(dt: datetime):
    hour = dt.hour + dt.minute / 60
    doy = dt.timetuple().tm_yday
    return (
        float(np.sin(2 * np.pi * hour / 24)),
        float(np.cos(2 * np.pi * hour / 24)),
        float(np.sin(2 * np.pi * doy / 365)),
        float(np.cos(2 * np.pi * doy / 365)),
    )


def engineer_multivar_features(
    weather_temp: float,
    fridge_temp: float,
    thermostat_temp: float,
    timestamp=None,
) -> dict:
    """Construit les 21 features multivariees (sliding window, backward-looking)."""
    if timestamp is None:
        timestamp = datetime.now()
    elif isinstance(timestamp, str):
        timestamp = datetime.fromisoformat(timestamp)

    ts = _get_ts(timestamp)

    fts = {}
    fts["weather_temp"] = weather_temp
    fts["fridge_temp"] = fridge_temp
    fts["thermostat_temp"] = thermostat_temp

    if len(_weather_buf) >= 1:
        fts["weather_diff_1"] = weather_temp - _weather_buf[-1]
        fts["fridge_diff_1"] = fridge_temp - _fridge_buf[-1]
        fts["thermostat_diff_1"] = thermostat_temp - _thermostat_buf[-1]
    else:
        fts["weather_diff_1"] = 0.0
        fts["fridge_diff_1"] = 0.0
        fts["thermostat_diff_1"] = 0.0

    # Fenetre glissante backward-looking exactement WINDOW=10 valeurs (current inclus)
    w_win = (list(_weather_buf) + [weather_temp])[-WINDOW:]
    f_win = (list(_fridge_buf) + [fridge_temp])[-WINDOW:]
    t_win = (list(_thermostat_buf) + [thermostat_temp])[-WINDOW:]

    fts["weather_roll_mean_10"] = float(np.mean(w_win))
    fts["weather_roll_std_10"] = float(np.std(w_win))
    fts["fridge_roll_mean_10"] = float(np.mean(f_win))
    fts["fridge_roll_std_10"] = float(np.std(f_win))
    fts["thermostat_roll_mean_10"] = float(np.mean(t_win))
    fts["thermostat_roll_std_10"] = float(np.std(t_win))

    fts["weather_fridge_diff"] = weather_temp - fridge_temp
    fts["weather_thermostat_diff"] = weather_temp - thermostat_temp
    fts["fridge_thermostat_diff"] = fridge_temp - thermostat_temp

    hour_sin, hour_cos, season_sin, season_cos = _cyclic(ts)
    fts["hour_sin"] = hour_sin
    fts["hour_cos"] = hour_cos
    fts["season_sin"] = season_sin
    fts["season_cos"] = season_cos

    fts["fridge_cond_enc"] = fridge_cond_encoding(fridge_temp)
    fts["thermo_status"] = thermo_status_encoding(thermostat_temp)

    _weather_buf.append(weather_temp)
    _fridge_buf.append(fridge_temp)
    _thermostat_buf.append(thermostat_temp)

    return fts


def engineer_residual_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compat : construit les 21 features multivariees a partir d'un DataFrame."""
    rows = []
    for _, row in df.iterrows():
        wt = float(row.get("temperature", row.get("weather_temp", 25)))
        ft = float(row.get("fridge_temperature", row.get("fridge_temp", 5)))
        tt = float(row.get("current_temperature", row.get("thermostat_temp", 25)))
        ts_val = row.get("datetime", None)
        if ts_val is not None:
            ts_val = pd.to_datetime(ts_val).to_pydatetime()
        fts = engineer_multivar_features(wt, ft, tt, ts_val)
        rows.append(fts)
    result = pd.DataFrame(rows)
    for c in MULTIVAR_FEATURE_COLS:
        if c not in result.columns:
            result[c] = 0.0
        else:
            result[c] = result[c].fillna(0)
    return result[MULTIVAR_FEATURE_COLS]
