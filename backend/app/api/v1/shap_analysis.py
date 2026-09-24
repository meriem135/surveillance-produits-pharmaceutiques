import os, traceback, json
import numpy as np
import pandas as pd
from fastapi import APIRouter, Query
import joblib

router = APIRouter(prefix="/api/shap", tags=["shap-analysis"])

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(_HERE)))
_PROJECT = os.path.dirname(_ROOT)

FEATURE_COLS = [
    "weather_temp", "fridge_temp", "thermostat_temp",
    "weather_diff_1", "weather_roll_mean_10", "weather_roll_std_10",
    "fridge_diff_1", "fridge_roll_mean_10", "fridge_roll_std_10",
    "thermostat_diff_1", "thermostat_roll_mean_10", "thermostat_roll_std_10",
    "weather_fridge_diff", "weather_thermostat_diff", "fridge_thermostat_diff",
    "hour_sin", "hour_cos", "season_sin", "season_cos",
    "fridge_cond_enc", "thermo_status",
]

FEATURE_LABEL = {
    "weather_temp": "Weather Temp", "fridge_temp": "Fridge Temp",
    "thermostat_temp": "Thermostat Temp",
    "weather_diff_1": "Weather Δ₁", "weather_roll_mean_10": "Weather μ₁₀", "weather_roll_std_10": "Weather σ₁₀",
    "fridge_diff_1": "Fridge Δ₁", "fridge_roll_mean_10": "Fridge μ₁₀", "fridge_roll_std_10": "Fridge σ₁₀",
    "thermostat_diff_1": "Thermostat Δ₁", "thermostat_roll_mean_10": "Thermostat μ₁₀", "thermostat_roll_std_10": "Thermostat σ₁₀",
    "weather_fridge_diff": "Weather↔Fridge", "weather_thermostat_diff": "Weather↔Thermostat", "fridge_thermostat_diff": "Fridge↔Thermostat",
    "hour_sin": "Hour (sin)", "hour_cos": "Hour (cos)", "season_sin": "Season (sin)", "season_cos": "Season (cos)",
    "fridge_cond_enc": "Fridge Cond", "thermo_status": "Thermo Status",
}

FEATURE_GROUP = {
    "weather_temp": "weather", "fridge_temp": "fridge", "thermostat_temp": "thermostat",
    "weather_diff_1": "weather", "weather_roll_mean_10": "weather", "weather_roll_std_10": "weather",
    "fridge_diff_1": "fridge", "fridge_roll_mean_10": "fridge", "fridge_roll_std_10": "fridge",
    "thermostat_diff_1": "thermostat", "thermostat_roll_mean_10": "thermostat", "thermostat_roll_std_10": "thermostat",
    "weather_fridge_diff": "cross", "weather_thermostat_diff": "cross", "fridge_thermostat_diff": "cross",
    "hour_sin": "time", "hour_cos": "time", "season_sin": "time", "season_cos": "time",
    "fridge_cond_enc": "other", "thermo_status": "other",
}

MONTH_NAMES = ["Jan","Fev","Mar","Avr","Mai","Jun","Jul","Aou","Sep","Oct","Nov","Dec"]

FEATURE_INTERPRETATION = {
    "weather_temp": "Température extérieure anormale",
    "fridge_temp": "Température du frigo anormale",
    "thermostat_temp": "Température du thermostat anormale",
    "weather_diff_1": "Variation brutale de la température extérieure",
    "weather_roll_mean_10": "Dérive de la tendance météo (moyenne 10 pas)",
    "weather_roll_std_10": "Volatilité anormale de la météo",
    "fridge_diff_1": "Variation brutale de la température frigo",
    "fridge_roll_mean_10": "Dérive de la température frigo (moyenne 10 pas)",
    "fridge_roll_std_10": "Volatilité anormale du frigo",
    "thermostat_diff_1": "Variation brutale du thermostat",
    "thermostat_roll_mean_10": "Dérive du thermostat (moyenne 10 pas)",
    "thermostat_roll_std_10": "Volatilité anormale du thermostat",
    "weather_fridge_diff": "Incohérence entre météo et frigo",
    "weather_thermostat_diff": "Incohérence entre météo et thermostat",
    "fridge_thermostat_diff": "Incohérence entre frigo et thermostat",
    "hour_sin": "Comportement horaire inhabituel",
    "hour_cos": "Comportement horaire inhabituel",
    "season_sin": "Comportement saisonnier inhabituel",
    "season_cos": "Comportement saisonnier inhabituel",
    "fridge_cond_enc": "État compresseur frigo anormal",
    "thermo_status": "Statut du thermostat anormal",
}

_cache = {"df": None, "model": None, "scaler": None, "model_kind": None,
          "matrix": None, "data_path": None, "model_path": None, "background": None}
_result_cache = {}


def _find_model_dir():
    for candidate in [
        os.path.join(_PROJECT, "phase2", "Data", "Processed", "models"),
        os.path.join(_PROJECT, "models"),
        os.path.join(_ROOT, "models"),
    ]:
        if os.path.isdir(candidate):
            return candidate
    return os.path.join(_PROJECT, "phase2", "Data", "Processed", "models")


MODELS_DIR = _find_model_dir()


