"""Fusion Insights — analyses « valeur de la fusion » pour le dashboard.

Exposition du dataset dès qu'il est fusionné peut sembler trivial ; ce module
prouve *pourquoi* la fusion apporte un gain mesurable, en exposant :

1. Fusion vs capteurs seuls (F1 / ROC-AUC / recall sur le MÊME split temporel)
2. Timeline superposée annotée avec les fenêtres d'attaque
3. Visibilité d'une attaque par capteur (z-score) + premier capteur à réagir
4. Courbe de sensibilité (taux de détection vs FPR) + matrice de confusion
5. Boxplots Normal vs Attaque + taille d'effet de Cohen
6. Métriques de qualité de la fusion (alignement, timestamps, complétude)
7. Calendrier des attaques (style GitHub)
8. Corrélation inter-capteurs par saison

Le calcul est coûteux au premier appel (entraînement de 3 OCSVM mono-capteur) :
il est effectué dans un ThreadPoolExecutor et mis en cache en mémoire.
"""

import os
import json

import joblib
import numpy as np
import pandas as pd
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Query

from sklearn.preprocessing import StandardScaler
from sklearn.svm import OneClassSVM
from sklearn.metrics import precision_recall_curve, confusion_matrix

from app.core import paths

router = APIRouter()

DATA_PATH = str(paths.DATASET_FUSIONNE)
WEATHER_PATH = str(paths.CONCAT_CSV["weather"])
FRIDGE_PATH = str(paths.CONCAT_CSV["fridge"])
THERMO_PATH = str(paths.CONCAT_CSV["thermostat"])
MODELS_DIR = str(paths.MODELS_DIR)
MODEL_PATH = str(paths.OCSVM_MODEL)
SCALER_PATH = str(paths.OCSVM_SCALER)
COMPLET_PATH = str(paths.RESULTS_COMPLETS)

SENSOR_COLS = {
    "weather": "weather_temp",
    "fridge": "fridge_temp",
    "thermostat": "thermostat_temp",
}
SENSOR_LABELS = {"weather": "Weather", "fridge": "Fridge", "thermostat": "Thermostat"}
SEASON_ORDER = ["hiver", "printemps", "ete", "automne"]
SEASON_OF_MONTH = {12: "hiver", 1: "hiver", 2: "hiver",
                   3: "printemps", 4: "printemps", 5: "printemps",
                   6: "ete", 7: "ete", 8: "ete",
                   9: "automne", 10: "automne", 11: "automne"}
NWEEK_DAYS = 7
NWEEKS = 53
SEED = 42

FEATURE_COLS = [
    "weather_temp", "fridge_temp", "thermostat_temp",
    "weather_diff_1", "weather_roll_mean_10", "weather_roll_std_10",
    "fridge_diff_1", "fridge_roll_mean_10", "fridge_roll_std_10",
    "thermostat_diff_1", "thermostat_roll_mean_10", "thermostat_roll_std_10",
    "weather_fridge_diff", "weather_thermostat_diff", "fridge_thermostat_diff",
    "hour_sin", "hour_cos", "season_sin", "season_cos",
    "fridge_cond_enc", "thermo_status",
]

_executor = ThreadPoolExecutor(max_workers=2)
_cache: dict = {}


def _round(v, nd=3):
    try:
        f = float(v)
        return round(f, nd) if np.isfinite(f) else 0.0
    except Exception:
        return 0.0


def _evaluate_pr(y_true, scores):
    """Copie de phase2._evaluate_pr : score = -decision_function, seuil max-F1 sur PR."""
    from sklearn.metrics import (
        roc_auc_score, average_precision_score, precision_score,
        recall_score, f1_score,
    )
    y = np.asarray(y_true)
    s = np.nan_to_num(np.asarray(scores), nan=0.0)
    prec, rec, thr = precision_recall_curve(y, s)
    with np.errstate(divide="ignore", invalid="ignore"):
        f1s = 2 * prec * rec / (prec + rec + 1e-12)
    best = int(np.argmax(f1s[:-1])) if len(f1s) > 1 else 0
    t = thr[best] if len(thr) > best else 0.5
    pred = (s >= t).astype(int)
    cm = confusion_matrix(y, pred, labels=[0, 1])
    tn, fp = cm[0]
    fn, tp = cm[1]
    return {
        "roc_auc": _round(float(roc_auc_score(y, s)), 3),
        "avg_precision": _round(float(average_precision_score(y, s)), 3),
        "precision": _round(float(precision_score(y, pred, zero_division=0)), 3),
        "recall": _round(float(recall_score(y, pred, zero_division=0)), 3),
        "f1": _round(float(f1_score(y, pred, zero_division=0)), 3),
        "fpr": _round(float(fp / (fp + tn)) if (fp + tn) > 0 else 0.0, 3),
        "threshold": _round(float(t), 4),
        "tp": int(tp), "fp": int(fp), "fn": int(fn), "tn": int(tn),
    }


