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


async def train(emit: Emit, precision_min: float | None = None, fa_max: float | None = None) -> dict:
    """Une répétition (la 0) des 6 modèles supervisés, même protocole que transmission_models.py :
    un seul point de fonctionnement par modèle (seuil + persistance k sur n) choisi sur la
    validation (rappel maximal sous précision ≥ precision_min et ≤ fa_max fausse alerte/h),
    mesuré sur train, validation et test ; choix du modèle sur la validation."""
    tr, tm, ta = _scripts_all()
    from sklearn.metrics import average_precision_score  # noqa: PLC0415

    precision_min = ta.PRECISION_MIN if precision_min is None else float(precision_min)
    fa_max = ta.FA_MAX if fa_max is None else float(fa_max)
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

    results: dict[str, dict] = {}
    models: dict[str, Any] = {}
    all_scores: dict[str, np.ndarray] = {}
    run_view = {"scores": all_scores, "y": y, "ev": ev, "episodes": episodes, "types": types}

    def evaluate(key: str, scores: np.ndarray, params: dict) -> dict:
        all_scores[key] = scores
        rows = ta.grid([{"s": scores, "y": y, "evaluated_val": ev["val"]}], "val")
        op = ta.choose(rows, precision_min, fa_max)
        m = tm.role_metrics([run_view], key, op)
        t, v = m["alarme"]["test"], m["alarme"]["val"]
        res = {"nom": tm.MODEL_NAMES[key], "type": "supervisé",
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
                                        "contrainte_tenue": op["contrainte_tenue"],
                                        "critere": ta.criterion_text(precision_min, fa_max),
                                        "validation": {x: op[x] for x in ("precision", "recall", "f1", "fa_h")}},
               "par_role": m, "hyperparameters": params}
        res["diagnostic"] = tm.diagnostic(res)
        results[key] = res
        return res

    def line(r: dict) -> str:
        op = r["point_fonctionnement"]
        return (f"seuil {op['seuil']:.2f}, {op['k']}/{op['n']} lignes ; test : rappel {r['recall']:.2f}, "
                f"précision {r['precision']:.2f}, {r['fausses_alarmes_evenements_par_heure']:.2f} FA/h, "
                f"{r['episodes_detectes']}/{r['episodes']} épisodes")

    # 1. Random Forest, par paliers d'arbres : la courbe se trace en direct (AP de validation)
    await emit("RandomForest", 10, "Random Forest : apprentissage par paliers de 30 arbres…", model="RandomForest")
    rf = tm.make_model("RandomForest", **tm._tuned("RandomForest"))           # réglage retenu (recherche groupée)
    rf_params = {k: v for k, v in rf.get_params().items()
                 if k in ("n_estimators", "min_samples_leaf", "max_features", "class_weight")}
    rf.set_params(n_estimators=30, warm_start=True)
    curve = []
    for n_trees in range(30, 301, 30):
        rf.set_params(n_estimators=n_trees)
        await asyncio.to_thread(rf.fit, X[idx["train"]], y[idx["train"]])
        p_tr = await asyncio.to_thread(lambda: rf.predict_proba(X[idx["train"]])[:, 1])
        p_val = await asyncio.to_thread(lambda: rf.predict_proba(X[idx["val"]])[:, 1])
        point = {"arbres": n_trees, "ap_train": round(float(average_precision_score(y[idx["train"]], p_tr)), 4),
                 "ap_validation": round(float(average_precision_score(y[idx["val"]], p_val)), 4)}
        curve.append(point)
        await emit("RandomForest", 10 + int(30 * n_trees / 300),
                   f"Random Forest : {n_trees} arbres, AP train {point['ap_train']:.3f}, validation "
                   f"{point['ap_validation']:.3f}", model="RandomForest", curve_point=point)
    models["RandomForest"] = rf
    r = evaluate("RandomForest", await asyncio.to_thread(tm.scores_of, rf, X), {**rf_params, "n_estimators": 300})
    await emit("RandomForest", 41, f"Random Forest : {line(r)}", model="RandomForest", result=_compact(r))

    # 2. Les autres modèles, mêmes réglages que transmission_models.py
    others = [k for k, _ in tm.MODELS if k != "RandomForest" and not (k == "XGBoost" and tm.XGBClassifier is None)]
    for i, key in enumerate(others):
        p0 = 42 + int(40 * i / len(others))
        nom = tm.MODEL_NAMES[key]
        await emit(key, p0, f"{nom} : entraînement…", model=key)
        model, params = await asyncio.to_thread(tm.fit_model, key, X, y, idx["train"])
        models[key] = model
        r = evaluate(key, await asyncio.to_thread(tm.scores_of, model, X), params)
        await emit(key, p0 + 6, f"{nom} : {line(r)}", model=key, result=_compact(r))

    ranking = tm.rank_models(results)          # VALIDATION uniquement
    best_key = ranking[0]
    tree_key = next((k for k in ranking if k in tm.TREE_MODELS), None)

    # 3. SHAP du meilleur modèle arborescent
    shap_out = None
    if tree_key is not None:
        await emit("SHAP", 85, f"SHAP : explication de {results[tree_key]['nom']} sur les attaques de validation et de test…")
        shap_out = await asyncio.to_thread(_shap_summary, models[tree_key], df, feats, idx["val"], idx["test"], tr)
        shap_out["modele"] = tree_key
        await emit("SHAP", 93, "SHAP terminé", shap=shap_out)

    # 4. Sauvegarde du modèle retenu et de son point de fonctionnement
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    import joblib  # noqa: PLC0415
    op = results[best_key]["point_fonctionnement"]
    joblib.dump(models[best_key], OUT_DIR / "modele_web.pkl")
    with open(OUT_DIR / "modele_web.json", "w", encoding="utf-8") as f:
        json.dump({"modele": best_key, "nom": results[best_key]["nom"], "features": feats, "seuil": op["seuil"],
                   "k": op["k"], "n": op["n"], "critere": op["critere"]}, f, indent=2, ensure_ascii=False)
    records = await asyncio.to_thread(study_records, df, episodes, 0, all_scores[best_key], op)
    out = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "duree_s": round(time.time() - t0, 1),
        "dataset": dataset_info,
        "features": feats,
        "critere": ta.criterion_text(precision_min, fa_max),
        "precision_min": precision_min, "fa_max": fa_max,
        "modeles": {k: _compact(r) for k, r in results.items()},
        "classement_validation": ranking,
        "meilleur": best_key,
        "courbe_random_forest": curve,
        "shap": shap_out,
    }
    with open(WEB_RESULTS, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False, default=str)
    b = results[best_key]
    await emit("done", 100, f"Entraînement terminé en {out['duree_s']:.0f} s — meilleur modèle (validation) : "
               f"{b['nom']} ; {line(b)}", results=out)
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
             "donne le rappel le plus haut possible tout en gardant au moins {pmin} % d'alertes justes et au plus "
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
                              "desequilibre": DESEQUILIBRE_TXT}
    candidates = {k: v for k, v in (models or {}).items() if k != "RF_v1"}
    if not candidates:
        report["message"] = "Aucun résultat disponible : lancez un entraînement."
        report["markdown"] = f"# {report['titre']}\n\n{report['message']}\n"
        return report

    best_key = tm.rank_models(candidates)[0]                # choix sur la VALIDATION
    t = candidates[best_key]
    op = t.get("point_fonctionnement") or {}
    fa_h = t.get("fausses_alarmes_evenements_par_heure")
    import transmission_alertes as ta  # noqa: PLC0415
    report["modele"] = {
        "cle": best_key, "nom": t.get("nom", best_key), "type": t.get("type", "supervisé"),
        "seuil_valeur": op.get("seuil"), "k": op.get("k"), "n": op.get("n"),
        "point_fonctionnement": (f"seuil {op['seuil']:.2f}, {op['k']} sur {op['n']} mesures" if op else "—"),
        "recall": t["recall"], "fausses_alertes_par_heure": fa_h, "delai_median_min": t.get("delai_median_min"),
        "precision": t["precision"], "f1": t["f1"],
        "episodes": f"{t.get('episodes_detectes')}/{t.get('episodes')}",
        "validation": {"recall": t.get("val_recall"), "precision": t.get("val_precision"),
                       "fausses_alertes_par_heure": t.get("val_fausses_alarmes_par_heure")},
        "seuil": SEUIL_TXT.format(k=op.get("k", "—"), n=op.get("n", "—"),
                                  duree=f"{(op.get('n') or 0) * 5 / 60:.1f}".replace(".", ","),
                                  pmin=round(100 * ta.PRECISION_MIN), famax=f"{ta.FA_MAX:g}".replace(".", ",")),
        "lecture": (f"Le modèle détecte {t.get('episodes_detectes')} épisodes d'attaque sur {t.get('episodes')} au "
                    f"test, avec environ {fa_h} fausse(s) alerte(s) par heure et un délai médian de "
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
        report["scenarios"].append({
            "scenario": name, "capteur": SENSOR_FR[sensor], "description": SCENARIOS_FR.get(name, ""),
            "famille": reco["titre"], "taux_detection": rate, "niveau": _niveau(rate),
            "lignes_signalees": pa.get("rate") if pa.get("n") else None,
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
        res = long_bias["resultats"].get("B", {})
        for amp, x in res.get("par_amplitude", {}).items():
            h = x.get("detectes_avant_min", {})
            parts = ", ".join(f"{v['detectes']}/{v['n']} en moins de {k} min" for k, v in h.items() if v["n"])
            limites.append(f"Étude complémentaire, biais long {amp} °C (1 à 3 h, moyennes sur 30 et 60 min) : {parts}.")
    report["limites"] = limites

    md = report["modele"]
    lines = [f"# {report['titre']}", f"*{report['date']} · source : {source}*", "",
             "## Le modèle en service", "",
             f"**{md['nom']}** ({md['type']}), réglage « {md['point_fonctionnement']} » — épisodes détectés "
             f"{md['episodes']}, {fa_h} fausse(s) alerte(s) par heure, délai médian "
             f"{_fmt_delai(md['delai_median_min'])}, précision {round(100 * md['precision'])} %, rappel "
             f"{round(100 * md['recall'])} %, F1 {md['f1']:.2f} (test).", "", md["lecture"], "", md["seuil"], "",
             "## Déséquilibre des classes", "", DESEQUILIBRE_TXT, "", "## Consignes par type d'attaque", ""]
    for s in report["scenarios"]:
        rate_txt = ("non évalué" if s["taux_detection"] is None else
                    f"épisodes {s['episodes']}, délai médian {_fmt_delai(s['delai_median_min'])}, "
                    f"{s['lignes_signalees']:.0f} % des mesures signalées")
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
