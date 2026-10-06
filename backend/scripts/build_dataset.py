"""
Construction du dataset d'entraînement et du flux de démonstration
==================================================================
Reproduit, à partir des seules traces brutes TON_IoT versionnées dans
`notebook/Raw/`, les fichiers attendus par le backend :

  data/processed/{weather,fridge,thermostat}_concat.csv   traces réelles normales nettoyées
  data/processed/dataset_fusionne.csv                     année 2019 fusionnée (3 capteurs, 5 min)
  data/generated/extraits_saisonniers_fusionne.csv        flux de démo Hiver → Automne

Méthode (celle des notebooks Generation_Annuelle + Pipeline_Phase2_Complet) :

1. Nettoyage des traces normales réelles (≈ 3,8 jours, 31/03 → 04/04/2019).
2. Génération d'une année 2019 au pas de 5 minutes :
   météo = niveau de base + saisonnalité de Fourier (3 harmoniques)
         + profil journalier extrait des données réelles (déformé selon la saison)
         + bruit AR(1) + événements extrêmes rares (loi GEV, restent « normaux ») ;
   frigo et thermostat couplés physiquement à la météo.
3. Injection d'attaques (label = 1, colonne `attack_type`) :
   a) rejeu des 9 traces d'attaque TON_IoT sur les 3 capteurs, à 3 périodes
      (février, juin, octobre), épisodes de 12 h ;
   b) MITM « frigo figé » : la mesure du frigo est bloquée (rejouée) 1 à 3 h ;
   c) Injection « plausible » : valeurs forgées autour de 7 °C, décorrélées de
      la météo, 3 à 6 h. Météo et thermostat ne sont jamais modifiés en (b)/(c).
4. Les 21 features multivariées sont calculées par la même fonction que
   l'entraînement (`app.api.v1.phase2._engineer_features`).

Usage :  cd backend && .venv/bin/python scripts/build_dataset.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import genextreme

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import paths  # noqa: E402

SEED = 42
FREQ = "5min"
YEAR = 2019

# Niveau moyen de la météo et couplage physique (Generation_Annuelle.ipynb).
WEATHER_BASE = 25.0
FRIDGE_SETPOINT, FRIDGE_COUPLING, FRIDGE_NOISE = 7.0, 0.10, 0.5
THERMO_SETPOINT, THERMO_COUPLING, THERMO_NOISE = 24.0, 0.12, 0.3
WEATHER_AR1_PHI, WEATHER_AR1_STD = 0.90, 0.5
EXTREME_EVENT_RATE = 0.001

REPLAY_ROUNDS = (2, 6, 10)          # mois des 3 vagues de rejeu TON_IoT
REPLAY_STEPS = 144                  # 12 h au pas de 5 min
REPLAY_SPACING_DAYS = 3

ATTACK_FOLDERS = {
    "IoT_DDoS_normal": "IoT_DDoS_normal",
    "IoT_DoS_normal": "IoT_DoS_normal",
    "IoT_Injection_normal": "IoT_Injection_normal",
    "IoT_MITM_normal": "IoT_MITM_normal",
    "IoT_XSS_normal": "IoT_XSS_normal",
    "IoT_backdoor_normal": "IoT_backdoor_normal",
    "IoT_password_normal": "IoT_password_normal",
    "IoT_runsomware_normal": "IoT_ransomware_normal",   # dossier source mal orthographié
    "IoT_scanning_normal": "IoT_scanning_normal",
}
MITM_FREEZE = "MITM_fridge_freeze"
INJECTION_PLAUSIBLE = "Injection_fridge_plausible"

SEASON_OF_MONTH = {12: 1, 1: 1, 2: 1, 3: 2, 4: 2, 5: 2, 6: 3, 7: 3, 8: 3, 9: 4, 10: 4, 11: 4}


def log(msg: str) -> None:
    print(msg, flush=True)


# ════════════════════════════════════════════════════════════════════════════
# 1. Traces brutes
# ════════════════════════════════════════════════════════════════════════════

def _clean_columns(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = [str(c).replace("﻿", "").strip().lower() for c in df.columns]
    return df


def _parse_datetime(date: pd.Series, time: pd.Series) -> pd.Series:
    d = date.astype(str).str.strip()
    # Année tronquée dans les fichiers source (« 4 Apr 201 ») -> 2019
    d = d.str.replace(r"(\D)201$", r"\g<1>2019", regex=True)
    t = time.astype(str).str.strip()
    return pd.to_datetime(d + " " + t, format="mixed", dayfirst=True, errors="coerce")


def load_normal_traces() -> dict[str, pd.DataFrame]:
    """Charge et nettoie les 3 fichiers normaux de chaque capteur."""
    specs = {
        "weather": ("IoT_normal_weather_*.csv", "temperature"),
        "fridge": ("IoT_normal_fridge_*.csv", "fridge_temperature"),
        "thermostat": ("IoT_normal_Thermostat_*.csv", "current_temperature"),
    }
    out = {}
    for sensor, (pattern, col) in specs.items():
        frames = []
        for f in sorted(paths.RAW_NORMAL_DIR.glob(pattern)):
            df = _clean_columns(pd.read_csv(f, skipinitialspace=True))
            df["datetime"] = _parse_datetime(df["date"], df["time"])
            frames.append(df.drop(columns=["date", "time"]))
        if not frames:
            raise FileNotFoundError(f"Aucune trace normale {pattern} dans {paths.RAW_NORMAL_DIR}")
        df = pd.concat(frames, ignore_index=True)
        df[col] = pd.to_numeric(df[col], errors="coerce")
        df = df.dropna(subset=["datetime", col]).drop_duplicates("datetime")
        df = df.sort_values("datetime").reset_index(drop=True)
        if sensor == "fridge":
            df["temp_condition"] = df["temp_condition"].astype(str).str.strip().str.lower()
        if sensor == "thermostat":
            status = df.pop("thermostate_status").astype(str).str.strip().str.upper()
            df["thermostat_status"] = (status == "TRUE").astype(int)
        df["label"] = 0
        out[sensor] = df
        log(f"  {sensor:10s} {len(df):>8,} lignes  {df['datetime'].min()} -> {df['datetime'].max()}  "
            f"{col} [{df[col].min():.1f} ; {df[col].max():.1f}]")
    return out


def load_attack_traces() -> dict[str, dict[str, np.ndarray]]:
    """Valeurs de température de chaque trace d'attaque TON_IoT, par capteur."""
    value_cols = {
        "weather": ["temperature"],
        "fridge": ["fridge_temperature"],
        "thermostat": ["current temperature", "current_temperature"],
    }
    traces: dict[str, dict[str, np.ndarray]] = {}
    for folder, attack_type in ATTACK_FOLDERS.items():
        d = paths.RAW_ATTACK_DIR / folder
        if not d.is_dir():
            log(f"  [!] dossier d'attaque absent : {d}")
            continue
        traces[attack_type] = {}
        for f in sorted(d.glob("*.csv")):
            name = f.name.lower()
            sensor = next((s for s in value_cols if s in name), None)
            if sensor is None:
                continue
            try:
                df = _clean_columns(pd.read_csv(f, skipinitialspace=True))
            except Exception as e:  # noqa: BLE001
                log(f"  [!] {f.name} illisible ({e})")
                continue
            col = next((c for c in value_cols[sensor] if c in df.columns), None)
            if col is None:
                continue
            values = pd.to_numeric(df[col], errors="coerce").dropna().to_numpy()
            if len(values) < 10:
                log(f"  [!] {f.name} : trace inexploitable ({len(values)} valeurs), ignorée")
                continue
            traces[attack_type][sensor] = values
        log(f"  {attack_type:24s} capteurs = {sorted(traces[attack_type])}")
    return traces