# ════════════════════════════════════════════════════════
#  Chargement + split temporel identique à l'entraînement
# ════════════════════════════════════════════════════════

def _load_df():
    df = pd.read_csv(DATA_PATH, parse_dates=["datetime"])
    df = df.sort_values("datetime").reset_index(drop=True)
    df["label"] = df["label"].astype(int)
    df = df.rename(columns={
        "w_f_diff": "weather_fridge_diff",
        "w_t_diff": "weather_thermostat_diff",
        "f_t_diff": "fridge_thermostat_diff",
    })
    for c in FEATURE_COLS:
        if c not in df.columns:
            df[c] = 0.0
    return df


def _split_tvt(df, train_ratio=0.70, val_ratio=0.5):
    """Split temporel strict 70/15/15, identique au notebook / phase2."""
    df = df.sort_values("datetime").reset_index(drop=True)
    norm = df[df["label"] == 0]
    att = df[df["label"] == 1].sort_values("datetime")
    n_train = int(len(norm) * train_ratio)
    norm_train = norm.iloc[:n_train]
    rem_norm = norm.iloc[n_train:]
    n_val_norm = int(len(rem_norm) * val_ratio)
    val_norm = rem_norm.iloc[:n_val_norm]
    test_norm = rem_norm.iloc[n_val_norm:]
    n_val_att = int(len(att) * val_ratio)
    val_att = att.iloc[:n_val_att]
    test_att = att.iloc[n_val_att:]
    train = norm_train.sort_values("datetime")
    val = pd.concat([val_norm, val_att]).sort_values("datetime")
    test = pd.concat([test_norm, test_att]).sort_values("datetime")
    return train, val, test


# ════════════════════════════════════════════════════════
#  1. Fusion vs capteurs seuls
# ════════════════════════════════════════════════════════

def _mono_eval(train: pd.DataFrame, test: pd.DataFrame, col: str, seed: int = SEED):
    yt = test["label"].values.astype(int)
    Xtr = train[[col]].fillna(0).values.astype(float)
    Xte = test[[col]].fillna(0).values.astype(float)
    sc = StandardScaler().fit(Xtr)
    Xtr_s, Xte_s = sc.transform(Xtr), sc.transform(Xte)
    rng = np.random.RandomState(seed)
    idx = rng.choice(len(Xtr_s), min(20000, len(Xtr_s)), replace=False)
    model = OneClassSVM(kernel="rbf", nu=0.03, gamma=0.001)
    model.fit(Xtr_s[idx])
    s = -model.decision_function(Xte_s)
    return _evaluate_pr(yt, s)


def _roc_curve_points(s, y):
    """Courbe de sensibilité : taux de détection (recall) vs FPR sur le test."""
    s = np.asarray(s)
    y = np.asarray(y).astype(int)
    lo, hi = float(np.nanmin(s)), float(np.nanmax(s))
    ts = np.linspace(lo, hi, 90)
    rows = []
    for t in ts:
        p = (s >= t).astype(int)
        cm = confusion_matrix(y, p, labels=[0, 1])
        tn, fp = cm[0]
        fn, tp = cm[1]
        rows.append({
            "threshold": round(float(t), 4),
            "tpr": round(float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0, 4),
            "tnr": round(float(tn / (tn + fp)) if (tn + fp) > 0 else 0.0, 4),
            "fpr": round(float(fp / (fp + tn)) if (fp + tn) > 0 else 0.0, 4),
            "precision": round(float(tp / (tp + fp)) if (tp + fp) > 0 else 0.0, 4),
        })
    return rows


