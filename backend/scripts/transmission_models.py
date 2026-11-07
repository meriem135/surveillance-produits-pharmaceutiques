# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/scripts/transmission_models.py
#   SCRIPT 3 — LE CŒUR MACHINE LEARNING. Features, 6 modèles sur 20 répétitions, choix du
#   réglage d'alerte, classement, diagnostic, validation croisée, SHAP, sauvegarde du meilleur
#   modèle.
# ══════════════════════════════════════════════════════════════════════════
"""
Modèles supervisés sur les traces réelles avec attaques de transmission (version 3)
==================================================================================
Plan de l'étudiante : (1) prétraitement des traces réelles, (2) injection d'attaques
MITM / injection, (3) modèles supervisés, choix du meilleur, (4) SHAP.

Corrections après la relecture du professeur (novembre 2026) :
  1. Zone de garde ≥ plus longue fenêtre : 20 min (tr.GUARD) après chaque épisode ET en
     début de chaque bloc qui change de rôle (tr.boundary_guard) ; aucune ligne apprise ou
     évaluée n'a de fenêtre glissante (≤ 15 min) qui traverse la frontière train/val/test.
     L'EWMA (mémoire non bornée) est retirée des features.
  2. UN SEUL point de fonctionnement, choisi sur la VALIDATION : seuil + règle de
     persistance « k lignes sur n » (transmission_alertes), rappel maximal sous
     précision ≥ 0,90 et ≤ 0,5 fausse alerte par heure. Fini les deux seuils et le F2.
  3. Classement des modèles sur la validation : modèles qui tiennent la contrainte d'abord,
     puis rappel à la contrainte, puis fausses alertes/h, puis délai.
  4. Diagnostic train / validation / test de chaque modèle et courbe d'apprentissage du
     meilleur (sous- ou sur-apprentissage).
  5. Modèles et features : Random Forest, Extra Trees, XGBoost, HistGradientBoosting
     (famille LightGBM, disponible dans scikit-learn), Régression Logistique, MLP ;
     hyperparamètres réglés par une petite grille en validation croisée GROUPÉE par bloc sur
     le seul train (transmission_recherche.py) ; features de forme de la distribution
     glissante (min, max, quantiles), variation absolue moyenne, résidus entre capteurs.

Prévalence (lignes évaluées, hors zone de garde). Un épisode dans CHAQUE bloc d'entraînement
(≈ 50 % d'attaques : les modèles supervisés ont besoin d'exemples), dans 2 blocs sur 5 en
validation et en test (≈ 17 %, mesuré et écrit dans le JSON).
Déséquilibre : class_weight / scale_pos_weight / sample_weight, pas de SMOTE (des points
interpolés fabriqueraient des fenêtres glissantes qui n'existent pas).

Protocole : 70/15/15 NON aléatoire par blocs d'une heure entrelacés, 20 répétitions = les
20 rotations du cycle (chaque heure sert 3 fois de test), résultats cumulés. Le seuil et
la règle de persistance de chaque modèle sont choisis sur la validation CUMULÉE des 20
répétitions (un seul réglage par modèle) ; le test ne fait que confirmer.

Sorties : data/processed/dataset_transmission_reel.csv + episodes_transmission_reel.json
          (répétition 0), models/transmission_reel/comparaison_modeles.json,
          validation_croisee.json, shap_transmission_reel.json, meilleur_modele.pkl +
          meilleur_modele.json (features, seuil, k, n), scores_repetition0.npz
Usage :  cd backend && nice -n 10 .venv/bin/python scripts/transmission_models.py
         (N_JOBS=3 ; SKIP_SHAP=1, SKIP_CV=1, SKIP_LC=1 pour aller plus vite ;
          N_RUNS=… pour un essai ; MODELS=RandomForest,HistGB pour un sous-ensemble)
"""

from __future__ import annotations

import os as _os

# Le serveur héberge d'autres sites : 3 cœurs au plus, y compris pour OpenMP (HistGradientBoosting, XGBoost).
_os.environ.setdefault("OMP_NUM_THREADS", _os.environ.get("N_JOBS", "3"))

import contextlib
import io
import json
import os
import sys
import time
import traceback
from pathlib import Path

for _flux in (sys.stdout, sys.stderr):
    try:
        _flux.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import LabelEncoder, StandardScaler

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import build_dataset as bd  # noqa: E402
import transmission_alertes as ta  # noqa: E402
import transmission_real as tr  # noqa: E402
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
TUNING_PATH = OUT_DIR / "recherche_hyperparametres.json"
BEST_CONFIG_PATH = OUT_DIR / "meilleur_modele.json"
SCORES0_PATH = OUT_DIR / "scores_repetition0.npz"
SHAP_RUNS = int(os.environ.get("SHAP_RUNS", "5"))           # SHAP cumulé sur les 5 premières rotations
LC_RUNS = (0, 7, 14)                                        # courbe d'apprentissage : 3 rotations
LC_FRACTIONS = (0.1, 0.25, 0.5, 0.75, 1.0)
log = tr.log

