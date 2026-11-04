"""
Attaques de transmission sur les traces réelles — service de l'API
===================================================================
Réutilise les scripts d'étude (backend/scripts/transmission_real.py et
transmission_models.py) : même jeu de données, mêmes features, même protocole.

- summary()            : état du jeu de données, résultats de référence, dernier entraînement web
- train(emit)          : entraîne les 6 modèles supervisés en diffusant la progression ; un seul
                         réglage d'alerte par modèle (seuil + persistance k sur n) choisi sur la
                         validation (rappel maximal sous précision et fausses alertes/h
                         bornées), choix du modèle sur la validation (le Random Forest est
                         entraîné par paliers d'arbres pour tracer sa courbe en direct), puis
                         SHAP du meilleur et sauvegarde ; study_records() prépare les lignes
                         écrites en base (jeu de données, scores, alertes, épisodes)
- operator_report()    : rapport de recommandation pour l'opérateur (JSON + Markdown)
- alert_recommendation : consigne pour une alerte précise
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
import warnings
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
            for tag, txt in (("min_", "minimum"), ("max_", "maximum"), ("q10_", "quantile 10 %"),
                             ("q90_", "quantile 90 %")):
                if rest.startswith(tag):
                    return f"{txt} sur {rest[len(tag):].replace('min', ' min')} du {fr}"
            if rest == "absdiff_5min":
                return f"variation absolue moyenne sur 5 min du {fr}"
            if rest.endswith("_diff_mean_15min"):
                a, b = feature.replace("_diff_mean_15min", "").split("_", 1)
                return f"écart {SENSOR_FR.get(a, a)} − {SENSOR_FR.get(b, b)} moyen sur 15 min"
            if rest == "repeat_2min":
                return f"séquence de 2 min du {fr} déjà transmise"
            if rest == "cond_enc":
                return "état « high / low » du frigo"
    if feature == "thermo_status":
        return "état du thermostat"
    if feature.endswith("_diff_mean_15min"):
        a, b = feature.replace("_diff_mean_15min", "").split("_", 1)
        return f"écart {SENSOR_FR.get(a, a)} − {SENSOR_FR.get(b, b)} moyen sur 15 min"
    if feature.endswith("_diff"):
        a, b = feature.replace("_diff", "").split("_", 1)
        return f"écart {SENSOR_FR.get(a, a)} − {SENSOR_FR.get(b, b)}"
    return feature


def scenarios() -> list[dict]:
    tr, _ = _scripts()
    return [{"nom": a[0], "capteur": a[1], "capteur_fr": SENSOR_FR[a[1]], "mecanisme": a[2],
             "parametre": a[3], "description": SCENARIOS_FR.get(a[0], "")} for a in tr.ATTACKS]


# ── Résumé ───────────────────────────────────────────────────────────────────

def _scripts_all():
    tr, tm = _scripts()
    import transmission_alertes as ta  # noqa: PLC0415
    return tr, tm, ta


def summary() -> dict:
    out: dict[str, Any] = {"dataset": None, "traces": None, "reference": None,
                           "shap_reference": None, "web": _load_json(WEB_RESULTS)}
    if DATASET_PATH.exists() and EPISODES_PATH.exists():
        tr, _ = _scripts()
        cols = pd.read_csv(DATASET_PATH, usecols=["label", "attack_type", "garde"], keep_default_na=False)
        garde = cols["garde"].astype(str).str.lower().eq("true").to_numpy()
        split = tr.block_split(len(cols), 0)   # le découpage n'est pas stocké dans le CSV
        keep = ~tr.excluded_rows(garde, 0)     # lignes évaluées (hors zones de garde)
        episodes = _load_json(EPISODES_PATH) or []
        par_role = {}
        for r in ("train", "val", "test"):
            sub = cols.loc[(split == r) & keep, "label"]
            par_role[r] = {"lignes": int(len(sub)), "attaques": int(sub.sum()),
                           "part": round(float(sub.mean()), 4) if len(sub) else 0.0}
        out["dataset"] = {
            "fichier": DATASET_PATH.name, "lignes": int(len(cols)), "lignes_evaluees": int(keep.sum()),
            "attaques": int(cols["label"].sum()), "heures": round(len(cols) * 5 / 3600, 1),
            "episodes": len(episodes), "par_role": par_role,
            "scenarios": sorted(set(e["name"] for e in episodes)),
            "zone_de_garde_min": tr.GUARD * tr.STEP_MINUTES,
        }
    study = _load_json(REAL_STUDY)
    if study:
        out["traces"] = {"fusion": study.get("fusion"), "profil": study.get("profil_traces")}
    pooled = _load_json(POOLED_RESULTS)
    if pooled:
        out["reference"] = {
            "generated_at": pooled.get("generated_at"), "version": pooled.get("version"),
            "repetitions": pooled["protocole"]["repetitions"], "protocole": pooled.get("protocole"),
            "prevalence": pooled.get("prevalence"), "meilleur": pooled.get("meilleur_modele"),
            "classement_validation": pooled.get("classement_validation"),
            "modeles": {k: _compact(v) for k, v in pooled["resultats"].items()},
            "courbe_apprentissage": pooled.get("courbe_apprentissage"),
        }
    out["validation_croisee"] = _load_json(CV_RESULTS) or (pooled or {}).get("validation_croisee")
    out["biais_long"] = _load_json(LONG_BIAS_RESULTS)
    out["shap_reference"] = _load_json(POOLED_SHAP)
    out["scenarios"] = scenarios() if DATASET_PATH.exists() or pooled else []
    return out


def public_kpis() -> dict | None:
    """Chiffres de la page d'accueil (publics) : agrégats des résultats de référence
    (comparaison_modeles.json, cumul des répétitions), meilleur modèle au point de
    fonctionnement unique choisi sur la validation, mesuré sur le test."""
    pooled = _load_json(POOLED_RESULTS)
    if not pooled or not pooled.get("resultats"):
        return None
    fusion = pooled.get("fusion") or {}
    best_id = pooled.get("meilleur_modele")
    m = pooled["resultats"].get(best_id, {})
    op = m.get("point_fonctionnement") or {}
    mesures = int(fusion.get("pas_conserves") or 0)
    par_scenario = sorted(m.get("per_episode", {}).items(),
                          key=lambda kv: -(kv[1]["detected"] / max(1, kv[1]["n"])))
    return {
        "generated_at": pooled.get("generated_at"),
        "traces": {"debut": fusion.get("debut"), "fin": fusion.get("fin"), "pas": fusion.get("pas"),
                   "mesures": mesures, "heures": round(mesures * 5 / 3600, 1)},
        "capteurs": list(SENSOR_FR),
        "repetitions": pooled.get("protocole", {}).get("repetitions"),
        "scenarios": len(par_scenario),
        "critere": op.get("critere"),
        "part_attaques_test": (pooled.get("prevalence") or {}).get("test", {}).get("part"),
        "meilleur": {"id": best_id, "nom": m.get("nom"), "recall": m.get("recall"),
                     "fausses_alarmes_par_heure": m.get("fausses_alarmes_evenements_par_heure"),
                     "delai_median_min": m.get("delai_median_min"), "precision": m.get("precision"),
                     "f1": m.get("f1"), "roc_auc": m.get("roc_auc"),
                     "episodes": m.get("episodes"), "episodes_detectes": m.get("episodes_detectes"),
                     "seuil": op.get("seuil"), "k": op.get("k"), "n": op.get("n")},
        "modeles": [{"id": k, "nom": v.get("nom"), "f1": v.get("f1")} for k, v in pooled["resultats"].items()
                    if k != "RF_v1"],
        "detection_par_scenario": [
            {"scenario": k, "description": SCENARIOS_FR.get(k, k),
             "taux": round(100 * v["detected"] / max(1, v["n"]), 1), "episodes": v["n"], "detectes": v["detected"],
             "lignes_signalees": (m.get("per_attack", {}).get(k) or {}).get("rate")}
            for k, v in par_scenario],
    }


# ── Entraînement ─────────────────────────────────────────────────────────────

def _dataset_is_current(tr, tm) -> bool:
    """Le CSV en place suit-il le protocole actuel (mêmes scénarios, mêmes features, épisodes
    placés après la zone de garde) ? Sinon il est reconstruit."""
    header = pd.read_csv(DATASET_PATH, nrows=0).columns
    episodes = _load_json(EPISODES_PATH) or []
    if "split" in header or not episodes or "fridge_q10_15min" not in header:
        return False
    if {e.get("name") for e in episodes} != set(tr.ATTACK_NAMES):
        return False
    split = tr.block_split(max(e["end"] for e in episodes), 0)
    return all(set(split[e["start"]:e["end"]]) == {e.get("split")} for e in episodes)


def _load_or_build_dataset(tr, tm) -> tuple[pd.DataFrame, list[str], list[dict], bool]:
    """Jeu de données réel avec attaques (répétition 0). Construit s'il manque ou s'il
    vient d'un ancien protocole."""
    if DATASET_PATH.exists() and EPISODES_PATH.exists() and _dataset_is_current(tr, tm):
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