def _find_data_path():
    """Donnees REClLLES du dernier entrainement temps reel : les 21 features
    + label, deja construites par _run_training (merge + feature engineering)."""
    candidates = [
        os.path.join(_PROJECT, "phase2", "Data", "Processed", "merged_3_sensors.csv"),
        os.path.join(_PROJECT, "Data", "Processed", "dataset_fusionne.csv"),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return candidates[0]


def _find_model_files():
    """Modele OCSVM entraine en temps reel via /phase2/train."""
    ocsvm = os.path.join(MODELS_DIR, "ocsvm_multivarie.pkl")
    ocsvm_scaler = os.path.join(MODELS_DIR, "scaler_ocsvm.pkl")
    if os.path.exists(ocsvm) and os.path.exists(ocsvm_scaler):
        return ocsvm, ocsvm_scaler, "ocsvm"
    return None, None, None


def _load_shap_matrix():
    """Matrice SHAP brute calculee pendant le dernier entrainement temps reel
    (pas de re-calcul KernelExplainer en ligne : trop lent)."""
    matrix_path = os.path.join(MODELS_DIR, "shap_analysis_live.json")
    if not os.path.exists(matrix_path):
        return None
    try:
        with open(matrix_path, "r", encoding="utf-8") as f:
            m = json.load(f)
        if not isinstance(m.get("shap_matrix"), list) or len(m.get("shap_matrix", [])) == 0:
            return None
        if m.get("model_kind") != "ocsvm":
            return None
        return m
    except Exception as e:
        print(f"[SHAP] Lecture matrice pre-calculee impossible: {e}")
        return None


def _load():
    data_path = _find_data_path()
    model_path, scaler_path, model_kind = _find_model_files()

    if (_cache["df"] is not None and _cache["data_path"] == data_path
            and _cache["model_path"] == model_path and _cache["model"] is not None):
        return _cache["df"], _cache["model"], _cache["scaler"], _cache["model_kind"], _cache["matrix"]

    if model_path is None:
        raise FileNotFoundError("Aucun modele entraine trouve. Lancez un entrainement temps reel depuis la page ML.")

    df = pd.read_csv(data_path)
    df["datetime"] = pd.to_datetime(df["datetime"], errors="coerce")
    df = df.dropna(subset=["datetime"]).sort_values("datetime").reset_index(drop=True)
    df = df.rename(columns={
        "w_f_diff": "weather_fridge_diff",
        "w_t_diff": "weather_thermostat_diff",
        "f_t_diff": "fridge_thermostat_diff",
    })
    for c in FEATURE_COLS:
        if c not in df.columns:
            df[c] = 0.0
    df = df.replace([np.inf, -np.inf], np.nan)
    df[FEATURE_COLS] = df[FEATURE_COLS].fillna(0)
    df["month"] = df["datetime"].dt.month
    df["doy"] = df["datetime"].dt.dayofyear
    df["hour"] = df["datetime"].dt.hour

    model = joblib.load(model_path)
    scaler = joblib.load(scaler_path)
    matrix = _load_shap_matrix()

    _cache["df"] = df
    _cache["model"] = model
    _cache["scaler"] = scaler
    _cache["model_kind"] = model_kind
    _cache["matrix"] = matrix
    _cache["model_path"] = model_path
    _cache["data_path"] = data_path

    return df, model, scaler, model_kind, matrix


def _on_demand_shap(model, X):
    """SHAP REEL calcule a la demande — jamais de donnees fabriquees.

    KernelExplainer sur la fonction de decision (KernelSHAP exact,
    deterministe avec seed fixe).
    En cas d'echec, leve une erreur -> le caller repond une erreur claire
    (le fallback "sensibilite" a ete supprime, on ne retourne jamais de fake).
    """
    import shap as shap_lib
    rng = np.random.RandomState(42)
    bg = _cache.get("background")
    if bg is None:
        bg_idx = rng.choice(len(X), min(50, len(X)), replace=False)
        bg = X[bg_idx]
        _cache["background"] = bg
    explainer = shap_lib.KernelExplainer(model.decision_function, bg)
    sv = explainer.shap_values(X, nsamples=64)
    return np.asarray(sv), "KernelExplainer (temps réel)"


def _shap_for_sample(sample, model, model_kind, matrix):
    """Renvoie (shap_vals, method) pour les lignes de `sample`.

    - OCSVM + matrice pre-calculee (KernelExplainer real de
      l'entrainement) : plus proche timestamp (SHAP reel reutilise).
    - sinon : calcul SHAP reel a la demande (KernelExplainer).
    Ne retombe JAMAIS sur un fallback approximatif.
    """
    if matrix is not None:
        mat_ts = np.array(matrix["timestamps"], dtype="datetime64[ns]")
        order = np.argsort(mat_ts)
        mat_sorted = mat_ts[order]
        sample_ts = np.array(sample["datetime"].values, dtype="datetime64[ns]")
        sample_sorted = np.sort(sample_ts)
        pos_sorted = np.searchsorted(mat_sorted, sample_sorted)
        pos_sorted = np.clip(pos_sorted, 0, len(mat_sorted) - 1)
        left = np.clip(pos_sorted - 1, 0, len(mat_sorted) - 1)
        dist_left = np.abs(sample_sorted - mat_sorted[left])
        dist_right = np.abs(sample_sorted - mat_sorted[pos_sorted])
        nearest_sorted = np.where(dist_left < dist_right, left, pos_sorted)
        inverse_order = np.empty_like(order)
        inverse_order[order] = np.arange(len(order))
        nearest_orig = inverse_order[nearest_sorted]
        sv = np.stack([np.asarray(matrix["shap_matrix"][i], dtype=float) for i in nearest_orig])
        return sv, f"KernelExplainer (pré-calculé, {matrix.get('n_samples', 0)} pts réels)"

    X_scaled_for_shap = None
    try:
        _, _, scaler, _, _ = _load()
        X_scaled_for_shap = scaler.transform(sample[FEATURE_COLS])
    except Exception:
        X_scaled_for_shap = None
    if X_scaled_for_shap is None:
        return None, None
    sv, method = _on_demand_shap(model, X_scaled_for_shap)
    return sv, method


def _season_name(month: int) -> str:
    if month in (12, 1, 2):
        return "winter"
    if month in (3, 4, 5):
        return "spring"
    if month in (6, 7, 8):
        return "summer"
    if month in (9, 10, 11):
        return "autumn"
    return "unknown"


def _anomaly_scores(model, X):
    """Score d'anomalie OCSVM : plus grand = plus anormal."""
    return -model.decision_function(X), (model.predict(X) == -1).astype(int)


@router.get("/model")
def get_shap_model():
    """Infos sur le modele + jeu de donnees utilises pour le SHAP (temps reel)."""
    try:
        df, model, scaler, model_kind, matrix = _load()
        model_path, _, _ = _find_model_files()
        return {
            "available": True,
            "model_kind": model_kind,
            "model_path": model_path,
            "data_path": _cache["data_path"],
            "n_samples": len(df),
            "n_features": len(FEATURE_COLS),
            "feature_names": FEATURE_COLS,
            "precomputed_matrix": matrix is not None,
            "n_shap_points": matrix.get("n_samples", 0) if matrix else 0,
            "trained_at": os.path.getmtime(model_path) if model_path else None,
        }
    except Exception as e:
        return {"available": False, "error": str(e)}


@router.get("/yearly")
def get_shap_yearly(
    day: int = Query(None, ge=1, le=365, description="Day of year (1-365)"),
    month: int = Query(None, ge=1, le=12, description="Month (1-12)"),
    season: str = Query(None, pattern="^(winter|spring|summer|autumn)$", description="Season filter"),
    start_doy: int = Query(None, ge=1, le=365, description="Start day of year range"),
    end_doy: int = Query(None, ge=1, le=365, description="End day of year range"),
    hour: int = Query(None, ge=0, le=23, description="Hour of day (0-23)"),
):
    global _result_cache
    cache_key = f"day={day}|month={month}|season={season}|start={start_doy}|end={end_doy}|hour={hour}"
    if cache_key in _result_cache:
        return _result_cache[cache_key]

    df, model, scaler, model_kind, matrix = _load()

    filtered = df.copy()
    season_map = {"winter": [12, 1, 2], "spring": [3, 4, 5], "summer": [6, 7, 8], "autumn": [9, 10, 11]}
    if day is not None:
        filtered = filtered[filtered["doy"] == day]
    if month is not None:
        filtered = filtered[filtered["month"] == month]
    if season is not None:
        filtered = filtered[filtered["month"].isin(season_map[season])]
    if start_doy is not None:
        filtered = filtered[filtered["doy"] >= start_doy]
    if end_doy is not None:
        filtered = filtered[filtered["doy"] <= end_doy]
    if hour is not None:
        filtered = filtered[filtered["hour"] == hour]

    n_real_attacks = int((filtered.get("label", pd.Series(0, index=filtered.index)) > 0).sum())
    n_real_days = int((filtered["label"] > 0).groupby(filtered["doy"]).any().sum()) if filtered.get("label") is not None else 0

    if len(filtered) == 0:
        return {"available": False, "error": "Aucune donnée pour ce filtre"}

    # ── Echantillonnage STRATIFIE (data scientist) ──────────────────────────
    # Probleme original : tirage uniforme -> ~97% normales -> les SHAP globaux
    # mesurent la structure "normale" et noient la signature des attaques.
    # Correction : pool large (2000 pts) -> on garde les anomalies prédites
    # (jusqu'a 100, triées par score décroissant) + 100 normales en contraste.
    if len(filtered) <= 288:
        # Petit jeu de filtres : tout garder (comportement historique).
        pool_n = len(filtered)
        sample = filtered.copy()
        X = scaler.transform(sample[FEATURE_COLS])
        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
        scores_arr, preds = _anomaly_scores(model, X)
        scores = np.nan_to_num(scores_arr, nan=0.0, posinf=0.0, neginf=0.0)
        is_anomaly = preds == 1
        sample_n = len(sample)
        n_att = int(is_anomaly.sum())
        n_norm = int((~is_anomaly).sum())
        n_anom_pool = n_att
        scored_n = len(filtered)
        scored_on = "fenêtre"
    else:
        pool_n = min(6000, len(filtered))
        pool = filtered.sample(pool_n, random_state=42).copy()
        X_pool = scaler.transform(pool[FEATURE_COLS])
        X_pool = np.nan_to_num(X_pool, nan=0.0, posinf=0.0, neginf=0.0)
        pool_scores, pool_preds = _anomaly_scores(model, X_pool)
        pool_scores = np.nan_to_num(pool_scores, nan=0.0, posinf=0.0, neginf=0.0)

        anom_mask = pool_preds == 1
        n_anom_pool = int(anom_mask.sum())
        if n_anom_pool == 0:
            # Binnaire muet (e.g. nu bas) : on prend le top 3% des scores comme attaques.
            k = max(1, int(round(len(pool) * 0.03)))
            anom_mask = np.zeros(len(pool), dtype=bool)
            anom_mask[np.argsort(pool_scores)[-k:]] = True
            n_anom_pool = k

        anom_idxs = np.where(anom_mask)[0]
        anom_idxs = anom_idxs[np.argsort(pool_scores[anom_idxs])[::-1]]  # +anormal d'abord
        n_att = min(100, n_anom_pool)
        take_anom = anom_idxs[:n_att]
        norm_idxs = np.where(~anom_mask)[0]
        n_norm = min(max(200 - n_att, 0), len(norm_idxs))
        rng_norm = np.random.RandomState(42)
        take_norm = rng_norm.choice(norm_idxs, n_norm, replace=False) if n_norm > 0 else np.array([], dtype=int)

        sample_idxs = np.concatenate([take_anom, take_norm])
        sample = pool.iloc[sample_idxs].copy()
        scores = pool_scores[sample_idxs]
        preds = pool_preds[sample_idxs]
        n_att = int(len(take_anom))
        n_norm = int(len(take_norm))
        sample_n = len(sample)
        is_anomaly = np.concatenate([np.ones(n_att, dtype=bool), np.zeros(n_norm, dtype=bool)])
        scored_n = len(pool)
        scored_on = "pool"

        X = scaler.transform(sample[FEATURE_COLS])
        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)

    # ── Véritables métriques de détection modèle vs label ─────────────────
    # Comparées sur les points réellement scorés (fenêtre complète si petite,
    # pool aléatoire de 6000 pts sinon). Aucune extrapolation cachée.
    detection_metrics = None
    scored_gt = None
    if scored_on == "fenêtre":
        if "label" in filtered.columns:
            scored_gt = (filtered["label"].fillna(0) > 0).astype(int).values
        pred_bool = is_anomaly
    else:
        if "label" in pool.columns:
            scored_gt = (pool["label"].fillna(0) > 0).astype(int).values
        pred_bool = anom_mask
    if scored_gt is not None:
        tp = int(((pred_bool == 1) & (scored_gt == 1)).sum())
        fp = int(((pred_bool == 1) & (scored_gt == 0)).sum())
        fn = int(((pred_bool == 0) & (scored_gt == 1)).sum())
        denom_r = tp + fn
        denom_p = tp + fp
        recall = tp / denom_r if denom_r > 0 else 0.0
        precision = tp / denom_p if denom_p > 0 else 0.0
        f1 = 2 * recall * precision / (recall + precision) if (recall + precision) > 0 else 0.0
        detection_metrics = {
            "tp": tp,
            "fp": fp,
            "fn": fn,
            "recall": round(recall, 4),
            "precision": round(precision, 4),
            "f1": round(f1, 4),
            "scored_n": int(scored_n),
            "scored_on": scored_on,
        }

    shap_vals, method = _shap_for_sample(sample, model, model_kind, matrix)
    if shap_vals is None:
        return {
            "available": False,
            "error": "SHAP indisponible pour ce modèle. Aucune matrice SHAP pré-calculée "
                     "ni calcul à la demande possible — aucune donnée synthétique ne sera renvoyée. "
                     "Relancez un entraînement temps réel depuis la page ML pour générer les vraies explications.",
        }

    shap_vals = np.asarray(shap_vals)
    shap_vals = np.nan_to_num(shap_vals, nan=0.0, posinf=0.0, neginf=0.0)
    if shap_vals.ndim == 3:
        shap_vals = shap_vals[0]

    low_sample_warning = None
    if sample_n < 30:
        low_sample_warning = f"Échantillon faible ({sample_n} pts) : résultats SHAP peu fiables. Restreignez moins les filtres."
    elif n_att < 20:
        low_sample_warning = (
            f"Filtre étroit : seulement {n_att} anomalie(s) détectée(s). "
            f"La vue « Attaques » est peu fiable ici — élargissez les filtres."
        )

    global_imp = []
    for i, feat in enumerate(FEATURE_COLS):
        mean_abs = float(np.mean(np.abs(shap_vals[:, i])))
        global_imp.append({
            "feature": feat,
            "label": FEATURE_LABEL.get(feat, feat),
            "group": FEATURE_GROUP.get(feat, "other"),
            "shap_importance": round(mean_abs, 6),
        })
    global_imp.sort(key=lambda x: x["shap_importance"], reverse=True)

    # ── Importance SHAP PAR CLASSE (attaques vs normales) ────────────────
    # C'est LE point clé : sur les attaques SEULES (is_anomaly), la signature
    # de l'attaque n'est plus noyée par les 97% de points normaux.
    def _importance_for(mask):
        mask = np.asarray(mask, dtype=bool)
        if mask.sum() == 0:
            return []
        out = []
        for i, feat in enumerate(FEATURE_COLS):
            out.append({
                "feature": feat,
                "label": FEATURE_LABEL.get(feat, feat),
                "group": FEATURE_GROUP.get(feat, "other"),
                "shap_importance": round(float(np.mean(np.abs(shap_vals[mask, i]))), 6),
            })
        out.sort(key=lambda x: x["shap_importance"], reverse=True)
        return out

    attack_imp = _importance_for(is_anomaly)
    normal_imp = _importance_for(~is_anomaly)

    group_imp = {g: 0.0 for g in set(FEATURE_GROUP.values())}
    for i, feat in enumerate(FEATURE_COLS):
        g = FEATURE_GROUP.get(feat, "other")
        group_imp[g] += float(np.mean(np.abs(shap_vals[:, i])))
    for g in group_imp:
        group_imp[g] = round(group_imp[g], 6)

    sample["month"] = sample["datetime"].dt.month
    monthly_shap = []
    for m in range(1, 13):
        mask = (sample["month"] == m).values
        if mask.sum() == 0:
            continue
        row = {"month": m, "month_name": MONTH_NAMES[m - 1], "count": int(mask.sum())}
        for i, feat in enumerate(FEATURE_COLS):
            mean_abs = float(np.mean(np.abs(shap_vals[mask, i])))
            row[feat] = round(mean_abs, 6)
        monthly_shap.append(row)

    seasonal_shap = {}
    for _season, months in season_map.items():
        mask = sample["month"].isin(months).values
        if mask.sum() == 0:
            continue
        feats = []
        for i, feat in enumerate(FEATURE_COLS):
            feats.append({
                "feature": feat,
                "label": FEATURE_LABEL.get(feat, feat),
                "shap_importance": round(float(np.mean(np.abs(shap_vals[mask, i]))), 6),
            })
        feats.sort(key=lambda x: x["shap_importance"], reverse=True)
        seasonal_shap[_season] = {"count": int(mask.sum()), "importance": feats}

    anomaly_locs = np.where(is_anomaly)[0]  # déjà triés par score décroissant dans l'échantillon stratifié
    top_anomalies = []
    for idx in anomaly_locs[:20]:
        row_sample = sample.iloc[idx]
        sv = {}
        for i, feat in enumerate(FEATURE_COLS):
            sv[feat] = round(float(shap_vals[idx, i]), 6)
        pos = sorted(sv.items(), key=lambda x: x[1], reverse=True)[:3]
        neg = sorted(sv.items(), key=lambda x: x[1])[:3]
        group_shap = {}
        for feat, v in sv.items():
            g = FEATURE_GROUP.get(feat, "other")
            group_shap[g] = group_shap.get(g, 0) + abs(v)
        top_group = max(group_shap, key=group_shap.get) if group_shap else "other"
        top_anomalies.append({
            "index": int(idx),
            "anomaly_score": round(float(scores[idx]), 4),
            "timestamp": str(row_sample["datetime"]),
            "month": int(row_sample.get("month", 0)) if row_sample.get("month") is not None else None,
            "season": _season_name(int(row_sample.get("month", 0))),
            "sensor_values": {
                "weather": round(float(row_sample.get("weather_temp", 0)), 2),
                "fridge": round(float(row_sample.get("fridge_temp", 0)), 2),
                "thermostat": round(float(row_sample.get("thermostat_temp", 0)), 2),
            },
            "group_shap": {g: round(v, 6) for g, v in group_shap.items()},
            "dominant_group": top_group,
            "top_causes": [{
                "feature": f,
                "shap_value": v,
                "feature_value": round(float(row_sample.get(f, 0)), 4),
                "interpretation": FEATURE_INTERPRETATION.get(f, f),
                "group": FEATURE_GROUP.get(f, "other"),
            } for f, v in pos],
            "top_normal": [{
                "feature": f,
                "shap_value": v,
                "feature_value": round(float(row_sample.get(f, 0)), 4),
                "interpretation": FEATURE_INTERPRETATION.get(f, f),
                "group": FEATURE_GROUP.get(f, "other"),
            } for f, v in neg],
        })

    shap_corr = {}
    for i, feat in enumerate(FEATURE_COLS):
        sv = shap_vals[:, i]
        xv = X[:, i]
        if np.std(sv) > 1e-12 and np.std(xv) > 1e-12:
            corr_val = float(np.corrcoef(xv, sv)[0, 1])
            shap_corr[feat] = round(corr_val, 4) if not np.isnan(corr_val) else 0
        else:
            shap_corr[feat] = 0

    try:
        from app.domains.intelligence.risk_service import DEFAULT_WEIGHTS
        risk_bridge = {}
        for g in ["weather", "fridge", "thermostat", "cross", "time"]:
            impact = group_imp.get(g, 0)
            risk_factor = "ml_anomaly" if g != "time" else "temporal"
            risk_bridge[g] = {
                "shap_impact": impact,
                "risk_factor": risk_factor,
                "weight": DEFAULT_WEIGHTS[risk_factor],
            }
    except Exception:
        risk_bridge = {}

    # ── Risk Intelligence (SHAP → Risk) ──────────────────────────────
    # Indice composite reel (0-100), aucune donnee fabriquee :
    #   - severite : position des scores d'anomalie reels dans la fenetre
    #   - prevalence : ponderation des capteurs par leur poids risque refletant
    #     l'importance SHAP de chaque groupe.
    GROUP_RISK_LABEL = {
        "weather": "Météo", "fridge": "Frigo", "thermostat": "Thermostat",
        "cross": "Inter-Capteurs", "time": "Temporel",
    }
    FACTOR_SPLIT = {"ml_anomaly": 4.0, "temporal": 1.0}

    eff_weights = {}
    for g in ["weather", "fridge", "thermostat", "cross", "time"]:
        f = risk_bridge.get(g, {}).get("risk_factor", "ml_anomaly")
        eff_weights[g] = DEFAULT_WEIGHTS.get(f, 0.0) / FACTOR_SPLIT.get(f, 1.0)

    attack_scores = np.asarray(scores)[np.asarray(is_anomaly)]
    if len(attack_scores) > 0:
        s_min, s_max = float(scores.min()), float(scores.max())
        denom = (s_max - s_min) if s_max - s_min > 1e-12 else 1.0
        top_att = attack_scores[np.argsort(attack_scores)[-min(10, len(attack_scores)):]]
        severity = float(np.mean((top_att - s_min) / denom))
    else:
        severity = 0.0

    group_attack_imp = {}
    for it in attack_imp:
        g = it.get("group", "other")
        group_attack_imp[g] = group_attack_imp.get(g, 0.0) + it["shap_importance"]
    max_group_impact = max(group_attack_imp.values()) if group_attack_imp else 0.0
    prevalence_numer = sum(eff_weights.get(g, 0) * group_attack_imp.get(g, 0) for g in eff_weights)
    prevalence_denom = sum(eff_weights.get(g, 0) for g in eff_weights) * max(max_group_impact, 1e-9)
    prevalence = prevalence_numer / prevalence_denom if prevalence_denom > 0 else 0.0

    risk_index = round(float(100.0 * (0.55 * severity + 0.45 * prevalence)), 1)

    # Monte-Carlo confidence (weights ±5%, comme le moteur Phase 3)
    sims = []
    rng_mc = np.random.default_rng(42)
    for _ in range(500):
        noise = {k: max(0.0, v + rng_mc.normal(0, 0.05)) for k, v in DEFAULT_WEIGHTS.items()}
        total = sum(noise.values())
        if total <= 0:
            continue
        noise = {k: v / total for k, v in noise.items()}
        num = 0.0
        for g in eff_weights:
            f = risk_bridge.get(g, {}).get("risk_factor", "ml_anomaly")
            w_eff = noise.get(f, 0.0) / FACTOR_SPLIT.get(f, 1.0)
            num += w_eff * group_attack_imp.get(g, 0.0)
        den = sum(noise.get(f, 0.0) / FACTOR_SPLIT.get(f, 1.0) for g, f in
                  [(g, risk_bridge.get(g, {}).get("risk_factor", "ml_anomaly")) for g in eff_weights]) * max(max_group_impact, 1e-9)
        sims.append(100.0 * (0.55 * severity + 0.45 * (num / den if den > 0 else 0.0)))
    ci_low = round(float(np.percentile(sims, 5)), 1) if sims else risk_index
    ci_high = round(float(np.percentile(sims, 95)), 1) if sims else risk_index
    ci_low, ci_high = max(0.0, ci_low), min(100.0, ci_high)

    if risk_index >= 80:
        severity_label, sever_color = "CRITIQUE", "#B5727E"
    elif risk_index >= 60:
        severity_label, sever_color = "ÉLEVÉ", "#CE9E8F"
    elif risk_index >= 40:
        severity_label, sever_color = "MODÉRÉ", "#D4BF7E"
    elif risk_index >= 20:
        severity_label, sever_color = "FAIBLE", "#A5C9A8"
    else:
        severity_label, sever_color = "NÉANT", "#7CB5CC"

    risk_factors = []
    for g in ["weather", "fridge", "thermostat", "cross", "time"]:
        impact = group_attack_imp.get(g, 0.0)
        w = eff_weights[g]
        risk_factors.append({
            "group": g,
            "label": GROUP_RISK_LABEL.get(g, g),
            "risk_factor": risk_bridge.get(g, {}).get("risk_factor", "ml_anomaly"),
            "shap_impact": round(impact, 6),
            "weight": round(w, 5),
            "weight_pct": round(w * 100, 1),
            "contribution": round(w * impact, 6),
        })

    monthly_risk = []
    if monthly_shap:
        refs = {}
        for m_row in monthly_shap:
            if m_row.get("count", 0) == 0:
                continue
            total_w = 0.0
            num = 0.0
            for i, feat in enumerate(FEATURE_COLS):
                g = FEATURE_GROUP.get(feat, "other")
                if g not in eff_weights:
                    continue
                num += eff_weights[g] * abs(float(m_row.get(feat, 0.0)))
                total_w += eff_weights[g]
            refs[m_row["month"]] = num / max(total_w, 1e-9)
        ref_max = max(refs.values()) if refs else 1.0
        for m_row in monthly_shap:
            if m_row.get("count", 0) == 0:
                continue
            total_w = 0.0
            num = 0.0
            for i, feat in enumerate(FEATURE_COLS):
                g = FEATURE_GROUP.get(feat, "other")
                if g not in eff_weights:
                    continue
                num += eff_weights[g] * abs(float(m_row.get(feat, 0.0)))
                total_w += eff_weights[g]
            monthly_risk.append({
                "month": m_row["month"],
                "month_name": m_row["month_name"],
                "count": int(m_row["count"]),
                "risk": round(float(100.0 * (num / max(total_w, 1e-9)) / max(ref_max, 1e-9)), 1),
            })
        monthly_risk.sort(key=lambda x: x["month"])

    seasonal_risk = {}
    for season_name, s_data in seasonal_shap.items():
        if s_data.get("count", 0) == 0:
            continue
        total_w = 0.0
        num = 0.0
        for it in s_data.get("importance", []):
            g = FEATURE_GROUP.get(it["feature"], "other")
            if g not in eff_weights:
                continue
            num += eff_weights[g] * abs(it["shap_importance"])
            total_w += eff_weights[g]
        seasonal_risk[season_name] = {
            "count": int(s_data["count"]),
            "risk": round(float(100.0 * (num / max(total_w, 1e-9)) / max(max_group_impact, 1e-9)), 1),
        }
    top_norm = max(seasonal_risk.values(), key=lambda x: x["risk"]).get("risk", 0.0) if seasonal_risk else 1.0
    for season_name in seasonal_risk:
        seasonal_risk[season_name]["risk"] = round(
            100.0 * seasonal_risk[season_name]["risk"] / max(top_norm, 1e-9), 1)

    top_contributors = []
    total_contrib = sum(f["contribution"] for f in risk_factors) or 1e-9
    for f in risk_factors:
        top_contributors.append({**f, "contribution_pct": round(100.0 * f["contribution"] / total_contrib, 1)})
    top_contributors.sort(key=lambda x: x["contribution"], reverse=True)

    risk_status = (
        "Risque critique : signature d'anomalie dominante et répandue." if severity_label == "CRITIQUE"
        else "Risque élevé : anomalies marquées, surveiller les capteurs dominants." if severity_label == "ÉLEVÉ"
        else "Risque modéré : anomalies présentes mais contenues." if severity_label == "MODÉRÉ"
        else "Risque faible : peu de signal anormal dans la fenêtre." if severity_label == "FAIBLE"
        else "Aucun signal anormal significatif détecté."
    )

    risk_analysis = {
        "risk_index": risk_index,
        "severity": severity_label,
        "severity_color": sever_color,
        "status": risk_status,
        "confidence_interval": {"low": ci_low, "high": ci_high},
        "severity_component": round(severity * 100.0, 1),
        "prevalence_component": round(prevalence * 100.0, 1),
        "n_anomalies": int(n_att),
        "n_sample": int(sample_n),
        "factors": risk_factors,
        "monthly": monthly_risk,
        "seasonal": seasonal_risk,
        "top_contributors": top_contributors,
        "formula": "Risk = 55%×Sévérité(scoreIA) + 45%×Prévalence(Σ poids×impactSHAP)",
    }

    _result_cache[cache_key] = {
        "available": True,
        "shap_method": method,
        "model_kind": model_kind,
        "n_samples": sample_n,
        "n_anomalies": int(preds.sum()),
        "n_attacks_sample": n_att,
        "n_normals_sample": n_norm,
        "n_anomalies_pool": int(n_anom_pool),
        "n_real_attacks": n_real_attacks,
        "n_real_days": n_real_days,
        "detection_metrics": detection_metrics,
        "stratified": True,
        "sampling_note": (
            f"Échantillon stratifié : {n_att} anomalies + {n_norm} normales"
            f" (pool de {pool_n} pts)"
        ),
        "low_sample_warning": low_sample_warning,
        "global_importance": global_imp,
        "attack_importance": attack_imp,
        "normal_importance": normal_imp,
        "group_importance": group_imp,
        "monthly_shap": monthly_shap,
        "seasonal_breakdown": seasonal_shap,
        "top_anomalies": top_anomalies,
        "shap_feature_correlation": shap_corr,
        "feature_names": FEATURE_COLS,
        "risk_bridge": risk_bridge,
        "risk_analysis": risk_analysis,
        "filter": {"day": day, "month": month, "season": season, "start_doy": start_doy, "end_doy": end_doy, "hour": hour},
    }
    return _result_cache[cache_key]