SENSORS = ("weather", "fridge", "thermostat")
WINDOWS = {"1min": 12, "5min": 60, "15min": 180}
SHAPE_SENSORS = ("fridge", "thermostat")       # capteurs attaqués : forme de la distribution glissante
SHAPE_WINDOWS = {"5min": 60, "15min": 180}
# Toutes les fenêtres tiennent dans tr.W_MAX (15 min), couverte par la zone de garde tr.GUARD.
assert max(max(WINDOWS.values()), max(SHAPE_WINDOWS.values())) <= tr.W_MAX


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] op_key
#   Rôle   : Ancien nom d'un réglage d'alerte (« rappel_0.90 »). Gardé seulement pour relire les anciens
#            fichiers JSON.
#   Entrée : target : rappel visé (ex. 0.9)
#   Sortie : le texte « rappel_0.90 »
# ──────────────────────────────────────────────────────────────────────
def op_key(target: float) -> str:
    """Ancien nom de point de fonctionnement « rappel cible » (gardé pour les anciens JSON)."""
    return f"rappel_{target:.2f}"


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] engineer
#   Rôle   : PRÉPARATION DES DONNÉES (feature engineering). Transforme les 3 températures brutes en ~50
#            colonnes que le modèle sait lire : variations, moyennes et écarts-types sur 1, 5 et 15 min,
#            min/max/quantiles, écarts entre capteurs, détection de rejeu. Toutes les colonnes ne regardent
#            QUE le passé (comme un vrai capteur en temps réel) et jamais plus de 15 min en arrière.
#   Entrée : df : tableau des mesures (une ligne toutes les 5 s, colonnes fridge_temp, thermostat_temp,
#            weather_temp…)
#   Sortie : (tableau enrichi, liste des noms des colonnes à donner au modèle)
# ──────────────────────────────────────────────────────────────────────
def engineer(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Features de prétraitement. Toutes sont CAUSALES (ne regardent que le passé) et leurs
    fenêtres font au plus tr.W_MAX = 15 min :
      - par capteur : valeur, variation, moyenne et écart-type glissants sur 1, 5 et 15 min,
        variation absolue moyenne sur 5 min (une valeur figée ou forgée varie peu),
        indicateur « séquence de 2 min déjà transmise » (rejeu exact) ;
      - frigo et thermostat : minimum, maximum, quantiles 10 % et 90 % sur 5 et 15 min (un
        décalage de −0,5 °C déplace le haut et le bas de la distribution glissante bien avant
        que la moyenne ne bouge : les traces sont bornées, frigo entre 1 et 14 °C) ;
      - écarts entre capteurs (résidus) et leur moyenne sur 15 min ; état du frigo et du thermostat.
    La moyenne lissée EWMA a été RETIRÉE : sa mémoire n'est pas bornée (elle aurait traversé
    la zone de garde). Pas d'heure ni de saison : 62 h de données seulement."""
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
        if s in SHAPE_SENSORS:
            for tag, w in SHAPE_WINDOWS.items():
                r = x.rolling(w, min_periods=1)
                d[f"{s}_min_{tag}"], d[f"{s}_max_{tag}"] = r.min(), r.max()
                d[f"{s}_q10_{tag}"], d[f"{s}_q90_{tag}"] = r.quantile(0.10), r.quantile(0.90)
                feats += [f"{s}_min_{tag}", f"{s}_max_{tag}", f"{s}_q10_{tag}", f"{s}_q90_{tag}"]
        d[f"{s}_absdiff_5min"] = x.diff().abs().rolling(60, min_periods=1).mean()
        d[f"{s}_repeat_2min"] = tr.replay_flags(x.to_numpy(float)).astype(float)
        feats += [f"{s}_absdiff_5min", f"{s}_repeat_2min"]
    d["fridge_thermostat_diff"] = d["fridge_temp"] - d["thermostat_temp"]
    d["weather_fridge_diff"] = d["weather_temp"] - d["fridge_temp"]
    d["weather_thermostat_diff"] = d["weather_temp"] - d["thermostat_temp"]
    d["fridge_thermostat_diff_mean_15min"] = d["fridge_thermostat_diff"].rolling(180, min_periods=1).mean()
    d["weather_fridge_diff_mean_15min"] = d["weather_fridge_diff"].rolling(180, min_periods=1).mean()
    d["fridge_cond_enc"] = LabelEncoder().fit_transform(d["fridge_cond"].astype(str)).astype(float)
    d["thermo_status"] = pd.to_numeric(d["thermo_status"], errors="coerce").fillna(0).astype(float)
    feats += ["fridge_thermostat_diff", "weather_fridge_diff", "weather_thermostat_diff",
              "fridge_thermostat_diff_mean_15min", "weather_fridge_diff_mean_15min",
              "fridge_cond_enc", "thermo_status"]
    d[feats] = d[feats].replace([np.inf, -np.inf], np.nan).fillna(0.0)
    d = tr.drop_legacy_cols(d)
    return d, feats


# ── Modèles ──────────────────────────────────────────────────────────────────
# Déséquilibre : poids de classe (class_weight / scale_pos_weight / sample_weight), pas de SMOTE.

MODELS = [("RandomForest", "Random Forest"),
          ("ExtraTrees", "Extra Trees"),
          ("XGBoost", "XGBoost"),
          ("HistGB", "HistGradientBoosting"),
          ("Logistique", "Régression Logistique"),
          ("MLP", "MLP — réseau de neurones")]
TREE_MODELS = ("RandomForest", "ExtraTrees", "XGBoost", "HistGB")
NEEDS_SCALING = ("Logistique", "MLP")
MODEL_NAMES = dict(MODELS)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _tuned
#   Rôle   : Lit les meilleurs hyperparamètres trouvés par transmission_recherche.py pour un modèle.
#   Entrée : key : nom court du modèle ("RandomForest", "XGBoost"…)
#   Sortie : dictionnaire des réglages (vide si le fichier n'existe pas)
# ──────────────────────────────────────────────────────────────────────
def _tuned(key: str) -> dict:
    """Réglage retenu par transmission_recherche.py (validation croisée groupée sur le train)."""
    try:
        with open(TUNING_PATH, encoding="utf-8") as f:
            return dict(json.load(f)["modeles"][key]["retenu"])
    except (OSError, ValueError, KeyError):
        return {}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] make_model
#   Rôle   : FABRIQUE UN MODÈLE vide (pas encore entraîné) parmi les 6 : Random Forest, Extra Trees, XGBoost,
#            HistGradientBoosting, Régression Logistique, MLP. Chaque modèle reçoit un réglage qui compense
#            le déséquilibre (beaucoup plus de mesures normales que d'attaques).
#   Entrée : key : nom du modèle ; ratio : normales / attaques (pour XGBoost) ; params : réglages à forcer
#   Sortie : l'objet scikit-learn / XGBoost prêt à être entraîné
# ──────────────────────────────────────────────────────────────────────
def make_model(key: str, ratio: float = 1.0, **params):
    """Estimateur non entraîné. ratio = normales / attaques du train (XGBoost)."""
    if key == "RandomForest":
        p = dict(n_estimators=300, min_samples_leaf=5, max_features="sqrt", class_weight="balanced_subsample",
                 random_state=SEED, n_jobs=N_JOBS)
        return RandomForestClassifier(**{**p, **params})
    if key == "ExtraTrees":
        p = dict(n_estimators=400, min_samples_leaf=5, max_features="sqrt", class_weight="balanced_subsample",
                 random_state=SEED, n_jobs=N_JOBS)
        return ExtraTreesClassifier(**{**p, **params})
    if key == "XGBoost":
        if XGBClassifier is None:
            raise RuntimeError("xgboost absent")
        p = dict(n_estimators=400, max_depth=6, learning_rate=0.05, subsample=0.8, colsample_bytree=0.8,
                 scale_pos_weight=ratio, eval_metric="logloss", random_state=SEED, n_jobs=N_JOBS, verbosity=0)
        return XGBClassifier(**{**p, **params})
    if key == "HistGB":
        p = dict(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, l2_regularization=1.0,
                 class_weight="balanced", random_state=SEED)
        return HistGradientBoostingClassifier(**{**p, **params})
    if key == "Logistique":
        return LogisticRegression(**{**dict(max_iter=1000, class_weight="balanced", random_state=SEED), **params})
    if key == "MLP":
        return MLPClassifier(**{**dict(hidden_layer_sizes=(64, 32), max_iter=300, early_stopping=True,
                                       random_state=SEED), **params})
    raise KeyError(key)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] make_random_forest
