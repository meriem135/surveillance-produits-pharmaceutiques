"""Pipeline d'entraînement One-Class SVM (features, split, évaluation, modèle).

Ce module ne contient aucun endpoint HTTP : il est utilisé par les scripts
d'entraînement et par le service de transmission.
"""

import json, os, io, asyncio, traceback
from datetime import datetime
import joblib
import numpy as np
import pandas as pd
from app.core import paths
from app.domains.ml.progress import TrainingProgressManager
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.svm import OneClassSVM
from sklearn.metrics import (
    precision_score, recall_score, f1_score, roc_auc_score,
    average_precision_score, precision_recall_curve, confusion_matrix,
)

SEED = 42

try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    SHAP_AVAILABLE = False


RESULTS_PATH = str(paths.RESULTS_COMPARISON)

FEATURE_COLS = [
    "weather_temp", "fridge_temp", "thermostat_temp",
    "weather_diff_1", "weather_roll_mean_10", "weather_roll_std_10",
    "fridge_diff_1", "fridge_roll_mean_10", "fridge_roll_std_10",
    "thermostat_diff_1", "thermostat_roll_mean_10", "thermostat_roll_std_10",
    "weather_fridge_diff", "weather_thermostat_diff", "fridge_thermostat_diff",
    "hour_sin", "hour_cos", "season_sin", "season_cos",
    "fridge_cond_enc", "thermo_status",
]

ATTACK_DB_NAMES = {
    "ddos": "IoT_DDoS_normal",
    "dos": "IoT_DoS_normal",
    "mitm": "IoT_MITM_normal",
    "xss": "IoT_XSS_normal",
    "backdoor": "IoT_backdoor_normal",
    "injection": "IoT_Injection_normal",
    "password": "IoT_password_normal",
    "ransomware": "IoT_ransomware_normal",
    "scanning": "IoT_scanning_normal",
}

SENSOR_MAP = {
    "weather": {"temperature": "weather_temp", "label": "label_w"},
    "fridge": {"fridge_temperature": "fridge_temp", "temp_condition": "fridge_cond", "label": "label_f"},
    "thermostat": {"current_temperature": "thermostat_temp", "thermostat_status": "thermo_status", "label": "label_t"},
}


# ══════════════════════════════════════════════════════════════════════════════
#  Progression d'entraînement
# ══════════════════════════════════════════════════════════════════════════════

progress_manager = TrainingProgressManager()

# Id du dernier entraînement TERMINÉ dans ce processus serveur.
_last_completed_model_id: int | None = None


async def _emit(step: str, progress: int, message: str, **extra):
    payload = {"step": step, "progress": progress, "message": message, **extra}
    await progress_manager.broadcast(payload)


# ══════════════════════════════════════════════════════════════════════════════
#  Feature Engineering
# ══════════════════════════════════════════════════════════════════════════════

def _engineer_features(df: pd.DataFrame) -> pd.DataFrame:
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

    # Encodage reel identique au notebook (common_model._build_fusion) :
    # LabelEncoder sur temp_condition, conversion numerique de thermostat_status.
    # Fallback 0/1 si les colonnes sources sont absentes (upload partiel).
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


def _load_uploaded_files(weather_file, fridge_file, thermostat_file) -> dict:
    files = {}
    for label, uf in [("weather", weather_file), ("fridge", fridge_file), ("thermostat", thermostat_file)]:
        if uf is None:
            continue
        content = uf.file_content if hasattr(uf, "file_content") else None
        if content is None:
            content = uf.read() if hasattr(uf, "read") else None
        if content is None:
            continue
        df = pd.read_csv(io.BytesIO(content))
        if "datetime" in df.columns:
            df["datetime"] = df["datetime"].astype(str).str.replace(r"^201-", "2019-", regex=True)
            df["datetime"] = pd.to_datetime(df["datetime"], errors="coerce")
            df = df.dropna(subset=["datetime"]).drop_duplicates(subset=["datetime"]).sort_values("datetime").reset_index(drop=True)
        files[label] = df
    return files


def _load_disk_files() -> dict:
    files = {}
    for sensor, path in paths.CONCAT_CSV.items():
        if path.exists():
            df = pd.read_csv(path)
            df["datetime"] = df["datetime"].astype(str).str.replace(r"^201-", "2019-", regex=True)
            df["datetime"] = pd.to_datetime(df["datetime"], errors="coerce")
            df = df.dropna(subset=["datetime"]).drop_duplicates(subset=["datetime"]).sort_values("datetime").reset_index(drop=True)
            files[sensor] = df
    return files


