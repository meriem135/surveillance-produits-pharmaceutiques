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

Prévalence. Les modèles supervisés ont besoin d'attaques dans l'entraînement : un
épisode est injecté dans CHAQUE bloc d'entraînement (~33 % d'attaques). La validation
et le test gardent une prévalence RÉALISTE : un épisode dans 2 blocs sur 5 (≈ 13–15 %
des lignes, mesuré et écrit dans le JSON). La précision et le F1 dépendent de la
prévalence ; à 33 % d'attaques en validation, le seuil « max F1 » glisserait vers
« tout signaler ».

Déséquilibre des classes : class_weight (Random Forest, Régression Logistique),
scale_pos_weight (XGBoost), sample_weight (MLP). Pas de SMOTE : sur des séries
temporelles, des points synthétiques interpolés entre deux lignes d'attaque
fabriqueraient des fenêtres glissantes qui n'existent pas, et le sur-échantillonnage
ne change pas la prévalence du test, qui seule fixe la précision réelle. Le levier
du rappel est le SEUIL, choisi sur la validation.

Prétraitement (features) : par capteur, valeur, variation, moyenne et écart-type
glissants sur 1, 5 et 15 min, moyenne lissée (EWMA 10 min), indicateur « séquence
de 2 min déjà transmise » (rejeu exact) ; écarts entre capteurs ; état du frigo et
du thermostat. Pas d'heure ni de saison : 62 h de données seulement.

Protocole (même découpage que transmission_real.py) : train/val/test NON aléatoire
70/15/15 par blocs d'une heure entrelacés (recalculé à l'entraînement via
`transmission_real.block_split`, plus stocké dans le CSV), 20 répétitions = les 20
rotations du cycle de blocs (chaque heure sert 3 fois de test), résultats cumulés.
Deux points de fonctionnement, seuils choisis sur la VALIDATION de chaque répétition
et appliqués tels quels à son test :
  - « max F1 »       : le seuil qui maximise le F1 de validation ;
  - « rappel cible » : le seuil le plus haut qui atteint le rappel cible sur la
                       validation (TARGET_RECALL, 0,90 par défaut ; aussi 0,80 et 0,95).