#   Rôle   : Raccourci : un Random Forest avec ses meilleurs réglages.
#   Entrée : rien
#   Sortie : le Random Forest non entraîné
# ──────────────────────────────────────────────────────────────────────
def make_random_forest() -> RandomForestClassifier:
    """Random Forest au réglage retenu (utilisé aussi par transmission_biais_long.py)."""
    return make_model("RandomForest", **_tuned("RandomForest"))


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] balanced_weights
#   Rôle   : Donne un poids plus fort aux lignes d'attaque (rares) pour que le modèle ne les ignore pas.
#            Utilisé par le MLP, qui n'a pas d'option « class_weight ».
#   Entrée : y_tr : étiquettes du train (0 = normal, 1 = attaque)
#   Sortie : un poids par ligne
# ──────────────────────────────────────────────────────────────────────
def balanced_weights(y_tr: np.ndarray) -> np.ndarray:
    """Poids d'échantillon qui équilibrent attaques et normales (comme class_weight="balanced")."""
    pos = max(1, int(y_tr.sum()))
    return np.where(y_tr == 1, len(y_tr) / (2 * pos), len(y_tr) / (2 * max(1, len(y_tr) - pos)))


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] fit_model
#   Rôle   : ENTRAÎNE un modèle sur les lignes d'entraînement. Pour la Régression Logistique et le MLP,
#            ajoute d'abord une mise à l'échelle (StandardScaler) car ces modèles sont sensibles aux unités.
#   Entrée : key : modèle ; X : features ; y : étiquettes ; rows : numéros des lignes du train ; params :
#            réglages
#   Sortie : (modèle entraîné, hyperparamètres utilisés pour l'affichage)
# ──────────────────────────────────────────────────────────────────────
def fit_model(key: str, X: np.ndarray, y: np.ndarray, rows: np.ndarray, params: dict | None = None):
    """Entraîne un modèle sur les lignes `rows`. Les modèles sensibles à l'échelle (Logistique,
    MLP) sont des pipelines StandardScaler → modèle : le .pkl s'applique tel quel aux mesures.
    Renvoie (modèle, hyperparamètres utilisés)."""
    y_tr = y[rows]
    pos = max(1, int(y_tr.sum()))
    ratio = float((len(rows) - pos) / pos)
    used = _tuned(key)
    used.update(params or {})
    est = make_model(key, ratio, **used)
    if key in NEEDS_SCALING:
        model = make_pipeline(StandardScaler(), est)
        fit_kw = {"mlpclassifier__sample_weight": balanced_weights(y_tr)} if key == "MLP" else {}
        model.fit(X[rows], y_tr, **fit_kw)
    else:
        model = est.fit(X[rows], y_tr)
    shown = {k: v for k, v in est.get_params().items()
             if k in ("n_estimators", "min_samples_leaf", "max_features", "class_weight", "max_depth",
                      "learning_rate", "min_child_weight", "subsample", "colsample_bytree", "max_iter",
                      "max_leaf_nodes", "l2_regularization", "hidden_layer_sizes", "early_stopping")}
    if key == "XGBoost":
        shown["scale_pos_weight"] = round(ratio, 2)
    if key == "MLP":
        shown["sample_weight"] = "équilibré"
    return model, shown


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] scores_of
#   Rôle   : Demande au modèle sa probabilité d'attaque pour chaque ligne.
#   Entrée : model : modèle entraîné ; X : features
#   Sortie : un score entre 0 et 1 par ligne
# ──────────────────────────────────────────────────────────────────────
def scores_of(model, X: np.ndarray) -> np.ndarray:
    return model.predict_proba(X)[:, 1].astype(np.float32)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] role_prevalence
#   Rôle   : Compte, pour train / validation / test, le nombre de lignes et la part d'attaques.
#   Entrée : y : étiquettes ; idx_by_role : lignes de chaque rôle
#   Sortie : {rôle: {lignes, attaques, part}}
# ──────────────────────────────────────────────────────────────────────
def role_prevalence(y: np.ndarray, idx_by_role: dict[str, np.ndarray]) -> dict:
    return {r: {"lignes": int(len(i)), "attaques": int(y[i].sum()),
                "part": round(float(y[i].mean()), 4) if len(i) else 0.0} for r, i in idx_by_role.items()}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] pr_curve
#   Rôle   : Calcule la courbe précision-rappel (≈ 120 points) affichée sur le site.
#   Entrée : y : étiquettes ; s : scores du modèle
#   Sortie : {recall: [...], precision: [...]}
# ──────────────────────────────────────────────────────────────────────
def pr_curve(y: np.ndarray, s: np.ndarray, n: int = 120) -> dict:
    """Courbe précision-rappel allégée (≈ n points) pour la page web."""
    p, r, _ = precision_recall_curve(y, s)
    idx = np.unique(np.linspace(0, len(p) - 1, min(n, len(p))).astype(int))
    return {"recall": [round(float(v), 4) for v in r[idx]], "precision": [round(float(v), 4) for v in p[idx]]}