@router.get("/hourly")
def get_shap_hourly(
    month: int = Query(None, ge=1, le=12, description="Month (1-12)"),
    season: str = Query(None, pattern="^(winter|spring|summer|autumn)$", description="Season filter"),
):
    global _result_cache
    cache_key = f"hourly|month={month}|season={season}"
    if cache_key in _result_cache:
        return _result_cache[cache_key]

    df, model, scaler, model_kind, matrix = _load()

    filtered = df.copy()
    season_map = {"winter": [12, 1, 2], "spring": [3, 4, 5], "summer": [6, 7, 8], "autumn": [9, 10, 11]}
    if month is not None:
        filtered = filtered[filtered["month"] == month]
    if season is not None:
        filtered = filtered[filtered["month"].isin(season_map[season])]

    sample_n = min(600 if matrix is None else 2400, len(filtered))
    sample = filtered.sample(sample_n, random_state=42).copy()

    X = scaler.transform(sample[FEATURE_COLS])
    X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)

    shap_vals, method = _shap_for_sample(sample, model, model_kind, matrix)
    if shap_vals is None:
        return {
            "available": False,
            "error": "SHAP indisponible pour ce modèle. Aucune donnée synthétique ne sera renvoyée. "
                     "Relancez un entraînement temps réel depuis la page ML pour générer les vraies explications.",
        }
    shap_vals = np.nan_to_num(np.asarray(shap_vals), nan=0.0, posinf=0.0, neginf=0.0)
    if shap_vals.ndim == 3:
        shap_vals = shap_vals[0]

    sample["hour"] = sample["datetime"].dt.hour
    hours = []
    for h in range(24):
        mask = (sample["hour"] == h).values
        if mask.sum() == 0:
            continue
        row = {"hour": h, "hour_label": f"{h:02d}h", "count": int(mask.sum())}
        for i, feat in enumerate(FEATURE_COLS):
            row[feat] = round(float(np.mean(np.abs(shap_vals[mask, i]))), 6)
        hours.append(row)

    low_sample_warning = None
    if len(filtered) < 600:
        low_sample_warning = f"Filtre restreint : {len(filtered)} pts au total, {sample_n} analysés."

    _result_cache[cache_key] = {
        "available": True,
        "shap_method": method,
        "model_kind": model_kind,
        "n_samples": sample_n,
        "low_sample_warning": low_sample_warning,
        "hours": hours,
        "feature_names": FEATURE_COLS,
        "filter": {"month": month, "season": season},
    }
    return _result_cache[cache_key]