# ════════════════════════════════════════════════════════════════════════════
# 2. Année normale générée
# ════════════════════════════════════════════════════════════════════════════

def _fourier_seasonal() -> np.ndarray:
    days = np.arange(1, 366)
    s = np.zeros(365)
    for k in range(1, 4):
        s += (6.0 / k) * np.sin(2 * np.pi * k * (days - 80) / 365)
        s += (4.0 / k) * np.cos(2 * np.pi * k * (days - 80) / 365)
    return s - s.mean()


def _daily_profile(weather: pd.DataFrame) -> np.ndarray:
    """Profil jour/nuit (écart à la moyenne, 24 valeurs) extrait des données réelles,
    ramené à une amplitude crête-à-crête de 8 °C (climat méditerranéen)."""
    prof = weather.groupby(weather["datetime"].dt.hour)["temperature"].mean()
    prof = prof.reindex(range(24)).interpolate().bfill().ffill().to_numpy()
    prof = prof - prof.mean()
    span = prof.max() - prof.min()
    return prof * (8.0 / span) if span > 0 else prof


def _warp(day: int, base: np.ndarray) -> np.ndarray:
    amp = 0.6 + 0.4 * np.sin(2 * np.pi * (day - 80) / 365)
    shift = 2 * np.sin(2 * np.pi * (day - 80) / 365)
    hours = np.arange(24)
    return np.interp((hours + shift) % 24, hours, base, period=24) * amp