# ── Une répétition ───────────────────────────────────────────────────────────

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] prepare_run
#   Rôle   : PRÉPARE UNE RÉPÉTITION de l'expérience : place les attaques dans le temps, les injecte dans les
#            traces réelles, calcule les features et découpe les lignes en train / validation / test (en
#            retirant la zone de garde).
#   Entrée : base : traces réelles fusionnées ; run : numéro de la répétition (0 à 19)
#   Sortie : dictionnaire avec df, X, y, épisodes, rôles et masques de chaque ligne
# ──────────────────────────────────────────────────────────────────────
def prepare_run(base: pd.DataFrame, run: int) -> dict:
    """Injection, features, masques des rôles (hors zones de garde) d'une répétition."""
    rng = np.random.default_rng(SEED + run)
    episodes = tr.build_schedule(len(base), rng, run, roles=("train", "val", "test"))
    injected = tr.inject(base, episodes, rng, run)
    df, feats = engineer(injected)
    y = df["label"].to_numpy().astype(int)
    split = tr.block_split(len(df), run)
    excl = tr.excluded_rows(df["garde"].to_numpy().astype(bool), run)
    ev = {role: (split == role) & ~excl for role in ("train", "val", "test")}
    out = {"run": run, "episodes": episodes, "df": df, "feats": feats, "y": y, "split": split, "excl": excl,
           "ev": ev, "idx": {r: np.where(m)[0] for r, m in ev.items()},
           "types": df["attack_type"].to_numpy(), "X": df[feats].to_numpy(np.float32)}
    return out


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] one_run
#   Rôle   : FAIT UNE RÉPÉTITION COMPLÈTE : prépare les données (prepare_run), entraîne chaque modèle sur le
#            train et garde ses scores sur toutes les lignes. Si un modèle plante, il est ignoré et l'étude
#            continue.
#   Entrée : base : traces réelles ; run : numéro de répétition ; keys : modèles à entraîner
#   Sortie : le dictionnaire de prepare_run + scores, modèles, réglages et temps d'entraînement
# ──────────────────────────────────────────────────────────────────────
def one_run(base: pd.DataFrame, run: int, keys: list[str]) -> dict:
    r = prepare_run(base, run)
    tri = r["idx"]["train"]
    r.update(scores={}, models={}, params={}, fit_s={},
             prevalence=role_prevalence(r["y"], r["idx"]))
    for key in keys:
        t0 = time.time()
        try:
            model, used = fit_model(key, r["X"], r["y"], tri)
        except Exception:  # noqa: BLE001 — un modèle en échec ne doit pas arrêter l'étude
            traceback.print_exc(file=sys.__stderr__)
            log(f"  !! {key} : échec, ignoré (répétition {run})")
            continue
        r["scores"][key] = scores_of(model, r["X"])
        r["models"][key], r["params"][key], r["fit_s"][key] = model, used, round(time.time() - t0, 1)
    return r


# ── Point de fonctionnement, métriques par rôle, classement ──────────────────

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] operating_point
#   Rôle   : CHOISIT LE RÉGLAGE D'ALERTE d'un modèle sur la VALIDATION : un seuil de score et une règle « k
#            mesures sur n ». Objectif : le plus de détections possible avec précision ≥ 90 % et au plus 0,5
#            fausse alerte par heure.
#   Entrée : runs : toutes les répétitions ; key : modèle
#   Sortie : (réglage retenu, toutes les combinaisons essayées)
# ──────────────────────────────────────────────────────────────────────
def operating_point(runs: list[dict], key: str) -> tuple[dict, list[dict]]:
    """Seuil + persistance (k, n) choisis sur la validation CUMULÉE (un seul réglage par modèle)."""
    scored = [{"s": r["scores"][key], "y": r["y"], "evaluated_val": r["ev"]["val"]} for r in runs if key in r["scores"]]
    rows = ta.grid(scored, "val")
    op = ta.choose(rows)
    return op, rows


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] role_metrics
#   Rôle   : Mesure les performances d'un modèle sur train, validation et test avec son réglage : rappel,
#            précision, F1, fausses alertes/h, épisodes détectés, délai, AUC et AP.
#   Entrée : runs : répétitions ; key : modèle ; op : réglage d'alerte
#   Sortie : dictionnaire des métriques par rôle
# ──────────────────────────────────────────────────────────────────────
def role_metrics(runs: list[dict], key: str, op: dict) -> dict:
    """Métriques cumulées train / val / test, au niveau « alarme » (persistance k sur n) et
    « ligne » (même seuil, sans persistance), plus AUC / AP moyennes."""
    out = {"alarme": {}, "ligne": {}, "auc": {}, "ap": {}}
    raw_op = {**op, "k": 1, "n": 1}
    for role in ("train", "val", "test"):
        ca, cl, aucs, aps = [], [], [], []
        for r in runs:
            if key not in r["scores"]:
                continue
            s, ev = r["scores"][key], r["ev"][role]
            ca.append(ta.count(ta.apply(s, op), r["y"], ev, r["episodes"], role, r["types"], tr.ATTACK_NAMES))
            cl.append(ta.count(ta.apply(s, raw_op), r["y"], ev, r["episodes"], role, r["types"], tr.ATTACK_NAMES))
            yy = r["y"][ev]
            if 0 < yy.sum() < len(yy):
                aucs.append(roc_auc_score(yy, s[ev]))
                aps.append(average_precision_score(yy, s[ev]))
        out["alarme"][role] = ta.pool(ca)
        out["ligne"][role] = ta.pool(cl)
        out["auc"][role] = round(float(np.mean(aucs)), 4) if aucs else None
        out["ap"][role] = round(float(np.mean(aps)), 4) if aps else None
    return out


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] summarize_model
#   Rôle   : FICHE RÉSULTAT D'UN MODÈLE : réglage choisi + toutes ses métriques (test surtout, mais aussi
#            validation et train) + courbes précision-rappel. C'est ce qui est écrit dans
#            comparaison_modeles.json.
#   Entrée : runs : répétitions ; key : modèle
#   Sortie : dictionnaire complet des résultats du modèle
# ──────────────────────────────────────────────────────────────────────
def summarize_model(runs: list[dict], key: str) -> dict:
    op, rows = operating_point(runs, key)
    m = role_metrics(runs, key, op)
    t, v = m["alarme"]["test"], m["alarme"]["val"]
    pool_role = lambda role: (np.concatenate([r["y"][r["ev"][role]] for r in runs if key in r["scores"]]),
                              np.concatenate([r["scores"][key][r["ev"][role]] for r in runs if key in r["scores"]]))
    yv, sv = pool_role("val")
    yt, st = pool_role("test")
    res = {
        "nom": MODEL_NAMES.get(key, key), "type": "supervisé",
        # champs « à plat » = TEST, niveau alarme, au point de fonctionnement unique
        **{k: t[k] for k in ("recall", "precision", "f1", "fpr", "tp", "fp", "fn", "tn", "part_attaques",
                             "fausses_alarmes_evenements_par_heure", "alertes", "fausses_alertes",
                             "precision_alertes", "episodes", "episodes_detectes", "delai_median_min",
                             "delai_p90_min", "per_attack", "per_episode")},
        **{f"val_{k}": v[k] for k in ("recall", "precision", "f1", "episodes", "episodes_detectes",
                                      "delai_median_min", "part_attaques")},
        "val_fausses_alarmes_par_heure": v["fausses_alarmes_evenements_par_heure"],
        "roc_auc": m["auc"]["test"], "avg_precision": m["ap"]["test"],
        "val_roc_auc": m["auc"]["val"], "val_avg_precision": m["ap"]["val"],
        "train_roc_auc": m["auc"]["train"], "train_avg_precision": m["ap"]["train"],
        "threshold": op["seuil"],
        "point_fonctionnement": {"seuil": op["seuil"], "k": op["k"], "n": op["n"],
                                 "persistance_min": round(op["n"] * tr.STEP_MINUTES, 2),
                                 "contrainte_tenue": op["contrainte_tenue"], "critere": ta.criterion_text(),
                                 "validation": {x: op[x] for x in ("precision", "recall", "f1", "fa_h")}},
        "par_role": {"alarme": m["alarme"], "ligne": m["ligne"], "auc": m["auc"], "ap": m["ap"]},
        "grille_validation": [x for x in rows if (x["k"], x["n"]) in {(op["k"], op["n"]), (1, 1)}],
        "courbe_pr": {"val": pr_curve(yv, sv), "test": pr_curve(yt, st)},
    }
    return res


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] rank_models
#   Rôle   : CLASSE LES MODÈLES sur la validation (jamais sur le test) : d'abord ceux qui respectent la
#            contrainte, puis le meilleur rappel, puis le moins de fausses alertes, puis le délai le plus
#            court.
#   Entrée : results : fiches de summarize_model
#   Sortie : liste des modèles du meilleur au moins bon
# ──────────────────────────────────────────────────────────────────────
def rank_models(results: dict, keys: list[str] | None = None) -> list[str]:
    """Classement sur la VALIDATION uniquement : modèles qui tiennent la contrainte (précision,
    fausses alertes/h) d'abord, puis rappel (alarme) le plus haut, puis moins de fausses
    alertes/h, puis délai le plus court."""
    keys = [k for k in (keys or results) if k in results]

    def cle(k):
        r = results[k]
        op = r.get("point_fonctionnement") or {}
        delai = r.get("val_delai_median_min")
        return (not op.get("contrainte_tenue", False), -(r.get("val_recall") or 0.0),
                r.get("val_fausses_alarmes_par_heure") or 0.0, delai if delai is not None else 1e9)

    return sorted(keys, key=cle)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] diagnostic