def _compute_comparison(df):
    train, val, test = _split_tvt(df)
    n_attack_test = int(test["label"].sum())
    n_normal_test = int((test["label"] == 0).sum())

    mono = {}
    for key, col in SENSOR_COLS.items():
        mono[key] = _mono_eval(train, test, col)

    fused = None
    fused_model_available = False
    fused_scores = None
    y_test = None
    flagment = None
    if os.path.exists(MODEL_PATH) and os.path.exists(SCALER_PATH):
        try:
            fused_scores, y_test = None, test["label"].values.astype(int)
            model = joblib.load(MODEL_PATH)
            scaler = joblib.load(SCALER_PATH)
            X = test[FEATURE_COLS].fillna(0).values.astype(float)
            fused_scores = -model.decision_function(scaler.transform(X))
            fused = _evaluate_pr(y_test, fused_scores)
            fused_model_available = True
        except Exception as e:
            flagment = str(e)
            fused = None

    if fused is None and os.path.exists(COMPLET_PATH):
        try:
            with open(COMPLET_PATH, "r", encoding="utf-8") as fh:
                comp = json.load(fh)
            mm = comp.get("model_metrics") or {}
            fused = {
                "roc_auc": _round(float(mm.get("roc_auc") or 0), 3),
                "avg_precision": _round(float(mm.get("average_precision") or 0), 3),
                "precision": _round(float(mm.get("precision") or 0), 3),
                "recall": _round(float(mm.get("recall") or 0), 3),
                "f1": _round(float(mm.get("f1") or 0), 3),
                "fpr": _round(float(mm.get("fpr") or 0), 3),
                "threshold": _round(float(mm.get("threshold") or 0), 4),
                "tp": int(mm.get("tp") or 0), "fp": int(mm.get("fp") or 0),
                "fn": int(mm.get("fn") or 0), "tn": int(mm.get("tn") or 0),
            }
            fused_model_available = True
        except Exception:
            pass

    roc_curve = []
    conf_matrix = None
    stored_metrics = None
    if fused_scores is not None and y_test is not None:
        roc_curve = _roc_curve_points(fused_scores, y_test)
        if fused is not None:
            conf_matrix = {
                "labels": ["Prédit normal", "Prédit attaque"],
                "matrix": [[fused["tn"], fused["fp"]], [fused["fn"], fused["tp"]]],
                "threshold": fused["threshold"],
                "tpr": fused["recall"],
                "fpr": fused["fpr"],
            }
    if os.path.exists(COMPLET_PATH):
        try:
            with open(COMPLET_PATH, "r", encoding="utf-8") as fh:
                comp = json.load(fh)
            mm = comp.get("model_metrics") or {}
            if not fused_model_available and mm:
                fus = {}
                for k in ["precision", "recall", "f1", "roc_auc", "fpr"]:
                    fus[k] = _round(float(mm.get(k) or 0), 3)
                fus["threshold"] = _round(float(mm.get("threshold") or 0), 4)
                fus["tp"] = int(mm.get("tp") or 0)
                fus["fp"] = int(mm.get("fp") or 0)
                fus["fn"] = int(mm.get("fn") or 0)
                fus["tn"] = int(mm.get("tn") or 0)
                fused = fus
                fused_model_available = True
            stored_metrics = {
                "precision": _round(float(mm.get("precision") or 0), 3),
                "recall": _round(float(mm.get("recall") or 0), 3),
                "f1": _round(float(mm.get("f1") or 0), 3),
                "roc_auc": _round(float(mm.get("roc_auc") or 0), 3),
                "fpr": _round(float(mm.get("fpr") or 0), 4),
                "threshold": _round(float(mm.get("threshold") or 0), 4),
                "tp": int(mm.get("tp") or 0), "fp": int(mm.get("fp") or 0),
                "fn": int(mm.get("fn") or 0), "tn": int(mm.get("tn") or 0),
            }
        except Exception:
            pass

    rows = []
    for key, col in SENSOR_COLS.items():
        m = mono[key]
        rows.append({
            "id": key,
            "name": SENSOR_LABELS[key],
            "color": {"weather": "#38BDF8", "fridge": "#00E676", "thermostat": "#FF9100"}[key],
            "f1": m["f1"], "roc_auc": m["roc_auc"], "recall": m["recall"],
            "precision": m["precision"], "fpr": m["fpr"], "threshold": m["threshold"],
            "tp": m["tp"], "fp": m["fp"], "fn": m["fn"], "tn": m["tn"],
        })
    if fused is not None and fused_model_available:
        rows.append({
            "id": "fusion",
            "name": "Fusion (3 capteurs)",
            "color": "#A855F7",
            "f1": fused["f1"], "roc_auc": fused["roc_auc"], "recall": fused["recall"],
            "precision": fused["precision"], "fpr": fused["fpr"], "threshold": fused["threshold"],
            "tp": fused["tp"], "fp": fused["fp"], "fn": fused["fn"], "tn": fused["tn"],
        })

    return {
        "comparison": rows,
        "confusion_matrix": conf_matrix,
        "roc_curve": roc_curve,
        "stored_metrics": stored_metrics,
        "fused_model_available": fused_model_available,
        "n_attack_test": n_attack_test,
        "n_normal_test": n_normal_test,
        "split": {
            "method": "temporel 70/15/15 (identique à l'entraînement)",
            "n_train": int(len(train)), "n_val": int(len(val)), "n_test": int(len(test)),
            "n_attack_test": n_attack_test,
        },
        "error": flagment,
    }


