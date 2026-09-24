import os
import json
import numpy as np
import pandas as pd
from fastapi import APIRouter

router = APIRouter()

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
DATA_PATH = os.path.join(BASE, "Data", "Processed", "dataset_fusionne.csv")

# ── Fichiers produits par l'entrainement reel (phase2) ────────────
MODELS_DIR = os.path.join(BASE, "phase2", "Data", "Processed", "models")
LIVE_RESULTS_PATH = os.path.join(MODELS_DIR, "live_trained_results.json")
COMPLETS_RESULTS_PATH = os.path.join(MODELS_DIR, "resultats_complets.json")
THRESHOLD_PATH = os.path.join(MODELS_DIR, "threshold_ocsvm.json")
HYPERPARAMS_PATH = os.path.join(MODELS_DIR, "hyperparams_ocsvm.json")

_cached_payload: dict | None = None

SENSOR_COLS = {
    "weather": "weather_temp",
    "fridge": "fridge_temp",
    "thermostat": "thermostat_temp",
}

SEASON_OF_MONTH = {1: 1, 2: 1, 3: 2, 4: 2, 5: 2, 6: 3, 7: 3, 8: 3, 9: 4, 10: 4, 11: 4, 12: 1}
SEASON_NAMES = {1: "hiver", 2: "printemps", 3: "ete", 4: "automne"}
MONTH_NAMES = ["Jan", "Fev", "Mar", "Avr", "Mai", "Jun", "Jul", "Aou", "Sep", "Oct", "Nov", "Dec"]
HOUR_LABELS = [f"{h:02d}h" for h in range(24)]


def _round(v, nd=2):
    try:
        f = float(v)
        return round(f, nd) if np.isfinite(f) else 0.0
    except Exception:
        return 0.0