def _load_fusionne_dataset() -> pd.DataFrame | None:
    """Charge `dataset_fusionne.csv` — le MÊME fichier que le notebook OneClassSVM.ipynb.

    Il contient deja les 21 features multivariees (dont `fridge_cond_enc` et
    `thermo_status` reels) et la colonne `label`. Seul le nom des 3 features de
    difference inter-capteurs differe (`w_f_diff` etc.) -> renommage pour
    correspondre a FEATURE_COLS.
    """
    candidates = [str(paths.DATASET_FUSIONNE)]
    for path in candidates:
        if os.path.exists(path):
            df = pd.read_csv(path)
            df["datetime"] = pd.to_datetime(df["datetime"], errors="coerce")
            df = df.dropna(subset=["datetime"]).sort_values("datetime").reset_index(drop=True)
            df = df.rename(columns={
                "w_f_diff": "weather_fridge_diff",
                "w_t_diff": "weather_thermostat_diff",
                "f_t_diff": "fridge_thermostat_diff",
            })
            df["label"] = df["label"].astype(int)
            for c in FEATURE_COLS:
                if c not in df.columns:
                    df[c] = 0.0
            return df
    return None


def _auto_detect_sensors(files: dict) -> dict:
    new_files = {}
    for label, df in list(files.items()):
        cols_lower = [c.lower() for c in df.columns]
        if "temperature" in cols_lower and "fridge_temperature" not in cols_lower:
            new_files["weather"] = df
        elif "fridge_temperature" in cols_lower or "temp_condition" in cols_lower:
            new_files["fridge"] = df
        elif "current_temperature" in cols_lower or "thermostat_status" in cols_lower:
            new_files["thermostat"] = df
        else:
            new_files[label] = df
    return new_files


def _fuse_sensors(files: dict) -> pd.DataFrame:
    first_key = list(files.keys())[0]
    smap = SENSOR_MAP.get(first_key, {})
    rename_map = {k: v for k, v in smap.items() if k in files[first_key].columns}
    merged = files[first_key].rename(columns=rename_map)
    keep_cols = ["datetime"] + [v for v in rename_map.values() if v != "datetime"]
    merged = merged[[c for c in keep_cols if c in merged.columns]]

    for sensor_name in ["weather", "fridge", "thermostat"]:
        if sensor_name not in files or sensor_name == first_key:
            continue
        smap_s = SENSOR_MAP[sensor_name]
        df_s = files[sensor_name].copy()
        rename_map_s = {k: v for k, v in smap_s.items() if k in df_s.columns}
        df_s = df_s.rename(columns=rename_map_s)
        merge_cols = ["datetime"] + [v for v in rename_map_s.values() if v != "datetime"]
        df_s = df_s[[c for c in merge_cols if c in df_s.columns]]
        merged = merged.merge(df_s, on="datetime", how="outer")

    label_cols = [c for c in merged.columns if c.startswith("label_")]
    if label_cols:
        merged["label"] = merged[label_cols].fillna(0).max(axis=1).astype(int)
        merged = merged.drop(columns=label_cols)
    else:
        merged["label"] = 0

    return merged.sort_values("datetime").reset_index(drop=True)


def _split_tvt(df: pd.DataFrame, train_ratio: float = 0.70, val_ratio: float = 0.5):
    """Split temporel strict train / validation / test — copie de common_model.split_tvt.

    - train : les 70% PREMIERS points normaux (100% normal).
    - val   : la moitie des normales restantes + la moitie des attaques.
    - test  : l'autre moitie (jamais touchee pendant le tuning).
    """
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


def _best_f1_threshold(y_true, scores) -> float:
    """Seuil qui maximise le F1 sur la courbe Precision-Rappel."""
    y = np.asarray(y_true)
    s = np.nan_to_num(np.asarray(scores), nan=0.0)
    prec, rec, thr = precision_recall_curve(y, s)
    with np.errstate(divide="ignore", invalid="ignore"):
        f1s = 2 * prec * rec / (prec + rec + 1e-12)
    best = int(np.argmax(f1s[:-1])) if len(f1s) > 1 else 0
    return float(thr[best]) if len(thr) > best else 0.5


def _evaluate_pr(y_true, scores, threshold: float | None = None) -> dict:
    """Metriques d'un detecteur : score plus grand = plus anormal, anomalie si
    score >= seuil.

    `threshold` doit venir de la VALIDATION (`_best_f1_threshold(y_val, s_val)`)
    pour que les metriques du test restent honnetes ; sans lui, le seuil
    max-F1 est cherche sur les donnees evaluees (optimiste, usage exploratoire).
    """
    y = np.asarray(y_true)
    s = np.nan_to_num(np.asarray(scores), nan=0.0)
    t = _best_f1_threshold(y, s) if threshold is None else float(threshold)
    pred = (s >= t).astype(int)
    cm = confusion_matrix(y, pred, labels=[0, 1])
    tn, fp = cm[0]
    fn, tp = cm[1]
    return {
        "roc_auc": float(roc_auc_score(y, s)),
        "avg_precision": float(average_precision_score(y, s)),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)),
        "f1": float(2 * tp / (2 * tp + fp + fn)) if (2 * tp + fp + fn) > 0 else 0.0,
        "fpr": float(fp / (fp + tn)) if (fp + tn) > 0 else 0.0,
        "threshold": float(t),
        "tp": int(tp), "fp": int(fp), "fn": int(fn), "tn": int(tn),
    }


