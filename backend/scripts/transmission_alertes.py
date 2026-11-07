# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/scripts/transmission_alertes.py
#   RÈGLE D'ALERTE. Persistance « k mesures sur n », comptage des vraies / fausses alertes,
#   choix du seuil (précision ≥ 90 %, ≤ 0,5 fausse alerte/h).
# ══════════════════════════════════════════════════════════════════════════
"""
Post-traitement temporel des alertes et choix du seuil unique
=============================================================
Un modèle donne un score par ligne (5 s). Signaler chaque ligne au-dessus du seuil
produit des alertes isolées, souvent fausses : l'opérateur ne peut pas les traiter.
Comme dans les IDS classiques, on ajoute une règle de PERSISTANCE (anti-rebond) :

    alarme(t) = au moins k des n dernières lignes (t-n+1 … t) sont au-dessus du seuil

Une alerte (événement) = une suite continue de lignes en alarme. Elle est VRAIE si
elle recouvre au moins une ligne d'attaque, FAUSSE sinon. On mesure :

- au niveau LIGNE : rappel, précision, F1 de l'alarme (après persistance) ;
- au niveau ALERTE / ÉPISODE : épisodes détectés (au moins une ligne en alarme pendant
  l'épisode), fausses alertes par heure normale, délai de détection (début de l'épisode
  → première ligne en alarme).

Seuil UNIQUE (un seul point de fonctionnement, plus de « deux seuils ») choisi sur la
VALIDATION, avec la règle de persistance (k, n), par le critère :

    maximiser le rappel (lignes) de l'alarme
    sous les contraintes  précision ≥ PRECISION_MIN  et  fausses alertes/h ≤ FA_MAX

C'est le point de fonctionnement d'un opérateur : au plus une fausse alerte toutes les
FA_MAX⁻¹ heures, et au moins PRECISION_MIN des lignes signalées sont de vraies attaques ;
à ces conditions, on détecte le plus possible. Si aucune combinaison ne respecte les deux
contraintes sur la validation, on prend celle qui a le moins de fausses alertes/h parmi
celles de précision maximale (c'est écrit dans le résultat : « contrainte_tenue »).

La règle de persistance regarde n lignes en arrière : la zone de garde du découpage
(transmission_real.GUARD) couvre la plus longue fenêtre des features PLUS n_max.
"""
from __future__ import annotations

import os
import re

import numpy as np

STEPS_HOUR = 720
STEP_MINUTES = 5 / 60

