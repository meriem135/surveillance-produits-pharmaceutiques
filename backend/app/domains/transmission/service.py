"""
Attaques de transmission sur les traces réelles — service de l'API
===================================================================
Réutilise les scripts d'étude (backend/scripts/transmission_real.py et
transmission_models.py) : même jeu de données, mêmes features, même protocole.

- summary()            : état du jeu de données, résultats de référence, dernier entraînement web
- train(emit)          : entraîne les 4 modèles candidats en diffusant la progression
                         (le Random Forest est entraîné par paliers d'arbres pour tracer
                         sa courbe en direct), puis SHAP du meilleur et sauvegarde
- operator_report()    : rapport de recommandation pour l'opérateur (JSON + Markdown)
- alert_recommendation : consigne pour une alerte précise
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from datetime import datetime
from typing import Any, Awaitable, Callable

import numpy as np
import pandas as pd

from app.core import paths

OUT_DIR = paths.MODELS_DIR / "transmission_reel"
DATASET_PATH = paths.PROCESSED_DIR / "dataset_transmission_reel.csv"
EPISODES_PATH = paths.PROCESSED_DIR / "episodes_transmission_reel.json"
WEB_RESULTS = OUT_DIR / "entrainement_web.json"
POOLED_RESULTS = OUT_DIR / "comparaison_modeles.json"
POOLED_SHAP = OUT_DIR / "shap_transmission_reel.json"
REAL_STUDY = OUT_DIR / "resultats_transmission_reel.json"
MODEL_FILE = OUT_DIR / "random_forest.pkl"
FEATURES_FILE = OUT_DIR / "random_forest_features.json"

Emit = Callable[..., Awaitable[None]]

SENSOR_FR = {"fridge": "frigo", "thermostat": "thermostat (salle)", "weather": "météo"}

SCENARIOS_FR = {
    "MITM_gel": "La dernière mesure du frigo est répétée en boucle",
    "MITM_rejeu": "Des mesures passées du frigo sont renvoyées (au moins 1 h plus tôt)",
    "Injection_nominale": "Des valeurs forgées autour de 7 °C, peu bruitées, remplacent celles du frigo",
    "Injection_biais_0.5": "Toutes les mesures du frigo sont décalées de −0,5 °C",
    "Injection_biais_1.0": "Toutes les mesures du frigo sont décalées de −1 °C",
    "Injection_biais_2.0": "Toutes les mesures du frigo sont décalées de −2 °C",
    "Injection_derive": "Les mesures du frigo sont décalées peu à peu, de 0 à −2 °C",
    "MITM_gel_thermostat": "La dernière mesure du thermostat est répétée en boucle",
    "Injection_biais_thermostat": "Toutes les mesures du thermostat sont décalées de −1,5 °C",
}

# Consignes opérateur par famille d'attaque (le mécanisme, pas le capteur)
RECOMMANDATIONS = {
    "gel": {
        "titre": "Mesure figée (MITM)",
        "risque": "Le serveur reçoit la même valeur en boucle : une vraie dérive de température "
                  "passerait inaperçue.",
        "signes": "L'écart-type sur 1 minute du capteur tombe à zéro.",
        "actions": [
            "Relever la température sur place avec un thermomètre de contrôle.",
            "Vérifier la liaison capteur → passerelle → broker (câble, Wi-Fi, alimentation) et redémarrer le capteur.",
            "Si la mesure réelle est hors 2–8 °C, isoler le lot et ouvrir un incident chaîne du froid.",
            "Comparer l'horodatage des messages MQTT avec l'horloge du capteur.",
        ],
    },
    "rejeu": {
        "titre": "Rejeu de mesures passées (MITM)",
        "risque": "Des mesures déjà transmises sont renvoyées : l'état réel du frigo est masqué.",
        "signes": "Une séquence de 2 minutes identique à une séquence déjà reçue.",
        "actions": [
            "Relever la température sur place avec un thermomètre de contrôle.",
            "Vérifier le compteur ou l'horodatage des messages MQTT : un rejeu répète des horodatages anciens.",
            "Activer TLS et l'authentification sur le broker ; changer les identifiants du capteur.",
            "Isoler le capteur du réseau le temps de la vérification.",
        ],
    },
    "nominale": {
        "titre": "Injection de valeurs plausibles",
        "risque": "Des valeurs forgées, proches de la consigne, remplacent les vraies mesures : "
                  "le frigo paraît parfait quoi qu'il arrive.",
        "signes": "La dispersion sur 1 et 5 minutes devient bien plus faible que d'habitude.",
        "actions": [
            "Relever la température sur place avec un thermomètre de contrôle.",
            "Vérifier l'intégrité du firmware du capteur et de la passerelle.",
            "Activer TLS et l'authentification sur le broker.",
            "Bloquer la libération des lots concernés jusqu'à vérification (BPF / GMP).",
        ],
    },
    "biais": {
        "titre": "Décalage des mesures (injection)",
        "risque": "Le frigo paraît plus froid qu'il ne l'est : un produit peut sortir de la plage "
                  "2–8 °C sans alerte.",
        "signes": "La moyenne lissée sur 10 minutes baisse alors que rien ne change sur place.",
        "actions": [
            "Comparer avec un thermomètre de référence étalonné.",
            "Recalibrer ou remplacer le capteur si l'écart est confirmé sur place.",
            "Bloquer la libération des lots jusqu'à vérification de l'historique (BPF / GMP).",
            "Vérifier la passerelle : un décalage constant vient souvent d'un équipement intermédiaire.",
        ],
    },
    "derive": {
        "titre": "Dérive lente des mesures (injection)",
        "risque": "Le décalage augmente peu à peu : difficile à voir, il finit par cacher une sortie de plage.",
        "signes": "La moyenne sur 15 minutes s'éloigne lentement de la moyenne habituelle.",
        "actions": [
            "Comparer avec un thermomètre de référence étalonné.",
            "Regarder l'historique de la journée : une dérive se voit sur plusieurs heures.",
            "Recalibrer ou remplacer le capteur ; vérifier la passerelle.",
            "Bloquer la libération des lots jusqu'à vérification (BPF / GMP).",
        ],
    },
}

GENERAL_RULES = [
    "Une alerte se vérifie d'abord sur place, avec un thermomètre de contrôle : le détecteur signale une "
    "transmission suspecte, pas une température.",
    "Un lot ne se libère jamais sur la seule base d'une mesure contestée.",
    "Isoler le capteur du réseau et vérifier le broker (TLS, authentification, horodatage) dès que "
    "l'attaque est confirmée.",
    "Journaliser chaque alerte, la vérification faite et la décision prise.",
]


# ── Accès aux scripts d'étude ────────────────────────────────────────────────

def _scripts():
    scripts = str(paths.BACKEND_DIR / "scripts")
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    import transmission_real as tr  # noqa: PLC0415
    import transmission_models as tm  # noqa: PLC0415
    return tr, tm


def _load_json(path) -> dict | None:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _family(attack_type: str) -> str:
    for kind in ("gel", "rejeu", "nominale", "derive", "biais"):
        if kind in attack_type.lower():
            return kind
    return "biais"


def feature_label(feature: str) -> str:
    """Nom lisible d'une feature : « écart-type sur 1 min du frigo »."""
    for sensor, fr in SENSOR_FR.items():
        if feature.startswith(sensor + "_"):
            rest = feature[len(sensor) + 1:]
            if rest == "temp":
                return f"valeur du {fr}"
            if rest == "diff_1":
                return f"variation d'une mesure à l'autre du {fr}"
            if rest.startswith("mean_"):
                return f"moyenne sur {rest[5:].replace('min', ' min')} du {fr}"
            if rest.startswith("std_"):
                return f"écart-type sur {rest[4:].replace('min', ' min')} du {fr}"
            if rest == "ewma_10min":
                return f"moyenne lissée sur 10 min du {fr}"
            if rest == "repeat_2min":
                return f"séquence de 2 min du {fr} déjà transmise"
            if rest == "cond_enc":
                return "état « high / low » du frigo"
    if feature == "thermo_status":
        return "état du thermostat"
    if feature.endswith("_diff"):
        a, b = feature.replace("_diff", "").split("_", 1)
        return f"écart {SENSOR_FR.get(a, a)} − {SENSOR_FR.get(b, b)}"
    return feature