COMPACT_KEYS = ("nom", "type", "recall", "fausses_alarmes_evenements_par_heure", "delai_median_min", "delai_p90_min",
                "precision", "precision_alertes", "f1", "fpr", "alertes", "fausses_alertes", "episodes",
                "episodes_detectes", "part_attaques", "val_recall", "val_fausses_alarmes_par_heure",
                "val_delai_median_min", "val_precision", "val_f1", "val_episodes", "val_episodes_detectes",
                "val_part_attaques", "roc_auc", "avg_precision", "val_roc_auc", "val_avg_precision", "train_roc_auc",
                "train_avg_precision", "threshold", "point_fonctionnement", "par_role", "diagnostic",
                "per_attack", "per_episode", "courbe_pr", "hyperparameters", "duree_entrainement_s")


def _compact(r: dict) -> dict:
    return {k: r[k] for k in COMPACT_KEYS if k in r}


def study_records(df: pd.DataFrame, episodes: list[dict], run: int, scores: np.ndarray, op: dict) -> dict:
    """Ce que les pages lisent en base pour UNE répétition : lignes du jeu de données (rôle,
    zone de garde), score / signal / alarme du meilleur modèle, alertes, épisodes détectés."""
    tr, _, ta = _scripts_all()
    n = len(df)
    split = tr.block_split(n, run)
    excl = tr.excluded_rows(df["garde"].to_numpy().astype(bool), run)
    y = df["label"].to_numpy().astype(int)
    ts = pd.to_datetime(df["datetime"]).to_numpy()
    s = np.asarray(scores, dtype=float)
    signal = s >= op["seuil"]
    alarm = ta.apply(s, op)
    alerts = []
    for role in ("train", "val", "test"):
        ev = (split == role) & ~excl
        for a, b in ta.alert_events(alarm, ev):
            vraie = bool(y[a:b].any())
            types = df["attack_type"].to_numpy()[a:b]
            sc = next((t for t in types if t != "normal"), None)
            cible = df["cible"].to_numpy()[a:b]
            alerts.append({"role": role, "start_idx": int(a), "end_idx": int(b), "start_ts": pd.Timestamp(ts[a]),
                           "end_ts": pd.Timestamp(ts[b - 1]), "duree_min": round((b - a) * tr.STEP_MINUTES, 2),
                           "score_max": round(float(s[a:b].max()), 4), "vraie": vraie, "scenario": sc,
                           "capteur": next((c for c in cible if c), None) if vraie else None})
    eps = []
    for e in episodes:
        seg = alarm[e["start"]:e["end"]]
        eps.append({**e, "detecte": bool(seg.any()),
                    "delai_min": round(int(np.argmax(seg)) * tr.STEP_MINUTES, 2) if seg.any() else None,
                    "start_ts": pd.Timestamp(ts[e["start"]]), "end_ts": pd.Timestamp(ts[min(n - 1, e["end"] - 1)])})
    return {"split": split, "evaluee": ~excl, "scores": s, "signal": signal, "alarme": alarm,
            "alertes": alerts, "episodes": eps}