#   Rôle   : Compare train, validation et test pour dire si le modèle sur-apprend (apprend par cœur) ou sous-
#            apprend (trop simple).
#   Entrée : res : fiche d'un modèle
#   Sortie : écarts mesurés + phrase de verdict
# ──────────────────────────────────────────────────────────────────────
def diagnostic(res: dict) -> dict:
    """Écart train → validation → test (AP, F1 de l'alarme) : sur- ou sous-apprentissage."""
    ap = res["par_role"]["ap"]
    f1 = {r: res["par_role"]["alarme"][r]["f1"] for r in ("train", "val", "test")}
    gap = None if ap["train"] is None or ap["val"] is None else round(ap["train"] - ap["val"], 4)
    if gap is None:
        verdict = "non évalué"
    elif ap["train"] >= 0.97 and gap > 0.1:
        verdict = "surapprentissage : le modèle connaît presque par cœur son train, l'écart avec la validation est grand"
    elif ap["train"] < 0.8:
        verdict = "sous-apprentissage : même sur son train, le modèle sépare mal attaques et normal"
    elif gap > 0.1:
        verdict = "écart train-validation marqué : variance (sur-apprentissage partiel)"
    else:
        verdict = "écart train-validation faible : pas de sur-apprentissage marqué"
    return {"ap": ap, "f1_alarme": f1, "ecart_ap_train_val": gap,
            "ecart_ap_val_test": None if ap["val"] is None or ap["test"] is None else round(ap["val"] - ap["test"], 4),
            "verdict": verdict}


# ── Courbe d'apprentissage ───────────────────────────────────────────────────

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] learning_curve
#   Rôle   : COURBE D'APPRENTISSAGE : réentraîne le meilleur modèle avec 10 %, 25 %, 50 %, 75 % et 100 % du
#            train pour voir si plus de données l'améliorerait.
#   Entrée : base : traces ; key : modèle ; op : réglage d'alerte
#   Sortie : une ligne par taille de train (AP et F1 train / validation)
# ──────────────────────────────────────────────────────────────────────
def learning_curve(base: pd.DataFrame, key: str, op: dict) -> list[dict]:
    """Score selon la taille du train (fraction des BLOCS d'entraînement tirés au hasard),
    moyenne sur LC_RUNS rotations : AP et F1 (ligne, seuil retenu) sur le train utilisé et sur la validation."""
    from sklearn.metrics import f1_score  # noqa: PLC0415
    acc: dict[float, list] = {f: [] for f in LC_FRACTIONS}
    for run in LC_RUNS:
        r = prepare_run(base, run)
        tri, vai = r["idx"]["train"], r["idx"]["val"]
        blocks = np.unique(tri // tr.STEPS_HOUR)
        rng = np.random.default_rng(SEED + 1000 + run)
        order = rng.permutation(blocks)
        for f in LC_FRACTIONS:
            keep = np.isin(tri // tr.STEPS_HOUR, order[:max(2, int(round(f * len(blocks))))])
            rows = tri[keep]
            model, _ = fit_model(key, r["X"], r["y"], rows)
            s_tr, s_va = scores_of(model, r["X"][rows]), scores_of(model, r["X"][vai])
            acc[f].append({"lignes": len(rows),
                           "ap_train": average_precision_score(r["y"][rows], s_tr),
                           "ap_val": average_precision_score(r["y"][vai], s_va),
                           "f1_train": f1_score(r["y"][rows], s_tr >= op["seuil"]),
                           "f1_val": f1_score(r["y"][vai], s_va >= op["seuil"])})
            log(f"    courbe d'apprentissage {key} rotation {run} : {100 * f:.0f} % du train → "
                f"AP train {acc[f][-1]['ap_train']:.3f}, val {acc[f][-1]['ap_val']:.3f}")
    return [{"part_train": f, "lignes_train": int(np.mean([x["lignes"] for x in v])),
             **{m: round(float(np.mean([x[m] for x in v])), 4) for m in ("ap_train", "ap_val", "f1_train", "f1_val")}}
            for f, v in acc.items()]


# ── Validation croisée de confirmation ───────────────────────────────────────

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] cv_splitters
#   Rôle   : Les deux façons de faire la validation croisée : naïve (lignes mélangées, à NE PAS faire) et
#            groupée par bloc d'une heure (la bonne).
#   Entrée : n_splits : nombre de plis
#   Sortie : {nom: découpeur scikit-learn}
# ──────────────────────────────────────────────────────────────────────
def cv_splitters(n_splits: int = 5) -> dict:
    from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold  # noqa: PLC0415
    return {"naif": StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=SEED),
            "groupes_blocs": StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=SEED)}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] shared_blocks