# ════════════════════════════════════════════════════════
#  2. Timeline annotée + fenêtres d'attaque
# ════════════════════════════════════════════════════════

def _compute_timeline(df):
    n = len(df)
    step = max(1, n // 420)
    idx = np.arange(0, n, step)
    points = [
        {
            "i": int(k),
            "datetime": df["datetime"].iloc[k].strftime("%Y-%m-%d %H:%M"),
            "weather": _round(df["weather_temp"].iloc[k], 3),
            "fridge": _round(df["fridge_temp"].iloc[k], 3),
            "thermostat": _round(df["thermostat_temp"].iloc[k], 3),
            "label": int(df["label"].iloc[k]),
        }
        for k in idx
    ]

    lab = df["label"].values
    runs = []
    start = None
    for i, l in enumerate(lab):
        if l == 1 and start is None:
            start = i
        elif l == 0 and start is not None:
            runs.append((start, i - 1))
            start = None
    if start is not None:
        runs.append((start, len(lab) - 1))

    # Fusion des fenêtres proches (trou < 24 échantillons ≈ 2h)
    merged = []
    for (a, b) in runs:
        if merged and (a - merged[-1][1]) <= 24:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))

    windows = []
    for a, b in merged:
        windows.append({
            "i_start": int(a),
            "i_end": int(b),
            "start": df["datetime"].iloc[a].strftime("%Y-%m-%d %H:%M"),
            "end": df["datetime"].iloc[b].strftime("%Y-%m-%d %H:%M"),
            "start_label": df["datetime"].iloc[a].strftime("%d %b %H:%M"),
            "end_label": df["datetime"].iloc[b].strftime("%d %b %H:%M"),
            "n_points": int(b - a + 1),
            "duration_min": int((df["datetime"].iloc[b] - df["datetime"].iloc[a]).total_seconds() / 60),
        })

    return {"points": points, "windows": windows, "n_windows": len(windows)}


# ════════════════════════════════════════════════════════
#  3. Visibilité par capteur (proxy z-score) + premier capteur
# ════════════════════════════════════════════════════════

