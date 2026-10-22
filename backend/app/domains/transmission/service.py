"""
Attaques de transmission sur les traces réelles — service de l'API
===================================================================
Réutilise les scripts d'étude (backend/scripts/transmission_real.py et
transmission_models.py) : même jeu de données, mêmes features, même protocole.

- summary()            : état du jeu de données, résultats de référence, dernier entraînement web
- train(emit)          : entraîne les 4 modèles supervisés (Random Forest, XGBoost,
                         Régression Logistique, MLP) en diffusant la progression ; seuils
                         « max F1 » et « rappel cible » choisis sur la validation, choix du
                         modèle sur la validation (F2 au rappel cible)
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
CV_RESULTS = OUT_DIR / "validation_croisee.json"
LONG_BIAS_RESULTS = OUT_DIR / "biais_long.json"
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

def _op_key(target: float) -> str:
    return f"rappel_{float(target):.2f}"


def summary() -> dict:
    out: dict[str, Any] = {"dataset": None, "traces": None, "reference": None,
                           "shap_reference": None, "web": _load_json(WEB_RESULTS)}
    if DATASET_PATH.exists() and EPISODES_PATH.exists():
        tr, _ = _scripts()
        cols = pd.read_csv(DATASET_PATH, usecols=["label", "attack_type", "garde"], keep_default_na=False)
        cols["split"] = tr.block_split(len(cols), 0)   # le découpage n'est plus stocké dans le CSV
        cols = cols[~cols["garde"].astype(str).str.lower().eq("true")]   # lignes évaluées (hors zone de garde)
        episodes = _load_json(EPISODES_PATH) or []
        par_role = {}
        for r in ("train", "val", "test"):
            sub = cols.loc[cols["split"] == r, "label"]
            par_role[r] = {"lignes": int(len(sub)), "attaques": int(sub.sum()),
                           "part": round(float(sub.mean()), 4) if len(sub) else 0.0}
        out["dataset"] = {
            "fichier": DATASET_PATH.name, "lignes": int(len(cols)), "attaques": int(cols["label"].sum()),
            "heures": round(len(cols) * 5 / 3600, 1), "episodes": len(episodes),
            "par_role": par_role, "scenarios": sorted(set(e["name"] for e in episodes)),
        }
    study = _load_json(REAL_STUDY)
    if study:
        out["traces"] = {"fusion": study.get("fusion"), "profil": study.get("profil_traces")}
    pooled = _load_json(POOLED_RESULTS)
    if pooled:
        out["reference"] = {
            "generated_at": pooled.get("generated_at"), "repetitions": pooled["protocole"]["repetitions"],
            "protocole": pooled.get("protocole"), "prevalence": pooled.get("prevalence"),
            "cible_rappel": pooled.get("cible_rappel"), "cibles_rappel": pooled.get("cibles_rappel"),
            "meilleur": pooled.get("meilleur_modele"), "meilleur_par_cible": pooled.get("meilleur_par_cible"),
            "classement_validation": pooled.get("classement_validation"),
            "classement_validation_max_f1": pooled.get("classement_validation_max_f1"),
            "classement_validation_par_cible": pooled.get("classement_validation_par_cible"),
            "modeles": pooled["resultats"],
        }
    out["validation_croisee"] = _load_json(CV_RESULTS) or (pooled or {}).get("validation_croisee")
    out["biais_long"] = _load_json(LONG_BIAS_RESULTS)
    out["shap_reference"] = _load_json(POOLED_SHAP)
    out["scenarios"] = scenarios() if DATASET_PATH.exists() or pooled else []
    return out


def public_kpis() -> dict | None:
    """Chiffres de la page d'accueil (publics) : uniquement des agrégats des résultats de
    référence sur les traces réelles (comparaison_modeles.json, cumul des répétitions).
    Le modèle et ses chiffres sont ceux du point « rappel cible » (choisi sur la validation),
    mesurés sur le test."""
    pooled = _load_json(POOLED_RESULTS)
    if not pooled or not pooled.get("resultats"):
        return None
    fusion = pooled.get("fusion") or {}
    best_id = pooled.get("meilleur_modele")
    best = pooled["resultats"].get(best_id, {})
    cible = pooled.get("cible_rappel")
    point = ((best.get("points_fonctionnement") or {}).get(_op_key(cible)) or {}).get("test") if cible else None
    m = point or best
    mesures = int(fusion.get("pas_conserves") or 0)
    par_scenario = sorted(m.get("per_attack", {}).items(), key=lambda kv: -kv[1]["rate"])
    return {
        "generated_at": pooled.get("generated_at"),
        "traces": {"debut": fusion.get("debut"), "fin": fusion.get("fin"), "pas": fusion.get("pas"),
                   "mesures": mesures, "heures": round(mesures * 5 / 3600, 1)},
        "capteurs": list(SENSOR_FR),
        "repetitions": pooled.get("protocole", {}).get("repetitions"),
        "scenarios": len(par_scenario),
        "cible_rappel": cible,
        "part_attaques_test": (pooled.get("prevalence") or {}).get("test", {}).get("part"),
        "meilleur": {"id": best_id, "nom": best.get("nom"), "recall": m.get("recall"),
                     "fausses_alarmes_par_heure": m.get("fausses_alarmes_evenements_par_heure"),
                     "delai_median_min": m.get("delai_median_min"), "precision": m.get("precision"),
                     "f1": m.get("f1"), "f2": m.get("f2"), "roc_auc": best.get("roc_auc"),
                     "episodes": m.get("episodes"), "episodes_detectes": m.get("episodes_detectes")},
        "modeles": [{"id": k, "nom": v.get("nom"), "f1": v.get("f1")} for k, v in pooled["resultats"].items()],
        "detection_par_scenario": [{"scenario": k, "description": SCENARIOS_FR.get(k, k), "taux": v["rate"],
                                    "points": v["n"], "detectes": v["detected"]} for k, v in par_scenario],
    }


# ── Entraînement ─────────────────────────────────────────────────────────────

def _dataset_is_current(tr) -> bool:
    """Le CSV en place suit-il le protocole actuel ? Un ancien CSV (colonne split, autres
    scénarios) est reconstruit plutôt que mélangé au nouveau découpage."""
    header = pd.read_csv(DATASET_PATH, nrows=0).columns
    episodes = _load_json(EPISODES_PATH) or []
    if "split" in header or not episodes:
        return False
    if {e.get("name") for e in episodes} != set(tr.ATTACK_NAMES):
        return False
    split = tr.block_split(max(e["end"] for e in episodes), 0)
    return all(set(split[e["start"]:e["end"]]) == {e.get("split")} for e in episodes)


def _load_or_build_dataset(tr, tm) -> tuple[pd.DataFrame, list[str], list[dict], bool]:
    """Jeu de données réel avec attaques (répétition 0). Construit s'il manque ou s'il
    vient d'un ancien protocole."""
    if DATASET_PATH.exists() and EPISODES_PATH.exists() and _dataset_is_current(tr):
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
        json.dump(episodes, f, indent=1, ensure_ascii=False)
    return df, feats, episodes, True