#   Rôle   : Compte les blocs d'une heure présents à la fois dans l'apprentissage et l'évaluation : 0 = pas
#            de fuite.
#   Entrée : splitter : découpeur ; X, y : données ; groups : bloc de chaque ligne
#   Sortie : nombre de blocs partagés
# ──────────────────────────────────────────────────────────────────────
def shared_blocks(splitter, X, y, groups) -> int:
    """Nombre de blocs d'une heure présents à la fois dans l'apprentissage et dans
    l'évaluation d'un même fold (somme sur les folds) : 0 = pas de fuite par les blocs."""
    total = 0
    uses_groups = "Group" in type(splitter).__name__
    for a, b in splitter.split(X, y, groups if uses_groups else None):
        total += len(np.intersect1d(np.unique(groups[a]), np.unique(groups[b])))
    return total


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] validation_croisee
#   Rôle   : Montre la FUITE DE DONNÉES : la validation croisée naïve donne des scores trop beaux, la
#            validation groupée par bloc donne des scores honnêtes.
#   Entrée : r0 : répétition 0 ; keys : modèles ; n_splits : nombre de plis
#   Sortie : résultats moyens (rappel, précision, F1, AP) de chaque méthode
# ──────────────────────────────────────────────────────────────────────
def validation_croisee(r0: dict, keys: list[str], n_splits: int = 5) -> dict:
    """StratifiedKFold naïf (lignes mélangées : une attaque et ses fenêtres glissantes de part
    et d'autre → score trop optimiste) contre StratifiedGroupKFold par bloc d'une heure.
    Lignes d'entraînement de la répétition 0, seuil par défaut (0,5)."""
    from sklearn.metrics import f1_score, precision_score, recall_score  # noqa: PLC0415
    tri = r0["idx"]["train"]
    X, y = r0["X"], r0["y"]
    groups = tr.block_index(len(y))[tri]
    out = {"repetition": 0, "lignes": int(len(tri)), "attaques": int(y[tri].sum()),
           "blocs": int(len(np.unique(groups))), "folds": n_splits,
           "seuil": "probabilité ≥ 0,5, modèles pondérés", "methodes": {}}
    for meth, splitter in cv_splitters(n_splits).items():
        res = {"description": ("StratifiedKFold(shuffle=True) : lignes mélangées — à NE PAS faire"
                               if meth == "naif" else "StratifiedGroupKFold, groupe = bloc d'une heure"),
               "blocs_partages": shared_blocks(splitter, X[tri], y[tri], groups), "modeles": {}}
        folds = list(splitter.split(X[tri], y[tri], groups if meth == "groupes_blocs" else None))
        for key in keys:
            t0 = time.time()
            vals = {m: [] for m in ("recall", "precision", "f1", "average_precision")}
            for a, b in folds:
                model, _ = fit_model(key, X, y, tri[a])
                s = scores_of(model, X[tri[b]])
                yb, pb = y[tri[b]], s >= 0.5
                vals["recall"].append(recall_score(yb, pb, zero_division=0))
                vals["precision"].append(precision_score(yb, pb, zero_division=0))
                vals["f1"].append(f1_score(yb, pb, zero_division=0))
                vals["average_precision"].append(average_precision_score(yb, s))
            res["modeles"][key] = {m: {"mean": round(float(np.mean(v)), 4), "std": round(float(np.std(v)), 4)}
                                   for m, v in vals.items()}
            log(f"    CV {meth:13s} {key:12s} AP {res['modeles'][key]['average_precision']['mean']:.3f} "
                f"rappel {res['modeles'][key]['recall']['mean']:.3f} précision "
                f"{res['modeles'][key]['precision']['mean']:.3f} ({time.time() - t0:.0f} s)")
        out["methodes"][meth] = res
    return out


# ── SHAP ─────────────────────────────────────────────────────────────────────

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] shap_summary
#   Rôle   : EXPLICABILITÉ SHAP : mesure quelles features ont le plus poussé le modèle à dire « attaque », en
#            général et pour chaque scénario d'attaque.
#   Entrée : runs : répétitions ; key : modèle à arbres ; rng : générateur aléatoire
#   Sortie : top 15 global + top 6 par scénario
# ──────────────────────────────────────────────────────────────────────
def shap_summary(runs: list[dict], key: str, rng) -> dict:
    """SHAP (TreeExplainer) du meilleur modèle arborescent sur les lignes d'attaque du test des
    SHAP_RUNS premières rotations : importance moyenne |SHAP| par feature, globale et par scénario."""
    import shap

    feats = runs[0]["feats"]
    imps, types_all = [], []
    for r in runs[:SHAP_RUNS]:
        model = r["models"].get(key)
        if model is None:
            continue
        att = r["idx"]["test"][r["y"][r["idx"]["test"]] == 1]
        rows = rng.choice(att, min(1000, len(att)), replace=False)
        values = shap.TreeExplainer(model).shap_values(r["X"][rows])
        if isinstance(values, list):
            values = values[-1]
        values = np.asarray(values)
        if values.ndim == 3:
            values = values[:, :, -1]
        imps.append(np.abs(values))
        types_all.append(r["types"][rows])
    imp = np.vstack(imps)
    types = np.concatenate(types_all)

    def top(mask: np.ndarray, k: int = 6) -> list[dict]:
        m = imp[mask].mean(axis=0)
        order = np.argsort(m)[::-1][:k]
        return [{"feature": feats[i], "importance": round(float(m[i]), 4)} for i in order]

    out = {"n_lignes": int(len(imp)), "repetitions": min(SHAP_RUNS, len(runs)),
           "global": top(np.ones(len(imp), dtype=bool), 15), "par_scenario": {}}
    for nm in tr.ATTACK_NAMES:
        mask = types == nm
        if mask.any():
            out["par_scenario"][nm] = top(mask)
    return out