def reference_choice(ref: dict | None) -> dict | None:
    """Le modèle retenu par l'étude de référence (lue en base) : clé, hyperparamètres, seuil et
    persistance k sur n. None si l'étude n'est pas disponible."""
    if not ref or not ref.get("modeles"):
        return None
    key = ref.get("meilleur") or next(iter(ref["modeles"]))
    m = ref["modeles"].get(key) or {}
    op = m.get("point_fonctionnement") or {}
    if op.get("seuil") is None or not op.get("k") or not op.get("n"):
        return None
    params = {k: v for k, v in (m.get("hyperparameters") or {}).items() if k != "sample_weight"}
    return {"modele": key, "nom": m.get("nom", key), "hyperparameters": params, "seuil": float(op["seuil"]),
            "k": int(op["k"]), "n": int(op["n"]), "contrainte_tenue": op.get("contrainte_tenue"),
            "critere": op.get("critere"),
            "repetitions": ((ref.get("etude") or {}).get("protocole") or {}).get("repetitions"),
            "test_reference": {x: m.get(x) for x in ("precision", "recall", "fausses_alarmes_evenements_par_heure",
                                                     "episodes", "episodes_detectes", "delai_median_min")}}


WARM_START_MODELS = ("RandomForest", "ExtraTrees")