def scenarios() -> list[dict]:
    tr, _ = _scripts()
    return [{"nom": a[0], "capteur": a[1], "capteur_fr": SENSOR_FR[a[1]], "mecanisme": a[2],
             "parametre": a[3], "description": SCENARIOS_FR.get(a[0], "")} for a in tr.ATTACKS]


# ── Résumé ───────────────────────────────────────────────────────────────────

def summary() -> dict:
    out: dict[str, Any] = {"dataset": None, "traces": None, "reference": None,
                           "shap_reference": None, "web": _load_json(WEB_RESULTS)}
    if DATASET_PATH.exists() and EPISODES_PATH.exists():
        cols = pd.read_csv(DATASET_PATH, usecols=["split", "label", "attack_type"], keep_default_na=False)
        episodes = _load_json(EPISODES_PATH) or []
        out["dataset"] = {
            "fichier": DATASET_PATH.name, "lignes": int(len(cols)), "attaques": int(cols["label"].sum()),
            "heures": round(len(cols) * 5 / 3600, 1), "episodes": len(episodes),
            "par_role": {r: {"lignes": int((cols["split"] == r).sum()),
                             "attaques": int(cols.loc[cols["split"] == r, "label"].sum())}
                         for r in ("train", "val", "test")},
            "scenarios": sorted(set(e["name"] for e in episodes)),
        }
    study = _load_json(REAL_STUDY)
    if study:
        out["traces"] = {"fusion": study.get("fusion"), "profil": study.get("profil_traces")}
    pooled = _load_json(POOLED_RESULTS)
    if pooled:
        out["reference"] = {"generated_at": pooled.get("generated_at"), "repetitions": pooled["protocole"]["repetitions"],
                            "meilleur": pooled.get("meilleur_modele"), "modeles": pooled["resultats"]}
    out["shap_reference"] = _load_json(POOLED_SHAP)
    out["scenarios"] = scenarios() if DATASET_PATH.exists() or pooled else []
    return out