def _build_payload() -> dict:
    df = pd.read_csv(DATA_PATH, parse_dates=["datetime"])
    df = df.sort_values("datetime").reset_index(drop=True)

    dt = df["datetime"] = pd.to_datetime(df["datetime"])
    total = len(df)

    label = df["label"].astype(int).to_numpy()
    n_attack = int(label.sum())
    n_normal = int(total - n_attack)

    month = dt.dt.month.to_numpy()
    hour = dt.dt.hour.to_numpy()
    season = np.array([SEASON_OF_MONTH[m] for m in month])

    # ── Plein ecart — résumé global ────────────────────────────
    stats = {}
    for key, col in SENSOR_COLS.items():
        s = df[col].astype(float)
        stats[key] = {
            "min": _round(s.min(), 3),
            "max": _round(s.max(), 3),
            "mean": _round(s.mean(), 3),
            "std": _round(s.std(), 3),
            "median": _round(s.median(), 3),
        }

    df2 = df.reset_index(drop=True)
    diffs_min = df2["datetime"].diff().dt.total_seconds().div(60).dropna()
    interval_min = round(float(diffs_min.mode().iloc[0]), 1) if len(diffs_min) else 0.0

    global_summary = {
        "total": total,
        "normal": n_normal,
        "attack": n_attack,
        "attack_pct": round(100.0 * n_attack / total, 2) if total else 0.0,
        "start": dt.min().strftime("%Y-%m-%d %H:%M"),
        "end": dt.max().strftime("%Y-%m-%d %H:%M"),
        "duration_days": round((dt.max() - dt.min()).days, 1),
        "sensors": list(SENSOR_COLS.keys()),
        "interval_min": interval_min,
        "stats": stats,
    }

    # ── Distribution par saison ────────────────────────────────
    seasonal = []
    for s in range(1, 5):
        mask = season == s
        n = int(mask.sum())
        a = int(label[mask].sum())
        seasonal.append({
            "season": SEASON_NAMES[s],
            "label": SEASON_NAMES[s],
            "normal": n - a,
            "attack": a,
            "total": n,
        })

    # ── Distribution par mois ──────────────────────────────────
    monthly = []
    for m in range(1, 13):
        mask = month == m
        n = int(mask.sum())
        a = int(label[mask].sum())
        monthly.append({
            "month": m,
            "label": MONTH_NAMES[m - 1],
            "normal": n - a,
            "attack": a,
            "total": n,
            "attack_pct": round(100.0 * a / n, 2) if n else 0.0,
        })

    # ── Distribution par heure ─────────────────────────────────
    hourly = []
    for h in range(24):
        mask = hour == h
        n = int(mask.sum())
        a = int(label[mask].sum())
        hourly.append({
            "hour": h,
            "label": HOUR_LABELS[h],
            "normal": n - a,
            "attack": a,
            "total": n,
        })

    # ── Heatmap 1 : jour du mois (1-31) x mois × nb d'attaques ─
    dom = dt.dt.day.to_numpy()
    heatmap_dom_attack = []
    heatmap_dom_max = 0
    for d in range(1, 32):
        row_attack = []
        for m in range(1, 13):
            mask = (dom == d) & (month == m)
            a = int(label[mask].sum())
            row_attack.append(a)
            if a > heatmap_dom_max:
                heatmap_dom_max = a
        heatmap_dom_attack.append({"day": d, "values": row_attack})

    # ── Heatmap 2 : mois x heure × % d'attaque ─────────────────
    heatmap_hour_pct = []
    for m in range(1, 13):
        row_pct = []
        for h in range(24):
            mask = (month == m) & (hour == h)
            n = int(mask.sum())
            a = int(label[mask].sum())
            row_pct.append(round(100.0 * a / n, 2) if n else 0.0)
        heatmap_hour_pct.append({"month": m, "label": MONTH_NAMES[m - 1], "values": row_pct})

    # ── Profils purs (graphe 24h normal vs attaque en %) ───────
    profiles = {
        "hourly_attack_pct": [],
        "seasonal_attack_pct": [],
    }
    for h in range(24):
        mask = hour == h
        n = int(mask.sum())
        a = int(label[mask].sum())
        profiles["hourly_attack_pct"].append(round(100.0 * a / n, 2) if n else 0.0)
    for s in range(1, 5):
        mask = season == s
        n = int(mask.sum())
        a = int(label[mask].sum())
        profiles["seasonal_attack_pct"].append(round(100.0 * a / n, 2) if n else 0.0)

    # ── Courbes de tendance par capteur (échantillonnées) ──────
    step = max(1, total // 400)
    sample_idx = np.arange(0, total, step)
    trends = {}
    for key, col in SENSOR_COLS.items():
        v = df[col].astype(float).to_numpy()
        trends[key] = [
            {
                "datetime": dt[i].strftime("%Y-%m-%d %H:%M"),
                "value": _round(v[i], 3),
                "label": int(label[i]),
            }
            for i in sample_idx
        ]

    # ── Statistiques normal vs attaque par capteur ─────────────
    split_stats = {}
    for key, col in SENSOR_COLS.items():
        v = df[col].astype(float).to_numpy()
        split_stats[key] = {
            "normal": {
                "mean": _round(v[label == 0].mean(), 3),
                "std": _round(v[label == 0].std(), 3),
            },
            "attack": {
                "mean": _round(v[label == 1].mean(), 3),
                "std": _round(v[label == 1].std(), 3),
            },
        }

    # ── Scatter data (sampled 1500 pts) ────────────────────────
    scatter_step = max(1, total // 1500)
    scatter_idx = np.arange(0, total, scatter_step)
    wv = df["weather_temp"].astype(float).to_numpy()
    fv = df["fridge_temp"].astype(float).to_numpy()
    tv = df["thermostat_temp"].astype(float).to_numpy()
    scatter = [
        {
            "weather": _round(wv[i], 3),
            "fridge": _round(fv[i], 3),
            "thermostat": _round(tv[i], 3),
            "label": int(label[i]),
        }
        for i in scatter_idx
    ]

    # ── Histograms (20 bins per sensor, normal vs attack) ───────
    histograms = {}
    for key, col in SENSOR_COLS.items():
        v = df[col].astype(float).to_numpy()
        vmin, vmax = float(v.min()), float(v.max())
        bins = np.linspace(vmin, vmax, 21)
        bin_edges = [_round(b, 2) for b in bins]
        bin_centers = [_round((bins[j] + bins[j + 1]) / 2, 2) for j in range(20)]
        hist_normal, _ = np.histogram(v[label == 0], bins=bins)
        hist_attack, _ = np.histogram(v[label == 1], bins=bins)
        histograms[key] = {
            "bin_centers": bin_centers,
            "bin_edges": bin_edges,
            "normal": [int(x) for x in hist_normal],
            "attack": [int(x) for x in hist_attack],
        }

    # ── Correlation matrix ──────────────────────────────────────
    sensor_arr = np.column_stack([wv, fv, tv])
    corr = np.corrcoef(sensor_arr.T)
    correlations = {
        "labels": ["weather", "fridge", "thermostat"],
        "matrix": [[_round(corr[i][j], 3) for j in range(3)] for i in range(3)],
    }

    # ── Rolling attack rate (window=500 pts) ────────────────────
    window = 500
    rolling = []
    for i in range(0, total, window):
        chunk = label[i:i + window]
        n = len(chunk)
        a = int(chunk.sum())
        rolling.append({
            "index": i,
            "label": dt[i].strftime("%m-%d %H:%M"),
            "attack_rate": round(100.0 * a / n, 2) if n else 0.0,
            "count": n,
        })

    # ── Seasonal sensor stats (mean per sensor per season) ──────
    seasonal_sensors = []
    for s in range(1, 5):
        mask = season == s
        row = {"season": SEASON_NAMES[s], "label": SEASON_NAMES[s]}
        for key, col in SENSOR_COLS.items():
            v = df[col].astype(float).to_numpy()
            sv = v[mask]
            row[f"{key}_mean"] = _round(sv.mean(), 2)
            row[f"{key}_std"] = _round(sv.std(), 2)
            row[f"{key}_median"] = _round(float(np.median(sv)), 2)
        seasonal_sensors.append(row)

    return {
        "filename": os.path.basename(DATA_PATH),
        "global": global_summary,
        "seasonal": seasonal,
        "monthly": monthly,
        "hourly": hourly,
        "heatmap_dom_attack": heatmap_dom_attack,
        "heatmap_dom_max": heatmap_dom_max,
        "heatmap_hour_pct": heatmap_hour_pct,
        "profiles": profiles,
        "trends": trends,
        "split_stats": split_stats,
        "scatter": scatter,
        "histograms": histograms,
        "correlations": correlations,
        "rolling": rolling,
        "seasonal_sensors": seasonal_sensors,
    }


@router.get("/phase2/dataset-overview")
async def get_dataset_overview():
    global _cached_payload
    if _cached_payload is None:
        _cached_payload = _build_payload()
    return _cached_payload


# ═══════════════════════════════════════════════════════════════════
#  KPIs réels du dataset d'entrainement + performances du modele
# ═══════════════════════════════════════════════════════════════════

def _load_payload() -> dict:
    global _cached_payload
    if _cached_payload is None:
        _cached_payload = _build_payload()
    return _cached_payload


def _load_training_kpis() -> dict:
    """Lit les resultats de l'entrainement reel (fichiers produits par phase2)."""
    training = {
        "available": False,
        "best_model": None,
        "metrics": None,
        "split": None,
        "trained_at": None,
        "attack_detection": [],
        "shap_top_features": [],
        "n_total_samples": None,
        "n_normal_samples": None,
        "n_attack_samples": None,
    }

    complet_src = compl_metrics = None
    if os.path.exists(COMPLETS_RESULTS_PATH):
        try:
            with open(COMPLETS_RESULTS_PATH, "r", encoding="utf-8") as f:
                complet_src = json.load(f)
        except Exception:
            complet_src = None

    live_src = None
    if os.path.exists(LIVE_RESULTS_PATH):
        try:
            with open(LIVE_RESULTS_PATH, "r", encoding="utf-8") as f:
                live_src = json.load(f) or {}
        except Exception:
            live_src = None

    if live_src and isinstance(live_src, dict):
        candidates = sorted(live_src.items(), key=lambda kv: float(kv[1].get("f1", 0) or 0), reverse=True)
        if candidates:
            mid, m = candidates[0]
            trained_at = m.get("trained_at") or (complet_src or {}).get("model_metrics", {}).get("trained_at")
            training.update({
                "available": True,
                "best_model": mid,
                "metrics": {
                    "precision": round(float(m.get("precision") or 0), 4),
                    "recall": round(float(m.get("recall") or 0), 4),
                    "f1": round(float(m.get("f1") or 0), 4),
                    "roc_auc": round(float(m.get("roc_auc") or 0), 4),
                    "ap": round(float(m.get("ap") or 0), 4),
                    "fpr": round(float(m.get("fpr") or 0), 4),
                    "tp": int(m.get("tp") or 0),
                    "fp": int(m.get("fp") or 0),
                    "fn": int(m.get("fn") or 0),
                    "tn": int(m.get("tn") or 0),
                },
                "trained_at": trained_at,
            })

    if complet_src:
        comp_metrics = complet_src.get("model_metrics") or {}
        ti = complet_src.get("training_info") or {}
        training["split"] = {
            "n_train": ti.get("split", {}).get("n_train"),
            "n_val": ti.get("split", {}).get("n_val"),
            "n_test": ti.get("split", {}).get("n_test"),
            "n_attack_val": ti.get("split", {}).get("n_attack_val"),
            "n_attack_test": ti.get("split", {}).get("n_attack_test"),
        }
        training["n_total_samples"] = ti.get("n_total_samples")
        training["n_normal_samples"] = ti.get("n_normal_samples")
        training["n_attack_samples"] = ti.get("n_attack_samples")
        if not training["available"] and comp_metrics:
            training["available"] = True
            training["best_model"] = "OCSVM_Multivarie"
            training["metrics"] = {
                "precision": round(float(comp_metrics.get("precision") or 0), 4),
                "recall": round(float(comp_metrics.get("recall") or 0), 4),
                "f1": round(float(comp_metrics.get("f1") or 0), 4),
                "roc_auc": round(float(comp_metrics.get("roc_auc") or 0), 4),
                "ap": round(float(comp_metrics.get("average_precision") or 0), 4),
                "fpr": round(float(comp_metrics.get("fpr") or 0), 4),
                "tp": int(comp_metrics.get("tp") or 0),
                "fp": int(comp_metrics.get("fp") or 0),
                "fn": int(comp_metrics.get("fn") or 0),
                "tn": int(comp_metrics.get("tn") or 0),
                "threshold": round(float(comp_metrics.get("threshold") or 0), 4),
                "cv_roc_auc": round(float(comp_metrics.get("cv_roc_auc") or 0), 4),
            }
            training["trained_at"] = comp_metrics.get("trained_at")
        training["attack_detection"] = [
            {
                "attack_type": a.get("attack_type", ""),
                "attack_id": a.get("attack_id", ""),
                "n_total": int(a.get("n_total") or 0),
                "n_detected": int(a.get("n_detected") or 0),
                "detection_rate": round(float(a.get("detection_rate") or 0), 1),
                "avg_score": round(float(a.get("avg_score") or 0), 3),
            }
            for a in (complet_src.get("attack_metrics") or [])
        ]
        shap = complet_src.get("shap") or {}
        if isinstance(shap, dict) and shap.get("global_importance"):
            training["shap_top_features"] = [
                {"feature": fi.get("feature", ""), "shap_importance": round(float(fi.get("shap_importance") or 0), 6)}
                for fi in shap["global_importance"][:10]
            ]

    if training["available"] and training["metrics"] and "threshold" not in training["metrics"]:
        try:
            if os.path.exists(THRESHOLD_PATH):
                with open(THRESHOLD_PATH, "r", encoding="utf-8") as f:
                    thr = json.load(f)
                training["metrics"]["threshold"] = round(float(thr.get("threshold") or 0), 4)
        except Exception:
            pass

    return training


@router.get("/phase2/dataset-kpis")
async def get_dataset_kpis():
    """KPIs calculés sur le dataset réel utilisé pour l'entrainement du modele.

    Toutes les valeurs proviennent de `dataset_fusionne.csv` (dataset
    d'entrainement) + des fichiers de résultats produits par l'entrainement.
    """
    payload = _load_payload()
    g = payload["global"]
    monthly = payload["monthly"]
    hourly = payload["hourly"]
    seasonal = payload["seasonal"]
    split = payload.get("split_stats", {})

    n_attack = g["attack"]
    n_normal = g["normal"]
    n_total = g["total"]

    def _peak(items, attack_key="attack"):
        if not items:
            return None
        best = max(items, key=lambda x: x[attack_key])
        total_ = best.get("total", 0) or 1
        return {
            "label": best.get("label"),
            "attack": int(best[attack_key]),
            "attack_pct": round(100.0 * best[attack_key] / total_, 2),
            "share_of_dataset": round(100.0 * best[attack_key] / n_attack, 2) if n_attack else 0.0,
        }

    normal_vs_attack = []
    for key, s in split.items():
        nm = s.get("normal", {}).get("mean", 0)
        am = s.get("attack", {}).get("mean", 0)
        normal_vs_attack.append({
            "sensor": key,
            "normal_mean": round(float(nm), 3),
            "attack_mean": round(float(am), 3),
            "delta": round(float(am) - float(nm), 3),
        })

    dataset_kpis = {
        "filename": payload.get("filename", os.path.basename(DATA_PATH)),
        "total": n_total,
        "normal": n_normal,
        "attack": n_attack,
        "attack_pct": g["attack_pct"],
        "normal_pct": round(100.0 - g["attack_pct"], 2),
        "imbalance_ratio": round(n_normal / n_attack, 1) if n_attack else 0.0,
        "duration_days": g["duration_days"],
        "start": g["start"],
        "end": g["end"],
        "interval_min": g.get("interval_min", 0.0),
        "sensors": g["sensors"],
        "features": 21,
        "sensor_stats": g.get("stats", {}),
        "normal_vs_attack": normal_vs_attack,
        "peaks": {
            "month": _peak(monthly),
            "hour": _peak(hourly),
            "season": _peak(seasonal),
        },
        "seasonal": seasonal,
        "monthly": monthly,
        "hourly": hourly,
        "profiles": payload.get("profiles", {}),
    }

    return {
        "dataset": dataset_kpis,
        "training": _load_training_kpis(),
        "generated_at": pd.Timestamp.now().isoformat(timespec="seconds"),
    }