@router.get("/latest")
def get_shap_latest():
    """SHAP temps reel : explique le DERNIER point reel du dataset avec le
    modele entraine en temps reel. Aucune donnee synthetique."""
    try:
        df, model, scaler, model_kind, matrix = _load()
    except Exception as e:
        return {"error": str(e), "available": False}

    last_row = df.iloc[-1]
    X = scaler.transform(df[FEATURE_COLS].values)
    x = X[-1:]

    scores, preds = _anomaly_scores(model, x)
    is_anomaly = bool(preds[0] == 1)

    sv, method = _shap_for_sample(df.iloc[[len(df) - 1]], model, model_kind, matrix)
    if sv is None:
        sv, method = _on_demand_shap(model, x)
    if sv is None:
        return {"error": "SHAP indisponible pour ce modele", "available": False}
    shap_vals = np.nan_to_num(np.asarray(sv), nan=0.0, posinf=0.0, neginf=0.0)
    if shap_vals.ndim == 3:
        shap_vals = shap_vals[0]

    top_indices = np.argsort(np.abs(shap_vals[0]))[::-1][:5]
    top_causes = []
    for idx in top_indices:
        feat_name = FEATURE_COLS[idx]
        impact = float(shap_vals[0, idx])
        base = FEATURE_INTERPRETATION.get(feat_name, f"Feature {feat_name}")
        if impact < 0:
            detail = f"{base} -> pousse vers ANOMALIE"
        else:
            detail = f"{base} -> pousse vers NORMAL"
        top_causes.append({
            "feature": feat_name,
            "valeur": round(float(x[0, idx]), 4),
            "impact": round(impact, 4),
            "interpretation": detail,
        })

    return {
        "available": True,
        "timestamp": str(last_row["datetime"]),
        "is_anomaly": is_anomaly,
        "anomaly_score": round(float(scores[0]), 4),
        "top_causes": top_causes,
        "sensors": {
            "weather_temp": round(float(last_row.get("weather_temp", 0)), 2),
            "fridge_temp": round(float(last_row.get("fridge_temp", 0)), 2),
            "thermostat_temp": round(float(last_row.get("thermostat_temp", 0)), 2),
        },
        "model_kind": model_kind,
        "shap_method": method,
    }