Choix du modèle sur la VALIDATION uniquement (le test ne fait que confirmer) : en
mode « rappel d'abord », F2 de validation au point « rappel cible ».
Validation croisée de confirmation (répétition 0, lignes d'entraînement) :
StratifiedGroupKFold avec le BLOC d'une heure comme groupe, comparée à un
StratifiedKFold naïf (à ne pas faire : fuite par les fenêtres glissantes).

Ordre des métriques partout : rappel, fausses alertes/heure, délai de détection,
précision, F1/F2.

Sorties : data/processed/dataset_transmission_reel.csv + episodes_transmission_reel.json
          (répétition 0, attaques dans tous les rôles ; seul script qui les écrit),
          models/transmission_reel/comparaison_modeles.json, validation_croisee.json,
          shap_transmission_reel.json, meilleur_modele.pkl (répétition 0)
Usage :  cd backend && nice -n 10 .venv/bin/python scripts/transmission_models.py
         (N_JOBS=3 cœurs par défaut ; SKIP_SHAP=1, SKIP_CV=1 pour aller plus vite ;
          N_RUNS=… pour un essai rapide ; TARGET_RECALL=0.90)
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
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score
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
N_RUNS = int(os.environ.get("N_RUNS", tr.N_RUNS))
N_JOBS = int(os.environ.get("N_JOBS", "3"))      # le serveur héberge d'autres sites : 3 cœurs au plus
OUT_DIR = tr.OUT_DIR
DATASET_PATH = tr.DATASET_PATH
EPISODES_PATH = paths.PROCESSED_DIR / "episodes_transmission_reel.json"
CV_PATH = OUT_DIR / "validation_croisee.json"
log = ts.log

# Point de fonctionnement « rappel d'abord » : rappel visé sur la validation
TARGET_RECALL = float(os.environ.get("TARGET_RECALL", "0.90"))
TARGETS = tuple(sorted({0.80, 0.90, 0.95, round(TARGET_RECALL, 2)}))

SENSORS = ("weather", "fridge", "thermostat")
WINDOWS = {"1min": 12, "5min": 60, "15min": 180}
EWMA_ALPHA = 2 / (120 + 1)      # ≈ 10 min


def op_key(target: float) -> str:
    """Nom du point de fonctionnement « rappel cible » : rappel_0.90."""
    return f"rappel_{target:.2f}"


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
# Déséquilibre : poids de classe (class_weight / scale_pos_weight / sample_weight), pas de SMOTE.

def make_random_forest() -> RandomForestClassifier:
    return RandomForestClassifier(n_estimators=300, min_samples_leaf=5, class_weight="balanced_subsample",
                                  random_state=SEED, n_jobs=N_JOBS)


def make_xgboost(ratio: float):
    return XGBClassifier(n_estimators=400, max_depth=6, learning_rate=0.05, subsample=0.8,
                         colsample_bytree=0.8, scale_pos_weight=ratio, eval_metric="logloss",
                         random_state=SEED, n_jobs=N_JOBS, verbosity=0)


def make_logistic() -> LogisticRegression:
    return LogisticRegression(max_iter=1000, class_weight="balanced", random_state=SEED)


def make_mlp() -> MLPClassifier:
    return MLPClassifier(hidden_layer_sizes=(64, 32), max_iter=300, early_stopping=True, random_state=SEED)


def balanced_weights(y_tr: np.ndarray) -> np.ndarray:
    """Poids d'échantillon qui équilibrent attaques et normales (comme class_weight="balanced")."""
    pos = max(1, int(y_tr.sum()))
    return np.where(y_tr == 1, len(y_tr) / (2 * pos), len(y_tr) / (2 * max(1, len(y_tr) - pos)))


def random_forest(X, y, train_all):
    model = make_random_forest().fit(X[train_all], y[train_all])
    return model.predict_proba(X)[:, 1], {"n_estimators": 300, "min_samples_leaf": 5,
                                          "class_weight": "balanced_subsample"}, model


def xgboost_model(X, y, train_all):
    pos = max(1, int(y[train_all].sum()))
    ratio = float((len(train_all) - pos) / pos)
    model = make_xgboost(ratio).fit(X[train_all], y[train_all])
    return model.predict_proba(X)[:, 1], {"n_estimators": 400, "max_depth": 6, "learning_rate": 0.05,
                                          "scale_pos_weight": round(ratio, 2)}, model


def logistic_regression(X_s, y, train_all):
    """Régression Logistique : baseline linéaire interprétable, class_weight équilibre les classes."""
    model = make_logistic().fit(X_s[train_all], y[train_all])
    return model.predict_proba(X_s)[:, 1], {"max_iter": 1000, "class_weight": "balanced"}, model


def mlp(X_s, y, train_all):
    """MLP (64, 32) : early stopping contre le surapprentissage ; sample_weight équilibre les classes
    (MLPClassifier n'a pas de class_weight)."""
    y_tr = y[train_all]
    model = make_mlp().fit(X_s[train_all], y_tr, sample_weight=balanced_weights(y_tr))
    return model.predict_proba(X_s)[:, 1], {"hidden_layer_sizes": (64, 32), "max_iter": 300,
                                            "early_stopping": True, "sample_weight": "équilibré"}, model


MODELS = [("RandomForest", "Random Forest (supervisé)"),
          ("XGBoost", "XGBoost (supervisé)"),
          ("Logistique", "Régression Logistique (supervisé)"),
          ("MLP", "MLP — réseau de neurones (supervisé)")]
TREE_MODELS = ("RandomForest", "XGBoost")


# ── Seuils et points de fonctionnement (toujours choisis sur la VALIDATION) ─────

def threshold_for_recall(y_val: np.ndarray, s_val: np.ndarray, target: float) -> float:
    """Seuil le plus HAUT qui atteint le rappel `target` sur la validation (alerte si
    score >= seuil) : il signale au moins ceil(target × P) des P lignes d'attaque, avec
    le moins de fausses alertes possible. Toujours atteignable s'il y a des attaques."""
    pos = np.sort(np.asarray(s_val, dtype=float)[np.asarray(y_val) == 1])[::-1]
    if len(pos) == 0:
        return float("inf")
    k = min(len(pos), max(1, int(np.ceil(target * len(pos) - 1e-9))))
    return float(pos[k - 1])


def operating_thresholds(y_val: np.ndarray, s_val: np.ndarray, targets=TARGETS) -> dict[str, float]:
    out = {"max_f1": float(phase2._best_f1_threshold(y_val, s_val))}
    for t in targets:
        out[op_key(t)] = threshold_for_recall(y_val, s_val, t)
    return out


def evaluate_scores(s, df, y, val_idx, test_idx, episodes, targets=TARGETS) -> dict:
    """Comptes d'une répétition pour chaque point de fonctionnement, sur la validation et le test."""
    s = np.nan_to_num(np.asarray(s, dtype=float), nan=0.0)
    out = {"points": {},
           "roc_auc": float(roc_auc_score(y[test_idx], s[test_idx])),
           "avg_precision": float(average_precision_score(y[test_idx], s[test_idx])),
           "val_roc_auc": float(roc_auc_score(y[val_idx], s[val_idx])),
           "val_avg_precision": float(average_precision_score(y[val_idx], s[val_idx])),
           "scores_val": s[val_idx], "y_val": y[val_idx], "scores_test": s[test_idx], "y_test": y[test_idx]}
    for op, thr in operating_thresholds(y[val_idx], s[val_idx], targets).items():
        pred = s >= thr
        out["points"][op] = {"seuil": thr,
                             "val": tr.count_run(pred, df, val_idx, episodes, "val"),
                             "test": tr.count_run(pred, df, test_idx, episodes, "test")}
    return out


def pr_curve(y: np.ndarray, s: np.ndarray, n: int = 120) -> dict:
    """Courbe précision-rappel allégée (≈ n points) pour la page web."""
    p, r, _ = precision_recall_curve(y, s)
    idx = np.unique(np.linspace(0, len(p) - 1, min(n, len(p))).astype(int))
    return {"recall": [round(float(v), 4) for v in r[idx]], "precision": [round(float(v), 4) for v in p[idx]]}


def _val_fields(v: dict) -> dict:
    return {"val_recall": v["recall"], "val_fausses_alarmes_par_heure": v["fausses_alarmes_evenements_par_heure"],
            "val_delai_median_min": v["delai_median_min"], "val_precision": v["precision"], "val_f1": v["f1"],
            "val_f2": v["f2"], "val_episodes": v["episodes"], "val_episodes_detectes": v["episodes_detectes"],
            "val_part_attaques": v["part_attaques"]}


def summarize_model(evals: list[dict], nom: str) -> dict:
    """Cumule les répétitions d'un modèle. Les champs « à plat » (recall, precision, f1…)
    sont ceux du TEST au seuil max F1 (compatibilité) ; val_* ceux de la VALIDATION ;
    points_fonctionnement contient les deux points (max F1, rappel cible) en val et test."""
    points = {}
    for op in evals[0]["points"]:
        v = tr.pool([e["points"][op]["val"] for e in evals])
        t = tr.pool([e["points"][op]["test"] for e in evals])
        points[op] = {"libelle": "max F1 (validation)" if op == "max_f1" else f"rappel cible {op[7:]} (validation)",
                      "seuils": [round(e["points"][op]["seuil"], 4) for e in evals], "val": v, "test": t}
    res = {"nom": nom, "type": "supervisé", **points["max_f1"]["test"], **_val_fields(points["max_f1"]["val"])}
    res["roc_auc"] = round(float(np.mean([e["roc_auc"] for e in evals])), 4)
    res["avg_precision"] = round(float(np.mean([e["avg_precision"] for e in evals])), 4)
    res["val_roc_auc"] = round(float(np.mean([e["val_roc_auc"] for e in evals])), 4)
    res["val_avg_precision"] = round(float(np.mean([e["val_avg_precision"] for e in evals])), 4)
    res["threshold"] = points["max_f1"]["seuils"][0]
    res["points_fonctionnement"] = points
    res["courbe_pr"] = {
        "val": pr_curve(np.concatenate([e["y_val"] for e in evals]), np.concatenate([e["scores_val"] for e in evals])),
        "test": pr_curve(np.concatenate([e["y_test"] for e in evals]), np.concatenate([e["scores_test"] for e in evals])),
    }
    return res


def rank_models(results: dict, op: str | None = None) -> list[str]:
    """Classement sur la VALIDATION uniquement (le test ne sert qu'à confirmer).
    op = « rappel_0.90 » (mode rappel d'abord) : F2 de validation à ce point, puis moins
    de fausses alertes/h, puis délai le plus court. op = « max_f1 » : F1 de validation."""
    op = op or op_key(TARGET_RECALL)

    def cle(k):
        v = results[k]["points_fonctionnement"][op]["val"]
        main = v["f1"] if op == "max_f1" else v["f2"]
        delai = v["delai_median_min"] if v["delai_median_min"] is not None else 1e9
        return (-main, v["fausses_alarmes_evenements_par_heure"], delai)

    return sorted(results, key=cle)


def role_prevalence(y: np.ndarray, idx_by_role: dict[str, np.ndarray]) -> dict:
    return {r: {"lignes": int(len(i)), "attaques": int(y[i].sum()),
                "part": round(float(y[i].mean()), 4) if len(i) else 0.0} for r, i in idx_by_role.items()}


# ── Une répétition ───────────────────────────────────────────────────────────

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

    out = {"episodes": episodes, "df": df, "feats": feats, "counts": {}, "models": {}, "params": {},
           "prevalence": role_prevalence(y, {"train": train_all, "val": val_idx, "test": test_idx}),
           "train_all": train_all, "X": X, "X_s": X_s, "y": y}
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
        if key in scores:
            out["counts"][key] = evaluate_scores(scores[key], df, y, val_idx, test_idx, episodes)
    out["test_idx"] = test_idx
    att = test_idx[y[test_idx] == 1]
    out["shap_X"], out["shap_types"] = X[att], df["attack_type"].to_numpy()[att]
    prev = out["prevalence"]
    op = op_key(TARGET_RECALL)
    log(f"    répétition {run} : {len(episodes)} épisodes "
        f"(train {sum(e['split'] == 'train' for e in episodes)}, val {sum(e['split'] == 'val' for e in episodes)}, "
        f"test {sum(e['split'] == 'test' for e in episodes)}) ; attaques train {100 * prev['train']['part']:.1f} %, "
        f"val {100 * prev['val']['part']:.1f} %, test {100 * prev['test']['part']:.1f} % ; "
        + ", ".join(f"{k} F2 val {tr.pool([c['points'][op]['val']])['f2']:.2f}" for k, c in out["counts"].items()))
    return out


# ── Validation croisée de confirmation ───────────────────────────────────────

def cv_splitters(n_splits: int = 5) -> dict:
    from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold  # noqa: PLC0415
    return {"naif": StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=SEED),
            "groupes_blocs": StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=SEED)}