def _compute_visibility(df):
    lab = df["label"].values
    norm_mask = lab == 0
    zthr = 1.5

    z = {}
    normal_profiles = {}
    for key, col in SENSOR_COLS.items():
        v = df[col].values.astype(float)
        mu = float(v[norm_mask].mean())
        sd = float(v[norm_mask].std())
        if sd <= 0:
            sd = 1.0
        zz = (v - mu) / sd
        z[key] = zz
        normal_profiles[key] = {"mean": _round(mu, 3), "std": _round(sd, 3)}

    runs = []
    start = None
    for i, l in enumerate(lab):
        if l == 1 and start is None:
            start = i
        elif l == 0 and start is not None:
            runs.append((start, i - 1))
            start = None
    if start is not None:
        runs.append((start, len(lab) - 1))

    vis = np.zeros(4, dtype=int)       # nb capteurs 0..3
    first_sensor = np.zeros(4, dtype=int)  # index 0..2 + 3 = égalité
    solo_detect = {k: 0 for k in SENSOR_COLS}

    for a, b in runs:
        visible = []
        first = {}
        for k, key in enumerate(SENSOR_COLS):
            zz = z[key][a:b + 1]
            mean_abs = float(np.mean(np.abs(zz)))
            first_idx = b + 1
            for j in range(a, b + 1):
                if abs(z[key][j]) >= zthr:
                    first_idx = j
                    break
            if mean_abs >= zthr:
                visible.append(k)
                first[key] = first_idx
        vis[min(len(visible), 3)] += 1
        if visible:
            first_key = min(first, key=lambda k: first[k])
            first_sensor[list(SENSOR_COLS.keys()).index(first_key)] += 1
        if len(visible) == 1:
            solo_detect[list(SENSOR_COLS.keys())[visible[0]]] += 1

    # latence moyenne du premier capteur par type
    latency = {k: [] for k in SENSOR_COLS}
    for a, b in runs:
        for k, key in enumerate(SENSOR_COLS):
            first_idx = b + 1
            for j in range(a, b + 1):
                if abs(z[key][j]) >= zthr:
                    first_idx = j
                    break
            if first_idx <= b:
                latency[key].append((first_idx - a) * 5.0)
    latency_avg = {k: _round(float(np.mean(v)), 1) if v else None for k, v in latency.items()}

    return {
        "z_threshold": zthr,
        "visibility_counts": {
            "0": int(vis[0]), "1": int(vis[1]), "2": int(vis[2]), "3": int(vis[3]),
            "total": int(len(runs)),
        },
        "first_sensor": {
            "weather": int(first_sensor[0]),
            "fridge": int(first_sensor[1]),
            "thermostat": int(first_sensor[2]),
            "equal": int(first_sensor[3]),
        },
        "solo_detect": {k: int(solo_detect[k]) for k in SENSOR_COLS},
        "latency_avg_min": latency_avg,
        "normal_profiles": normal_profiles,
        "n_windows": int(len(runs)),
    }


# ════════════════════════════════════════════════════════
#  5. Boxplots Normal vs Attaque + Cohen's d
# ════════════════════════════════════════════════════════

def _quantile_arr(v, q):
    if len(v) == 0:
        return [0.0] * 5
    qs = np.percentile(v, [0, 25, 50, 75, 100])
    return [_round(float(x), 3) for x in qs]


def _compute_boxplots(df):
    lab = df["label"].values
    out = []
    for key, col in SENSOR_COLS.items():
        v = df[col].values.astype(float)
        vn, va = v[lab == 0], v[lab == 1]
        sn, sa = float(vn.std(ddof=1)), float(va.std(ddof=1))
        nn, na = len(vn), len(va)
        pooled = np.sqrt(((nn - 1) * sn ** 2 + (na - 1) * sa ** 2) / max(1, (nn + na - 2)))
        mean_n, mean_a = float(vn.mean()), float(va.mean())
        cohen = (mean_a - mean_n) / pooled if pooled > 0 else 0.0
        mag = "négligeable"
        a = abs(cohen)
        if a >= 0.8:
            mag = "grand"
        elif a >= 0.5:
            mag = "moyen"
        elif a >= 0.2:
            mag = "petit"
        out.append({
            "sensor": key,
            "name": SENSOR_LABELS[key],
            "color": {"weather": "#38BDF8", "fridge": "#00E676", "thermostat": "#FF9100"}[key],
            "normal": {
                "box": _quantile_arr(vn, 5), "mean": _round(mean_n, 3),
                "std": _round(sn, 3), "n": int(nn),
            },
            "attack": {
                "box": _quantile_arr(va, 5), "mean": _round(mean_a, 3),
                "std": _round(sa, 3), "n": int(na),
            },
            "cohen_d": _round(cohen, 3),
            "effect_size": mag,
        })
    return out


# ════════════════════════════════════════════════════════
#  6. Qualité de la fusion
# ════════════════════════════════════════════════════════

def _read_dt(path, columns):
    if not os.path.exists(path):
        return None
    df = pd.read_csv(path, usecols=columns, parse_dates=["datetime"])
    df["datetime"] = df["datetime"].astype(str).str.replace(r"^201-", "2019-", regex=True)
    df["datetime"] = pd.to_datetime(df["datetime"], errors="coerce")
    return df.dropna(subset=["datetime"]).drop_duplicates(subset=["datetime"])