async def train(emit: Emit, reference: dict | None = None, precision_min: float | None = None,
                fa_max: float | None = None) -> dict:
    """Entraînement web : UNIQUEMENT le modèle retenu par l'étude de référence (lue en base), avec
    ses hyperparamètres, son seuil et sa règle de persistance (k sur n) tels quels, sur une seule
    répétition (la 0) du découpage par blocs ; métriques train / validation / test. L'étude
    complète (6 modèles, 20 répétitions) reste celle de scripts/transmission_models.py.

    Sans étude de référence, repli : Extra Trees avec le réglage de la recherche groupée et un
    point de fonctionnement choisi sur la validation (précision ≥ precision_min, ≤ fa_max FA/h)."""
    tr, tm, ta = _scripts_all()
    from sklearn.metrics import average_precision_score  # noqa: PLC0415

    precision_min = ta.PRECISION_MIN if precision_min is None else float(precision_min)
    fa_max = ta.FA_MAX if fa_max is None else float(fa_max)
    choice = reference_choice(reference)
    key = choice["modele"] if choice else "ExtraTrees"
    nom = tm.MODEL_NAMES.get(key, key)
    params = dict(choice["hyperparameters"]) if choice else tm._tuned(key)
    t0 = time.time()
    await emit("dataset", 3, "Chargement des traces réelles avec attaques de transmission…")
    df, feats, episodes, built = await asyncio.to_thread(_load_or_build_dataset, tr, tm)
    y = df["label"].to_numpy().astype(int)
    split = tr.block_split(len(df), 0)
    excl = tr.excluded_rows(df["garde"].to_numpy().astype(bool), 0)
    ev = {r: (split == r) & ~excl for r in ("train", "val", "test")}
    idx = {r: np.where(m)[0] for r, m in ev.items()}
    X = df[feats].to_numpy(np.float32)
    types = df["attack_type"].to_numpy()
    prevalence = tm.role_prevalence(y, idx)
    dataset_info = {
        "fichier": DATASET_PATH.name, "construit": built, "lignes": int(len(df)), "features": len(feats),
        "train": int(len(idx["train"])), "val": int(len(idx["val"])), "test": int(len(idx["test"])),
        "exclues_zone_de_garde": int(excl.sum()), "zone_de_garde_min": tr.GUARD * tr.STEP_MINUTES,
        "attaques_train": int(y[idx["train"]].sum()), "attaques_val": int(y[idx["val"]].sum()),
        "attaques_test": int(y[idx["test"]].sum()), "prevalence": prevalence, "episodes": len(episodes),
    }
    await emit("dataset", 8, f"{len(df):,} lignes, {len(feats)} features, {len(episodes)} épisodes ; train "
               f"{len(idx['train']):,} · val {len(idx['val']):,} · test {len(idx['test']):,} lignes (zone de garde "
               f"de {tr.GUARD * tr.STEP_MINUTES:.0f} min exclue)", dataset=dataset_info)
    await emit(key, 10, (f"Modèle retenu par l'étude de référence : {nom} ; seuil {choice['seuil']:.2f}, "
                         f"{choice['k']} sur {choice['n']} mesures, hyperparamètres de l'étude."
                         if choice else f"Pas d'étude de référence en base : repli sur {nom}, réglage choisi sur la validation."),
               model=key)

    # 1. Apprentissage. Forêts : par paliers d'arbres, la courbe AP train / validation se trace en direct.
    curve: list[dict] = []
    if key in WARM_START_MODELS:
        total = int(params.get("n_estimators") or 300)
        step = max(10, total // 10)
        model = tm.make_model(key, **{**params, "n_estimators": step, "warm_start": True})
        # AP d'entraînement sur un échantillon fixe (la courbe n'a pas besoin des 30 000 lignes)
        rng = np.random.default_rng(0)
        tr_eval = np.sort(rng.choice(idx["train"], size=min(8000, len(idx["train"])), replace=False))
        n_trees = 0
        while n_trees < total:
            n_trees = min(total, n_trees + step)
            model.set_params(n_estimators=n_trees)
            with warnings.catch_warnings():     # class_weight + warm_start : mêmes lignes à chaque palier
                warnings.simplefilter("ignore", UserWarning)
                await asyncio.to_thread(model.fit, X[idx["train"]], y[idx["train"]])
            p_tr = await asyncio.to_thread(lambda: model.predict_proba(X[tr_eval])[:, 1])
            p_val = await asyncio.to_thread(lambda: model.predict_proba(X[idx["val"]])[:, 1])
            point = {"arbres": n_trees, "ap_train": round(float(average_precision_score(y[tr_eval], p_tr)), 4),
                     "ap_validation": round(float(average_precision_score(y[idx["val"]], p_val)), 4)}
            curve.append(point)
            await emit(key, 10 + int(60 * n_trees / total),
                       f"{nom} : {n_trees} arbres, AP train {point['ap_train']:.3f}, validation "
                       f"{point['ap_validation']:.3f}", model=key, curve_point=point)
        model.set_params(warm_start=False)
        used = {**params, "n_estimators": total}
    else:
        await emit(key, 15, f"{nom} : entraînement…", model=key)
        model, used = await asyncio.to_thread(tm.fit_model, key, X, y, idx["train"], params)

    # 2. Mesure au point de fonctionnement de l'étude (aucun nouveau choix sur cette répétition)
    await emit(key, 74, f"{nom} : scores et alertes sur train, validation et test…", model=key)
    scores = await asyncio.to_thread(tm.scores_of, model, X)
    if choice:
        op = {"seuil": choice["seuil"], "k": choice["k"], "n": choice["n"],
              "contrainte_tenue": choice.get("contrainte_tenue"),
              "critere": "réglage de l'étude de référence appliqué tel quel ("
                         + (choice.get("critere") or ta.criterion_text(precision_min, fa_max)) + ")"}
    else:
        rows = ta.grid([{"s": scores, "y": y, "evaluated_val": ev["val"]}], "val")
        op = {**ta.choose(rows, precision_min, fa_max), "critere": ta.criterion_text(precision_min, fa_max)}
    run_view = {"scores": {key: scores}, "y": y, "ev": ev, "episodes": episodes, "types": types}
    m = tm.role_metrics([run_view], key, op)
    t, v = m["alarme"]["test"], m["alarme"]["val"]
    res = {"nom": nom, "type": "supervisé",
           **{k: t[k] for k in ("recall", "precision", "f1", "fpr", "part_attaques",
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
                                    "contrainte_tenue": op.get("contrainte_tenue"), "critere": op["critere"],
                                    "validation": {"precision": v["precision"], "recall": v["recall"], "f1": v["f1"],
                                                   "fa_h": v["fausses_alarmes_evenements_par_heure"]}},
           "par_role": m, "hyperparameters": used}
    res["diagnostic"] = tm.diagnostic(res)
    await emit(key, 80, (f"{nom} : test (répétition 0, {t['episodes']} épisodes) : précision {t['precision']:.2f}, "
                         f"{t['fausses_alarmes_evenements_par_heure']:.2f} FA/h, rappel {t['recall']:.2f}, "
                         f"{t['episodes_detectes']}/{t['episodes']} épisodes"), model=key, result=_compact(res))

    # 3. SHAP du modèle (arbres)
    shap_out = None
    if key in tm.TREE_MODELS:
        await emit("SHAP", 84, f"SHAP : explication de {nom} sur les attaques de validation et de test…")
        shap_out = await asyncio.to_thread(_shap_summary, model, df, feats, idx["val"], idx["test"], tr)
        shap_out["modele"] = key
        await emit("SHAP", 93, "SHAP terminé", shap=shap_out)

    # 4. Sauvegarde du modèle et de son point de fonctionnement
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    import joblib  # noqa: PLC0415
    joblib.dump(model, OUT_DIR / "modele_web.pkl")
    with open(OUT_DIR / "modele_web.json", "w", encoding="utf-8") as f:
        json.dump({"modele": key, "nom": nom, "features": feats, "seuil": op["seuil"],
                   "k": op["k"], "n": op["n"], "critere": op["critere"]}, f, indent=2, ensure_ascii=False)
    records = await asyncio.to_thread(study_records, df, episodes, 0, scores, op)
    out = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "duree_s": round(time.time() - t0, 1),
        "mode": "modele_retenu",
        "description": (f"Une seule répétition (découpage n° 0, {t['episodes']} épisodes d'attaque au test) du modèle "
                        f"retenu, {nom}, avec le réglage de l'étude de référence. Les chiffres de référence "
                        f"sont ceux de l'étude complète ({(choice or {}).get('repetitions') or 20} répétitions)."),
        "reference": choice,
        "dataset": dataset_info,
        "features": feats,
        "critere": op["critere"],
        "precision_min": precision_min, "fa_max": fa_max,
        "modeles": {key: _compact(res)},
        "classement_validation": [key],
        "meilleur": key,
        "courbe_arbres": curve,
        "shap": shap_out,
    }
    with open(WEB_RESULTS, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False, default=str)
    await emit("done", 100, f"Entraînement terminé en {out['duree_s']:.0f} s — {nom} (modèle retenu) : test de la "
               f"répétition 0, précision {res['precision']:.2f}, {res['fausses_alarmes_evenements_par_heure']:.2f} "
               f"FA/h, {res['episodes_detectes']}/{res['episodes']} épisodes", results=out)
    out["_records"] = {"df": df, **records}
    return out


def _shap_summary(model, df, feats, val_idx, test_idx, tr) -> dict:
    import shap  # noqa: PLC0415

    y = df["label"].to_numpy()
    types = df["attack_type"].to_numpy()
    rows = np.concatenate([val_idx[y[val_idx] == 1], test_idx[y[test_idx] == 1]])
    rng = np.random.default_rng(tr.SEED)
    rows = np.sort(rng.choice(rows, min(300, len(rows)), replace=False))   # SHAP exact des arbres : coûteux
    values = shap.TreeExplainer(model).shap_values(df[feats].to_numpy(float)[rows])
    if isinstance(values, list):
        values = values[-1]
    values = np.asarray(values)
    if values.ndim == 3:
        values = values[:, :, -1]
    imp = np.abs(values)

    def top(mask, k=6):
        m = imp[mask].mean(axis=0)
        order = np.argsort(m)[::-1][:k]
        return [{"feature": feats[i], "label": feature_label(feats[i]), "importance": round(float(m[i]), 4)}
                for i in order]

    out = {"n_lignes": int(len(rows)), "global": top(np.ones(len(rows), dtype=bool), 15), "par_scenario": {}}
    for nm in tr.ATTACK_NAMES:
        mask = types[rows] == nm
        if mask.any():
            out["par_scenario"][nm] = top(mask, 6)
    return out


# ── Rapport pour l'opérateur ─────────────────────────────────────────────────

SEUIL_TXT = ("Un seul réglage d'alerte, choisi sur la VALIDATION : un seuil de score et une règle de persistance "
             "(alerte quand au moins {k} mesures sur les {n} dernières, soit {duree} min, dépassent le seuil). Il "
             "donne le rappel le plus haut possible tout en gardant au moins {pmin} % de mesures signalées vraiment falsifiées et au plus "
             "{famax} fausse alerte par heure : l'opérateur ne doit pas être noyé de fausses alertes. Le modèle est "
             "choisi sur la validation ; les chiffres ci-dessous sont mesurés ensuite sur le test, qui n'a servi à "
             "aucun choix.")
DESEQUILIBRE_TXT = ("Les attaques sont minoritaires : les modèles compensent par des poids de classe "
                    "(class_weight, scale_pos_weight, sample_weight). Pas de SMOTE : des points synthétiques "
                    "interpolés entre deux lignes d'une série temporelle fabriqueraient des fenêtres glissantes "
                    "qui n'existent pas, et le sur-échantillonnage ne change pas la proportion d'attaques réelle, "
                    "qui seule fixe la précision. Les leviers sont le seuil et la règle de persistance.")


def _results_for_report() -> tuple[dict | None, dict | None, str]:
    pooled = _load_json(POOLED_RESULTS)
    if pooled and pooled.get("resultats"):
        n = pooled.get("protocole", {}).get("repetitions")
        return pooled["resultats"], _load_json(POOLED_SHAP), f"étude de référence ({n} répétitions)"
    web = _load_json(WEB_RESULTS)
    if web and web.get("modeles"):
        return web["modeles"], web.get("shap"), "dernier entraînement web"
    return None, None, "aucun résultat"


# Niveau de détection d'un scénario : trois mesures au test, pas une seule.
#  - E : part des épisodes d'attaque détectés (au moins une alerte pendant l'épisode) ;
#  - M : part des mesures falsifiées signalées (couverture de l'épisode) ;
#  - D : délai médian entre le début de l'épisode et la première alerte.
NIVEAU_EPISODES_MIN = 85.0      # % : au plus ~1 épisode manqué sur 7 à 10
NIVEAU_MESURES_MIN = 70.0       # % : la majorité de chaque épisode est couverte
NIVEAU_DELAI_MAX = 5.0          # min : alerte avant la fin d'une fenêtre de 5 min
NIVEAU_EPISODES_MAL = 60.0      # % : en dessous, trop d'attaques passent
CRITERE_NIVEAU = (
    f"Niveau de détection, mesuré au test pour chaque scénario : « bien détecté » si au moins "
    f"{NIVEAU_EPISODES_MIN:.0f} % des épisodes sont détectés, au moins {NIVEAU_MESURES_MIN:.0f} % des mesures "
    f"falsifiées sont signalées et le délai médian est d'au plus {NIVEAU_DELAI_MAX:.0f} min ; « mal détecté » si "
    f"moins de {NIVEAU_EPISODES_MAL:.0f} % des épisodes sont détectés ; sinon « détecté partiellement » (épisodes "
    f"manqués ou trop peu de mesures signalées) et/ou « tardivement » (délai médian au-delà de "
    f"{NIVEAU_DELAI_MAX:.0f} min). Un épisode compte comme détecté dès qu'une alerte tombe pendant l'épisode : "
    "c'est pourquoi la part des mesures signalées et le délai sont indispensables pour juger."
)


def _niveau(episodes_pct: float | None, mesures_pct: float | None = None,
            delai_min: float | None = None) -> tuple[str, str]:
    """(niveau, raison) d'un scénario selon CRITERE_NIVEAU."""
    if episodes_pct is None:
        return "non évalué", "aucun épisode de ce scénario au test"
    fr = lambda v, d=0: f"{v:.{d}f}".replace(".", ",")  # noqa: E731
    if episodes_pct < NIVEAU_EPISODES_MAL:
        return ("mal détecté : vérification humaine indispensable",
                f"seulement {fr(episodes_pct)} % des épisodes détectés (seuil {NIVEAU_EPISODES_MAL:.0f} %)")
    raisons, partiel = [], False
    if episodes_pct < NIVEAU_EPISODES_MIN:
        partiel = True
        raisons.append(f"{fr(episodes_pct)} % des épisodes détectés (< {NIVEAU_EPISODES_MIN:.0f} %)")
    if mesures_pct is not None and mesures_pct < NIVEAU_MESURES_MIN:
        partiel = True
        raisons.append(f"{fr(mesures_pct)} % des mesures falsifiées signalées (< {NIVEAU_MESURES_MIN:.0f} %)")
    tardif = delai_min is not None and delai_min > NIVEAU_DELAI_MAX
    if tardif:
        raisons.append(f"délai médian {fr(delai_min, 1)} min (> {NIVEAU_DELAI_MAX:.0f} min)")
    if not partiel and not tardif:
        return "bien détecté", (f"{fr(episodes_pct)} % des épisodes, "
                                + (f"{fr(mesures_pct)} % des mesures signalées, " if mesures_pct is not None else "")
                                + (f"délai médian {fr(delai_min, 1)} min" if delai_min is not None else "délai inconnu"))
    niveau = ("détecté partiellement et tardivement" if partiel and tardif
              else "détecté partiellement" if partiel else "détecté tardivement")
    return niveau, " ; ".join(raisons)


def _fmt_delai(d) -> str:
    return "—" if d is None else f"{d:.1f} min".replace(".", ",")


def operator_report(models: dict | None = None, shap_data: dict | None = None, source: str | None = None) -> dict:
    """Rapport de recommandation : le modèle en service et son réglage d'alerte, chaque scénario
    (épisodes détectés, délai, lignes signalées, ce que le modèle regarde, consignes), les limites
    connues et les règles générales. JSON structuré + rendu Markdown. Les chiffres sont lus dans
    les résultats (aucun chiffre écrit en dur)."""
    if models is None:
        models, shap_data, source = _results_for_report()
    tr, tm = _scripts()
    report: dict[str, Any] = {"titre": "Rapport pour l'opérateur — attaques de transmission",
                              "date": datetime.now().strftime("%d/%m/%Y %H:%M"), "source": source,
                              "modele": None, "scenarios": [], "regles_generales": GENERAL_RULES,
                              "desequilibre": DESEQUILIBRE_TXT,
                              "critere_niveau": CRITERE_NIVEAU}
    candidates = {k: v for k, v in (models or {}).items() if k != "RF_v1"}
    if not candidates:
        report["message"] = "Aucun résultat disponible : lancez un entraînement."
        report["markdown"] = f"# {report['titre']}\n\n{report['message']}\n"
        return report

    best_key = tm.rank_models(candidates)[0]                # choix sur la VALIDATION
    t = candidates[best_key]
    op = t.get("point_fonctionnement") or {}
    fa_h = t.get("fausses_alarmes_evenements_par_heure")
    fa_txt = "—" if fa_h is None else f"{fa_h:.2f}".replace(".", ",")
    import transmission_alertes as ta  # noqa: PLC0415
    report["modele"] = {
        "cle": best_key, "nom": t.get("nom", best_key), "type": t.get("type", "supervisé"),
        "seuil_valeur": op.get("seuil"), "k": op.get("k"), "n": op.get("n"),
        "point_fonctionnement": (f"seuil {op['seuil']:.2f}, {op['k']} sur {op['n']} mesures".replace(".", ",") if op else "—"),
        "recall": t["recall"], "fausses_alertes_par_heure": fa_h, "delai_median_min": t.get("delai_median_min"),
        "precision": t["precision"], "f1": t["f1"],
        "episodes": f"{t.get('episodes_detectes')}/{t.get('episodes')}",
        "validation": {"recall": t.get("val_recall"), "precision": t.get("val_precision"),
                       "fausses_alertes_par_heure": t.get("val_fausses_alarmes_par_heure")},
        "seuil": SEUIL_TXT.format(k=op.get("k", "—"), n=op.get("n", "—"),
                                  duree=f"{(op.get('n') or 0) * 5 / 60:.1f}".replace(".", ","),
                                  pmin=round(100 * ta.PRECISION_MIN), famax=f"{ta.FA_MAX:g}".replace(".", ",")),
        "lecture": (f"Le modèle détecte {t.get('episodes_detectes')} épisodes d'attaque sur {t.get('episodes')} au "
                    f"test, avec environ {fa_txt} fausse alerte par heure et un délai médian de "
                    f"{_fmt_delai(t.get('delai_median_min'))} ; sur 100 mesures signalées, environ "
                    f"{round(100 * t['precision'])} sont vraiment falsifiées, et {round(100 * t['recall'])} % des "
                    "mesures falsifiées sont signalées."),
    }

    shap_sc = (shap_data or {}).get("par_scenario", {})
    for a in tr.ATTACKS:
        name, sensor, kind = a[0], a[1], a[2]
        pa = t.get("per_attack", {}).get(name, {})
        pe = t.get("per_episode", {}).get(name, {})
        reco = RECOMMANDATIONS[_family(kind)]
        feats = shap_sc.get(name, [])[:3]
        rate = round(100 * pe["detected"] / pe["n"], 1) if pe.get("n") else None   # épisodes détectés
        mesures = pa.get("rate") if pa.get("n") else None
        niveau, raison = _niveau(rate, mesures, pe.get("delai_median_min"))
        report["scenarios"].append({
            "scenario": name, "capteur": SENSOR_FR[sensor], "description": SCENARIOS_FR.get(name, ""),
            "famille": reco["titre"], "taux_detection": rate, "niveau": niveau,
            "niveau_raison": raison, "lignes_signalees": mesures,
            "episodes": f"{pe.get('detected', '—')}/{pe.get('n', '—')}",
            "delai_median_min": pe.get("delai_median_min"),
            "ce_que_le_modele_regarde": [f.get("label") or feature_label(f["feature"]) for f in feats] or [reco["signes"]],
            "risque": reco["risque"], "actions": reco["actions"],
        })

    limites = []
    for name in ("Injection_biais_0.5", "Injection_biais_1.0"):
        pa = (t.get("per_attack") or {}).get(name, {})
        pe = (t.get("per_episode") or {}).get(name, {})
        if pa.get("n"):
            limites.append(f"{SCENARIOS_FR[name]} : {pe.get('detected')}/{pe.get('n')} épisodes détectés, "
                           f"{pa['rate']:.0f} % des mesures falsifiées signalées, délai médian "
                           f"{_fmt_delai(pe.get('delai_median_min'))} — décalage plus petit que le bruit du capteur "
                           "(σ ≈ 3,4 °C par mesure du frigo) : la détection vient de la forme de la distribution sur "
                           "5 à 15 min, elle reste plus lente et moins sûre que pour les autres scénarios.")
    long_bias = _load_json(LONG_BIAS_RESULTS)
    if long_bias:
        res = long_bias["resultats"].get("A", {})
        for amp, x in res.get("par_amplitude", {}).items():
            h = x.get("detectes_avant_min", {})
            parts = ", ".join(f"{v['detectes']}/{v['n']} en moins de {k} min" for k, v in h.items() if v["n"])
            limites.append(f"Étude complémentaire, biais long {amp.replace('.', ',')} °C (épisodes de 1 à 3 h, features de l'étude "
                           f"principale) : {parts} ({str(res.get('fa_h_test', '—')).replace('.', ',')} fausse(s) alerte(s)/h au test).")
    report["limites"] = limites

    md = report["modele"]
    lines = [f"# {report['titre']}", f"*{report['date']} · source : {source}*", "",
             "## Le modèle en service", "",
             f"**{md['nom']}** ({md['type']}), réglage « {md['point_fonctionnement']} » — épisodes détectés "
             f"{md['episodes']}, {fa_txt} fausse alerte par heure, délai médian "
             f"{_fmt_delai(md['delai_median_min'])}, précision {round(100 * md['precision'])} %, rappel "
             f"{round(100 * md['recall'])} %, F1 {md['f1']:.2f} (test).", "", md["lecture"], "", md["seuil"], "",
             "## Déséquilibre des classes", "", DESEQUILIBRE_TXT, "", "## Consignes par type d'attaque", "",
             f"*{CRITERE_NIVEAU}*", ""]
    for s in report["scenarios"]:
        rate_txt = ("non évalué" if s["taux_detection"] is None else
                    f"épisodes {s['episodes']}, délai médian {_fmt_delai(s['delai_median_min'])}, "
                    f"{s['lignes_signalees']:.0f} % des mesures signalées")
        lines += [f"### {s['famille']} — {s['scenario']} ({s['capteur']})", "",
                  f"- **Ce que fait l'attaquant :** {s['description']}",
                  f"- **Détection :** {rate_txt} — **{s['niveau']}** ({s['niveau_raison']})",
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
