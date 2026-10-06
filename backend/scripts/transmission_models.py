"""
Quatre modèles candidats sur les traces réelles avec attaques de transmission
===========================================================================
Plan de l'étudiante : (1) prétraitement des traces réelles, (2) injection d'attaques
MITM / injection, (3) quatre modèles, choix du meilleur, (4) SHAP.

Modèles et raison du choix
  - Isolation Forest   non supervisé : apprend le normal seul, isole ce qui est rare
                       (rapide, robuste au bruit, pas besoin d'exemples d'attaque)
  - One-Class SVM      non supervisé : frontière du normal dans l'espace des features
                       (référence déjà utilisée dans la phase 2)
  - Random Forest      supervisé : apprend sur des attaques étiquetées ; robuste,
                       explicable par SHAP (TreeExplainer)
  - XGBoost            supervisé : boosting, en général le plus précis sur des
                       features tabulaires ; explicable par SHAP
  Référence : le détecteur statistique par capteur de transmission_real.py.

Les modèles supervisés ont besoin d'attaques dans l'entraînement : les épisodes
sont injectés dans un bloc sur deux de CHAQUE rôle (train / val / test). Les
non-supervisés n'apprennent que sur les lignes normales des blocs d'entraînement.

Prétraitement (features) : par capteur, valeur, variation, moyenne et écart-type
glissants sur 1, 5 et 15 min, moyenne lissée (EWMA 10 min), indicateur « séquence
de 2 min déjà transmise » (rejeu exact) ; écarts entre capteurs ; état du frigo et
du thermostat. Pas d'heure ni de saison : 62 h de données seulement.

Même protocole que transmission_real.py : blocs d'une heure entrelacés, 9
répétitions à rôles tournants, seuil = max F1 sur la validation, résultats cumulés.

Sorties : data/processed/dataset_transmission_reel.csv (répétition 0, attaques dans
          tous les rôles), models/transmission_reel/comparaison_modeles.json,
          shap_transmission_reel.json, meilleur_modele.pkl (répétition 0)
Usage :  cd backend && .venv/bin/python scripts/transmission_models.py
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
import time
import traceback
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.preprocessing import LabelEncoder, StandardScaler

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import build_dataset as bd  # noqa: E402
import transmission_real as tr  # noqa: E402
import transmission_study as ts  # noqa: E402
from app.api.v1 import phase2  # noqa: E402
from app.core import paths  # noqa: E402

try:
    from xgboost import XGBClassifier
except ImportError:  # pragma: no cover
    XGBClassifier = None

SEED = tr.SEED
N_RUNS = tr.N_RUNS
OUT_DIR = tr.OUT_DIR
DATASET_PATH = tr.DATASET_PATH
log = ts.log

SENSORS = ("weather", "fridge", "thermostat")
WINDOWS = {"1min": 12, "5min": 60, "15min": 180}
EWMA_ALPHA = 2 / (120 + 1)      # ≈ 10 min


def engineer(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Features de prétraitement (voir en-tête). Toutes ne regardent que le passé."""
    d = df.copy()
    feats: list[str] = []
    for s in SENSORS:
        col = f"{s}_temp"
        x = d[col]
        d[f"{s}_diff_1"] = x.diff().fillna(0.0)
        feats += [col, f"{s}_diff_1"]
        for tag, w in WINDOWS.items():
            d[f"{s}_mean_{tag}"] = x.rolling(w, min_periods=1).mean()
            d[f"{s}_std_{tag}"] = x.rolling(w, min_periods=2).std(ddof=0).fillna(0.0)
            feats += [f"{s}_mean_{tag}", f"{s}_std_{tag}"]
        d[f"{s}_ewma_10min"] = x.ewm(alpha=EWMA_ALPHA, adjust=False).mean()
        d[f"{s}_repeat_2min"] = tr.replay_flags(x.to_numpy(float)).astype(float)
        feats += [f"{s}_ewma_10min", f"{s}_repeat_2min"]
    d["fridge_thermostat_diff"] = d["fridge_temp"] - d["thermostat_temp"]
    d["weather_fridge_diff"] = d["weather_temp"] - d["fridge_temp"]
    d["weather_thermostat_diff"] = d["weather_temp"] - d["thermostat_temp"]
    d["fridge_cond_enc"] = LabelEncoder().fit_transform(d["fridge_cond"].astype(str)).astype(float)
    d["thermo_status"] = pd.to_numeric(d["thermo_status"], errors="coerce").fillna(0).astype(float)
    feats += ["fridge_thermostat_diff", "weather_fridge_diff", "weather_thermostat_diff",
              "fridge_cond_enc", "thermo_status"]
    d[feats] = d[feats].replace([np.inf, -np.inf], np.nan).fillna(0.0)
    return d, feats