def public_kpis() -> dict | None:
    """Chiffres de la page d'accueil (publics) : uniquement des agrégats des résultats de
    référence sur les traces réelles (comparaison_modeles.json, 9 répétitions)."""
    pooled = _load_json(POOLED_RESULTS)
    if not pooled or not pooled.get("resultats"):
        return None
    fusion = pooled.get("fusion") or {}
    best_id = pooled.get("meilleur_modele")
    best = pooled["resultats"].get(best_id, {})
    mesures = int(fusion.get("pas_conserves") or 0)
    par_scenario = sorted(best.get("per_attack", {}).items(), key=lambda kv: -kv[1]["rate"])
    return {
        "generated_at": pooled.get("generated_at"),
        "traces": {"debut": fusion.get("debut"), "fin": fusion.get("fin"), "pas": fusion.get("pas"),
                   "mesures": mesures, "heures": round(mesures * 5 / 3600, 1)},
        "capteurs": list(SENSOR_FR),
        "repetitions": pooled.get("protocole", {}).get("repetitions"),
        "scenarios": len(par_scenario),
        "meilleur": {"id": best_id, "nom": best.get("nom"), "f1": best.get("f1"), "precision": best.get("precision"),
                     "recall": best.get("recall"), "roc_auc": best.get("roc_auc"), "episodes": best.get("episodes"),
                     "episodes_detectes": best.get("episodes_detectes"), "delai_median_min": best.get("delai_median_min")},
        "modeles": [{"id": k, "nom": v.get("nom"), "f1": v.get("f1")} for k, v in pooled["resultats"].items()],
        "detection_par_scenario": [{"scenario": k, "description": SCENARIOS_FR.get(k, k), "taux": v["rate"],
                                    "points": v["n"], "detectes": v["detected"]} for k, v in par_scenario],
    }


# ── Entraînement ─────────────────────────────────────────────────────────────

def _load_or_build_dataset(tr, tm) -> tuple[pd.DataFrame, list[str], list[dict], bool]:
    """Jeu de données réel avec attaques (répétition 0). Construit s'il manque."""
    if DATASET_PATH.exists() and EPISODES_PATH.exists():
        df = pd.read_csv(DATASET_PATH, parse_dates=["datetime"], keep_default_na=False)
        df["garde"] = df["garde"].astype(str).str.lower().eq("true")
        episodes = json.load(open(EPISODES_PATH, encoding="utf-8"))
        df, feats = tm.engineer(df)
        return df, feats, episodes, False
    import build_dataset as bd  # noqa: PLC0415
    real = bd.load_normal_traces()
    base, _ = tr.fuse_real(real)
    rng = np.random.default_rng(tr.SEED)
    episodes = tr.build_schedule(len(base), rng, 0, roles=("train", "val", "test"))
    df = tr.inject(base, episodes, rng, 0)
    df, feats = tm.engineer(df)
    paths.ensure_dirs()
    df.to_csv(DATASET_PATH, index=False, float_format="%.4f")
    with open(EPISODES_PATH, "w", encoding="utf-8") as f:
        json.dump(episodes, f, indent=1)
    return df, feats, episodes, True