def _compact(r: dict) -> dict:
    keys = ("nom", "type", "recall", "fausses_alarmes_evenements_par_heure", "delai_median_min", "precision",
            "f1", "f2", "fpr", "episodes", "episodes_detectes", "part_attaques",
            "val_recall", "val_fausses_alarmes_par_heure", "val_delai_median_min", "val_precision", "val_f1",
            "val_f2", "val_episodes", "val_episodes_detectes", "val_part_attaques",
            "roc_auc", "avg_precision", "val_roc_auc", "val_avg_precision", "threshold",
            "per_attack", "per_episode", "points_fonctionnement", "courbe_pr", "hyperparameters")
    return {k: r[k] for k in keys if k in r}


async def train(emit: Emit) -> dict:
    """Une répétition (la 0) des 4 modèles supervisés, même protocole que transmission_models.py :
    seuils max F1 et rappel cible choisis sur la validation, mesurés sur le test ; choix du
    modèle sur la validation (F2 au rappel cible)."""
    tr, tm = _scripts()
    from sklearn.metrics import roc_auc_score  # noqa: PLC0415
    from sklearn.preprocessing import StandardScaler  # noqa: PLC0415

    t0 = time.time()
    await emit("dataset", 3, "Chargement des traces réelles avec attaques de transmission…")
    df, feats, episodes, built = await asyncio.to_thread(_load_or_build_dataset, tr, tm)
    y = df["label"].to_numpy().astype(int)
    split = tr.block_split(len(df), 0)     # découpage 70/15/15 recalculé (non stocké dans le CSV)
    garde = df["garde"].to_numpy().astype(bool)
    train_all = np.where((split == "train") & ~garde)[0]
    train_norm = train_all[y[train_all] == 0]
    val_idx = np.where((split == "val") & ~garde)[0]
    test_idx = np.where((split == "test") & ~garde)[0]
    X = df[feats].to_numpy(float)
    X_s = StandardScaler().fit(X[train_norm]).transform(X)
    prevalence = tm.role_prevalence(y, {"train": train_all, "val": val_idx, "test": test_idx})
    dataset_info = {
        "fichier": DATASET_PATH.name, "construit": built, "lignes": int(len(df)), "features": len(feats),
        "train": int(len(train_all)), "train_normales": int(len(train_norm)),
        "val": int(len(val_idx)), "test": int(len(test_idx)),
        "attaques_train": int(y[train_all].sum()), "attaques_val": int(y[val_idx].sum()),
        "attaques_test": int(y[test_idx].sum()), "prevalence": prevalence,
        "episodes": len(episodes),
    }
    await emit("dataset", 10, f"{len(df):,} lignes, {len(feats)} features, {len(episodes)} épisodes d'attaque "
               f"(train {len(train_all):,} · val {len(val_idx):,} · test {len(test_idx):,} ; attaques "
               f"{100 * prevalence['train']['part']:.0f} % / {100 * prevalence['val']['part']:.0f} % / "
               f"{100 * prevalence['test']['part']:.0f} %)", dataset=dataset_info)

    cible = tm.TARGET_RECALL
    op = tm.op_key(cible)
    results: dict[str, dict] = {}

    def evaluate(key: str, nom: str, scores: np.ndarray, params: dict | None = None) -> dict:
        ev = tm.evaluate_scores(scores, df, y, val_idx, test_idx, episodes)
        r = tm.summarize_model([ev], nom)
        r["hyperparameters"] = params or {}
        results[key] = r
        return r

    def line(r: dict) -> str:
        t = r["points_fonctionnement"][op]["test"]
        return (f"rappel {t['recall']:.2f}, {t['fausses_alarmes_evenements_par_heure']:.1f} FA/h, "
                f"précision {t['precision']:.2f}, F2 {t['f2']:.2f} sur le test (rappel cible {cible:.2f})")

    # 1. Random Forest, par paliers d'arbres : la courbe se trace en direct
    await emit("RandomForest", 12, "Random Forest : apprentissage par paliers de 30 arbres…", model="RandomForest")
    rf = tm.make_random_forest().set_params(n_estimators=30, warm_start=True)
    curve = []
    for n_trees in range(30, 301, 30):
        rf.set_params(n_estimators=n_trees)
        await asyncio.to_thread(rf.fit, X[train_all], y[train_all])
        p_val = await asyncio.to_thread(lambda: rf.predict_proba(X[val_idx])[:, 1])
        thr = tm.threshold_for_recall(y[val_idx], p_val, cible)
        pred = p_val >= thr
        tp = int((pred & (y[val_idx] == 1)).sum()); fp = int((pred & (y[val_idx] == 0)).sum())
        fn = int((~pred & (y[val_idx] == 1)).sum())
        prec, rec = tp / max(1, tp + fp), tp / max(1, tp + fn)
        point = {"arbres": n_trees, "f2_validation": round(tr.f_beta(prec, rec, 2.0), 4),
                 "precision_validation": round(prec, 4),
                 "auc_validation": round(float(roc_auc_score(y[val_idx], p_val)), 4)}
        curve.append(point)
        await emit("RandomForest", 12 + int(38 * n_trees / 300),
                   f"Random Forest : {n_trees} arbres, F2 validation {point['f2_validation']:.2f} "
                   f"(précision {prec:.2f} au rappel {cible:.2f})", model="RandomForest", curve_point=point)
    s_rf = await asyncio.to_thread(lambda: rf.predict_proba(X)[:, 1])
    r = evaluate("RandomForest", "Random Forest", s_rf,
                 {"n_estimators": 300, "min_samples_leaf": 5, "class_weight": "balanced_subsample"})
    await emit("RandomForest", 52, f"Random Forest : {line(r)}", model="RandomForest", result=_compact(r))

    # 2. XGBoost, 3. Régression Logistique, 4. MLP : mêmes réglages que transmission_models.py
    models = {"RandomForest": rf}
    steps = []
    if tm.XGBClassifier is not None:
        steps.append(("XGBoost", "XGBoost", tm.xgboost_model, X, (55, 68), "XGBoost : 400 itérations de boosting…"))
    else:
        await emit("XGBoost", 55, "XGBoost absent (pip install xgboost) : modèle ignoré", model="XGBoost", skipped=True)
    steps += [("Logistique", "Régression Logistique", tm.logistic_regression, X_s, (70, 76),
               "Régression Logistique (class_weight équilibré)…"),
              ("MLP", "MLP", tm.mlp, X_s, (77, 83), "MLP (64, 32), early stopping, sample_weight équilibré…")]
    for key, nom, fn, Xm, (p0, p1), msg in steps:
        await emit(key, p0, msg, model=key)
        s_m, p_m, m_m = await asyncio.to_thread(fn, Xm, y, train_all)
        r = evaluate(key, nom, s_m, p_m)
        models[key] = m_m
        await emit(key, p1, f"{nom} : {line(r)}", model=key, result=_compact(r))

    ranking = tm.rank_models(results, op)          # VALIDATION uniquement
    best_key = ranking[0]
    tree_key = next((k for k in ranking if k in tm.TREE_MODELS), None)

    # 5. SHAP du meilleur modèle arborescent
    shap_out = None
    if tree_key is not None:
        await emit("SHAP", 85, f"SHAP : explication de {results[tree_key]['nom']} sur les attaques de validation et de test…")
        shap_out = await asyncio.to_thread(_shap_summary, models[tree_key], df, feats, val_idx, test_idx, tr)
        shap_out["modele"] = tree_key
        await emit("SHAP", 95, "SHAP terminé", shap=shap_out)

    # 6. Sauvegarde
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    import joblib  # noqa: PLC0415
    joblib.dump(rf, MODEL_FILE)
    with open(FEATURES_FILE, "w", encoding="utf-8") as f:
        json.dump(feats, f, indent=1)
    if best_key != "RandomForest":
        joblib.dump(models[best_key], OUT_DIR / f"{best_key.lower()}.pkl")
    out = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "duree_s": round(time.time() - t0, 1),
        "dataset": dataset_info,
        "features": feats,
        "cible_rappel": cible,
        "cibles_rappel": list(tm.TARGETS),
        "modeles": {k: _compact(r) for k, r in results.items()},
        "classement_validation": ranking,
        "classement_validation_max_f1": tm.rank_models(results, "max_f1"),
        "classement_validation_par_cible": {f"{t:.2f}": tm.rank_models(results, tm.op_key(t)) for t in tm.TARGETS},
        "meilleur": best_key,
        "courbe_random_forest": curve,
        "shap": shap_out,
    }
    with open(WEB_RESULTS, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False, default=str)
    b = results[best_key]["points_fonctionnement"][op]["test"]
    await emit("done", 100, f"Entraînement terminé en {out['duree_s']:.0f} s — meilleur modèle (validation) : "
               f"{results[best_key]['nom']} ; test au rappel cible {cible:.2f} : rappel {b['recall']:.2f}, "
               f"{b['fausses_alarmes_evenements_par_heure']:.1f} FA/h, précision {b['precision']:.2f}", results=out)
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