def _compute_quality(df):
    w = _read_dt(WEATHER_PATH, ["datetime", "label"])
    f = _read_dt(FRIDGE_PATH, ["datetime", "label"])
    t = _read_dt(THERMO_PATH, ["datetime", "label"])

    q = {"sources": {}}
    union = None
    if w is not None and f is not None and t is not None:
        sw = set(w["datetime"]); sf = set(f["datetime"]); st = set(t["datetime"])
        union = sw | sf | st
        common = sw & sf & st
        sources = {
            "weather": {"rows": int(len(w)), "attacks": int(w["label"].sum()) if "label" in w else 0},
            "fridge": {"rows": int(len(f)), "attacks": int(f["label"].sum()) if "label" in f else 0},
            "thermostat": {"rows": int(len(t)), "attacks": int(t["label"].sum()) if "label" in t else 0},
        }
        q["sources"] = sources
        q["union_timestamps"] = int(len(union))
        q["common_timestamps"] = int(len(common))
        q["alignment_rate"] = _round(100.0 * len(common) / len(union), 2) if union else 0.0
        q["unique_only"] = {
            "weather": int(len(sw - (sf | st))),
            "fridge": int(len(sf - (sw | st))),
            "thermostat": int(len(st - (sw | sf))),
        }

    fused = {
        "rows": int(len(df)),
        "attacks": int(df["label"].sum()),
        "attack_pct": _round(100.0 * df["label"].mean(), 2),
        "null_cells": {k: int(df[SENSOR_COLS[k]].isna().sum()) for k in SENSOR_COLS},
        "duplicated_datetime": int(df["datetime"].duplicated().sum()),
    }
    diffs = df["datetime"].diff().dt.total_seconds().div(60).dropna()
    fused["interval_min"] = _round(float(diffs.mode().iloc[0]), 1) if len(diffs) else 0.0
    fused["start"] = df["datetime"].min().strftime("%Y-%m-%d %H:%M")
    fused["end"] = df["datetime"].max().strftime("%Y-%m-%d %H:%M")
    fused["duration_days"] = _round((df["datetime"].max() - df["datetime"].min()).days, 1)
    q["fused"] = fused
    q["filename"] = os.path.basename(DATA_PATH)
    return q


# ════════════════════════════════════════════════════════
#  7. Calendrier des attaques (style GitHub)
# ════════════════════════════════════════════════════════

def _compute_calendar(df):
    dt = df["datetime"]
    labels = df["label"].values

    years = {}
    for i, ts in enumerate(dt):
        iso = ts.isocalendar()
        y, wk, wd = iso.year, iso.week, iso.weekday - 1
        years.setdefault(y, {}).setdefault(wk, np.zeros(7, dtype=int))
        years[y][wk][wd] += int(labels[i])

    years_out = []
    all_max = 0
    for y, weeks in sorted(years.items()):
        maxwk = max(weeks)
        grid = []
        for wk in range(1, maxwk + 1):
            days = weeks.get(wk, np.zeros(7, dtype=int))
            total = int(days.sum())
            if total > all_max:
                all_max = total
            grid.append({
                "week": wk,
                "label": f"S{wk:02d}",
                "days": [int(x) for x in days],
                "total": total,
            })
        years_out.append({"year": y, "weeks": grid})
    return {"years": years_out, "max": all_max}


# ════════════════════════════════════════════════════════
#  8. Corrélation par saison
# ════════════════════════════════════════════════════════

def _compute_seasonal_corr(df):
    month = df["datetime"].dt.month
    season = month.map(lambda m: SEASON_OF_MONTH[int(m)])
    pairs = [("weather", "fridge"), ("weather", "thermostat"), ("fridge", "thermostat")]
    seasons = []
    for s in SEASON_ORDER:
        sub = df[season == s][list(SENSOR_COLS.values())].values
        if len(sub) < 2:
            continue
        c = np.corrcoef(sub.T)
        row = {
            "season": s,
            "label": {"hiver": "Hiver", "printemps": "Printemps", "ete": "Été", "automne": "Automne"}[s],
            "matrix": [[_round(c[i][j], 3) for j in range(3)] for i in range(3)],
            "pairs": {
                f"{a}_{b}": _round(float(c[list(SENSOR_COLS.keys()).index(a)][list(SENSOR_COLS.keys()).index(b)]), 3)
                for a, b in pairs
            },
        }
        seasons.append(row)
    return {"seasons": seasons, "labels": list(SENSOR_COLS.keys())}


# ════════════════════════════════════════════════════════
#  Insights automatiques (storytelling)
# ════════════════════════════════════════════════════════