def _compact(r: dict) -> dict:
    keys = ("nom", "type", "precision", "recall", "f1", "fpr", "val_f1", "roc_auc", "avg_precision",
            "fausses_alarmes_evenements_par_heure", "episodes", "episodes_detectes", "delai_median_min",
            "threshold", "per_attack", "per_episode", "hyperparameters")
    return {k: r[k] for k in keys if k in r}


async def train(emit: Emit) -> dict:
    tr, tm = _scripts()
    import transmission_study as ts  # noqa: PLC0415
    from app.api.v1 import phase2  # noqa: PLC0415
    from sklearn.ensemble import IsolationForest, RandomForestClassifier  # noqa: PLC0415
    from sklearn.metrics import average_precision_score, roc_auc_score  # noqa: PLC0415
    from sklearn.preprocessing import StandardScaler  # noqa: PLC0415

    t0 = time.time()
    await emit("dataset", 3, "Chargement des traces réelles avec attaques de transmission…")
    df, feats, episodes, built = await asyncio.to_thread(_load_or_build_dataset, tr, tm)
    y = df["label"].to_numpy().astype(int)
    split = df["split"].to_numpy()
    garde = df["garde"].to_numpy().astype(bool)
    train_all = np.where((split == "train") & ~garde)[0]
    train_norm = train_all[y[train_all] == 0]
    val_idx = np.where((split == "val") & ~garde)[0]
    test_idx = np.where((split == "test") & ~garde)[0]
    X = df[feats].to_numpy(float)
    X_s = StandardScaler().fit(X[train_norm]).transform(X)
    dataset_info = {
        "fichier": DATASET_PATH.name, "construit": built, "lignes": int(len(df)), "features": len(feats),
        "train": int(len(train_all)), "train_normales": int(len(train_norm)),
        "val": int(len(val_idx)), "test": int(len(test_idx)),
        "attaques_val": int(y[val_idx].sum()), "attaques_test": int(y[test_idx].sum()),
        "episodes": len(episodes),
    }
    await emit("dataset", 10, f"{len(df):,} lignes, {len(feats)} features, {len(episodes)} épisodes d'attaque "
               f"(train {len(train_all):,} · val {len(val_idx):,} · test {len(test_idx):,})", dataset=dataset_info)

    results: dict[str, dict] = {}

    def evaluate(key: str, nom: str, typ: str, scores: np.ndarray, params: dict | None = None) -> dict:
        s = np.nan_to_num(np.asarray(scores, dtype=float), nan=0.0)
        thr = phase2._best_f1_threshold(y[val_idx], s[val_idx])
        pred = s >= thr
        r = tr.pool([tr.count_run(pred, df, test_idx, episodes, "test")])
        r.update(nom=nom, type=typ, threshold=float(thr),
                 val_f1=tr.pool([tr.count_run(pred, df, val_idx, episodes, "val")])["f1"],
                 roc_auc=round(float(roc_auc_score(y[test_idx], s[test_idx])), 4),
                 avg_precision=round(float(average_precision_score(y[test_idx], s[test_idx])), 4),
                 hyperparameters=params or {})
        results[key] = r
        return r

    # 1. Isolation Forest
    await emit("IsolationForest", 14, "Isolation Forest : apprentissage sur les lignes normales…", model="IsolationForest")
    iso = IsolationForest(n_estimators=300, max_samples=min(4096, len(train_norm)), contamination="auto",
                          random_state=tr.SEED, n_jobs=-1)
    s_if = await asyncio.to_thread(lambda: -iso.fit(X_s[train_norm]).score_samples(X_s))
    r = evaluate("IsolationForest", "Isolation Forest", "non supervisé", s_if, {"n_estimators": 300})
    await emit("IsolationForest", 24, f"Isolation Forest : F1 {r['f1']:.2f} sur le test", model="IsolationForest",
               result=_compact(r))

    # 2. One-Class SVM
    await emit("OCSVM", 27, "One-Class SVM : 12 configurations (ν × γ) comparées sur la validation…", model="OCSVM")
    s_oc, p_oc = await asyncio.to_thread(ts.ocsvm_scores, X_s, y, train_norm, val_idx)
    r = evaluate("OCSVM", "One-Class SVM", "non supervisé", s_oc, p_oc)
    await emit("OCSVM", 40, f"One-Class SVM : F1 {r['f1']:.2f} sur le test", model="OCSVM", result=_compact(r))

    # 3. Random Forest, par paliers d'arbres : la courbe se trace en direct
    await emit("RandomForest", 42, "Random Forest : apprentissage par paliers de 30 arbres…", model="RandomForest")
    rf = RandomForestClassifier(n_estimators=30, min_samples_leaf=5, class_weight="balanced_subsample",
                                warm_start=True, random_state=tr.SEED, n_jobs=-1)
    curve = []
    for n_trees in range(30, 301, 30):
        rf.set_params(n_estimators=n_trees)
        await asyncio.to_thread(rf.fit, X[train_all], y[train_all])
        p_val = await asyncio.to_thread(lambda: rf.predict_proba(X[val_idx])[:, 1])
        thr = phase2._best_f1_threshold(y[val_idx], p_val)
        pred = p_val >= thr
        tp = int((pred & (y[val_idx] == 1)).sum()); fp = int((pred & (y[val_idx] == 0)).sum())
        fn = int((~pred & (y[val_idx] == 1)).sum())
        point = {"arbres": n_trees, "f1_validation": round(2 * tp / max(1, 2 * tp + fp + fn), 4),
                 "auc_validation": round(float(roc_auc_score(y[val_idx], p_val)), 4)}
        curve.append(point)
        await emit("RandomForest", 42 + int(24 * n_trees / 300),
                   f"Random Forest : {n_trees} arbres, F1 validation {point['f1_validation']:.2f}",
                   model="RandomForest", curve_point=point)
    s_rf = await asyncio.to_thread(lambda: rf.predict_proba(X)[:, 1])
    r = evaluate("RandomForest", "Random Forest", "supervisé", s_rf,
                 {"n_estimators": 300, "min_samples_leaf": 5, "class_weight": "balanced_subsample"})
    await emit("RandomForest", 68, f"Random Forest : F1 {r['f1']:.2f} sur le test", model="RandomForest",
               result=_compact(r))

    # 4. XGBoost
    models = {"RandomForest": rf, "IsolationForest": iso}
    try:
        from xgboost import XGBClassifier  # noqa: PLC0415
    except ImportError:
        XGBClassifier = None
        await emit("XGBoost", 70, "XGBoost absent (pip install xgboost) : modèle ignoré", model="XGBoost", skipped=True)
    if XGBClassifier is not None:
        await emit("XGBoost", 70, "XGBoost : 400 itérations de boosting…", model="XGBoost")
        pos = max(1, int(y[train_all].sum()))
        xgb = XGBClassifier(n_estimators=400, max_depth=6, learning_rate=0.05, subsample=0.8, colsample_bytree=0.8,
                            scale_pos_weight=float((len(train_all) - pos) / pos), eval_metric="logloss",
                            random_state=tr.SEED, n_jobs=8, verbosity=0)
        s_xgb = await asyncio.to_thread(lambda: xgb.fit(X[train_all], y[train_all]).predict_proba(X)[:, 1])
        r = evaluate("XGBoost", "XGBoost", "supervisé", s_xgb, {"n_estimators": 400, "max_depth": 6, "learning_rate": 0.05})
        models["XGBoost"] = xgb
        await emit("XGBoost", 82, f"XGBoost : F1 {r['f1']:.2f} sur le test", model="XGBoost", result=_compact(r))

    best_key = max(results, key=lambda k: results[k]["val_f1"])

    # 5. SHAP du meilleur modèle arborescent
    shap_out = None
    if best_key in models:
        await emit("SHAP", 85, f"SHAP : explication de {results[best_key]['nom']} sur les attaques de validation et de test…")
        shap_out = await asyncio.to_thread(_shap_summary, models[best_key], df, feats, val_idx, test_idx, tr)
        await emit("SHAP", 95, "SHAP terminé", shap=shap_out)

    # 6. Sauvegarde
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    import joblib  # noqa: PLC0415
    joblib.dump(rf, MODEL_FILE)
    with open(FEATURES_FILE, "w", encoding="utf-8") as f:
        json.dump(feats, f, indent=1)
    if best_key in models and best_key != "RandomForest":
        joblib.dump(models[best_key], OUT_DIR / f"{best_key.lower()}.pkl")
    out = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "duree_s": round(time.time() - t0, 1),
        "dataset": dataset_info,
        "features": feats,
        "modeles": {k: _compact(r) for k, r in results.items()},
        "classement_validation": sorted(results, key=lambda k: results[k]["val_f1"], reverse=True),
        "meilleur": best_key,
        "courbe_random_forest": curve,
        "shap": shap_out,
    }
    with open(WEB_RESULTS, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    await emit("done", 100, f"Entraînement terminé en {out['duree_s']:.0f} s — meilleur modèle : "
               f"{results[best_key]['nom']} (F1 {results[best_key]['f1']:.2f})", results=out)
    return out


def _shap_summary(model, df, feats, val_idx, test_idx, tr) -> dict:
    import shap  # noqa: PLC0415

    y = df["label"].to_numpy()
    types = df["attack_type"].to_numpy()
    rows = np.concatenate([val_idx[y[val_idx] == 1], test_idx[y[test_idx] == 1]])
    rng = np.random.default_rng(tr.SEED)
    rows = np.sort(rng.choice(rows, min(800, len(rows)), replace=False))
    values = shap.TreeExplainer(model).shap_values(df[feats].to_numpy(float)[rows])
    if isinstance(values, list):
        values = values[-1]
    if values.ndim == 3:
        values = values[:, :, -1]
    imp = np.abs(values)

    def top(mask, k=6):
        m = imp[mask].mean(axis=0)
        order = np.argsort(m)[::-1][:k]
        return [{"feature": feats[i], "label": feature_label(feats[i]), "importance": round(float(m[i]), 4)}
                for i in order]

    out = {"n_lignes": int(len(rows)), "global": top(np.ones(len(rows), dtype=bool), 10), "par_scenario": {}}
    for nm in tr.ATTACK_NAMES:
        mask = types[rows] == nm
        if mask.any():
            out["par_scenario"][nm] = top(mask, 4)
    return out


# ── Rapport pour l'opérateur ─────────────────────────────────────────────────

def _results_for_report() -> tuple[dict | None, dict | None, str]:
    web = _load_json(WEB_RESULTS)
    if web and web.get("modeles"):
        return web["modeles"], web.get("shap"), "dernier entraînement web"
    pooled = _load_json(POOLED_RESULTS)
    if pooled:
        models = {k: v for k, v in pooled["resultats"].items() if k != "Statistique"}
        return models, _load_json(POOLED_SHAP), "étude de référence (9 répétitions)"
    return None, None, "aucun résultat"


def operator_report(models: dict | None = None, shap_data: dict | None = None, source: str | None = None) -> dict:
    """Rapport de recommandation : le modèle en service, chaque scénario (détection, ce que le
    modèle regarde, consignes), et les règles générales. JSON structuré + rendu Markdown."""
    if models is None:
        models, shap_data, source = _results_for_report()
    tr, _ = _scripts()
    report: dict[str, Any] = {"titre": "Rapport pour l'opérateur — attaques de transmission",
                              "date": datetime.now().strftime("%d/%m/%Y %H:%M"), "source": source,
                              "modele": None, "scenarios": [], "regles_generales": GENERAL_RULES}
    if not models:
        report["message"] = "Aucun résultat disponible : lancez un entraînement."
        report["markdown"] = f"# {report['titre']}\n\n{report['message']}\n"
        return report

    best_key = max(models, key=lambda k: models[k].get("val_f1", models[k].get("f1", 0)))
    best = models[best_key]
    if not best.get("type"):
        best = {**best, "type": "supervisé" if best_key in ("RandomForest", "XGBoost") else "non supervisé"}
    fa_h = best.get("fausses_alarmes_evenements_par_heure", best.get("evenements_fausse_alarme_par_jour"))
    report["modele"] = {
        "cle": best_key, "nom": best.get("nom", best_key), "type": best.get("type"),
        "precision": best["precision"], "recall": best["recall"], "f1": best["f1"],
        "fausses_alertes_par_heure": fa_h, "delai_median_min": best.get("delai_median_min"),
        "episodes": f"{best.get('episodes_detectes')}/{best.get('episodes')}",
        "lecture": (f"Sur 100 alertes, environ {round(100 * best['precision'])} correspondent à une vraie attaque. "
                    f"Le modèle signale {round(100 * best['recall'])} % des mesures falsifiées et déclenche "
                    f"environ {fa_h} fausse(s) alerte(s) par heure."),
    }
    shap_sc = (shap_data or {}).get("par_scenario", {})
    for a in tr.ATTACKS:
        name, sensor, kind = a[0], a[1], a[2]
        pa = best.get("per_attack", {}).get(name, {})
        pe = best.get("per_episode", {}).get(name, {})
        reco = RECOMMANDATIONS[_family(kind)]
        feats = shap_sc.get(name, [])[:3]
        rate = pa.get("rate") if pa.get("n") else None      # scénario absent du test : non évalué
        if rate is None:
            niveau = "non évalué"
        elif rate >= 80:
            niveau = "bien détecté"
        elif rate >= 40:
            niveau = "partiellement détecté"
        else:
            niveau = "mal détecté : vérification humaine indispensable"
        report["scenarios"].append({
            "scenario": name, "capteur": SENSOR_FR[sensor], "description": SCENARIOS_FR.get(name, ""),
            "famille": reco["titre"], "taux_detection": rate, "niveau": niveau,
            "episodes": f"{pe.get('detected', '—')}/{pe.get('n', '—')}",
            "ce_que_le_modele_regarde": [f.get("label") or feature_label(f["feature"]) for f in feats] or [reco["signes"]],
            "risque": reco["risque"], "actions": reco["actions"],
        })

    lines = [f"# {report['titre']}", f"*{report['date']} · source : {source}*", "",
             "## Le modèle en service", "",
             f"**{report['modele']['nom']}**" + (f" ({report['modele']['type']})" if report['modele']['type'] not in report['modele']['nom'] else "") + f" — précision {round(100 * best['precision'])} %, "
             f"rappel {round(100 * best['recall'])} %, F1 {best['f1']:.2f}, {fa_h} fausse(s) alerte(s) par heure, "
             f"épisodes détectés {report['modele']['episodes']}.", "", report["modele"]["lecture"], "",
             "## Consignes par type d'attaque", ""]
    for s in report["scenarios"]:
        rate_txt = "non évalué" if s["taux_detection"] is None else f"{s['taux_detection']:.0f} % des mesures, épisodes {s['episodes']}"
        lines += [f"### {s['famille']} — {s['scenario']} ({s['capteur']})", "",
                  f"- **Ce que fait l'attaquant :** {s['description']}",
                  f"- **Détection :** {rate_txt} — {s['niveau']}",
                  f"- **Ce que le modèle regarde :** {', '.join(s['ce_que_le_modele_regarde'])}",
                  f"- **Risque :** {s['risque']}",
                  "- **À faire :**"] + [f"  {i}. {act}" for i, act in enumerate(s["actions"], 1)] + [""]
    lines += ["## Règles générales", ""] + [f"- {r}" for r in GENERAL_RULES] + [""]
    report["markdown"] = "\n".join(lines)
    return report


def alert_recommendation(attack_type: str, sensor: str | None = None, probability: float | None = None,
                         top_features: list[str] | None = None) -> dict:
    """Consigne pour une alerte précise (scénario désigné par le modèle, capteur, probabilité)."""
    reco = RECOMMANDATIONS[_family(attack_type)]
    sensor_fr = SENSOR_FR.get(sensor or "", sensor or "capteur")
    out = {
        "attack_type": attack_type, "capteur": sensor_fr, "famille": reco["titre"],
        "description": SCENARIOS_FR.get(attack_type, ""), "risque": reco["risque"], "signes": reco["signes"],
        "actions": reco["actions"],
        "indices": [feature_label(f) for f in (top_features or [])],
    }
    if probability is not None:
        p = float(probability)
        out["confiance"] = "élevée" if p >= 0.8 else ("moyenne" if p >= 0.5 else "faible")
        out["probabilite"] = round(p, 3)
    out["consigne"] = (f"Alerte {reco['titre'].lower()} sur le {sensor_fr}"
                       + (f" (confiance {out['confiance']})" if "confiance" in out else "")
                       + " : contrôler la température sur place avant toute décision, puis "
                       + reco["actions"][1].rstrip(".").lower() + ".")
    return out