SEUIL_TXT = ("Le seuil d'alerte est réglé sur la VALIDATION pour signaler au moins {cible} % des mesures "
             "falsifiées (mode « rappel d'abord » : rater une attaque coûte plus cher qu'une fausse alerte). "
             "Le modèle est choisi sur la validation (F2) ; les chiffres ci-dessous sont mesurés ensuite sur le "
             "test, qui n'a servi à aucun choix.")
DESEQUILIBRE_TXT = ("Les attaques sont minoritaires : les modèles compensent par des poids de classe "
                    "(class_weight, scale_pos_weight, sample_weight). Pas de SMOTE : des points synthétiques "
                    "interpolés entre deux lignes d'une série temporelle fabriqueraient des fenêtres glissantes "
                    "qui n'existent pas, et le sur-échantillonnage ne change pas la proportion d'attaques réelle, "
                    "qui seule fixe la précision. Le vrai levier est le seuil.")


def _results_for_report() -> tuple[dict | None, dict | None, str, float | None]:
    web = _load_json(WEB_RESULTS)
    if web and web.get("modeles"):
        return web["modeles"], web.get("shap"), "dernier entraînement web", web.get("cible_rappel")
    pooled = _load_json(POOLED_RESULTS)
    if pooled:
        n = pooled.get("protocole", {}).get("repetitions")
        return (pooled["resultats"], _load_json(POOLED_SHAP), f"étude de référence ({n} répétitions)",
                pooled.get("cible_rappel"))
    return None, None, "aucun résultat", None