# ── Affichage ────────────────────────────────────────────────────────────────

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] print_results
#   Rôle   : Affiche dans le terminal le tableau des résultats de tous les modèles.
#   Entrée : results : fiches ; ranking : classement
#   Sortie : rien (affichage)
# ──────────────────────────────────────────────────────────────────────
def print_results(results: dict, ranking: list[str]) -> None:
    print()
    print("═" * 118)
    print(f"Point de fonctionnement unique ({ta.criterion_text()}) — cumul de {N_RUNS} répétitions")
    print("═" * 118)
    print(f"{'Modèle':42s} {'seuil':>5s} {'k/n':>6s} {'rôle':5s} {'Rappel':>7s} {'Préc.':>6s} {'F1':>6s} "
          f"{'FA/h':>6s} {'Épisodes':>9s} {'Délai':>6s} {'AP':>6s}")
    for k in ranking + [x for x in results if x not in ranking]:
        r = results[k]
        op = r["point_fonctionnement"]
        for role in ("train", "val", "test"):
            v = r["par_role"]["alarme"][role]
            d = "—" if v["delai_median_min"] is None else f"{v['delai_median_min']:.1f}"
            print(f"{r['nom'][:42]:42s} {op['seuil']:>5.2f} {str(op['k']) + '/' + str(op['n']):>6s} {role:5s} "
                  f"{v['recall']:>7.3f} {v['precision']:>6.3f} {v['f1']:>6.3f} "
                  f"{v['fausses_alarmes_evenements_par_heure']:>6.2f} "
                  f"{str(v['episodes_detectes']) + '/' + str(v['episodes']):>9s} {d:>6s} "
                  f"{tr._fmt(r['par_role']['ap'][role], '.3f', 6)}")
    best = results[ranking[0]]
    print()
    print("Par scénario (meilleur modèle, test) : rappel lignes, épisodes, délai médian")
    for nm in tr.ATTACK_NAMES:
        pa, pe = best["per_attack"].get(nm, {}), best["per_episode"].get(nm, {})
        print(f"  {nm:28s} {pa.get('rate', 0):>6.1f} %  {pe.get('detected')}/{pe.get('n')}  "
              f"{pe.get('delai_median_min')} min")


