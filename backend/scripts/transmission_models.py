"""
Quatre modèles supervisés sur les traces réelles avec attaques de transmission
=============================================================================
Plan de l'étudiante : (1) prétraitement des traces réelles, (2) injection d'attaques
MITM / injection, (3) quatre modèles supervisés, choix du meilleur, (4) SHAP.

Modèles (tous supervisés) et raison du choix
  - Random Forest      apprend sur des attaques étiquetées ; robuste, explicable
                       par SHAP (TreeExplainer)
  - XGBoost            boosting, en général le plus précis sur des features
                       tabulaires ; explicable par SHAP
  - Régression Logistique  baseline linéaire interprétable, sert de point de
                       comparaison aux modèles non linéaires
  - MLP                réseau de neurones (64, 32) avec early stopping, apporte une
                       famille non-arbre au comparatif

  Les modèles NON supervisés (Isolation Forest, One-Class SVM) et la référence
  statistique ont été RETIRÉS du comparatif : l'étude ne compare que des modèles
  supervisés.

Les modèles supervisés ont besoin d'attaques dans l'entraînement : un épisode est
injecté dans CHAQUE bloc, ce qui porte le jeu de données à ~33 % d'attaques
(train, val et test).

Prétraitement (features) : par capteur, valeur, variation, moyenne et écart-type
glissants sur 1, 5 et 15 min, moyenne lissée (EWMA 10 min), indicateur « séquence
de 2 min déjà transmise » (rejeu exact) ; écarts entre capteurs ; état du frigo et
du thermostat. Pas d'heure ni de saison : 62 h de données seulement.

Même protocole que transmission_real.py : découpage train/val/test NON aléatoire
70/15/15 par blocs d'une heure entrelacés (recalculé à l'entraînement via
`transmission_real.block_split`, plus stocké dans le CSV), 9 répétitions à rôles
tournants, seuil = max F1 sur la validation, résultats cumulés.

Sorties : data/processed/dataset_transmission_reel.csv (répétition 0, attaques dans
          tous les rôles), models/transmission_reel/comparaison_modeles.json,
          shap_transmission_reel.json, meilleur_modele.pkl (répétition 0)
Usage :  cd backend && .venv/bin/python scripts/transmission_models.py
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import time
import traceback
from pathlib import Path

# Garde-fou encodage : sur Windows, une sortie redirigee peut etre en cp1252 et faire
# planter le script sur un caractere comme la fleche '->'. On force UTF-8 (avec
# remplacement) pour que le script ne plante JAMAIS pour une histoire d'accent.
for _flux in (sys.stdout, sys.stderr):
    try:
        _flux.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.neural_network import MLPClassifier
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
EPISODES_PATH = paths.PROCESSED_DIR / "episodes_transmission_reel.json"
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

    # Nettoyage : on retire les colonnes héritées du pré-calcul phase2 (heure, saison,
    # moyennes/écarts glissants sur 10 pas), inutiles au modèle de transmission.
    d = tr.drop_phase2_cols(d)
    return d, feats


# ── Modèles : chacun renvoie (score par ligne, hyperparamètres, objet entraîné) ──

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


def logistic_regression(X_s, y, train_all):
    """Régression Logistique : baseline linéaire interprétable, class_weight équilibre les classes."""
    model = LogisticRegression(max_iter=1000, class_weight="balanced",
                               random_state=SEED).fit(X_s[train_all], y[train_all])
    return model.predict_proba(X_s)[:, 1], {"max_iter": 1000, "class_weight": "balanced"}, model


def mlp(X_s, y, train_all):
    """MLP (64, 32) : early stopping contre le surapprentissage ; sample_weight équilibre les classes
    (MLPClassifier n'a pas de class_weight)."""
    y_tr = y[train_all]
    pos = max(1, int(y_tr.sum()))
    poids = np.where(y_tr == 1, len(y_tr) / (2 * pos), len(y_tr) / (2 * max(1, len(y_tr) - pos)))
    model = MLPClassifier(hidden_layer_sizes=(64, 32), max_iter=300, early_stopping=True,
                          random_state=SEED).fit(X_s[train_all], y_tr, sample_weight=poids)
    return model.predict_proba(X_s)[:, 1], {"hidden_layer_sizes": (64, 32), "max_iter": 300,
                                            "early_stopping": True}, model


MODELS = [("RandomForest", "Random Forest (supervisé)"),
          ("XGBoost", "XGBoost (supervisé)"),
          ("Logistique", "Régression Logistique (supervisé)"),
          ("MLP", "MLP — réseau de neurones (supervisé)")]


def one_run(base: pd.DataFrame, run: int) -> dict:
    rng = np.random.default_rng(SEED + run)
    episodes = tr.build_schedule(len(base), rng, run, roles=("train", "val", "test"))
    df = tr.inject(base, episodes, rng, run)
    df, feats = engineer(df)
    y = df["label"].to_numpy().astype(int)
    split = tr.block_split(len(df), run)   # 70/15/15 non aléatoire, recalculé (non stocké dans le CSV)
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

    attempt("RandomForest", lambda: random_forest(X, y, train_all))
    if XGBClassifier is not None:
        attempt("XGBoost", lambda: xgboost_model(X, y, train_all))
    attempt("Logistique", lambda: logistic_regression(X_s, y, train_all))
    attempt("MLP", lambda: mlp(X_s, y, train_all))

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

    log(f"[2] {N_RUNS} répétitions : attaques injectées dans tous les rôles, 4 modèles supervisés")
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
            # Le planning des épisodes est écrit EN MÊME TEMPS que le jeu de données :
            # les deux doivent rester cohérents (mêmes épisodes, mêmes bornes).
            with open(EPISODES_PATH, "w", encoding="utf-8") as f:
                json.dump(r["episodes"], f, indent=1, ensure_ascii=False, default=ts._json_default)
            log(f"    {DATASET_PATH.name} (répétition 0) : {len(r['df']):,} lignes, {len(r['feats'])} features")
            log(f"    {EPISODES_PATH.name} : {len(r['episodes'])} épisodes")
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
    best_key = ranking[0]
    b = results[best_key]
    print(f"→ Meilleur des 4 modèles : {b['nom']} (test : F1 {b['f1']:.3f}, rappel {b['recall']:.3f}, "
          f"{b['fausses_alarmes_evenements_par_heure']:.2f} fausse(s) alarme(s)/heure, "
          f"{b['episodes_detectes']}/{b['episodes']} épisodes)")

    log("[3] SHAP du meilleur modèle (cumulé sur les répétitions)")
    shap_out = None
    model0 = runs[0]["models"].get(best_key)
    # SKIP_SHAP=1 : on saute l'étape SHAP (lente, inutile pour le tableau comparatif).
    # Le .pkl du meilleur modèle est quand même écrit ci-dessous.
    if (model0 is not None and best_key in ("RandomForest", "XGBoost")
            and not os.environ.get("SKIP_SHAP")):
        shap_out = shap_summary(runs, best_key, np.random.default_rng(SEED))
        print()
        print(f"SHAP — features qui font détecter ({b['nom']}, lignes d'attaque du test, {N_RUNS} répétitions)")
        print("  global : " + ", ".join(f"{f['feature']} ({f['importance']:.3f})" for f in shap_out["global"][:6]))
        for nm, lst in shap_out["par_scenario"].items():
            print(f"  {nm:28s} " + ", ".join(f"{f['feature']} ({f['importance']:.3f})" for f in lst[:4]))
    else:
        log("    pas de SHAP arborescent pour ce modèle (meilleur modèle non-arbre)")
    # Le .pkl du meilleur modèle est écrit quelle que soit sa famille (arbre ou non)
    if model0 is not None:
        joblib.dump(model0, OUT_DIR / "meilleur_modele.pkl")

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "dataset": DATASET_PATH.name,
        "fusion": fusion,
        "features": runs[0]["feats"],
        "protocole": {
            "split": "70/15/15 NON aléatoire, blocs d'une heure entrelacés (14 train / 3 val / 3 test "
                     "sur un cycle de 20), rôles tournant à chaque répétition ; recalculé à l'entraînement "
                     "(transmission_real.block_split), plus stocké dans le jeu de données",
            "attaques": "un épisode de 15 à 25 min dans CHAQUE bloc (train, val et test) : ~33 % d'attaques",
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