def _point(m: dict, op: str | None, role: str = "test") -> dict:
    """Métriques d'un modèle à un point de fonctionnement ; anciens résultats : champs à plat (max F1)."""
    pts = m.get("points_fonctionnement") or {}
    if op and op in pts:
        return pts[op][role]
    return m if role == "test" else {k[4:]: v for k, v in m.items() if k.startswith("val_")}


def _niveau(rate: float | None) -> str:
    if rate is None:
        return "non évalué"
    if rate >= 80:
        return "bien détecté"
    if rate >= 40:
        return "partiellement détecté"
    return "mal détecté : vérification humaine indispensable"


def _fmt_delai(d) -> str:
    return "—" if d is None else f"{d:.1f} min"


def operator_report(models: dict | None = None, shap_data: dict | None = None, source: str | None = None,
                    cible: float | None = None) -> dict:
    """Rapport de recommandation : le modèle en service et son seuil (rappel cible), chaque
    scénario (rappel, épisodes, délai, ce que le modèle regarde, consignes), les limites
    connues et les règles générales. JSON structuré + rendu Markdown. Les chiffres sont lus
    dans les résultats (aucun chiffre écrit en dur)."""
    if models is None:
        models, shap_data, source, cible = _results_for_report()
    tr, tm = _scripts()
    report: dict[str, Any] = {"titre": "Rapport pour l'opérateur — attaques de transmission",
                              "date": datetime.now().strftime("%d/%m/%Y %H:%M"), "source": source,
                              "modele": None, "scenarios": [], "regles_generales": GENERAL_RULES,
                              "desequilibre": DESEQUILIBRE_TXT}
    if not models:
        report["message"] = "Aucun résultat disponible : lancez un entraînement."
        report["markdown"] = f"# {report['titre']}\n\n{report['message']}\n"
        return report

    has_points = all("points_fonctionnement" in m for m in models.values())
    cible = cible if cible is not None else tm.TARGET_RECALL
    op = tm.op_key(cible) if has_points else None
    if op and all(op in m["points_fonctionnement"] for m in models.values()):
        best_key = tm.rank_models(models, op)[0]                # choix sur la VALIDATION
    else:
        op = None
        best_key = max(models, key=lambda k: models[k].get("val_f1", 0))
    best = models[best_key]
    t = _point(best, op, "test")
    v = _point(best, op, "val")
    fa_h = t.get("fausses_alarmes_evenements_par_heure")
    report["modele"] = {
        "cle": best_key, "nom": best.get("nom", best_key), "type": best.get("type", "supervisé"),
        "point_fonctionnement": f"rappel cible {cible:.2f}" if op else "max F1",
        "cible_rappel": cible if op else None,
        "recall": t["recall"], "fausses_alertes_par_heure": fa_h, "delai_median_min": t.get("delai_median_min"),
        "precision": t["precision"], "f1": t["f1"], "f2": t.get("f2"),
        "episodes": f"{t.get('episodes_detectes')}/{t.get('episodes')}",
        "validation": {"recall": v.get("recall"), "precision": v.get("precision"), "f2": v.get("f2")},
        "seuil": SEUIL_TXT.format(cible=round(100 * cible)) if op else "Seuil : F1 maximal sur la validation.",
        "lecture": (f"Le modèle signale {round(100 * t['recall'])} % des mesures falsifiées, déclenche environ "
                    f"{fa_h} fausse(s) alerte(s) par heure et réagit en {_fmt_delai(t.get('delai_median_min'))} "
                    f"(médiane) ; sur 100 alertes, environ {round(100 * t['precision'])} correspondent à une vraie "
                    "attaque" + (f" ; {round(100 * t['fpr'])} % des mesures normales sont aussi signalées."
                                 if t.get("fpr") is not None else ".")),
    }
    if op and "max_f1" in best.get("points_fonctionnement", {}):
        m1 = best["points_fonctionnement"]["max_f1"]["test"]
        report["modele"]["alternative_max_f1"] = {
            "recall": m1["recall"], "fausses_alertes_par_heure": m1["fausses_alarmes_evenements_par_heure"],
            "delai_median_min": m1["delai_median_min"], "precision": m1["precision"], "f1": m1["f1"]}

    shap_sc = (shap_data or {}).get("par_scenario", {})
    for a in tr.ATTACKS:
        name, sensor, kind = a[0], a[1], a[2]
        pa = t.get("per_attack", {}).get(name, {})
        pe = t.get("per_episode", {}).get(name, {})
        reco = RECOMMANDATIONS[_family(kind)]
        feats = shap_sc.get(name, [])[:3]
        rate = pa.get("rate") if pa.get("n") else None      # scénario absent du test : non évalué
        report["scenarios"].append({
            "scenario": name, "capteur": SENSOR_FR[sensor], "description": SCENARIOS_FR.get(name, ""),
            "famille": reco["titre"], "taux_detection": rate, "niveau": _niveau(rate),
            "episodes": f"{pe.get('detected', '—')}/{pe.get('n', '—')}",
            "delai_median_min": pe.get("delai_median_min"),
            "ce_que_le_modele_regarde": [f.get("label") or feature_label(f["feature"]) for f in feats] or [reco["signes"]],
            "risque": reco["risque"], "actions": reco["actions"],
        })

    # Limites connues : les petits biais, et l'étude complémentaire des biais longs
    limites = []
    points = [(t, report["modele"]["point_fonctionnement"])]
    if op and "max_f1" in best.get("points_fonctionnement", {}):
        points.append((best["points_fonctionnement"]["max_f1"]["test"], "max F1"))
    for name in ("Injection_biais_0.5", "Injection_biais_1.0"):
        parts = []
        for m, lib in points:
            pa = (m.get("per_attack") or {}).get(name, {})
            if pa.get("n"):
                fpr = f" pour {100 * m['fpr']:.0f} % des mesures normales" if m.get("fpr") is not None else ""
                parts.append(f"{pa['rate']:.0f} % des mesures signalées{fpr} (seuil {lib})")
        if parts:
            limites.append(f"{SCENARIOS_FR[name]} : " + " ; ".join(parts) + " — non détectable de façon fiable "
                           "en 15 à 25 min à ce niveau de bruit (σ ≈ 3,4 °C par mesure du frigo) : un épisode "
                           "« détecté » peut l'être par une alerte fortuite.")
    long_bias = _load_json(LONG_BIAS_RESULTS)
    if long_bias:
        for jeu, lib in (("B", "avec des moyennes sur 30 et 60 min"), ("A", "avec les features actuelles")):
            res = long_bias["resultats"].get(jeu, {})
            for amp, x in res.get("par_amplitude", {}).items():
                h = x.get("detectes_avant_min", {})
                parts = ", ".join(f"{v['detectes']}/{v['n']} en moins de {k} min" for k, v in h.items() if v["n"])
                limites.append(f"Biais long {amp} °C (1 à 3 h), {lib} : {parts} "
                               f"({res.get('fa_h_test', '—')} fausse(s) alerte(s)/h mesurée(s) au test, seuil fixé sur la "
                               "validation pour ≤ 1 par heure).")
    report["limites"] = limites

    md = report["modele"]
    lines = [f"# {report['titre']}", f"*{report['date']} · source : {source}*", "",
             "## Le modèle en service", "",
             f"**{md['nom']}** ({md['type']}), seuil « {md['point_fonctionnement']} » — rappel "
             f"{round(100 * md['recall'])} %, {fa_h} fausse(s) alerte(s) par heure, délai médian "
             f"{_fmt_delai(md['delai_median_min'])}, précision {round(100 * md['precision'])} %, "
             f"F1 {md['f1']:.2f}" + (f", F2 {md['f2']:.2f}" if md.get("f2") is not None else "")
             + f", épisodes détectés {md['episodes']} (test).", "", md["lecture"], "", md["seuil"], ""]
    if md.get("alternative_max_f1"):
        a1 = md["alternative_max_f1"]
        lines += [f"Au seuil « max F1 », le même modèle aurait un rappel de {round(100 * a1['recall'])} %, "
                  f"{a1['fausses_alertes_par_heure']} fausse(s) alerte(s)/h et une précision de "
                  f"{round(100 * a1['precision'])} % : moins d'alertes, mais plus d'attaques ratées.", ""]
    lines += ["## Déséquilibre des classes", "", DESEQUILIBRE_TXT, "", "## Consignes par type d'attaque", ""]
    for s in report["scenarios"]:
        rate_txt = ("non évalué" if s["taux_detection"] is None else
                    f"rappel {s['taux_detection']:.0f} % des mesures, épisodes {s['episodes']}, "
                    f"délai médian {_fmt_delai(s['delai_median_min'])}")
        lines += [f"### {s['famille']} — {s['scenario']} ({s['capteur']})", "",
                  f"- **Ce que fait l'attaquant :** {s['description']}",
                  f"- **Détection :** {rate_txt} — {s['niveau']}",
                  f"- **Ce que le modèle regarde :** {', '.join(s['ce_que_le_modele_regarde'])}",
                  f"- **Risque :** {s['risque']}",
                  "- **À faire :**"] + [f"  {i}. {act}" for i, act in enumerate(s["actions"], 1)] + [""]
    if limites:
        lines += ["## Limites connues", ""] + [f"- {x}" for x in limites] + [""]
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