# ── Modèles : chacun renvoie (score par ligne, hyperparamètres, objet entraîné) ──

def isolation_forest(X_s, train_norm):
    model = IsolationForest(n_estimators=300, max_samples=min(4096, len(train_norm)),
                            contamination="auto", random_state=SEED, n_jobs=-1).fit(X_s[train_norm])
    return -model.score_samples(X_s), {"n_estimators": 300, "max_samples": min(4096, len(train_norm))}, model


def one_class_svm(X_s, y, train_norm, val_idx):
    scores, params = ts.ocsvm_scores(X_s, y, train_norm, val_idx)
    return scores, params, None


def random_forest(X, y, train_all):
    model = RandomForestClassifier(n_estimators=300, min_samples_leaf=5, class_weight="balanced_subsample",
                                   random_state=SEED, n_jobs=-1).fit(X[train_all], y[train_all])
    return model.predict_proba(X)[:, 1], {"n_estimators": 300, "min_samples_leaf": 5,
                                          "class_weight": "balanced_subsample"}, model


def xgboost_model(X, y, train_all):
    pos = max(1, int(y[train_all].sum()))
    ratio = float((len(train_all) - pos) / pos)
    model = XGBClassifier(n_estimators=400, max_depth=6, learning_rate=0.05, subsample=0.8,
                          colsample_bytree=0.8, scale_pos_weight=ratio, eval_metric="logloss",
                          random_state=SEED, n_jobs=8, verbosity=0).fit(X[train_all], y[train_all])
    return model.predict_proba(X)[:, 1], {"n_estimators": 400, "max_depth": 6, "learning_rate": 0.05,
                                          "scale_pos_weight": round(ratio, 2)}, model


MODELS = [("IsolationForest", "Isolation Forest (non supervisé)"),
          ("OCSVM", "One-Class SVM (non supervisé)"),
          ("RandomForest", "Random Forest (supervisé)"),
          ("XGBoost", "XGBoost (supervisé)"),
          ("Statistique", "Réf. : statistique par capteur")]