def _build_takeaways(comparison, visibility, quality):
    tips = []
    rows = comparison.get("comparison", [])
    fused = next((r for r in rows if r["id"] == "fusion"), None)
    monos = [r for r in rows if r["id"] != "fusion"]
    if fused is not None and monos:
        best_f1_mono = max(monos, key=lambda r: r["f1"])
        delta = round((fused["f1"] - best_f1_mono["f1"]) * 100.0)
        tips.append({
            "icon": "trend",
            "title": "La fusion surpasse chaque capteur seul",
            "text": f"F1 fusionné : {fused['f1']*100:.1f}% vs {best_f1_mono['f1']*100:.1f}% pour "
                    f"{best_f1_mono['name']} seul (Δ+{delta} pts), sur le même split temporel "
                    f"({comparison.get('n_attack_test', 0):,} attaques en test).",
            "color": "#A855F7",
        })
        best_recall_mono = max(monos, key=lambda r: r["recall"])
        if best_recall_mono["recall"] > fused["recall"] and best_recall_mono["fpr"] > fused["fpr"]:
            tips.append({
                "icon": "shield",
                "title": "Rappel élevé ne veut pas dire détection utile",
                "text": f"{best_recall_mono['name']} seul atteint {best_recall_mono['recall']*100:.1f}% de rappel "
                        f"mais avec un taux de faux positifs de {best_recall_mono['fpr']*100:.1f}% "
                        f"(FPR fusion : {fused['fpr']*100:.2f}%). La fusion détecte presque autant "
                        f"({fused['recall']*100:.1f}%) sans inonder l'opérateur d'alertes.",
                "color": "#F59E0B",
            })
    vc = visibility.get("visibility_counts", {})
    total = vc.get("total", 0)
    h = int(vc.get("0", 0))
    if total > 0:
        hidden = "seule" if h == 1 else "seules"
        tips.append({
            "icon": "eye",
            "title": "Certaines attaques passent inaperçues en température",
            "text": f"{h}/{total} fenêtres d'attaque ne sont pas visibles par un écart brut de température "
                    f"sur un seul capteur — c'est le rôle des features de différence inter-capteurs de la fusion.",
            "color": "#38BDF8",
        })
    q = quality or {}
    ar = q.get("alignment_rate")
    if ar is not None:
        tips.append({
            "icon": "algo",
            "title": "Fusion bien alignée",
            "text": f"{ar:.1f}% de timestamps communs sur {q.get('union_timestamps', 0):,} créneaux, "
                    f"{q.get('fused', {}).get('rows', 0):,} lignes au final "
                    f"({q.get('fused', {}).get('interval_min', '—')} min, {q.get('fused', {}).get('attacks', 0):,} attaques).",
            "color": "#00E676",
        })
    return tips


# ════════════════════════════════════════════════════════
#  Assemblage + endpoint
# ════════════════════════════════════════════════════════

def _compute_all() -> dict:
    df = _load_df()
    comparison = _compute_comparison(df)
    timeline = _compute_timeline(df)
    visibility = _compute_visibility(df)
    boxplots = _compute_boxplots(df)
    quality = _compute_quality(df)
    calendar = _compute_calendar(df)
    seasonal_corr = _compute_seasonal_corr(df)
    takeaways = _build_takeaways(comparison, visibility, quality)

    payload = {
        "comparison": comparison,
        "timeline": timeline,
        "visibility": visibility,
        "boxplots": boxplots,
        "quality": quality,
        "calendar": calendar,
        "seasonal_corr": seasonal_corr,
        "takeaways": takeaways,
        "dataset": {
            "filename": os.path.basename(DATA_PATH),
            "rows": int(len(df)),
            "attacks": int(df["label"].sum()),
            "start": df["datetime"].min().strftime("%Y-%m-%d"),
            "end": df["datetime"].max().strftime("%Y-%m-%d"),
        },
        "generated_at": pd.Timestamp.now().isoformat(timespec="seconds"),
    }
    return payload


@router.get("/phase2/fusion-insights")
async def get_fusion_insights(force: bool = Query(False)):
    import asyncio
    if not force and "payload" in _cache:
        return _cache["payload"]
    loop = asyncio.get_running_loop()
    payload = await loop.run_in_executor(_executor, _compute_all)
    _cache["payload"] = payload
    return payload