def shared_blocks(splitter, X, y, groups) -> int:
    """Nombre de blocs d'une heure présents à la fois dans l'apprentissage et dans
    l'évaluation d'un même fold (somme sur les folds) : 0 = pas de fuite par les blocs."""
    total = 0
    uses_groups = "Group" in type(splitter).__name__
    for a, b in splitter.split(X, y, groups if uses_groups else None):
        total += len(np.intersect1d(np.unique(groups[a]), np.unique(groups[b])))
    return total


def validation_croisee(X, X_s, y, train_all, n_splits: int = 5) -> dict:
    """StratifiedKFold naïf (lignes mélangées : une même attaque et ses fenêtres
    glissantes de part et d'autre → score trop optimiste) contre StratifiedGroupKFold
    avec le BLOC d'une heure comme groupe (chaque attaque tient dans un bloc, et les
    lignes normales qui l'entourent partagent ses fenêtres glissantes : grouper par bloc
    retire la fuite). Lignes d'entraînement de la répétition 0, seuil par défaut (0,5)."""
    from sklearn.model_selection import cross_validate  # noqa: PLC0415

    y_tr = y[train_all]
    groups = tr.block_index(len(y))[train_all]
    pos = max(1, int(y_tr.sum()))
    estimators = {"RandomForest": (make_random_forest(), X, None),
                  "Logistique": (make_logistic(), X_s, None),
                  "MLP": (make_mlp(), X_s, {"sample_weight": balanced_weights(y_tr)})}
    if XGBClassifier is not None:
        estimators["XGBoost"] = (make_xgboost(float((len(y_tr) - pos) / pos)), X, None)
    scoring = {"recall": "recall", "precision": "precision", "f1": "f1", "average_precision": "average_precision"}
    out = {"repetition": 0, "lignes": int(len(train_all)), "attaques": int(y_tr.sum()),
           "blocs": int(len(np.unique(groups))), "folds": n_splits,
           "seuil": "predict (probabilité ≥ 0,5), modèles pondérés",
           "methodes": {}}
    for meth, splitter in cv_splitters(n_splits).items():
        res = {"description": ("StratifiedKFold(shuffle=True) : lignes mélangées — à NE PAS faire"
                               if meth == "naif" else "StratifiedGroupKFold, groupe = bloc d'une heure"),
               "blocs_partages": shared_blocks(splitter, X[train_all], y_tr, groups), "modeles": {}}
        for key, _ in MODELS:
            if key not in estimators:
                continue
            est, Xm, params = estimators[key]
            t0 = time.time()
            cv = cross_validate(est, Xm[train_all], y_tr, cv=splitter,
                                groups=groups if meth == "groupes_blocs" else None, scoring=scoring,
                                params=params, n_jobs=1)
            res["modeles"][key] = {m: {"mean": round(float(cv[f"test_{m}"].mean()), 4),
                                       "std": round(float(cv[f"test_{m}"].std()), 4)} for m in scoring}
            log(f"    CV {meth:13s} {key:12s} rappel {res['modeles'][key]['recall']['mean']:.3f} "
                f"± {res['modeles'][key]['recall']['std']:.3f}, précision {res['modeles'][key]['precision']['mean']:.3f} "
                f"± {res['modeles'][key]['precision']['std']:.3f} ({time.time() - t0:.0f} s)")
        out["methodes"][meth] = res
    return out