def _ar1(n: int, phi: float, std: float, rng: np.random.Generator) -> np.ndarray:
    eta = rng.normal(0, std * np.sqrt(1 - phi ** 2), n + 200)
    eps = np.zeros(n + 200)
    for t in range(1, n + 200):
        eps[t] = phi * eps[t - 1] + eta[t]
    return eps[200:]


def generate_year(real: dict[str, pd.DataFrame], rng: np.random.Generator) -> pd.DataFrame:
    idx = pd.date_range(f"{YEAR}-01-01", f"{YEAR}-12-31 23:55", freq=FREQ)
    n = len(idx)
    doy = idx.dayofyear.to_numpy()
    hour = idx.hour.to_numpy() + idx.minute.to_numpy() / 60.0

    seasonal = _fourier_seasonal()[np.minimum(doy, 365) - 1]
    base = _daily_profile(real["weather"])
    daily = np.empty(n)
    for day in np.unique(doy):
        m = doy == day
        daily[m] = np.interp(hour[m], np.arange(25), np.append(_warp(int(day), base), _warp(int(day), base)[0]))
    weather = WEATHER_BASE + seasonal + daily + _ar1(n, WEATHER_AR1_PHI, WEATHER_AR1_STD, rng)

    # Événements météo extrêmes (canicule / coup de froid ponctuels) : restent normaux
    triggers = np.where(rng.random(n) < EXTREME_EVENT_RATE)[0]
    amps = genextreme.rvs(c=0.2, loc=12, scale=4, size=len(triggers), random_state=SEED)
    for i, t in enumerate(triggers):
        sign = 1 if 170 <= doy[t] <= 260 else (-1 if (doy[t] <= 80 or doy[t] >= 340) else rng.choice([-1, 1]))
        weather[t] += sign * amps[i]

    fridge = np.clip(FRIDGE_SETPOINT - FRIDGE_COUPLING * (weather - WEATHER_BASE)
                     + rng.normal(0, FRIDGE_NOISE, n), 0.5, 14.0)
    thermo = np.clip(THERMO_SETPOINT - THERMO_COUPLING * (weather - WEATHER_BASE)
                     + rng.normal(0, THERMO_NOISE, n), 18.0, 32.0)

    return pd.DataFrame({
        "datetime": idx,
        "weather_temp": weather,
        "fridge_temp": fridge,
        "thermostat_temp": thermo,
        "label": 0,
        "attack_type": "normal",
    })


# ════════════════════════════════════════════════════════════════════════════
# 3. Attaques
# ════════════════════════════════════════════════════════════════════════════

def _slot(df: pd.DataFrame, ts: pd.Timestamp) -> int:
    return int(df["datetime"].searchsorted(ts))


