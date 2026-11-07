# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/scripts/transmission_biais_long.py
#   ÉTUDE COMPLÉMENTAIRE. À partir de quelle durée les petits biais (−0,5 / −1 °C) deviennent
#   détectables.
# ══════════════════════════════════════════════════════════════════════════
"""
Étude complémentaire : petits biais (−0,5 et −1 °C) LONGS, de 1 à 3 heures
=========================================================================
Dans l'étude principale (transmission_models.py), un épisode dure 15 à 25 min et tient
dans un bloc d'une heure. Les biais −0,5 et −1 °C y sont mal détectés : leur amplitude
est très sous le bruit du frigo (σ ≈ 3,4 °C par mesure, sans mémoire). La question ici :
à partir de quelle DURÉE deviennent-ils détectables ?

Pourquoi une étude séparée. Un épisode de 1 à 3 h ne tient pas dans un bloc d'une heure,
et un épisode à cheval sur deux blocs mettrait la même attaque dans deux rôles (fuite).
On reprend donc le même protocole avec des blocs de 4 h : chaque épisode (1, 2 ou 3 h)
tient ENTIÈREMENT dans son bloc de 4 h, donc dans un seul rôle.
  - 62 h de traces → 15 blocs de 4 h ; cycle de 5 blocs : 3 train / 1 val / 1 test ;
  - 5 rotations du cycle × 2 tirages = 10 répétitions : chaque bloc sert 2 fois de test ;
  - un épisode par bloc ; amplitude −0,5 / −1 °C et durée 1 / 2 / 3 h en alternance ;
  - 60 min après chaque épisode exclues de l'évaluation (fenêtres glissantes jusqu'à 1 h).
Modèle : Random Forest (mêmes réglages que l'étude principale, class_weight équilibré),
avec deux jeux de features :
  A. les features de l'étude principale (fenêtres ≤ 15 min, dont min, max et quantiles) ;
  B. A + moyennes glissantes sur 30 et 60 min et EWMA ≈ 1 h de chaque capteur.
Seuil : choisi sur la VALIDATION pour un budget d'au plus 1 fausse alerte par heure
(le seuil le plus bas qui le respecte), appliqué tel quel au test.
Résultat : par amplitude et par durée, épisodes détectés et délai médian ; part des
épisodes détectés en moins de 20, 60, 120 et 180 min.

Ce n'est qu'une petite étude (30 épisodes de test au total) : elle donne un ordre de
grandeur, pas un chiffre de production.

Sortie : models/transmission_reel/biais_long.json
Usage :  cd backend && nice -n 10 .venv/bin/python scripts/transmission_biais_long.py
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import time
from pathlib import Path

for _flux in (sys.stdout, sys.stderr):
    try:
        _flux.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import numpy as np
from sklearn.metrics import roc_auc_score

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import build_dataset as bd  # noqa: E402
import transmission_models as tm  # noqa: E402
import transmission_real as tr  # noqa: E402

SEED = tr.SEED + 100
BLOCK = 4 * tr.STEPS_HOUR            # blocs de 4 h
CYCLE = 5                            # 3 train / 1 val / 1 test
TRAIN_BLOCKS, VAL_BLOCKS = 3, 1
N_DRAWS = 2                          # 2 tirages par rotation → 10 répétitions
AMPLITUDES = (-0.5, -1.0)
DURATIONS_H = (1, 2, 3)
GUARD = tr.STEPS_HOUR                # 60 min exclues après chaque épisode
FA_BUDGET = 1.0                      # fausses alertes par heure tolérées sur la validation
HORIZONS_MIN = (20, 60, 120, 180)
OUT_PATH = tr.OUT_DIR / "biais_long.json"
log = tr.log

LONG_WINDOWS = {"30min": 360, "60min": 720}
EWMA_1H = 2 / (720 + 1)


def role_of_block(block: int, rot: int) -> str:
    r = (block + rot) % CYCLE
    return "train" if r < TRAIN_BLOCKS else ("val" if r < TRAIN_BLOCKS + VAL_BLOCKS else "test")


def block_roles(n: int, rot: int) -> np.ndarray:
    return np.array([role_of_block(b, rot) for b in np.arange(n) // BLOCK], dtype=object)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] schedule
#   Rôle   : Place un épisode de biais par bloc de 4 h.
#   Entrée : n, rng, rot, draw
#   Sortie : liste d'épisodes
# ──────────────────────────────────────────────────────────────────────
def schedule(n: int, rng: np.random.Generator, rot: int, draw: int) -> list[dict]:
    """Un épisode de biais par bloc de 4 h, entièrement dans le bloc."""
    episodes = []
    for k in range(n // BLOCK):
        amp = AMPLITUDES[(k + draw) % len(AMPLITUDES)]
        dur = DURATIONS_H[(k + rot + draw) % len(DURATIONS_H)] * tr.STEPS_HOUR
        s = k * BLOCK + int(rng.integers(12, BLOCK - dur - 12 + 1))
        episodes.append({"name": f"Biais_long_{abs(amp)}", "sensor": "fridge", "kind": "biais", "param": amp,
                         "duree_h": dur // tr.STEPS_HOUR, "start": s, "end": s + dur,
                         "split": role_of_block(k, rot)})
    return episodes


def long_features(df) -> list[str]:
    feats = []
    for s in tm.SENSORS:
        x = df[f"{s}_temp"]
        for tag, w in LONG_WINDOWS.items():
            df[f"{s}_mean_{tag}"] = x.rolling(w, min_periods=1).mean()
            feats.append(f"{s}_mean_{tag}")
        df[f"{s}_ewma_1h"] = x.ewm(alpha=EWMA_1H, adjust=False).mean()
        feats.append(f"{s}_ewma_1h")
    return feats


def fa_events_per_hour(pred: np.ndarray, y: np.ndarray, idx: np.ndarray) -> float:
    fa = np.zeros(len(y), dtype=bool)
    fa[idx] = pred[idx] & (y[idx] == 0)
    events = int((fa & ~np.r_[False, fa[:-1]]).sum())
    return events / max(1e-9, (y[idx] == 0).sum() / tr.STEPS_HOUR)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] budget_threshold
#   Rôle   : Seuil le plus bas qui garde les fausses alertes sous le budget autorisé.
#   Entrée : s, y, val_idx
#   Sortie : seuil
# ──────────────────────────────────────────────────────────────────────
def budget_threshold(s: np.ndarray, y: np.ndarray, val_idx: np.ndarray) -> float:
    """Seuil le plus bas dont les fausses alertes de validation restent ≤ FA_BUDGET par heure."""
    normal = s[val_idx][y[val_idx] == 0]
    for q in (0.90, 0.95, 0.98, 0.99, 0.995, 0.998, 0.999, 0.9995, 1.0):
        thr = float(np.quantile(normal, q))
        if q == 1.0:
            thr = np.nextafter(thr, np.inf)
        if fa_events_per_hour(s >= thr, y, val_idx) <= FA_BUDGET:
            return thr
    return float("inf")


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] one_run
#   Rôle   : Une répétition de l'étude des biais longs : injection, entraînement, mesure.
#   Entrée : base, rot, draw
#   Sortie : résultats de la répétition
# ──────────────────────────────────────────────────────────────────────
def one_run(base, rot: int, draw: int) -> dict:
    run = draw * CYCLE + rot
    rng = np.random.default_rng(SEED + run)
    episodes = schedule(len(base), rng, rot, draw)
    df = tr.inject(base, episodes, rng, run)
    garde = np.zeros(len(df), dtype=bool)
    for ep in episodes:
        garde[ep["end"]:ep["end"] + GUARD] = True
    df, feats_a = tm.engineer(df)
    feats_b = feats_a + long_features(df)
    y = df["label"].to_numpy().astype(int)
    roles = block_roles(len(df), rot)
    train_idx = np.where((roles == "train") & ~garde)[0]
    val_idx = np.where((roles == "val") & ~garde)[0]
    test_idx = np.where((roles == "test") & ~garde)[0]
    out = {"run": run, "episodes": [e for e in episodes if e["split"] == "test"], "jeux": {}}
    for jeu, feats in (("A", feats_a), ("B", feats_b)):
        X = df[feats].to_numpy(float)
        model = tm.make_random_forest().fit(X[train_idx], y[train_idx])
        s = model.predict_proba(X)[:, 1]
        thr = budget_threshold(s, y, val_idx)
        pred = s >= thr
        eps = []
        for ep in out["episodes"]:
            seg = pred[ep["start"]:ep["end"]]
            eps.append({"amplitude": ep["param"], "duree_h": ep["duree_h"], "detecte": bool(seg.any()),
                        "delai_min": round(int(np.argmax(seg)) * tr.STEP_MINUTES, 1) if seg.any() else None,
                        "part_lignes_signalees": round(float(seg.mean()), 3)})
        out["jeux"][jeu] = {"seuil": thr, "episodes": eps,
                            "fa_h_val": round(fa_events_per_hour(pred, y, val_idx), 2),
                            "fa_h_test": round(fa_events_per_hour(pred, y, test_idx), 2),
                            "normal_h_test": float((y[test_idx] == 0).sum() / tr.STEPS_HOUR),
                            "auc_test": float(roc_auc_score(y[test_idx], s[test_idx]))}
    return out


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] summarize
#   Rôle   : Cumule les répétitions et calcule les métriques.
#   Entrée : runs, jeu
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
def summarize(runs: list[dict], jeu: str) -> dict:
    eps = [e for r in runs for e in r["jeux"][jeu]["episodes"]]
    hours = sum(r["jeux"][jeu]["normal_h_test"] for r in runs)
    fa = sum(r["jeux"][jeu]["fa_h_test"] * r["jeux"][jeu]["normal_h_test"] for r in runs)
    out = {"fa_h_test": round(fa / max(1e-9, hours), 2),
           "auc_test_moyenne": round(float(np.mean([r["jeux"][jeu]["auc_test"] for r in runs])), 3),
           "par_amplitude": {}}
    for amp in AMPLITUDES:
        sub = [e for e in eps if e["amplitude"] == amp]
        par_duree = {}
        for d in DURATIONS_H:
            dd = [e for e in sub if e["duree_h"] == d]
            delays = [e["delai_min"] for e in dd if e["detecte"]]
            par_duree[f"{d}h"] = {"n": len(dd), "detectes": len(delays),
                                  "delai_median_min": round(float(np.median(delays)), 1) if delays else None}
        horizons = {}
        for h in HORIZONS_MIN:
            elig = [e for e in sub if e["duree_h"] * 60 >= h]      # épisodes assez longs pour cet horizon
            ok = [e for e in elig if e["detecte"] and e["delai_min"] <= h]
            horizons[str(h)] = {"n": len(elig), "detectes": len(ok),
                                "part": round(len(ok) / len(elig), 3) if elig else None}
        delays = [e["delai_min"] for e in sub if e["detecte"]]
        out["par_amplitude"][f"{amp}"] = {
            "n": len(sub), "detectes": len(delays),
            "delai_median_min": round(float(np.median(delays)), 1) if delays else None,
            "par_duree": par_duree, "detectes_avant_min": horizons,
        }
    return out


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] main
#   Rôle   : ÉTUDE COMPLÉMENTAIRE : mesure à partir de quelle durée (1 à 3 h) les petits biais −0,5 et −1 °C
#            deviennent détectables.
#   Entrée : rien
#   Sortie : fichier JSON de résultats
# ──────────────────────────────────────────────────────────────────────
def main() -> None:
    t0 = time.time()
    log("[1] Traces réelles TON_IoT")
    with contextlib.redirect_stdout(io.StringIO()):
        real = bd.load_normal_traces()
    base, fusion = tr.fuse_real(real)
    n_blocks = len(base) // BLOCK
    log(f"    {len(base):,} lignes → {n_blocks} blocs de 4 h ; {CYCLE} rotations × {N_DRAWS} tirages")
    runs = []
    for draw in range(N_DRAWS):
        for rot in range(CYCLE):
            with contextlib.redirect_stdout(io.StringIO()):
                r = one_run(base, rot, draw)
            runs.append(r)
            log(f"    répétition {r['run']} : " + " | ".join(
                f"{j} : {sum(e['detecte'] for e in v['episodes'])}/{len(v['episodes'])} épisodes de test, "
                f"FA/h test {v['fa_h_test']:.2f}" for j, v in r["jeux"].items()))
    res = {j: summarize(runs, j) for j in ("A", "B")}

    print()
    print("Petits biais LONGS (épisodes de test cumulés) — seuil : ≤ 1 fausse alerte/h sur la validation")
    for j, lib in (("A", "features de l'étude principale (≤ 15 min)"), ("B", "+ moyennes 30 / 60 min, EWMA 1 h")):
        print(f"  Jeu {j} ({lib}) : FA/h test {res[j]['fa_h_test']:.2f}, AUC test {res[j]['auc_test_moyenne']:.3f}")
        for amp, v in res[j]["par_amplitude"].items():
            dur = ", ".join(f"{d} {x['detectes']}/{x['n']}" for d, x in v["par_duree"].items())
            hor = ", ".join(f"≤{h} min {x['detectes']}/{x['n']}" for h, x in v["detectes_avant_min"].items())
            print(f"    biais {amp} °C : {v['detectes']}/{v['n']} détectés (délai médian {v['delai_median_min']} min)"
                  f" | par durée : {dur} | {hor}")

    out = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "duree_s": round(time.time() - t0, 1),
        "protocole": {
            "blocs": "blocs de 4 h, cycle de 5 (3 train / 1 val / 1 test) ; chaque épisode tient dans son bloc, "
                     "donc dans un seul rôle",
            "repetitions": len(runs), "blocs_par_repetition": n_blocks,
            "episodes": "un biais par bloc, amplitude −0,5 / −1 °C, durée 1 / 2 / 3 h en alternance",
            "modele": "Random Forest (réglages de l'étude principale)",
            "seuil": f"le plus bas qui garde ≤ {FA_BUDGET:g} fausse alerte/h sur la validation",
            "zone_de_garde_min": GUARD * 5 // 60,
        },
        "jeux_features": {"A": "features de l'étude principale (fenêtres ≤ 15 min, dont min, max et quantiles)",
                          "B": "A + moyennes glissantes 30 et 60 min, EWMA ≈ 1 h, par capteur"},
        "resultats": res,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False, default=tr._json_default)
    log(f"Résultats : {OUT_PATH} ({time.time() - t0:.0f} s)")


if __name__ == "__main__":
    if os.environ.get("N_JOBS") is None:
        tm.N_JOBS = 3
    main()