# ── SHAP ─────────────────────────────────────────────────────────────────────

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
        X_att, types_att = r["shap_X"], r["shap_types"]      # lignes d'attaque du test
        rows = rng.choice(len(X_att), min(1500, len(X_att)), replace=False)
        values = shap.TreeExplainer(model).shap_values(X_att[rows])
        if isinstance(values, list):
            values = values[-1]
        if values.ndim == 3:
            values = values[:, :, -1]
        imps.append(np.abs(values))
        types_all.append(types_att[rows])
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


# ── Affichage ────────────────────────────────────────────────────────────────

def print_operating_points(results: dict) -> None:
    """Tableau val + test à chaque point de fonctionnement, dans l'ordre des métriques :
    rappel, fausses alertes/h, délai, précision, F1, F2."""
    for op in ["max_f1"] + [op_key(t) for t in TARGETS]:
        print()
        print(f"Point de fonctionnement : {results[next(iter(results))]['points_fonctionnement'][op]['libelle']}")
        print(f"{'Modèle':36s} {'rôle':5s} {'Rappel':>7s} {'FA/h':>6s} {'Délai':>7s} {'Épisodes':>9s} "
              f"{'Préc.':>6s} {'F1':>6s} {'F2':>6s}")
        for k, r in results.items():
            for role in ("val", "test"):
                v = r["points_fonctionnement"][op][role]
                d = "—" if v["delai_median_min"] is None else f"{v['delai_median_min']:.1f}"
                print(f"{r['nom']:36s} {role:5s} {v['recall']:>7.3f} {v['fausses_alarmes_evenements_par_heure']:>6.2f} "
                      f"{d:>7s} {str(v['episodes_detectes']) + '/' + str(v['episodes']):>9s} "
                      f"{v['precision']:>6.3f} {v['f1']:>6.3f} {v['f2']:>6.3f}")