PRECISION_MIN = float(os.environ.get("PRECISION_MIN", "0.90"))
FA_MAX = float(os.environ.get("FA_MAX", "0.5"))          # fausses alertes par heure normale
# Règles de persistance essayées (k sur n lignes de 5 s) : n ≤ 36 lignes = 3 min
DEBOUNCE_GRID = ((1, 1), (3, 6), (6, 12), (12, 24), (18, 24), (24, 36), (30, 36))
N_MAX = max(n for _, n in DEBOUNCE_GRID)
# Seuils essayés : pas de 0,01 de 0,05 à 0,95, puis plus fin près de 1 (les modèles à boosting
# donnent des probabilités très proches de 0 ou de 1).
THRESHOLD_GRID = tuple(sorted({round(float(t), 3) for t in np.linspace(0.05, 0.95, 91)}
                              | {0.96, 0.97, 0.98, 0.985, 0.99, 0.993, 0.995, 0.997, 0.998, 0.999}))


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] debounce
#   Rôle   : RÈGLE DE PERSISTANCE (anti-rebond) : l'alarme ne sonne que si au moins k des n dernières mesures
#            dépassent le seuil. Évite les fausses alertes isolées.
#   Entrée : flags : vrai/faux « au-dessus du seuil » ; k, n : règle
#   Sortie : vrai/faux « en alarme » par ligne
# ──────────────────────────────────────────────────────────────────────
def debounce(flags: np.ndarray, k: int, n: int) -> np.ndarray:
    """alarme(t) = au moins k lignes signalées parmi les n dernières (t inclus). Causal."""
    flags = np.asarray(flags, dtype=bool)
    if k <= 1 and n <= 1:
        return flags.copy()
    c = np.concatenate([[0], np.cumsum(flags, dtype=np.int64)])
    t = np.arange(len(flags))
    lo = np.maximum(0, t - n + 1)
    return (c[t + 1] - c[lo]) >= k


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] alert_events
#   Rôle   : Regroupe les lignes en alarme consécutives en ALERTES (début, fin).
#   Entrée : alarm : alarme par ligne ; evaluated : lignes comptées
#   Sortie : liste de (début, fin)
# ──────────────────────────────────────────────────────────────────────
def alert_events(alarm: np.ndarray, evaluated: np.ndarray) -> list[tuple[int, int]]:
    """Alertes = suites continues de lignes en alarme parmi les lignes évaluées : [début, fin)."""
    a = np.asarray(alarm, dtype=bool) & np.asarray(evaluated, dtype=bool)
    if not a.any():
        return []
    d = np.diff(np.concatenate([[0], a.astype(np.int8), [0]]))
    return list(zip(np.where(d == 1)[0].tolist(), np.where(d == -1)[0].tolist()))


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] count
#   Rôle   : COMPTE ce qui s'est passé dans une répétition : vrais/faux positifs, épisodes détectés, fausses
#            alertes, délai de détection.
#   Entrée : alarm, y, evaluated : alarme, vérité, lignes comptées ; episodes, role, types, names : infos des
#            attaques
#   Sortie : comptes bruts (à cumuler avec pool)
# ──────────────────────────────────────────────────────────────────────
def count(alarm: np.ndarray, y: np.ndarray, evaluated: np.ndarray, episodes: list[dict], role: str,
          types: np.ndarray | None = None, names: list[str] | None = None) -> dict:
    """Comptes bruts d'une répétition, sur les lignes évaluées d'un rôle (à cumuler par pool)."""
    alarm = np.asarray(alarm, dtype=bool)
    ev = np.asarray(evaluated, dtype=bool)
    yy = np.asarray(y) == 1
    a = alarm & ev
    out = {"tp": int((a & yy).sum()), "fp": int((a & ~yy).sum()), "fn": int((~a & yy & ev).sum()),
           "tn": int((~a & ~yy & ev).sum()), "nominal_hours": float((ev & ~yy).sum() / STEPS_HOUR),
           "alertes": 0, "fausses_alertes": 0, "delays": [], "per_attack": {}, "per_episode": {},
           "delays_per_attack": {}}
    for s, e in alert_events(alarm, ev):
        out["alertes"] += 1
        if not yy[s:e].any():
            out["fausses_alertes"] += 1
    names = names or sorted({e["name"] for e in episodes})
    for nm in names:
        out["per_episode"][nm] = [0, 0]
        out["delays_per_attack"][nm] = []
        if types is not None:
            m = ev & (types == nm)
            out["per_attack"][nm] = [int(m.sum()), int((m & alarm).sum())]
    for e in episodes:
        if e.get("split") != role:
            continue
        seg = alarm[e["start"]:e["end"]]
        pe = out["per_episode"].setdefault(e["name"], [0, 0])
        dl = out["delays_per_attack"].setdefault(e["name"], [])
        pe[0] += 1
        if seg.any():
            pe[1] += 1
            d = int(np.argmax(seg)) * STEP_MINUTES
            out["delays"].append(d)
            dl.append(d)
    return out


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] pool
#   Rôle   : CUMULE les comptes de toutes les répétitions et calcule les métriques finales (rappel,
#            précision, F1, fausses alertes/h, délai médian…).
#   Entrée : runs : comptes de chaque répétition
#   Sortie : dictionnaire de métriques
# ──────────────────────────────────────────────────────────────────────
def pool(runs: list[dict]) -> dict:
    """Cumule les comptes des répétitions et en tire les métriques."""
    tp = sum(r["tp"] for r in runs); fp = sum(r["fp"] for r in runs)
    fn = sum(r["fn"] for r in runs); tn = sum(r["tn"] for r in runs)
    hours = sum(r["nominal_hours"] for r in runs)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    delays = [d for r in runs for d in r["delays"]]
    per_attack, per_episode = {}, {}
    names = list(dict.fromkeys(nm for r in runs for nm in r["per_episode"]))
    for nm in names:
        if any(nm in r["per_attack"] for r in runs):
            n = sum(r["per_attack"].get(nm, [0, 0])[0] for r in runs)
            d = sum(r["per_attack"].get(nm, [0, 0])[1] for r in runs)
            per_attack[nm] = {"n": n, "detected": d, "rate": round(100 * d / max(1, n), 1)}
        ne = sum(r["per_episode"].get(nm, [0, 0])[0] for r in runs)
        de = sum(r["per_episode"].get(nm, [0, 0])[1] for r in runs)
        dl = [x for r in runs for x in r["delays_per_attack"].get(nm, [])]
        per_episode[nm] = {"n": ne, "detected": de,
                           "delai_median_min": round(float(np.median(dl)), 1) if dl else None}
    fa = sum(r["fausses_alertes"] for r in runs)
    alerts = sum(r["alertes"] for r in runs)
    return {
        "recall": round(recall, 4), "precision": round(precision, 4),
        "f1": round(2 * tp / (2 * tp + fp + fn), 4) if 2 * tp + fp + fn else 0.0,
        "fpr": round(fp / (fp + tn), 5) if fp + tn else 0.0,
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "part_attaques": round((tp + fn) / max(1, tp + fp + fn + tn), 4),
        "heures_normales": round(hours, 2),
        "alertes": alerts, "fausses_alertes": fa,
        "precision_alertes": round((alerts - fa) / alerts, 4) if alerts else None,
        "fausses_alarmes_evenements_par_heure": round(fa / max(1e-9, hours), 3),
        "episodes": sum(v["n"] for v in per_episode.values()),
        "episodes_detectes": sum(v["detected"] for v in per_episode.values()),
        "delai_median_min": round(float(np.median(delays)), 1) if delays else None,
        "delai_p90_min": round(float(np.percentile(delays, 90)), 1) if delays else None,
        "per_attack": per_attack, "per_episode": per_episode,
    }


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _fast_counts
#   Rôle   : Version rapide du comptage, utilisée pour tester des milliers de réglages.
#   Entrée : alarm, yy, ev
#   Sortie : (vp, fp, fn, vn, fausses alertes/h)
# ──────────────────────────────────────────────────────────────────────
def _fast_counts(alarm, yy, ev) -> tuple[int, int, int, int, float]:
    a = alarm & ev
    tp = int((a & yy).sum()); fp = int((a & ~yy).sum()); fn = int((~a & yy & ev).sum())
    nfa = 0
    for s, e in alert_events(alarm, ev):
        if not yy[s:e].any():
            nfa += 1
    return tp, fp, fn, nfa, float((ev & ~yy).sum() / STEPS_HOUR)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] grid