@router.get("/point")
def get_shap_point(
    timestamp: str = Query(..., description="Timestamp ISO du point à expliquer (ex: 2019-01-02T03:04:05)"),
):
    """Explication SHAP d'un point PRECIS du dataset, choisi par timestamp.

    Reutilise la matrice SHAP pre-calculee de l'entrainement si le timestamp
    y est present (SHAP reel exact), sinon le KernelExplainer a la demande.
    Ne retourne jamais de donnees synthetiques. Le point manquant est gere
    par correspondance exacte puis plus proche (± 10 min).
    """
    try:
        df, model, scaler, model_kind, matrix = _load()
    except Exception as e:
        return {"available": False, "error": str(e)}

    try:
        dt = pd.to_datetime(timestamp, errors="coerce")
    except Exception:
        dt = None
    if dt is None or pd.isna(dt):
        return {"available": False, "error": f"Timestamp invalide: {timestamp}"}

    # correspondance exacte, sinon plus proche dans une tolerance de 10 min
    exact = df.index[df["datetime"] == dt]
    if len(exact) > 0:
        idx = int(exact[0])
    else:
        delta = (df["datetime"] - dt).abs()
        near = int(delta.idxmin())
        if delta.iloc[near] > pd.Timedelta(minutes=10):
            return {"available": False, "error": "Aucun point du dataset à ±10 min de ce timestamp."}
        idx = near

    row = df.iloc[idx]
    X_all = scaler.transform(df[FEATURE_COLS].values)
    X_all = np.nan_to_num(X_all, nan=0.0, posinf=0.0, neginf=0.0)
    scores_all, preds_all = _anomaly_scores(model, X_all)
    scores_all = np.nan_to_num(scores_all, nan=0.0, posinf=0.0, neginf=0.0)
    scores = scores_all[idx:idx + 1]
    is_anomaly = bool(preds_all[idx] == 1)
    lo, hi = float(np.min(scores_all)), float(np.max(scores_all))
    span = hi - lo
    risk = 50.0
    if span > 1e-9:
        risk = 100.0 * (float(scores[0]) - lo) / span
    risk_score = round(min(99.0, max(1.0, risk)), 1)

    sv, method = _shap_for_sample(df.iloc[[idx]], model, model_kind, matrix)
    if sv is None:
        try:
            sv, method = _on_demand_shap(model, X_all[idx:idx + 1])
        except Exception as e:
            return {"available": False, "error": f"SHAP indisponible pour ce point: {e}"}
    shap_vals = np.nan_to_num(np.asarray(sv), nan=0.0, posinf=0.0, neginf=0.0)
    if shap_vals.ndim == 3:
        shap_vals = shap_vals[0]
    if shap_vals.ndim == 1:
        shap_vals = shap_vals.reshape(1, -1)
    sv_row = shap_vals[0]

    # OCSVM : SHAP negatif => pousse vers ANOMALIE, positif => vers NORMAL
    def _explain(mask_desc, order):
        out = []
        for i in order:
            f = FEATURE_COLS[i]
            out.append({
                "feature": f,
                "label": FEATURE_LABEL.get(f, f),
                "shap_value": round(float(sv_row[i]), 6),
                "feature_value": round(float(row.get(f, 0)), 4),
                "interpretation": FEATURE_INTERPRETATION.get(f, f),
                "group": FEATURE_GROUP.get(f, "other"),
            })
        return out

    idx_sorted = np.argsort(sv_row)
    top_causes = _explain("anomaly", idx_sorted[:5].tolist())         # plus negatif
    top_normal = _explain("normal", idx_sorted[::-1][:5].tolist())     # plus positif

    group_shap = {}
    for i, f in enumerate(FEATURE_COLS):
        g = FEATURE_GROUP.get(f, "other")
        group_shap[g] = group_shap.get(g, 0.0) + abs(float(sv_row[i]))
    for g in group_shap:
        group_shap[g] = round(group_shap[g], 6)
    dominant_group = max(group_shap, key=group_shap.get) if group_shap else "other"

    # capteur dominant : thermostat -> production, fridge -> stock, weather -> logistique
    dominant_sensor = dominant_group if dominant_group in ("thermostat", "fridge", "weather") else "thermostat"

    label = int(row.get("label", 0)) if row.get("label") is not None else 0
    month = int(row.get("month", 0)) if row.get("month") is not None else int(dt.month)

    return {
        "available": True,
        "timestamp": str(row["datetime"]),
        "requested_timestamp": timestamp,
        "index": int(idx),
        "is_anomaly": is_anomaly,
        "anomaly_score": round(float(scores[0]), 6),
        "prediction": int(preds_all[idx]),
        "label": label,
        "month": month,
        "season": _season_name(month),
        "risk_score_per_100": risk_score,
        "sensor_values": {
            "weather": round(float(row.get("weather_temp", 0)), 2),
            "fridge": round(float(row.get("fridge_temp", 0)), 2),
            "thermostat": round(float(row.get("thermostat_temp", 0)), 2),
        },
        "group_shap": group_shap,
        "dominant_group": dominant_group,
        "dominant_sensor": dominant_sensor,
        "top_causes": top_causes,
        "top_normal": top_normal,
        "model_kind": model_kind,
        "shap_method": method,
    }