def main() -> None:
    paths.ensure_dirs()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    t_start = time.time()
    log("[1] Traces réelles TON_IoT, prétraitement")
    with contextlib.redirect_stdout(io.StringIO()):
        real = bd.load_normal_traces()
    base, fusion = tr.fuse_real(real)
    log(f"    grille {tr.STEP} : {fusion['pas_conserves']:,} lignes ({fusion['debut']} → {fusion['fin']})")

    log(f"[2] {N_RUNS} répétitions : attaques dans tous les rôles, 4 modèles supervisés, {N_JOBS} cœurs")
    runs, run_times = [], []
    for run in range(N_RUNS):
        t0 = time.time()
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
        else:
            # Mémoire : seule la répétition 0 garde son jeu de données (CSV, validation croisée) ;
            # les autres ne gardent que leurs comptes et, pour SHAP, les modèles arborescents.
            for k in ("X", "X_s", "df", "y", "train_all"):
                r.pop(k, None)
            r["models"] = {k: m for k, m in r["models"].items() if k in TREE_MODELS}
        runs.append(r)
        run_times.append(time.time() - t0)
        log(f"    répétition {run} terminée ({run_times[-1]:.0f} s)")

    results: dict = {}
    for key, nom in MODELS:
        evals = [r["counts"][key] for r in runs if key in r["counts"]]
        if not evals:
            continue
        res = summarize_model(evals, nom)
        res["hyperparameters"] = runs[0]["params"].get(key)
        results[key] = res
    tr.print_tables(results)
    print_operating_points(results)

    # Prévalence mesurée par rôle (lignes évaluées, cumul des répétitions)
    prevalence = {}
    for role in ("train", "val", "test"):
        n = sum(r["prevalence"][role]["lignes"] for r in runs)
        a = sum(r["prevalence"][role]["attaques"] for r in runs)
        prevalence[role] = {"lignes": n, "attaques": a, "part": round(a / max(1, n), 4),
                            "part_min": min(r["prevalence"][role]["part"] for r in runs),
                            "part_max": max(r["prevalence"][role]["part"] for r in runs)}
    print()
    print("Part d'attaques par rôle (cumul) : " + ", ".join(
        f"{role} {100 * v['part']:.1f} % ({100 * v['part_min']:.1f}–{100 * v['part_max']:.1f} %)"
        for role, v in prevalence.items()))

    # Choix du modèle : VALIDATION uniquement
    op = op_key(TARGET_RECALL)
    ranking = rank_models(results, op)
    ranking_f1 = rank_models(results, "max_f1")
    par_cible = {f"{t:.2f}": rank_models(results, op_key(t)) for t in TARGETS}
    print()
    print(f"Classement sur la VALIDATION, mode rappel d'abord (F2 au rappel cible {TARGET_RECALL:.2f}) : "
          + " > ".join(f"{k} ({results[k]['points_fonctionnement'][op]['val']['f2']:.3f})" for k in ranking))
    print("Classement sur la VALIDATION au seuil max F1 (F1) : "
          + " > ".join(f"{k} ({results[k]['val_f1']:.3f})" for k in ranking_f1))
    best_key = ranking[0]
    b = results[best_key]["points_fonctionnement"][op]
    print(f"→ Meilleur des 4 modèles : {results[best_key]['nom']} — confirmation sur le test au rappel cible : "
          f"rappel {b['test']['recall']:.3f}, {b['test']['fausses_alarmes_evenements_par_heure']:.2f} fausse(s) "
          f"alarme(s)/heure, délai médian {b['test']['delai_median_min']} min, précision {b['test']['precision']:.3f}, "
          f"F2 {b['test']['f2']:.3f}, {b['test']['episodes_detectes']}/{b['test']['episodes']} épisodes")

    cv = None
    if not os.environ.get("SKIP_CV"):
        log("[3] Validation croisée de confirmation (répétition 0) : naïve contre groupée par bloc")
        r0 = runs[0]
        cv = validation_croisee(r0["X"], r0["X_s"], r0["y"], r0["train_all"])
        cv["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        with open(CV_PATH, "w", encoding="utf-8") as f:
            json.dump(cv, f, indent=2, ensure_ascii=False, default=ts._json_default)

    log("[4] SHAP du meilleur modèle arborescent (cumulé sur les répétitions)")
    shap_out = None
    shap_key = next((k for k in ranking if k in TREE_MODELS), None)
    # SKIP_SHAP=1 : on saute l'étape SHAP (lente, inutile pour le tableau comparatif).
    # Le .pkl du meilleur modèle est quand même écrit ci-dessous.
    if shap_key is not None and runs[0]["models"].get(shap_key) is not None and not os.environ.get("SKIP_SHAP"):
        shap_out = shap_summary(runs, shap_key, np.random.default_rng(SEED))
        print()
        print(f"SHAP — features qui font détecter ({results[shap_key]['nom']}, lignes d'attaque du test, "
              f"{N_RUNS} répétitions)" + ("" if shap_key == best_key else " — meilleur modèle arborescent"))
        print("  global : " + ", ".join(f"{f['feature']} ({f['importance']:.3f})" for f in shap_out["global"][:6]))
        for nm, lst in shap_out["par_scenario"].items():
            print(f"  {nm:28s} " + ", ".join(f"{f['feature']} ({f['importance']:.3f})" for f in lst[:4]))
    # Le .pkl du meilleur modèle est écrit quelle que soit sa famille (arbre ou non)
    model0 = runs[0]["models"].get(best_key)
    if model0 is not None:
        joblib.dump(model0, OUT_DIR / "meilleur_modele.pkl")

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "duree_s": round(time.time() - t_start, 1),
        "duree_par_repetition_s": round(float(np.mean(run_times)), 1),
        "n_jobs": N_JOBS,
        "dataset": DATASET_PATH.name,
        "fusion": fusion,
        "features": runs[0]["feats"],
        "protocole": {
            "split": "70/15/15 NON aléatoire, blocs d'une heure entrelacés (14 train / 3 val / 3 test "
                     "sur un cycle de 20), rôles tournant à chaque répétition ; recalculé à l'entraînement "
                     "(transmission_real.block_split), plus stocké dans le jeu de données",
            "attaques": "un épisode de 15 à 25 min dans CHAQUE bloc d'entraînement (~33 %), dans 2 blocs sur 5 "
                        "de validation et de test (prévalence réaliste ≈ 13–15 %)",
            "repetitions": N_RUNS,
            "couverture": ("les 20 rotations du cycle : chaque heure sert 3 fois de test et 3 fois de validation"
                           if N_RUNS % tr.BLOCK_CYCLE == 0 else
                           f"{N_RUNS} rotations sur {tr.BLOCK_CYCLE} : toutes les heures ne servent pas de test"),
            "seuil": "choisi sur la validation de chaque répétition, appliqué tel quel à son test : max F1, "
                     "et rappel cible (seuil le plus haut qui atteint ce rappel sur la validation)",
            "selection": "sur la VALIDATION uniquement ; mode rappel d'abord : F2 de validation au rappel cible",
            "desequilibre": "class_weight / scale_pos_weight / sample_weight, pas de SMOTE",
            "episodes_par_repetition": [len(r["episodes"]) for r in runs],
        },
        "prevalence": prevalence,
        "cible_rappel": TARGET_RECALL,
        "cibles_rappel": list(TARGETS),
        "ordre_metriques": ["rappel", "fausses alertes/heure", "délai de détection", "précision", "F1/F2"],
        "modeles": {k: nom for k, nom in MODELS},
        "classement_validation": ranking,
        "classement_validation_max_f1": ranking_f1,
        "classement_validation_par_cible": par_cible,
        "meilleur_modele": best_key,
        "meilleur_par_cible": {t: lst[0] for t, lst in par_cible.items()},
        "modele_shap": shap_key if shap_out is not None else None,
        "resultats": results,
        "validation_croisee": cv,
        "shap": shap_out,
    }
    with open(OUT_DIR / "comparaison_modeles.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, default=ts._json_default)
    if shap_out is not None:
        with open(OUT_DIR / "shap_transmission_reel.json", "w", encoding="utf-8") as f:
            json.dump({"modele": shap_key, **shap_out}, f, indent=2, ensure_ascii=False, default=ts._json_default)
    log(f"Résultats : {OUT_DIR / 'comparaison_modeles.json'} ({time.time() - t_start:.0f} s)")


if __name__ == "__main__":
    main()