#   Rôle   : ESSAIE TOUS LES RÉGLAGES (seuil × règle k sur n) sur la validation et note leurs résultats.
#   Entrée : scored : scores, étiquettes, masques ; role : rôle évalué
#   Sortie : une ligne de résultats par réglage
# ──────────────────────────────────────────────────────────────────────
def grid(scored: list[dict], role: str = "val", thresholds=THRESHOLD_GRID, debounces=DEBOUNCE_GRID) -> list[dict]:
    """Toutes les combinaisons (seuil, k, n) sur les lignes d'un rôle, cumulées sur les répétitions.
    scored : [{"s": scores, "y": étiquettes, "evaluated_<role>": masque}, …]"""
    rows = []
    prepared = [(np.asarray(r["s"], float), np.asarray(r["y"]) == 1, np.asarray(r[f"evaluated_{role}"], bool))
                for r in scored]
    for k, n in debounces:
        for thr in thresholds:
            tp = fp = fn = nfa = 0
            hours = 0.0
            for s, yy, ev in prepared:
                c = _fast_counts(debounce(s >= thr, k, n), yy, ev)
                tp += c[0]; fp += c[1]; fn += c[2]; nfa += c[3]; hours += c[4]
            p = tp / (tp + fp) if tp + fp else 0.0
            r = tp / (tp + fn) if tp + fn else 0.0
            rows.append({"seuil": float(thr), "k": k, "n": n, "precision": round(p, 4), "recall": round(r, 4),
                         "f1": round(2 * p * r / (p + r), 4) if p + r else 0.0,
                         "fa_h": round(nfa / max(1e-9, hours), 3)})
    return rows


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] choose
#   Rôle   : CHOISIT LE RÉGLAGE : rappel maximal avec précision ≥ 90 % et ≤ 0,5 fausse alerte/h. Si aucun ne
#            tient, prend le plus prudent et l'indique (contrainte_tenue = False).
#   Entrée : rows : résultats de grid ; precision_min, fa_max : contraintes
#   Sortie : le réglage retenu
# ──────────────────────────────────────────────────────────────────────
def choose(rows: list[dict], precision_min: float = PRECISION_MIN, fa_max: float = FA_MAX) -> dict:
    """Critère unique : rappel maximal sous précision ≥ precision_min et FA/h ≤ fa_max (validation).
    Égalités : moins de fausses alertes/h, puis n le plus court (réaction plus rapide), puis seuil haut."""
    ok = [r for r in rows if r["precision"] >= precision_min and r["fa_h"] <= fa_max and r["recall"] > 0]
    if ok:
        best = max(ok, key=lambda r: (r["recall"], -r["fa_h"], -r["n"], r["seuil"]))
        return {**best, "contrainte_tenue": True}
    cand = [r for r in rows if r["recall"] > 0] or rows
    best = min(cand, key=lambda r: (r["fa_h"], -r["precision"], -r["recall"]))
    return {**best, "contrainte_tenue": False}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] apply
#   Rôle   : Applique un réglage aux scores : seuil puis règle de persistance.
#   Entrée : scores : scores du modèle ; op : réglage
#   Sortie : alarme par ligne
# ──────────────────────────────────────────────────────────────────────
def apply(scores: np.ndarray, op: dict) -> np.ndarray:
    """Alarme d'un modèle à son point de fonctionnement (seuil, k, n)."""
    return debounce(np.asarray(scores, float) >= op["seuil"], int(op["k"]), int(op["n"]))


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] criterion_text
#   Rôle   : Phrase qui explique le critère de choix (affichée sur le site et dans les JSON).
#   Entrée : contraintes
#   Sortie : texte
# ──────────────────────────────────────────────────────────────────────
def criterion_text(precision_min: float = PRECISION_MIN, fa_max: float = FA_MAX) -> str:
    text = (f"seuil unique et règle de persistance (k sur n lignes) choisis sur la validation : rappel maximal "
            f"sous les contraintes précision ≥ {precision_min:.2f} et fausses alertes ≤ {fa_max:g} par heure")
    return re.sub(r"(\d)\.(\d)", r"\1,\2", text)