def one_run(base: pd.DataFrame, run: int) -> dict:
    rng = np.random.default_rng(SEED + run)
    episodes = tr.build_schedule(len(base), rng, run, roles=("train", "val", "test"))
    df = tr.inject(base, episodes, rng, run)
    df, feats = engineer(df)
    y = df["label"].to_numpy().astype(int)
    split = df["split"].to_numpy()
    garde = df["garde"].to_numpy().astype(bool)
    train_all = np.where((split == "train") & ~garde)[0]
    train_norm = train_all[y[train_all] == 0]
    val_idx = np.where((split == "val") & ~garde)[0]
    test_idx = np.where((split == "test") & ~garde)[0]
    X = df[feats].to_numpy(float)
    X_s = StandardScaler().fit(X[train_norm]).transform(X)

    out = {"episodes": episodes, "df": df, "feats": feats, "counts": {}, "models": {}, "params": {}}
    scores: dict[str, np.ndarray] = {}

    def attempt(key, fn):
        try:
            s, p, m = fn()
            scores[key], out["params"][key], out["models"][key] = s, p, m
        except Exception:  # noqa: BLE001 — un modèle en échec ne doit pas arrêter l'étude
            traceback.print_exc()
            log(f"  !! {key} : échec, ignoré (répétition {run})")

    attempt("IsolationForest", lambda: isolation_forest(X_s, train_norm))
    attempt("OCSVM", lambda: one_class_svm(X_s, y, train_norm, val_idx))
    attempt("RandomForest", lambda: random_forest(X, y, train_all))
    if XGBClassifier is not None:
        attempt("XGBoost", lambda: xgboost_model(X, y, train_all))
    with contextlib.redirect_stdout(io.StringIO()):
        scores["Statistique"] = tr.stat_detector(df, y, train_norm, val_idx)["TOUS"]

    for key, _ in MODELS:
        if key not in scores:
            continue
        s = np.nan_to_num(np.asarray(scores[key], dtype=float), nan=0.0)
        thr = phase2._best_f1_threshold(y[val_idx], s[val_idx])
        pred = s >= thr
        out["counts"][key] = {
            "test": tr.count_run(pred, df, test_idx, episodes, "test"),
            "val": tr.count_run(pred, df, val_idx, episodes, "val"),
            "roc_auc": float(roc_auc_score(y[test_idx], s[test_idx])),
            "avg_precision": float(average_precision_score(y[test_idx], s[test_idx])),
            "threshold": float(thr),
        }
    out["test_idx"] = test_idx
    log(f"    répétition {run} : {len(episodes)} épisodes "
        f"(train {sum(e['split'] == 'train' for e in episodes)}, val {sum(e['split'] == 'val' for e in episodes)}, "
        f"test {sum(e['split'] == 'test' for e in episodes)}) ; "
        + ", ".join(f"{k} F1 {tr.pool([c['test']])['f1']:.2f}" for k, c in out["counts"].items()))
    return out


def shap_summary(runs: list[dict], best_key: str, rng) -> dict:
    """SHAP (TreeExplainer) du meilleur modèle, cumulé sur les répétitions, sur les
    lignes d'attaque du test : importance moyenne |SHAP| par feature, globale et par
    scénario (chaque répétition apporte ses propres épisodes de test)."""
    import shap

    feats = runs[0]["feats"]
    imps, types_all = [], []
    for r in runs:
        model = r["models"].get(best_key)
        if model is None:
            continue
        df, test_idx = r["df"], r["test_idx"]
        y = df["label"].to_numpy()
        rows = test_idx[y[test_idx] == 1]
        rows = rng.choice(rows, min(1500, len(rows)), replace=False)
        values = shap.TreeExplainer(model).shap_values(df[feats].to_numpy(float)[rows])
        if isinstance(values, list):
            values = values[-1]
        if values.ndim == 3:
            values = values[:, :, -1]
        imps.append(np.abs(values))
        types_all.append(df["attack_type"].to_numpy()[rows])
    imp = np.vstack(imps)
    types = np.concatenate(types_all)

    def top(mask: np.ndarray, k: int = 6) -> list[dict]:
        m = imp[mask].mean(axis=0)
        order = np.argsort(m)[::-1][:k]
        return [{"feature": feats[i], "importance": round(float(m[i]), 4)} for i in order]

    out = {"n_lignes": int(len(imp)), "global": top(np.ones(len(imp), dtype=bool), 10), "par_scenario": {}}
    for nm in tr.ATTACK_NAMES:
        mask = types == nm
        if mask.any():
            out["par_scenario"][nm] = top(mask)
    return out