# ══════════════════════════════════════════════════════════════════════════════
#  Core Training Function (One-Class SVM + recherche par grille manuelle)
# ══════════════════════════════════════════════════════════════════════════════

async def _run_training(
    files: dict,
    upload_contents: dict | None = None,
):
    """Entrainement One-Class SVM multivarie avec progress WebSocket temps reel."""
    t_start = datetime.now()

    try:
        # ── 1. Chargement ───────────────────────────────────────────────────
        await _emit("upload", 5, "Chargement des fichiers capteurs...")

        merged_preloaded = None
        if upload_contents:
            loaded = {}
            for label, content in upload_contents.items():
                df = await asyncio.to_thread(pd.read_csv, io.BytesIO(content))
                if "datetime" in df.columns:
                    df["datetime"] = df["datetime"].astype(str).str.replace(r"^201-", "2019-", regex=True)
                    df["datetime"] = pd.to_datetime(df["datetime"], errors="coerce")
                    df = df.dropna(subset=["datetime"]).drop_duplicates(subset=["datetime"]).sort_values("datetime").reset_index(drop=True)
                loaded[label] = df
                await _emit("upload", 10, f"Fichier {label} charge: {len(df):,} lignes")
            files = loaded
        else:
            # Meme dataset que le notebook OneClassSVM.ipynb -> metriques identiques.
            merged_preloaded = _load_fusionne_dataset()
            if merged_preloaded is not None:
                files = {"weather": None, "fridge": None, "thermostat": None}
                await _emit("upload", 10, "Dataset fusionne charge (dataset_fusionne.csv, comme le notebook)")
            else:
                files = _auto_detect_sensors(_load_disk_files())

        if not files and merged_preloaded is None:
            raise ValueError("Aucun fichier charge")

        await _emit("upload", 15, f"{len(files)} capteur(s) charge(s)")

        # ── 2. Fusion / dataset fusionne ─────────────────────────────────────
        await _emit("fusion", 18, "Fusion des 3 capteurs...")
        if merged_preloaded is not None:
            merged = merged_preloaded
            await _emit("fusion", 20, "Dataset fusionne charge (dataset_fusionne.csv)")
        else:
            merged = await asyncio.to_thread(_fuse_sensors, files)
        n_total = len(merged)
        n_attack = int(merged["label"].sum())
        await _emit("fusion", 22, f"Fusion: {n_total:,} lignes | {n_attack:,} attaques detectees")

        paths.ensure_dirs()
        merged_path = str(paths.MERGED_3_SENSORS)
        merged.to_csv(merged_path, index=False)

        # ── 3. Feature Engineering ───────────────────────────────────────────
        await _emit("features", 25, f"Creation de {len(FEATURE_COLS)} features multivariees...")
        if merged_preloaded is not None:
            featured = merged.copy()
            await _emit("features", 28, "Features deja presentes dans dataset_fusionne.csv")
        else:
            featured = _engineer_features(merged)
        await _emit("features", 30, "Feature engineering termine")

        # ── 4. Preparation : split temporel train/val/test (comme le notebook) ──
        train, val, test = _split_tvt(featured)
        X_train = train[FEATURE_COLS].values
        X_val = val[FEATURE_COLS].values
        y_val = val["label"].values.astype(int)
        X_test = test[FEATURE_COLS].values
        y_test = test["label"].values.astype(int)
        all_data = featured[FEATURE_COLS].copy()
        y_all = featured["label"].values.astype(int)

        n_normal = len(train)
        n_val = len(val)
        n_test = len(test)
        n_attack_val = int(y_val.sum())
        n_attack_test = int(y_test.sum())

        if n_normal < 50:
            raise ValueError(f"Pas assez de donnees normales ({n_normal}). Minimum 50 requis.")

        # Scaler ajuste sur le TRAIN uniquement (pas de leakage, comme le notebook).
        scaler_full = StandardScaler()
        X_train_s = scaler_full.fit_transform(X_train)
        X_val_s = scaler_full.transform(X_val)
        X_test_s = scaler_full.transform(X_test)

        # Sous-echantillon du train pour la vitesse (SVM quadratique) : 20 000 lignes.
        MAX_SVM = 20000
        rng = np.random.RandomState(SEED)
        idx = rng.choice(len(X_train_s), min(MAX_SVM, len(X_train_s)), replace=False)
        X_tr_svm = X_train_s[idx]

        # Echelle de tout le dataset (pour l'analyse timeline/SHAP en aval).
        X_all_scaled = scaler_full.transform(all_data.values)
        X_normal_scaled = X_train_s

        await _emit("prepare", 33,
                    f"Train: {n_normal:,} normales | Val: {n_val:,} ({n_attack_val:,} attaques) | "
                    f"Test: {n_test:,} ({n_attack_test:,} attaques) | 21 features")

        # ── 5. Recherche par grille manuelle (comme le notebook OneClassSVM.ipynb) ──
        # On reprend EXACTEMENT la grille du notebook :
        #   grid = [(nu, g) for nu in [0.01, 0.02, 0.03]
        #                   for g in ['auto', 0.1, 0.01, 0.001]]
        # soit 12 combinaisons. Chaque configuration est entrainee sur le
        # sous-echantillon du train et scorEe sur la VALIDATION (jamais le test).
        #
        # Pourquoi cette approche :
        # - Le notebook obtient best_auc_val=0.9458 et test ROC-AUC=0.9783 avec
        #   nu=0.03, gamma=0.001 trouvés par cette grille de 12 essais.
        # - Le test reste cache pendant tout le tuning.
        await _emit("grid", 35, "Grille manuelle : 12 configurations (3 nu x 4 gamma)...")

        grid = [(nu, g) for nu in [0.01, 0.02, 0.03]
                for g in ["auto", 0.1, 0.01, 0.001]]
        grid_history = []

        # Le fit SVM + scoring sont CPU-bound : exécutés hors de l'event loop
        # (asyncio.to_thread) pour ne pas geler le serveur pendant le training.
        def _fit_grid_one(nu: float, g: str) -> float:
            m = OneClassSVM(nu=nu, kernel="rbf", gamma=g)
            m.fit(X_tr_svm)
            sc = -m.decision_function(X_val_s)
            return float(roc_auc_score(y_val, sc))

        for i, (nu, g) in enumerate(grid, 1):
            auc = await asyncio.to_thread(_fit_grid_one, nu, g)
            grid_history.append({
                "config": i,
                "params": {"kernel": "rbf", "nu": nu, "gamma": g},
                "value": round(auc, 4),
            })
            best_so_far = max(h["value"] for h in grid_history)
            progress = 35 + int(i / len(grid) * 25)
            await _emit("grid", progress,
                        f"Config {i}/{len(grid)} | nu={nu} gamma={g} | AUC val={auc:.4f}",
                        trial=i, total_trials=len(grid),
                        best_score=round(best_so_far, 4),
                        current_params={"kernel": "rbf", "nu": nu, "gamma": g})

        grid_history.sort(key=lambda x: x["value"], reverse=True)
        best_params = grid_history[0]["params"]
        best_cv_score = grid_history[0]["value"]
        n_configs = len(grid_history)

        await _emit("grid", 60,
                    f"Grille manuelle terminee : {n_configs} configs | Best AUC val: {best_cv_score:.4f}",
                    best_params=best_params, grid_history=grid_history[:15])

        # ── 6. Refit final sur train + validation (comme le notebook) ───────
        await _emit("training", 62, "Refit One-Class SVM sur train + validation...")

        final_params = {k: v for k, v in best_params.items()}
        # One-Class : on n'apprend que la normalite -> seules les lignes
        # normales de la validation rejoignent le refit (pas d'attaques).
        X_val_normal = X_val_s[y_val == 0]
        X_refit = np.vstack([X_tr_svm, X_val_normal[:2000]])
        np.random.seed(SEED)

        def _refit_and_score():
            m = OneClassSVM(**final_params)
            m.fit(X_refit)
            tr = m.decision_function(X_tr_svm)
            return m, float(tr.mean()), float(tr.std())

        final_model, score_mean, score_std = await asyncio.to_thread(_refit_and_score)

        await _emit("training", 70,
                    f"Modele refit sur {len(X_refit):,} lignes (score_mean={score_mean:.4f})")

        # ── 7. Evaluation sur le TEST (jamais utilise pendant le tuning) ────
        await _emit("evaluation", 72, "Evaluation sur le test (jamais vu)...")

        # Seuil de decision choisi sur la VALIDATION (max F1), puis applique
        # tel quel au test : le test ne sert a aucun reglage.
        score_val = -(await asyncio.to_thread(final_model.decision_function, X_val_s))
        threshold = _best_f1_threshold(y_val, score_val)
        score_test = -(await asyncio.to_thread(final_model.decision_function, X_test_s))
        raw = _evaluate_pr(y_test, score_test, threshold)

        roc_auc = round(float(raw["roc_auc"]), 4)
        ap = round(float(raw["avg_precision"]), 4)
        precision = round(float(raw["precision"]), 4)
        recall = round(float(raw["recall"]), 4)
        f1 = round(float(raw["f1"]), 4)
        fpr = round(float(raw["fpr"]), 4)
        tp, fp, fn, tn = raw["tp"], raw["fp"], raw["fn"], raw["tn"]

        metrics = {
            "precision": precision, "recall": recall, "f1": f1,
            "roc_auc": roc_auc, "average_precision": ap, "fpr": fpr,
            "threshold": round(threshold, 4),
            "tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "cv_roc_auc": round(best_cv_score, 4),
            "score_mean": round(score_mean, 4), "score_std": round(score_std, 4),
            "n_train": n_normal, "n_val": n_val, "n_test": n_test,
            "n_attack_test": n_attack_test,
        }

        await _emit("evaluation", 80,
                    f"Metriques (test): F1={f1:.3f} | Recall={recall:.3f} | ROC-AUC={roc_auc:.3f}",
                    metrics=metrics)

        # Predictions sur TOUT le dataset avec le seuil PR optimal -> analyse en aval.
        scores_raw = await asyncio.to_thread(final_model.decision_function, X_all_scaled)
        scores_neg = -scores_raw
        y_pred = (scores_neg >= threshold).astype(int)

        # ── 8. Sauvegarde modele + scaler ───────────────────────────────────
        MODEL_DIR = str(paths.MODELS_DIR)
        os.makedirs(MODEL_DIR, exist_ok=True)

        model_path = os.path.join(MODEL_DIR, "ocsvm_multivarie.pkl")
        scaler_path = os.path.join(MODEL_DIR, "scaler_ocsvm.pkl")
        joblib.dump(final_model, model_path)
        joblib.dump(scaler_full, scaler_path)

        hyperparams_path = os.path.join(MODEL_DIR, "hyperparams_ocsvm.json")
        with open(hyperparams_path, "w", encoding="utf-8") as f:
            json.dump({
                "best_params": best_params,
                "best_auc_val": best_cv_score,
                "n_training_samples": n_normal,
                "n_attack_samples": n_attack,
                "features": FEATURE_COLS,
                "n_grid_configs": n_configs,
                "grid_history": grid_history[:15],
                "split": {
                    "method": "temporel 70/15/15 (identique notebook)",
                    "n_train": n_normal, "n_val": n_val, "n_test": n_test,
                    "n_attack_val": n_attack_val, "n_attack_test": n_attack_test,
                },
                "threshold_pr": threshold,
                "test_metrics": metrics,
                "trained_at": datetime.now().isoformat(),
                "score_mean": score_mean, "score_std": score_std,
            }, f, indent=2)

        threshold_path = os.path.join(MODEL_DIR, "threshold_ocsvm.json")
        with open(threshold_path, "w", encoding="utf-8") as f:
            json.dump({
                "threshold": threshold,
                "metric": "max_f1_precision_recall",
                "model_type": "OneClassSVM",
                "trained_at": datetime.now().isoformat(),
            }, f, indent=2)

        # ── 9. SHAP ────────────────────────────────────────────────────────
        await _emit("shap", 82, "Calcul SHAP (KernelExplainer)...")

        shap_data = {"available": False, "global_importance": [], "sample_explanations": []}
        if SHAP_AVAILABLE:
            try:
                # Echantillon REPARTI SUR TOUTE L'ANNEE (stride) pour couvrir
                # mois/saisons/heures dans le dashboard SHAP (pas seulement le debut).
                sample_n = min(400, len(X_all_scaled))
                stride = max(1, len(X_all_scaled) // sample_n)
                sample_idxs = sorted(set(range(0, len(X_all_scaled), stride)))[:sample_n]
                if len(sample_idxs) < sample_n:
                    extra = rng.choice(len(X_all_scaled), sample_n - len(sample_idxs), replace=False)
                    sample_idxs = sorted(set(list(sample_idxs) + list(extra)))[:sample_n]
                X_shap = X_all_scaled[sample_idxs]

                bg_idx = rng.choice(len(X_normal_scaled), min(50, len(X_normal_scaled)), replace=False)
                background = X_normal_scaled[bg_idx]

                shap_explainer = shap.KernelExplainer(final_model.decision_function, background)
                # SHAP est TRES gourmand (400 echantillons x 21 features) :
                # hors event loop, sinon le serveur gelee et la progression WebSocket s'arrete.
                shap_values = await asyncio.to_thread(shap_explainer.shap_values, X_shap, nsamples=50)

                n_shap = len(sample_idxs)

                global_shap = []
                for i, feat in enumerate(FEATURE_COLS):
                    mean_abs = float(np.mean(np.abs(shap_values[:, i])))
                    global_shap.append({"feature": feat, "shap_importance": round(mean_abs, 6)})
                global_shap.sort(key=lambda x: x["shap_importance"], reverse=True)

                anomaly_indices = np.where(y_pred[sample_idxs] == 1)[0]
                sample_exps = []
                for j in anomaly_indices[:20]:
                    orig_idx = int(sample_idxs[j])
                    feat_vals = {}
                    shap_vals = {}
                    for i, feat in enumerate(FEATURE_COLS):
                        feat_vals[feat] = round(float(X_all_scaled[orig_idx, i]), 4)
                        shap_vals[feat] = round(float(shap_values[j, i]), 6)
                    top_pos = sorted(shap_vals.items(), key=lambda x: x[1], reverse=True)[:5]
                    top_neg = sorted(shap_vals.items(), key=lambda x: x[1])[:5]
                    sample_exps.append({
                        "index": int(orig_idx),
                        "anomaly_score": round(float(scores_neg[orig_idx]), 4),
                        "top_features_anomaly": [{"feature": f, "shap_value": v, "feature_value": feat_vals[f]} for f, v in top_pos],
                        "top_features_normal": [{"feature": f, "shap_value": v, "feature_value": feat_vals[f]} for f, v in top_neg],
                    })

                shap_full = []
                for row_idx in range(n_shap):
                    row = {}
                    for i, feat in enumerate(FEATURE_COLS):
                        row[feat] = round(float(shap_values[row_idx, i]), 6)
                    shap_full.append({"sample_index": int(sample_idxs[row_idx]), "values": row})

                dt_col = featured["datetime"] if "datetime" in featured.columns else None
                shap_timestamps = []
                if dt_col is not None:
                    for row_idx in sample_idxs:
                        shap_timestamps.append(str(dt_col.iloc[row_idx]))

                seasonal_shap = {}
                if dt_col is not None:
                    dt_series = pd.to_datetime(dt_col.iloc[sample_idxs])
                    for season_name in ["winter", "spring", "summer", "autumn"]:
                        seasonal_shap[season_name] = {"count": 0, "features": {}}
                    for row_idx in range(n_shap):
                        month = dt_series.iloc[row_idx].month
                        if month in (12, 1, 2): key = "winter"
                        elif month in (3, 4, 5): key = "spring"
                        elif month in (6, 7, 8): key = "summer"
                        else: key = "autumn"
                        seasonal_shap[key]["count"] += 1
                        for i, feat in enumerate(FEATURE_COLS):
                            v = round(float(shap_values[row_idx, i]), 6)
                            if feat not in seasonal_shap[key]["features"]:
                                seasonal_shap[key]["features"][feat] = []
                            seasonal_shap[key]["features"][feat].append(v)
                    for season_name in seasonal_shap:
                        agg = []
                        for feat, vals in seasonal_shap[season_name]["features"].items():
                            mean_abs = round(float(np.mean(np.abs(vals))), 6)
                            agg.append({"feature": feat, "shap_importance": mean_abs})
                        agg.sort(key=lambda x: x["shap_importance"], reverse=True)
                        seasonal_shap[season_name] = {
                            "count": seasonal_shap[season_name]["count"],
                            "importance": agg,
                        }

                shap_data = {
                    "available": True,
                    "global_importance": global_shap[:21],
                    "sample_explanations": sample_exps,
                    "n_samples_explained": n_shap,
                    "full_matrix": shap_full,
                    "feature_names": FEATURE_COLS,
                    "timestamps": shap_timestamps,
                    "seasonal_breakdown": seasonal_shap,
                }
                await _emit("shap", 88, f"SHAP: {n_shap} echantillons expliques")

            except Exception as e:
                print(f"[TRAIN] SHAP erreur: {e}")
                shap_data["error"] = str(e)
        else:
            print("[TRAIN] SHAP non installe -- skipped")

        feat_imp = shap_data["global_importance"] if shap_data["available"] else [
            {"feature": FEATURE_COLS[i], "shap_importance": 0}
            for i in range(len(FEATURE_COLS))
        ]

        # ── 11. Timeline + attack + monthly + seasonal ──────────────────────
        await _emit("analysis", 89, "Analyse par attaque / mois / saison...")

        featured["prediction"] = y_pred
        featured["anomaly_score"] = scores_neg

        step_size = max(1, len(featured) // 500)
        timeline_sample = featured.iloc[::step_size].head(500).copy()
        timeline_sample["datetime"] = timeline_sample["datetime"].astype(str)
        timeline_data = timeline_sample[["datetime", "weather_temp", "fridge_temp", "thermostat_temp", "label", "prediction", "anomaly_score"]].to_dict("records")
        for row in timeline_data:
            for k, v in row.items():
                if isinstance(v, (np.floating,)):
                    row[k] = round(float(v), 4)
                elif isinstance(v, (np.integer,)):
                    row[k] = int(v)

        attack_metrics = []
        # Taux de detection par type d'attaque, mesure sur le TEST uniquement
        # (la validation a servi a choisir les hyperparametres et le seuil).
        is_attack = (featured["label"] == 1) & featured.index.isin(test.index)
        if "attack_type" in featured.columns:
            attack_groups = [
                (t, t, featured[is_attack & (featured["attack_type"] == t)])
                for t in sorted(featured.loc[is_attack, "attack_type"].dropna().astype(str).unique())
            ]
        else:
            # Sans colonne de type, seul un agregat "toutes attaques" est mesurable
            attack_groups = [("all", "all_attacks", featured[is_attack])]
        for attack_id, db_name, atk_rows in attack_groups:
            if len(atk_rows) == 0:
                continue
            atk_pred = atk_rows["prediction"].values
            atk_detected = int((atk_pred == 1).sum())
            attack_metrics.append({
                "attack_type": db_name, "attack_id": attack_id,
                "n_total": len(atk_rows), "n_detected": atk_detected,
                "detection_rate": round(atk_detected / max(1, len(atk_rows)) * 100, 1),
                "avg_score": round(float(atk_rows["anomaly_score"].mean()), 4),
            })

        dt_col = featured["datetime"]
        featured["month"] = dt_col.dt.month
        featured["month_name"] = dt_col.dt.strftime("%b")
        monthly = []
        for m in range(1, 13):
            m_data = featured[featured["month"] == m]
            if len(m_data) == 0:
                continue
            m_y = m_data["label"].values
            m_p = m_data["prediction"].values
            monthly.append({
                "month": m, "month_name": m_data["month_name"].iloc[0],
                "total": len(m_data), "attacks": int((m_y == 1).sum()),
                "detected": int(((m_y == 1) & (m_p == 1)).sum()),
                "precision": round(float(precision_score(m_y, m_p, zero_division=0)), 3),
                "recall": round(float(recall_score(m_y, m_p, zero_division=0)), 3),
                "f1": round(float(f1_score(m_y, m_p, zero_division=0)), 3),
            })

        def month_to_season(m):
            if m in (3, 4, 5): return "spring"
            if m in (6, 7, 8): return "summer"
            if m in (9, 10, 11): return "autumn"
            return "winter"

        featured["season"] = featured["month"].apply(month_to_season)
        seasonal = []
        for s in ["winter", "spring", "summer", "autumn"]:
            s_data = featured[featured["season"] == s]
            if len(s_data) == 0:
                continue
            s_y = s_data["label"].values
            s_p = s_data["prediction"].values
            seasonal.append({
                "season": s, "total": len(s_data), "attacks": int((s_y == 1).sum()),
                "detected": int(((s_y == 1) & (s_p == 1)).sum()),
                "precision": round(float(precision_score(s_y, s_p, zero_division=0)), 3),
                "recall": round(float(recall_score(s_y, s_p, zero_division=0)), 3),
            })

        duration = (datetime.now() - t_start).total_seconds()

        # ── 12. Model ID + live registry ────────────────────────────────────
        model_id = f"OCSVM_Multivarie_{t_start.strftime('%Y%m%d_%H%M%S')}"

        LIVE_RESULTS_PATH = os.path.join(os.path.dirname(RESULTS_PATH), "live_trained_results.json")
        try:
            live_data = {}
            if os.path.exists(LIVE_RESULTS_PATH):
                with open(LIVE_RESULTS_PATH, "r") as f:
                    live_data = json.load(f) or {}
            live_data["OCSVM_Multivarie"] = {
                "precision": precision, "recall": recall, "f1": f1,
                "roc_auc": roc_auc, "ap": ap, "fpr": fpr,
                "tp": tp, "fp": fp, "fn": fn, "tn": tn,
                "trained_at": datetime.now().isoformat(timespec="seconds"),
            }
            os.makedirs(os.path.dirname(LIVE_RESULTS_PATH), exist_ok=True)
            with open(LIVE_RESULTS_PATH, "w") as f:
                json.dump(live_data, f, indent=2)
        except Exception:
            pass

        # ── 13. Reponse complete ────────────────────────────────────────────
        full_response = {
            "status": "success",
            "message": f"Modele One-Class SVM entraine en {duration:.1f}s (Grille manuelle + SHAP)",
            "training_info": {
                "duration_seconds": round(duration, 2),
                "n_total_samples": n_total,
                "n_normal_samples": n_normal,
                "n_attack_samples": n_attack,
                "n_features_original": len(FEATURE_COLS),
                "n_features_selected": len(FEATURE_COLS),
                "sensors_used": list(files.keys()),
                "dataset_saved": merged_path,
                "model_saved": model_path,
                "scaler_saved": scaler_path,
                "model_type": "OneClassSVM",
                "split": {
                    "method": "temporel 70/15/15 (identique notebook OneClassSVM.ipynb)",
                    "n_train": n_normal, "n_val": n_val, "n_test": n_test,
                    "n_attack_val": n_attack_val, "n_attack_test": n_attack_test,
                },
            },
            "feature_selection": {
                "method": "Aucune (21 features completes)",
                "n_features_original": len(FEATURE_COLS),
                "n_features_selected": len(FEATURE_COLS),
                "selected_features": FEATURE_COLS,
                "dropped_features": [],
                "feature_scores": [{"feature": f, "score": 1.0, "selected": True} for f in FEATURE_COLS],
            },
            "grid_search": {
                "n_trials": n_configs,
                "best_cv_roc_auc": round(best_cv_score, 4),
                "best_params": best_params,
                "history": grid_history[:15],
                "search_type": "grille manuelle (3 nu x 4 gamma)",
                "optimization_target": "roc_auc",
                "evaluated_on": "validation (split temporel 70/15/15, jamais sur le test)",
            },
            "shap": shap_data,
            "best_params": best_params,
            "model_metrics": metrics,
            "attack_metrics": attack_metrics,
            "monthly_breakdown": monthly,
            "seasonal_breakdown": seasonal,
            "timeline": timeline_data,
            "feature_importance": feat_imp[:21],
        }

        # ── 14. PostgreSQL (ml_models + model_metrics) ─────────────────────
        await _emit("save", 92, "Sauvegarde dans PostgreSQL...")

        try:
            from app.db.session import AsyncSessionLocal
            from app.domains.ml.entities import MLModel, ModelMetric
            async with AsyncSessionLocal() as db:
                ml_model = MLModel(
                    id=model_id,
                    name="One-Class SVM Multivarie",
                    model_type="one_class_svm",
                    sensor="combine",
                    version="1.0.0",
                    hyperparameters=best_params,
                    features=FEATURE_COLS,
                    feature_count=len(FEATURE_COLS),
                    training_samples=n_normal,
                    contamination=best_params.get("nu", 0.05),
                    n_estimators=0,
                    anomaly_rate_normal=fpr,
                    score_moyen_normal=score_mean,
                    precision=precision,
                    recall=recall,
                    f1=f1,
                    roc_auc=roc_auc,
                    ap=ap,
                    fpr=fpr,
                    tp=tp, fp=fp, fn=fn, tn=tn,
                    status="trained",
                    trained_at=t_start,
                    model_path=model_path,
                    scaler_path=scaler_path,
                    result_json=json.loads(json.dumps(full_response, default=str)),
                )
                db.add(ml_model)

                for atk in attack_metrics:
                    metric = ModelMetric(
                        model_id=model_id,
                        attack_type=atk.get("attack_type", "unknown"),
                        capteur="combine",
                        n_total=atk.get("n_total", 0),
                        n_anomalies=atk.get("n_detected", 0),
                        taux_detection=atk.get("detection_rate", 0.0),
                        score_moyen=atk.get("avg_score", 0.0),
                        roc_auc=roc_auc,
                        avg_precision=ap,
                        precision_normal=precision,
                        recall_normal=recall,
                        f1_normal=f1,
                    )
                    db.add(metric)

                await db.commit()
                print(f"[TRAIN] Modele sauvegarde PostgreSQL: {model_id}")
        except Exception as e:
            print(f"[TRAIN] Erreur PostgreSQL: {e}")

        # ── 16. Sauvegarde disque ───────────────────────────────────────────
        try:
            full_path = os.path.join(os.path.dirname(RESULTS_PATH), "resultats_complets.json")
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, "w", encoding="utf-8") as f:
                json.dump(full_response, f, indent=2, ensure_ascii=False, default=str)
        except Exception:
            pass

        # ── 17. DONE ────────────────────────────────────────────────────────
        global _last_completed_model_id
        _last_completed_model_id = model_id
        await _emit("done", 100,
                    f"Entrainement termine en {duration:.1f}s",
                    result=full_response, model_id=model_id)

        return full_response

    except Exception as e:
        traceback.print_exc()
        await _emit("error", 0, f"Erreur: {str(e)}")
        raise