def inject_attacks(df: pd.DataFrame, traces: dict, rng: np.random.Generator) -> list[dict]:
    col_of = {"weather": "weather_temp", "fridge": "fridge_temp", "thermostat": "thermostat_temp"}
    episodes = []

    # (a) Rejeu des traces TON_IoT : 3 vagues, un type d'attaque tous les 3 jours
    for month in REPLAY_ROUNDS:
        for i, (attack_type, sensors) in enumerate(traces.items()):
            start = _slot(df, pd.Timestamp(YEAR, month, 1 + i * REPLAY_SPACING_DAYS, 8, 0))
            end = min(start + REPLAY_STEPS, len(df))
            for sensor, values in sensors.items():
                step = max(1, len(values) // REPLAY_STEPS)
                vals = values[::step][: end - start]
                df.loc[start:start + len(vals) - 1, col_of[sensor]] = vals
            df.loc[start:end - 1, ["label", "attack_type"]] = [1, attack_type]
            episodes.append({"attack_type": attack_type, "start": start, "end": end})

    # (b) MITM : le frigo est figé (l'attaquant rejoue la dernière valeur)
    # (c) Injection plausible : valeurs forgées ~7 °C, décorrélées de la météo
    for month in range(1, 13):
        start = _slot(df, pd.Timestamp(YEAR, month, 20, 14, 0))
        length = int(rng.integers(12, 37))            # 1 h à 3 h
        df.loc[start:start + length - 1, "fridge_temp"] = df.at[start - 1, "fridge_temp"]
        df.loc[start:start + length - 1, ["label", "attack_type"]] = [1, MITM_FREEZE]
        episodes.append({"attack_type": MITM_FREEZE, "start": start, "end": start + length})

        start = _slot(df, pd.Timestamp(YEAR, month, 25, 2, 0))
        length = int(rng.integers(36, 73))            # 3 h à 6 h
        forged = FRIDGE_SETPOINT + _ar1(length, 0.3, FRIDGE_NOISE, rng)
        df.loc[start:start + length - 1, "fridge_temp"] = forged
        df.loc[start:start + length - 1, ["label", "attack_type"]] = [1, INJECTION_PLAUSIBLE]
        episodes.append({"attack_type": INJECTION_PLAUSIBLE, "start": start, "end": start + length})

    return episodes


# ════════════════════════════════════════════════════════════════════════════
# 4. Assemblage
# ════════════════════════════════════════════════════════════════════════════

def finalize(df: pd.DataFrame) -> pd.DataFrame:
    from app.api.v1.phase2 import FEATURE_COLS, _engineer_features

    df["fridge_cond"] = np.where(df["fridge_temp"] > 8.0, "high", "low")
    df["thermo_status"] = (np.abs(df["thermostat_temp"] - THERMO_SETPOINT) > 1.5).astype(int)
    featured = _engineer_features(df)
    featured["month"] = featured["datetime"].dt.month
    featured["season"] = featured["month"].map(SEASON_OF_MONTH)
    featured["hour"] = featured["datetime"].dt.hour
    cols = (["datetime", "month", "season", "hour", "fridge_cond"] + FEATURE_COLS
            + ["label", "attack_type"])
    return featured[cols]


def build_stream(data: pd.DataFrame, episodes: list[dict]) -> pd.DataFrame:
    """Flux de démo : pour chaque saison (Hiver → Automne), jusqu'à 3 fenêtres
    de 200 pas autour d'épisodes d'attaque de types différents : d'abord deux
    rejeux TON_IoT (visibles par le DPI), puis une attaque furtive sur le frigo
    (qui illustre la limite des règles)."""
    names = {1: "Hiver", 2: "Printemps", 3: "Été", 4: "Automne"}
    stealth = {MITM_FREEZE, INJECTION_PLAUSIBLE}
    parts = []
    for season in (1, 2, 3, 4):
        in_season = [ep for ep in sorted(episodes, key=lambda e: e["start"])
                     if SEASON_OF_MONTH[int(data.at[ep["start"], "month"])] == season]
        replays = [ep for ep in in_season if ep["attack_type"] not in stealth][:2]
        furtive = [ep for ep in in_season if ep["attack_type"] in stealth]
        chosen = replays + furtive[: 3 - len(replays)] if replays else furtive[:2]
        for k, ep in enumerate(chosen):
            a = max(0, ep["start"] - 60)
            w = data.iloc[a:a + 200].copy()
            w["segment"] = f"{names[season]}-{k + 1}"
            parts.append(w)
    stream = pd.concat(parts, ignore_index=True)
    return stream[["segment", "datetime", "month", "season", "weather_temp", "fridge_temp",
                   "thermostat_temp", "weather_diff_1", "fridge_diff_1", "thermostat_diff_1",
                   "weather_roll_std_10", "label", "attack_type"]]


def main() -> None:
    rng = np.random.default_rng(SEED)
    np.random.seed(SEED)
    paths.ensure_dirs()

    log("[1] Traces normales réelles")
    real = load_normal_traces()
    for sensor, df in real.items():
        df.to_csv(paths.CONCAT_CSV[sensor], index=False)

    log("[2] Traces d'attaque TON_IoT")
    traces = load_attack_traces()

    log(f"[3] Génération de l'année {YEAR} au pas de {FREQ}")
    year = generate_year(real, rng)

    log("[4] Injection des attaques")
    episodes = inject_attacks(year, traces, rng)

    log("[5] Features multivariées (21)")
    data = finalize(year)
    data.to_csv(paths.DATASET_FUSIONNE, index=False)

    n_att = int(data["label"].sum())
    log(f"    {paths.DATASET_FUSIONNE}  {len(data):,} lignes, {n_att:,} attaques "
        f"({n_att / len(data):.1%}), {len(episodes)} épisodes")
    log(data.loc[data["label"] == 1, "attack_type"].value_counts().to_string())

    log("[6] Flux de démonstration saisonnier")
    stream = build_stream(data, episodes)
    stream.to_csv(paths.SEASONAL_STREAM_CSV, index=False)
    log(f"    {paths.SEASONAL_STREAM_CSV}  {len(stream):,} lignes, "
        f"{stream['segment'].nunique()} fenêtres")

    normal = data[data["label"] == 0]
    log("[7] Contrôles (lignes normales)")
    log(f"    frigo      moyenne {normal['fridge_temp'].mean():.2f} °C  σ {normal['fridge_temp'].std():.2f}")
    log(f"    thermostat moyenne {normal['thermostat_temp'].mean():.2f} °C  σ(Δ) {normal['thermostat_diff_1'].std():.2f}")
    log(f"    météo      [{normal['weather_temp'].min():.1f} ; {normal['weather_temp'].max():.1f}] °C  "
        f"σ glissant médian {normal['weather_roll_std_10'].median():.2f}")


if __name__ == "__main__":
    main()