def main() -> None:
    paths.ensure_dirs()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    log("[1] Traces réelles TON_IoT, prétraitement")
    with contextlib.redirect_stdout(io.StringIO()):
        real = bd.load_normal_traces()
    base, fusion = tr.fuse_real(real)
    log(f"    grille {tr.STEP} : {fusion['pas_conserves']:,} lignes ({fusion['debut']} → {fusion['fin']})")

    log(f"[2] {N_RUNS} répétitions : attaques injectées dans tous les rôles, 4 modèles + référence")
    runs = []
    for run in range(N_RUNS):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            try:
                r = one_run(base, run)
            except Exception:  # noqa: BLE001
                traceback.print_exc(file=sys.__stderr__)
                raise
        if run == 0:
            r["df"].to_csv(DATASET_PATH, index=False, float_format="%.4f")
            log(f"    {DATASET_PATH.name} (répétition 0) : {len(r['df']):,} lignes, {len(r['feats'])} features")
        runs.append(r)
        log(f"    répétition {run} terminée")

    results: dict = {}
    for key, nom in MODELS:
        counts = [r["counts"][key] for r in runs if key in r["counts"]]
        if not counts:
            continue
        res = tr.pool([c["test"] for c in counts])
        res["nom"] = nom
        res["val_f1"] = tr.pool([c["val"] for c in counts])["f1"]
        res["roc_auc"] = round(float(np.mean([c["roc_auc"] for c in counts])), 4)
        res["avg_precision"] = round(float(np.mean([c["avg_precision"] for c in counts])), 4)
        res["hyperparameters"] = runs[0]["params"].get(key)
        results[key] = res
    tr.print_tables(results)

    ranking = sorted(results, key=lambda k: results[k]["val_f1"], reverse=True)
    print()
    print("Classement sur la VALIDATION (F1 cumulé) : "
          + " > ".join(f"{k} ({results[k]['val_f1']:.3f})" for k in ranking))
    best_key = next(k for k in ranking if k != "Statistique")
    b = results[best_key]
    print(f"→ Meilleur des 4 modèles : {b['nom']} (test : F1 {b['f1']:.3f}, rappel {b['recall']:.3f}, "
          f"{b['fausses_alarmes_evenements_par_heure']:.2f} fausse(s) alarme(s)/heure, "
          f"{b['episodes_detectes']}/{b['episodes']} épisodes)")

    log("[3] SHAP du meilleur modèle (cumulé sur les répétitions)")
    shap_out = None
    model0 = runs[0]["models"].get(best_key)
    if model0 is not None and best_key in ("RandomForest", "XGBoost", "IsolationForest"):
        shap_out = shap_summary(runs, best_key, np.random.default_rng(SEED))
        print()
        print(f"SHAP — features qui font détecter ({b['nom']}, lignes d'attaque du test, {N_RUNS} répétitions)")
        print("  global : " + ", ".join(f"{f['feature']} ({f['importance']:.3f})" for f in shap_out["global"][:6]))
        for nm, lst in shap_out["par_scenario"].items():
            print(f"  {nm:28s} " + ", ".join(f"{f['feature']} ({f['importance']:.3f})" for f in lst[:4]))
        joblib.dump(model0, OUT_DIR / "meilleur_modele.pkl")
    else:
        log("    pas de SHAP arborescent pour ce modèle")

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "dataset": DATASET_PATH.name,
        "fusion": fusion,
        "features": runs[0]["feats"],
        "protocole": {
            "split": "blocs d'une heure entrelacés : 3 train / 1 val / 1 test, rôles tournant à chaque répétition",
            "attaques": "un épisode de 12 à 20 min dans un bloc sur deux de chaque rôle",
            "repetitions": N_RUNS,
            "seuil": "max F1 sur la validation de chaque répétition, appliqué tel quel à son test",
            "episodes_par_repetition": [len(r["episodes"]) for r in runs],
        },
        "modeles": {k: nom for k, nom in MODELS},
        "classement_validation": ranking,
        "meilleur_modele": best_key,
        "resultats": results,
        "shap": shap_out,
    }
    with open(OUT_DIR / "comparaison_modeles.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, default=ts._json_default)
    if shap_out is not None:
        with open(OUT_DIR / "shap_transmission_reel.json", "w", encoding="utf-8") as f:
            json.dump({"modele": best_key, **shap_out}, f, indent=2, ensure_ascii=False, default=ts._json_default)
    log(f"Résultats : {OUT_DIR / 'comparaison_modeles.json'}")


if __name__ == "__main__":
    main()