# ── Programme ────────────────────────────────────────────────────────────────

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] main
#   Rôle   : PROGRAMME PRINCIPAL de l'étude : (1) charge les traces réelles, (2) fait 20 répétitions avec les
#            6 modèles, (3) choisit le réglage et classe les modèles, (4) courbe d'apprentissage, (5)
#            validation croisée, (6) SHAP, puis sauvegarde le meilleur modèle (meilleur_modele.pkl) et tous
#            les résultats JSON.
#   Entrée : rien (variables d'environnement N_RUNS, MODELS, SKIP_… pour aller plus vite)
#   Sortie : fichiers dans models/transmission_reel/
# ──────────────────────────────────────────────────────────────────────
def main() -> None:
    paths.ensure_dirs()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    t_start = time.time()
    keys = [k for k, _ in MODELS]
    if os.environ.get("MODELS"):
        keys = [k for k in os.environ["MODELS"].split(",") if k in dict(MODELS)]
    if XGBClassifier is None and "XGBoost" in keys:
        keys.remove("XGBoost")
    log("[1] Traces réelles TON_IoT, prétraitement")
    with contextlib.redirect_stdout(io.StringIO()):
        real = bd.load_normal_traces()
    base, fusion = tr.fuse_real(real)
    log(f"    grille {tr.STEP} : {fusion['pas_conserves']:,} lignes ({fusion['debut']} → {fusion['fin']})")

    log(f"[2] {N_RUNS} répétitions : {', '.join(keys)}, {N_JOBS} cœurs")
    runs, run_times = [], []
    for run in range(N_RUNS):
        t0 = time.time()
        with contextlib.redirect_stdout(io.StringIO()):
            r = one_run(base, run, keys)
        if run == 0:
            r["df"].to_csv(DATASET_PATH, index=False, float_format="%.4f")
            with open(EPISODES_PATH, "w", encoding="utf-8") as f:
                json.dump(r["episodes"], f, indent=1, ensure_ascii=False, default=tr._json_default)
            log(f"    {DATASET_PATH.name} (répétition 0) : {len(r['df']):,} lignes, {len(r['feats'])} features")
        # Mémoire : on garde scores, masques et étiquettes ; X pour SHAP / courbes ; modèles arborescents
        # des SHAP_RUNS premières rotations ; tout pour la répétition 0.
        r.pop("df", None)
        if run >= SHAP_RUNS:
            r.pop("X", None)
            r["models"] = {}
        elif run > 0:
            r["models"] = {k: m for k, m in r["models"].items() if k in TREE_MODELS}
        runs.append(r)
        run_times.append(time.time() - t0)
        prev = r["prevalence"]
        log(f"    répétition {run} terminée ({run_times[-1]:.0f} s) ; attaques train {100 * prev['train']['part']:.1f} %, "
            f"val {100 * prev['val']['part']:.1f} %, test {100 * prev['test']['part']:.1f} % ; "
            + ", ".join(f"{k} {v:.0f} s" for k, v in r["fit_s"].items()))

    log("[3] Point de fonctionnement unique de chaque modèle (validation cumulée)")
    results: dict = {}
    for key in keys:
        if not any(key in r["scores"] for r in runs):
            continue
        t0 = time.time()
        res = summarize_model(runs, key)
        res["hyperparameters"] = runs[0]["params"].get(key)
        res["duree_entrainement_s"] = round(float(np.mean([r["fit_s"][key] for r in runs if key in r["fit_s"]])), 1)
        res["diagnostic"] = diagnostic(res)
        results[key] = res
        op = res["point_fonctionnement"]
        log(f"    {key:12s} seuil {op['seuil']:.2f}, {op['k']}/{op['n']} lignes, validation : rappel "
            f"{op['validation']['recall']:.3f}, précision {op['validation']['precision']:.3f}, "
            f"{op['validation']['fa_h']:.2f} FA/h ({time.time() - t0:.0f} s)")
    ranking = rank_models(results, keys)
    best_key = ranking[0]
    print_results(results, ranking)

    prevalence = {}
    for role in ("train", "val", "test"):
        n = sum(r["prevalence"][role]["lignes"] for r in runs)
        a = sum(r["prevalence"][role]["attaques"] for r in runs)
        prevalence[role] = {"lignes": n, "attaques": a, "part": round(a / max(1, n), 4),
                            "part_min": min(r["prevalence"][role]["part"] for r in runs),
                            "part_max": max(r["prevalence"][role]["part"] for r in runs)}
    b = results[best_key]
    print()
    print("Classement sur la VALIDATION : " + " > ".join(
        f"{k} (rappel {results[k]['val_recall']:.3f}, {results[k]['val_fausses_alarmes_par_heure']:.2f} FA/h)"
        for k in ranking))
    print(f"→ Meilleur modèle : {b['nom']} — test : rappel {b['recall']:.3f}, précision {b['precision']:.3f}, "
          f"{b['fausses_alarmes_evenements_par_heure']:.2f} FA/h, {b['episodes_detectes']}/{b['episodes']} épisodes, "
          f"délai médian {b['delai_median_min']} min")

    # Sauvegarde intermédiaire (scores, masques, épisodes) : permet de refaire le résumé sans réentraîner
    try:
        joblib.dump([{k: r[k] for k in ("run", "episodes", "y", "ev", "types", "scores", "params", "fit_s", "prevalence")}
                     for r in runs], OUT_DIR / "_repetitions_scores.joblib", compress=3)
    except Exception:  # noqa: BLE001
        traceback.print_exc()

    lc = None
    if not os.environ.get("SKIP_LC"):
        log(f"[4] Courbe d'apprentissage de {best_key}")
        try:
            lc = learning_curve(base, best_key, b["point_fonctionnement"])
        except Exception:  # noqa: BLE001 — une étape annexe ne doit pas faire perdre les résultats
            traceback.print_exc()

    cv = None
    if not os.environ.get("SKIP_CV"):
        log("[5] Validation croisée de confirmation (répétition 0) : naïve contre groupée par bloc")
        try:
            # Démonstration de la fuite : meilleur modèle, Random Forest et baseline linéaire (coût limité)
            cv_keys = [k for k in dict.fromkeys([best_key, "RandomForest", "Logistique"]) if k in keys]
            cv = validation_croisee(runs[0], cv_keys)
            cv["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            with open(CV_PATH, "w", encoding="utf-8") as f:
                json.dump(cv, f, indent=2, ensure_ascii=False, default=tr._json_default)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            cv = None

    shap_out, shap_key = None, next((k for k in ranking if k in TREE_MODELS), None)
    if shap_key is not None and not os.environ.get("SKIP_SHAP"):
        log(f"[6] SHAP de {shap_key} ({SHAP_RUNS} rotations)")
        try:
            shap_out = shap_summary(runs, shap_key, np.random.default_rng(SEED))
            print("SHAP global : " + ", ".join(f"{f['feature']} ({f['importance']:.3f})" for f in shap_out["global"][:8]))
        except Exception:  # noqa: BLE001
            traceback.print_exc()

    # Modèle en service : celui de la répétition 0, avec son point de fonctionnement
    r0 = runs[0]
    joblib.dump(r0["models"][best_key], OUT_DIR / "meilleur_modele.pkl")
    op = b["point_fonctionnement"]
    with open(BEST_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump({"modele": best_key, "nom": b["nom"], "features": r0["feats"], "seuil": op["seuil"],
                   "k": op["k"], "n": op["n"], "critere": op["critere"], "repetition": 0,
                   "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S")}, f, indent=2, ensure_ascii=False)
    np.savez_compressed(SCORES0_PATH, **{k: v for k, v in r0["scores"].items()})

    summary = {
        "version": 3,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "duree_s": round(time.time() - t_start, 1),
        "duree_par_repetition_s": round(float(np.mean(run_times)), 1),
        "n_jobs": N_JOBS,
        "dataset": DATASET_PATH.name,
        "fusion": fusion,
        "features": r0["feats"],
        "protocole": {
            "split": "70/15/15 NON aléatoire, blocs d'une heure entrelacés (14 train / 3 val / 3 test "
                     "sur un cycle de 20), rôles tournant à chaque répétition",
            "zone_de_garde": {"pas": tr.GUARD, "minutes": tr.GUARD * tr.STEP_MINUTES,
                              "plus_longue_fenetre_min": tr.W_MAX * tr.STEP_MINUTES,
                              "persistance_max_min": ta.N_MAX * tr.STEP_MINUTES,
                              "ou": "après chaque épisode et au début de chaque bloc qui change de rôle"},
            "attaques": "un épisode de 15 à 25 min dans CHAQUE bloc d'entraînement, dans 2 blocs sur 5 "
                        "de validation et de test (prévalence réaliste ≈ 13 %)",
            "repetitions": N_RUNS,
            "couverture": ("les 20 rotations du cycle : chaque heure sert 3 fois de test et 3 fois de validation"
                           if N_RUNS % tr.BLOCK_CYCLE == 0 else
                           f"{N_RUNS} rotations sur {tr.BLOCK_CYCLE} : toutes les heures ne servent pas de test"),
            "seuil": ta.criterion_text(),
            "precision_min": ta.PRECISION_MIN, "fa_max_par_heure": ta.FA_MAX,
            "persistances_essayees": [list(x) for x in ta.DEBOUNCE_GRID],
            "selection": "sur la VALIDATION uniquement : contrainte tenue, puis rappel, puis fausses alertes/h, "
                         "puis délai",
            "hyperparametres": "petite grille, StratifiedGroupKFold par bloc sur le train de la répétition 0 "
                               "(recherche_hyperparametres.json)",
            "desequilibre": "class_weight / scale_pos_weight / sample_weight, pas de SMOTE",
            "episodes_par_repetition": [len(r["episodes"]) for r in runs],
        },
        "prevalence": prevalence,
        "modeles": {k: MODEL_NAMES[k] for k in results},
        "classement_validation": ranking,
        "meilleur_modele": best_key,
        "modele_shap": shap_key if shap_out is not None else None,
        "resultats": results,
        "courbe_apprentissage": {"modele": best_key, "rotations": list(LC_RUNS), "points": lc} if lc else None,
        "validation_croisee": cv,
        "shap": shap_out,
    }
    with open(OUT_DIR / "comparaison_modeles.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, default=tr._json_default)
    if shap_out is not None:
        with open(OUT_DIR / "shap_transmission_reel.json", "w", encoding="utf-8") as f:
            json.dump({"modele": shap_key, **shap_out}, f, indent=2, ensure_ascii=False, default=tr._json_default)
    log(f"Résultats : {OUT_DIR / 'comparaison_modeles.json'} ({time.time() - t_start:.0f} s)")


if __name__ == "__main__":
    main()
