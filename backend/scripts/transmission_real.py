"""
Attaques de transmission sur les TRACES RÉELLES TON_IoT — sans année simulée
==========================================================================
Consigne : travailler uniquement sur les données disponibles (3 traces normales,
31 mars → 4 avril 2019), y injecter des attaques de transmission, puis entraîner.

1. Fusion des trois capteurs sur une grille régulière de 5 s (moyenne par pas,
   trous < 1 min comblés par la dernière valeur, le reste supprimé) :
   data/processed/dataset_transmission_reel.csv
2. Découpage train / val / test NON aléatoire (70 / 15 / 15) par blocs d'une heure
   entrelacés. Le découpage est calculé AU MOMENT DE L'ENTRAÎNEMENT (fonction
   `block_split`) et n'est plus écrit dans le jeu de données. Une attaque de 15 à
   25 min tient ENTIÈREMENT dans un bloc : aucune attaque n'est coupée entre deux
   rôles (pas de fuite temporelle). Un épisode dans CHAQUE bloc porte le jeu de
   données à ~33 % d'attaques, partout (train, val et test). 7 scénarios (le
   « masquage » n'a pas de sens ici : ces traces n'ont pas d'excursion réelle). Les
   traces ne durent que 62 h : l'étude est donc RÉPÉTÉE 9 fois en faisant tourner les
   rôles des blocs et les scénarios, et les résultats sont cumulés (chaque heure sert
   de test, chaque scénario a ~5 épisodes).
3. Même protocole que transmission_study.py (seuil = max F1 sur la validation de
   chaque répétition) : les 4 modèles de la phase 2
   réentraînés, et un détecteur STATISTIQUE par capteur — A : capteur figé,
   L : niveau (EWMA), V : dispersion (EWMA du carré des écarts), R : séquence déjà
   vue (rejeu exact).

Ce que sont ces traces : du bruit sans mémoire (frigo uniforme 1–14 °C, thermostat
25 °C avec sauts, météo cycle de 5 valeurs), sans relation physique entre capteurs.
Le canal « désaccord salle↔frigo » de transmission_study.py n'a donc pas de base ici.

Sorties : data/processed/dataset_transmission_reel.csv (répétition 0),
          models/transmission_reel/resultats_transmission_reel.json, detecteur_statistique.json
Usage :  cd backend && .venv/bin/python scripts/transmission_real.py
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
import time
import traceback
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.preprocessing import StandardScaler

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import build_dataset as bd  # noqa: E402
import train_models as tm  # noqa: E402
import transmission_study as ts  # noqa: E402
from app.api.v1 import phase2  # noqa: E402
from app.core import paths  # noqa: E402

SEED = 2019
STEP = "5s"
STEPS_HOUR = 720
STEPS_DAY = 24 * STEPS_HOUR
STEP_MINUTES = 5 / 60
MAX_GAP = 12                    # trous ≤ 1 min comblés par la dernière valeur
GUARD = 60                      # 5 min après chaque épisode exclues de l'évaluation
EP_MIN, EP_MAX = 180, 300       # durée d'un épisode : 15 à 25 min (≈ 33 % d'un bloc)
N_RUNS = 9                      # répétitions : rotation des rôles des blocs et des scénarios
FEATURES = phase2.FEATURE_COLS
OUT_DIR = paths.MODELS_DIR / "transmission_reel"
DATASET_PATH = paths.PROCESSED_DIR / "dataset_transmission_reel.csv"

F_SET, F_NOISE = 7.0, 0.35      # injection « nominale » : valeurs forgées autour de la consigne
RANGE = {"fridge": (1.0, 14.0), "thermostat": (25.0, 35.0)}   # plages observées dans les traces

# Périmètre : les biais faibles -0.5 °C et -1.0 °C ont été RETIRÉS du périmètre d'étude
# (amplitude sous le bruit du capteur ±3.4 °C : AUC ≈ 0.64 et 0.82, quasi indétectables).
# Ils sont conservés dans l'historique (Soutenance/) comme limite connue du système.
ATTACKS = [
    ("MITM_gel",                   "fridge",     "gel",      None),   # dernière valeur rejouée en boucle
    ("MITM_rejeu",                 "fridge",     "rejeu",    None),   # fenêtre passée (≥ 1 h plus tôt) rejouée
    ("Injection_nominale",         "fridge",     "nominale", None),   # valeurs forgées ~7 °C, peu bruitées
    ("Injection_biais_2.0",        "fridge",     "biais",    -2.0),
    ("Injection_derive",           "fridge",     "derive",   -2.0),   # rampe lente 0 → -2 °C
    ("MITM_gel_thermostat",        "thermostat", "gel",      None),
    ("Injection_biais_thermostat", "thermostat", "biais",    -1.5),
]
ATTACK_NAMES = [a[0] for a in ATTACKS]

log = ts.log


PHASE2_ONLY_COLS = ("hour_sin", "hour_cos", "season_sin", "season_cos")


def drop_phase2_cols(df: pd.DataFrame) -> pd.DataFrame:
    """Retire les colonnes héritées du pré-calcul phase2 (heure, saison, moyennes et
    écarts glissants sur 10 pas). Elles ne font pas partie des 35 features du modèle
    de transmission : on garde un jeu de données propre et reproductible."""
    cols = [c for c in df.columns if c.endswith(("_roll_mean_10", "_roll_std_10"))]
    cols += [c for c in PHASE2_ONLY_COLS if c in df.columns]
    return df.drop(columns=cols, errors="ignore")


# ════════════════════════════════════════════════════════════════════════════
# 1. Jeu de données : traces réelles fusionnées + attaques de transmission
# ════════════════════════════════════════════════════════════════════════════

def fuse_real(real: dict[str, pd.DataFrame]) -> tuple[pd.DataFrame, dict]:
    """Les trois traces sur une grille commune de 5 s."""
    cols = {"weather": "temperature", "fridge": "fridge_temperature", "thermostat": "current_temperature"}
    series = {f"{s}_temp": real[s].set_index("datetime")[c].resample(STEP).mean() for s, c in cols.items()}
    series["fridge_cond"] = real["fridge"].set_index("datetime")["temp_condition"].resample(STEP).last()
    series["thermo_status"] = real["thermostat"].set_index("datetime")["thermostat_status"].resample(STEP).max()
    df = pd.DataFrame(series)
    n_grid = len(df)
    df = df.ffill(limit=MAX_GAP)
    df = df.dropna(subset=["weather_temp", "fridge_temp", "thermostat_temp"]).reset_index()
    df["fridge_cond"] = df["fridge_cond"].fillna("low")
    df["thermo_status"] = df["thermo_status"].fillna(0).astype(int)
    for c in ("weather_temp", "fridge_temp", "thermostat_temp"):
        df[c] = df[c].round(2)
    info = {"pas": STEP, "pas_grille": int(n_grid), "pas_conserves": int(len(df)),
            "debut": str(df["datetime"].iloc[0]), "fin": str(df["datetime"].iloc[-1])}
    return df, info


def profile(df: pd.DataFrame) -> dict:
    """Ce que sont ces traces : niveau, dispersion, mémoire (autocorrélation) et lien entre capteurs."""
    out = {}
    for s in ("weather", "fridge", "thermostat"):
        x = df[f"{s}_temp"]
        out[s] = {"moyenne": round(float(x.mean()), 2), "ecart_type": round(float(x.std()), 2),
                  "autocorr_5s": round(float(x.autocorr(1)), 3), "autocorr_1min": round(float(x.autocorr(12)), 3)}
    out["correlation_frigo_salle_meteo_fixee"] = round(
        ts._partial_corr(df["fridge_temp"], df["thermostat_temp"], df["weather_temp"]), 3)
    return out


# Découpage train / val / test : NON aléatoire, 70 / 15 / 15.
# On découpe les heures en blocs entrelacés : sur un cycle de 20 blocs consécutifs,
# 14 vont au train, 3 à la validation et 3 au test. Comme une attaque tient
# ENTIÈREMENT dans un bloc d'une heure, aucune attaque n'est jamais coupée entre
# deux rôles (pas de fuite temporelle). `run` décale le motif d'un cran à chaque
# répétition (rôles tournants de l'étude cumulée) : le découpage reste déterministe.
BLOCK_CYCLE = 20
TRAIN_BLOCKS = 14          # 14/20 = 70 %
VAL_BLOCKS = 3             # 3/20 = 15 %  (le reste, 3/20 = 15 %, part au test)


def role_of_block(block: int, run: int = 0) -> str:
    r = (block + run) % BLOCK_CYCLE
    if r < TRAIN_BLOCKS:
        return "train"
    return "val" if r < TRAIN_BLOCKS + VAL_BLOCKS else "test"


def block_split(n: int, run: int = 0) -> np.ndarray:
    """Rôle (train / val / test) de CHAQUE ligne, déduit de son bloc horaire.
    Le découpage n'est plus stocké dans le jeu de données : il est recalculé ICI,
    au moment de l'entraînement. Non aléatoire et reproductible : mêmes blocs,
    mêmes rôles à chaque exécution."""
    return np.array([role_of_block(i // STEPS_HOUR, run) for i in range(n)], dtype=object)


def build_schedule(n: int, rng: np.random.Generator, run: int = 0,
                   roles: tuple[str, ...] = ("val", "test")) -> list[dict]:
    """Un épisode dans CHAQUE bloc des rôles demandés ; les scénarios tournent avec la
    répétition, pour que chacun soit testé plusieurs fois. Les modèles supervisés
    (transmission_models.py) demandent des attaques dans tous les rôles :
    roles=("train", "val", "test"). Un épisode dans chaque bloc d'une heure porte le
    jeu de données à ~33 % d'attaques (durée 15 à 25 min par épisode)."""
    episodes, counters = [], {r: run for r in roles}
    for block in range(n // STEPS_HOUR):
        role = role_of_block(block, run)
        if role not in counters:
            continue
        s = block * STEPS_HOUR + int(rng.integers(12, STEPS_HOUR - EP_MAX - 12))
        e = s + int(rng.integers(EP_MIN, EP_MAX + 1))
        name, sensor, kind, param = ATTACKS[counters[role] % len(ATTACKS)]
        counters[role] += 1
        episodes.append({"name": name, "sensor": sensor, "kind": kind, "param": param,
                         "start": s, "end": e, "split": role})
    return episodes


def inject(df: pd.DataFrame, episodes: list[dict], rng: np.random.Generator, run: int = 0) -> pd.DataFrame:
    n = len(df)
    cols = {"fridge": "fridge_temp", "thermostat": "thermostat_temp"}
    true = {s: df[c].to_numpy(float) for s, c in cols.items()}
    tx = {s: v.copy() for s, v in true.items()}
    label = np.zeros(n, dtype=int)
    attack_type = np.full(n, "normal", dtype=object)
    cible = np.full(n, "", dtype=object)
    garde = np.zeros(n, dtype=bool)
    for ep in episodes:
        s, e, kind, sensor = ep["start"], ep["end"], ep["kind"], ep["sensor"]
        lo, hi = RANGE[sensor]
        x, x_true = tx[sensor], true[sensor]
        if kind == "gel":
            x[s:e] = x_true[s - 1]
        elif kind == "rejeu":
            src = int(rng.integers(0, max(1, s - (e - s) - STEPS_HOUR)))
            x[s:e] = x_true[src:src + (e - s)]
        elif kind == "nominale":
            x[s:e] = np.clip(F_SET + bd._ar1(e - s, 0.3, F_NOISE, rng), lo, hi)
        elif kind == "biais":
            x[s:e] = np.clip(x_true[s:e] + ep["param"], lo, hi)
        elif kind == "derive":
            x[s:e] = np.clip(x_true[s:e] + ep["param"] * np.linspace(0.0, 1.0, e - s), lo, hi)
        label[s:e] = 1
        attack_type[s:e] = ep["name"]
        cible[s:e] = sensor
        garde[e:e + GUARD] = True

    out = df.copy()
    out["fridge_temp"] = np.round(tx["fridge"], 2)
    out["thermostat_temp"] = np.round(tx["thermostat"], 2)
    out["fridge_true"] = np.round(true["fridge"], 2)
    out["thermostat_true"] = np.round(true["thermostat"], 2)
    out["label"] = label
    out["attack_type"] = attack_type
    out["cible"] = cible
    out["incident"] = 0                      # pas d'incident réel identifiable dans ces traces
    # Le rôle train/val/test n'est PLUS écrit dans le jeu de données : il est recalculé
    # au moment de l'entraînement par block_split() (non aléatoire, 70/15/15, par blocs).
    out["garde"] = garde
    return phase2._engineer_features(out)


# ════════════════════════════════════════════════════════════════════════════
# 2. Détecteur statistique par capteur
# ════════════════════════════════════════════════════════════════════════════

SENSORS = {"fridge": "fridge_temp", "thermostat": "thermostat_temp", "weather": "weather_temp"}
STD_WINDOW = 12             # 1 min : fenêtre du canal A (capteur figé)
HASH_WINDOW = 24            # 2 min de valeurs brutes pour le canal R (rejeu exact)
HASH_MIN_DISTINCT = 8       # une suite constante (thermostat à 25 °C) n'est pas un rejeu
REPLAY_SCORE = 1e3          # le canal R est tout-ou-rien : au-dessus de tout seuil


def _ewma(x: np.ndarray, lam: float) -> np.ndarray:
    return pd.Series(x).ewm(alpha=lam, adjust=False).mean().to_numpy()


def _zscore(v: np.ndarray, train_idx: np.ndarray) -> tuple[np.ndarray, float, float]:
    m, s = float(v[train_idx].mean()), float(v[train_idx].std() or 1e-9)
    return (v - m) / s, m, s


def replay_flags(x: np.ndarray) -> np.ndarray:
    """Vrai quand les HASH_WINDOW dernières valeurs ont déjà été vues telles quelles plus tôt."""
    xr = np.round(x, 2)
    flags = np.zeros(len(x), dtype=bool)
    seen: set[bytes] = set()
    for t in range(HASH_WINDOW - 1, len(x)):
        w = xr[t - HASH_WINDOW + 1:t + 1]
        key = w.tobytes()
        if key in seen and len(np.unique(w)) >= HASH_MIN_DISTINCT:
            flags[t] = True
        seen.add(key)
    return flags


def stat_channels(df: pd.DataFrame, train_idx: np.ndarray, lam: float) -> dict:
    """Quatre canaux par capteur, standardisés sur le normal d'entraînement :
    A capteur figé (log de l'écart-type glissant), L niveau (EWMA de la valeur),
    V dispersion (EWMA du carré des écarts à la moyenne), R séquence déjà vue."""
    params = {"lambda": lam, "std_window": STD_WINDOW, "hash_window": HASH_WINDOW, "capteurs": {}}
    per = {}
    for name, col in SENSORS.items():
        x = df[col].to_numpy(float)
        rs = pd.Series(x).rolling(STD_WINDOW, min_periods=STD_WINDOW).std(ddof=0).to_numpy()
        rs = np.where(np.isnan(rs), np.nanmedian(rs), rs)
        z_a, m_a, s_a = _zscore(np.log(rs + 1e-3), train_idx)
        z_l, m_l, s_l = _zscore(_ewma(x, lam), train_idx)
        mu = float(x[train_idx].mean())
        z_v, m_v, s_v = _zscore(np.log(_ewma((x - mu) ** 2, lam) + 1e-6), train_idx)
        per[name] = {"A": -z_a, "L": np.abs(z_l), "V": np.abs(z_v),
                     "R": replay_flags(x).astype(float) * REPLAY_SCORE}
        params["capteurs"][name] = {
            "moyenne": mu,
            "immobilite": {"log_std_mean": m_a, "log_std_std": s_a},
            "niveau": {"ewma_mean": m_l, "ewma_std": s_l},
            "dispersion": {"log_var_mean": m_v, "log_var_std": s_v},
        }
    channels = {}
    for ch in ("A", "L", "V", "R"):
        channels[ch] = np.column_stack([per[s][ch] for s in SENSORS]).max(axis=1)
    channels["ALV"] = np.maximum.reduce([channels["A"], channels["L"], channels["V"]])
    channels["TOUS"] = np.maximum(channels["ALV"], channels["R"])
    channels["per_sensor"] = {s: np.maximum.reduce([per[s][c] for c in ("A", "L", "V", "R")]) for s in SENSORS}
    channels["params"] = params
    return channels


def stat_detector(df: pd.DataFrame, y: np.ndarray, train_idx: np.ndarray, val_idx: np.ndarray) -> dict:
    best = None
    for lam in (0.005, 0.01, 0.02, 0.05):
        ch = stat_channels(df, train_idx, lam)
        ap = average_precision_score(y[val_idx], ch["TOUS"][val_idx])
        log(f"  statistique : lambda={lam}  AP val {ap:.4f}")
        if best is None or ap > best[0]:
            best = (ap, ch)
    return best[1]


# ════════════════════════════════════════════════════════════════════════════
# 3. Évaluation cumulée sur les répétitions
# ════════════════════════════════════════════════════════════════════════════

def count_run(pred: np.ndarray, df: pd.DataFrame, idx: np.ndarray, episodes: list[dict], split: str) -> dict:
    """Comptes bruts d'une répétition (à cumuler) : lignes, événements, épisodes, délais."""
    y = df["label"].to_numpy()[idx] == 1
    p = pred[idx]
    types = df["attack_type"].to_numpy()[idx]
    fa = np.zeros(len(df), dtype=bool)
    fa[idx] = p & ~y
    out = {"tp": int((p & y).sum()), "fp": int((p & ~y).sum()), "fn": int((~p & y).sum()),
           "tn": int((~p & ~y).sum()), "fa_events": int((fa & ~np.r_[False, fa[:-1]]).sum()),
           "nominal_hours": float((~y).sum() / STEPS_HOUR),
           "per_attack": {nm: [int((types == nm).sum()), int((p & (types == nm)).sum())] for nm in ATTACK_NAMES},
           "per_episode": {nm: [0, 0] for nm in ATTACK_NAMES}, "delays": []}
    for ep in episodes:
        if ep["split"] != split:
            continue
        seg = pred[ep["start"]:ep["end"]]
        out["per_episode"][ep["name"]][0] += 1
        if seg.any():
            out["per_episode"][ep["name"]][1] += 1
            out["delays"].append(int(np.argmax(seg)) * STEP_MINUTES)
    return out


def pool(runs: list[dict]) -> dict:
    """Cumule les comptes des répétitions et en tire les métriques finales."""
    tp = sum(r["tp"] for r in runs); fp = sum(r["fp"] for r in runs)
    fn = sum(r["fn"] for r in runs); tn = sum(r["tn"] for r in runs)
    hours = sum(r["nominal_hours"] for r in runs)
    delays = [d for r in runs for d in r["delays"]]
    per_attack, per_episode = {}, {}
    for nm in ATTACK_NAMES:
        n = sum(r["per_attack"][nm][0] for r in runs); d = sum(r["per_attack"][nm][1] for r in runs)
        per_attack[nm] = {"n": n, "detected": d, "rate": round(100 * d / max(1, n), 1)}
        ne = sum(r["per_episode"][nm][0] for r in runs); de = sum(r["per_episode"][nm][1] for r in runs)
        per_episode[nm] = {"n": ne, "detected": de}
    return {
        "precision": round(tp / (tp + fp), 4) if tp + fp else 0.0,
        "recall": round(tp / (tp + fn), 4) if tp + fn else 0.0,
        "f1": round(2 * tp / (2 * tp + fp + fn), 4) if 2 * tp + fp + fn else 0.0,
        "fpr": round(fp / (fp + tn), 5) if fp + tn else 0.0,
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "fausses_alarmes_evenements_par_heure": round(sum(r["fa_events"] for r in runs) / max(1e-9, hours), 2),
        "episodes": sum(v["n"] for v in per_episode.values()),
        "episodes_detectes": sum(v["detected"] for v in per_episode.values()),
        "delai_median_min": round(float(np.median(delays)), 1) if delays else None,
        "per_attack": per_attack, "per_episode": per_episode,
    }


def print_tables(results: dict) -> None:
    keys = list(results)
    print()
    print("═" * 112)
    print(f"ATTAQUES DE TRANSMISSION SUR LES TRACES RÉELLES — test cumulé sur {N_RUNS} répétitions "
          "(seuil : max F1 sur la validation de chaque répétition)")
    print("═" * 112)
    print(f"{'Détecteur':28s} {'AUC':>6s} {'AP':>6s} {'Préc.':>6s} {'Rappel':>7s} {'F1':>6s} "
          f"{'FA/h':>6s} {'Épisodes':>9s} {'Délai méd.':>11s}")
    for k in keys:
        r = results[k]
        ep = f"{r['episodes_detectes']}/{r['episodes']}"
        delai = "—" if r["delai_median_min"] is None else f"{r['delai_median_min']:.1f} min"
        print(f"{r['nom']:28s} {ts._fmt(r.get('roc_auc'), '.3f', 6)} {ts._fmt(r.get('avg_precision'), '.3f', 6)} "
              f"{r['precision']:>6.3f} {r['recall']:>7.3f} {r['f1']:>6.3f} "
              f"{r['fausses_alarmes_evenements_par_heure']:>6.2f} {ep:>9s} {delai:>11s}")
    print("FA/h : alertes distinctes à tort par heure normale. AUC et AP : moyennes des répétitions.")

    for title, field in (("% des LIGNES d'attaque détectées", "per_attack"), ("ÉPISODES détectés", "per_episode")):
        print()
        print(f"Détection par scénario — {title} (test cumulé)")
        print(f"{'Scénario':28s} {'n':>5s} " + " ".join(f"{k:>11s}" for k in keys))
        for name in ATTACK_NAMES:
            n = results[keys[0]][field][name]["n"]
            if field == "per_attack":
                cells = " ".join(f"{results[k][field][name]['rate']:>10.1f}%" for k in keys)
            else:
                cells = " ".join(f"{results[k][field][name]['detected']:>8d}/{n:<2d}" for k in keys)
            print(f"{name:28s} {n:>5d} {cells}")


# ════════════════════════════════════════════════════════════════════════════
# 4. Programme
# ════════════════════════════════════════════════════════════════════════════

DETECTORS = [("OCSVM", "OCSVM_Multivarie"), ("PCA", "Autoencodeur_PCA"),
             ("GNN", "GNN_Correlation"), ("LSTM", "Forecasting_LSTM"),
             ("Canal A", "Canal A seul (figé)"), ("Canal L", "Canal L seul (niveau)"),
             ("Canal V", "Canal V seul (dispersion)"), ("Canal R", "Canal R seul (rejeu exact)"),
             ("Stat A+L+V", "Statistique A+L+V"), ("Statistique", "Statistique A+L+V+R")]
CHANNEL_OF = {"Canal A": "A", "Canal L": "L", "Canal V": "V", "Canal R": "R", "Stat A+L+V": "ALV", "Statistique": "TOUS"}


def one_run(base: pd.DataFrame, run: int, quiet: bool) -> tuple[dict, list[dict], pd.DataFrame]:
    """Une répétition : injection, entraînement, scores et comptes de chaque détecteur."""
    rng = np.random.default_rng(SEED + run)
    episodes = build_schedule(len(base), rng, run)
    df = inject(base, episodes, rng, run)
    y = df["label"].to_numpy().astype(int)
    split = block_split(len(df), run)     # découpage recalculé ici (non stocké dans le CSV)
    garde = df["garde"].to_numpy().astype(bool)
    train_idx = np.where((split == "train") & (y == 0))[0]
    val_idx = np.where((split == "val") & ~garde)[0]
    test_idx = np.where((split == "test") & ~garde)[0]
    val_norm_idx = val_idx[y[val_idx] == 0]
    X_s = StandardScaler().fit(df[FEATURES].to_numpy(float)[train_idx]).transform(df[FEATURES].to_numpy(float))

    scores: dict[str, np.ndarray] = {}
    preds: dict[str, np.ndarray] = {}

    def attempt(key, fn):
        try:
            fn()
        except Exception:  # noqa: BLE001 — un modèle en échec ne doit pas arrêter l'étude
            traceback.print_exc()
            log(f"  !! {key} : échec, ignoré (répétition {run})")

    attempt("OCSVM", lambda: scores.__setitem__("OCSVM", ts.ocsvm_scores(X_s, y, train_idx, val_idx)[0]))
    attempt("PCA", lambda: scores.__setitem__("PCA", tm.train_autoencoder_pca(X_s, train_idx)[0]))
    attempt("GNN", lambda: scores.__setitem__("GNN", tm.train_gnn_correlation(df, train_idx)[0]))
    attempt("LSTM", lambda: scores.__setitem__(
        "LSTM", tm.train_forecasting_lstm(df, X_s, train_idx, val_norm_idx, y == 1)[0]))
    channels = stat_detector(df, y, train_idx, val_idx)
    for key, ch in CHANNEL_OF.items():
        scores[key] = channels[ch]

    counts: dict[str, dict] = {}
    for key, _ in DETECTORS:
        if key in scores:
            s = np.nan_to_num(np.asarray(scores[key], dtype=float), nan=0.0)
            # Le canal R est tout-ou-rien : son seuil est naturel, pas choisi par le F1
            # (sinon « tout signaler » gagne sur la validation dès que R voit peu d'attaques).
            thr = REPLAY_SCORE / 2 if key == "Canal R" else phase2._best_f1_threshold(y[val_idx], s[val_idx])
            preds[key] = s >= thr
        if key not in preds:
            continue
        c = {"test": count_run(preds[key], df, test_idx, episodes, "test"),
             "val": count_run(preds[key], df, val_idx, episodes, "val")}
        if key in scores:
            c["roc_auc"] = float(roc_auc_score(y[test_idx], s[test_idx]))
            c["avg_precision"] = float(average_precision_score(y[test_idx], s[test_idx]))
            c["threshold"] = float(thr)
        counts[key] = c

    # Capteur désigné par le détecteur statistique : le capteur au score le plus fort
    names = list(SENSORS)
    guess = np.array(names, dtype=object)[np.column_stack([channels["per_sensor"][s] for s in names]).argmax(axis=1)]
    detected = np.zeros(len(df), dtype=bool)
    detected[test_idx] = True
    detected &= (y == 1) & preds["Statistique"]
    cible, types = df["cible"].to_numpy(), df["attack_type"].to_numpy()
    counts["localisation"] = {nm: [int((detected & (types == nm)).sum()),
                                   int((detected & (types == nm) & (guess == cible)).sum())] for nm in ATTACK_NAMES}
    counts["lambda"] = channels["params"]["lambda"]
    counts["params"] = channels["params"]
    counts["seuil_statistique"] = counts.get("Statistique", {}).get("threshold")
    if not quiet:
        log(f"    répétition {run} : {len(episodes)} épisodes, {int(y[val_idx].sum()):,}/{len(val_idx):,} lignes "
            f"d'attaque en validation, {int(y[test_idx].sum()):,}/{len(test_idx):,} en test")
    return counts, episodes, df


def main() -> None:
    paths.ensure_dirs()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    production_model_file = paths.model_file
    paths.model_file = lambda name: str(OUT_DIR / name)
    try:
        _main()
    finally:
        paths.model_file = production_model_file


def _main() -> None:
    log("[1] Traces réelles TON_IoT")
    real = bd.load_normal_traces()
    base, fusion = fuse_real(real)
    prof = profile(base)
    log(f"    grille {STEP} : {fusion['pas_grille']:,} pas, {fusion['pas_conserves']:,} conservés "
        f"({fusion['debut']} → {fusion['fin']})")
    for s in ("weather", "fridge", "thermostat"):
        p = prof[s]
        log(f"    {s:10s} moy {p['moyenne']:6.2f} σ {p['ecart_type']:5.2f} | autocorr 5 s {p['autocorr_5s']:5.2f}, "
            f"1 min {p['autocorr_1min']:5.2f}")
    log(f"    corrélation frigo↔salle à météo fixée : {prof['correlation_frigo_salle_meteo_fixee']:.2f}")

    log(f"[2] {N_RUNS} répétitions : attaques injectées, détecteurs entraînés et évalués")
    all_counts, all_episodes = [], []
    for run in range(N_RUNS):
        with contextlib.redirect_stdout(io.StringIO()) if run else contextlib.nullcontext():
            counts, episodes, df = one_run(base, run, quiet=False)
        if run == 0:
            # ATTENTION : ce CSV est ECRIT PAR DEUX SCRIPTS. Ici, roles=("val","test") ->
            # le train reste SANS attaques, ce qui convient a l'etude statistique non
            # supervisee. L'etude supervisee (transmission_models.py) ecrase ce meme
            # fichier avec roles=("train","val","test") -> train AVEC attaques. Le
            # decoupage train/val/test n'est plus stocke dans le CSV (il est recalcule a
            # l'entrainement par block_split) : les deux variantes ont donc exactement les
            # memes colonnes, seul le label des blocs de train change. L'application, les
            # notebooks et entrainement_web.json ont besoin de la variante supervisee : il
            # faut donc executer transmission_models.py APRES ce script, jamais l'inverse.
            # Voir Soutenance/perimetre_etude_attaques.md ("Ordre d'execution obligatoire").
            df = drop_phase2_cols(df)
            df.to_csv(DATASET_PATH, index=False, float_format="%.4f")
            log(f"    {DATASET_PATH.name} (répétition 0) : {len(df):,} lignes")
        all_counts.append(counts)
        all_episodes.append([{**e, "run": run} for e in episodes])
        log(f"    répétition {run} terminée (lambda {counts['lambda']})")

    results: dict = {}
    for key, nom in DETECTORS:
        runs = [c[key] for c in all_counts if key in c]
        if not runs:
            continue
        res = pool([r["test"] for r in runs])
        res["nom"] = nom
        res["val_f1"] = pool([r["val"] for r in runs])["f1"]
        if "roc_auc" in runs[0]:
            res["roc_auc"] = round(float(np.mean([r["roc_auc"] for r in runs])), 4)
            res["avg_precision"] = round(float(np.mean([r["avg_precision"] for r in runs])), 4)
            res["thresholds"] = [round(r["threshold"], 4) for r in runs]
        results[key] = res

    print_tables(results)

    loc = {}
    for nm in ATTACK_NAMES:
        n = sum(c["localisation"][nm][0] for c in all_counts)
        ok = sum(c["localisation"][nm][1] for c in all_counts)
        loc[nm] = {"n": n, "exact": round(100 * ok / n, 1) if n else None}
    n_all = sum(v["n"] for v in loc.values())
    ok_all = sum(round(v["n"] * v["exact"] / 100) for v in loc.values() if v["exact"] is not None)
    loc["TOUTES"] = {"n": n_all, "exact": round(100 * ok_all / n_all, 1) if n_all else None}
    print()
    print("Capteur désigné (détecteur statistique, lignes d'attaque détectées, test cumulé)")
    for name in ATTACK_NAMES + ["TOUTES"]:
        v = loc[name]
        print(f"  {name:28s} n={v['n']:>5d}  capteur correct : " + ("—" if v["exact"] is None else f"{v['exact']:.1f} %"))

    ranking = sorted(results, key=lambda k: results[k]["val_f1"], reverse=True)
    print()
    print("Classement sur la VALIDATION (F1 cumulé) : "
          + " > ".join(f"{k} ({results[k]['val_f1']:.3f})" for k in ranking))
    b = results[ranking[0]]
    print(f"→ Meilleur détecteur sur les traces réelles : {b['nom']} (test : F1 {b['f1']:.3f}, "
          f"rappel {b['recall']:.3f}, {b['fausses_alarmes_evenements_par_heure']:.2f} fausse(s) alarme(s)/heure, "
          f"{b['episodes_detectes']}/{b['episodes']} épisodes)")

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "dataset": DATASET_PATH.name,
        "perimetre": "attaques de transmission (Injection + MITM) sur les traces réelles TON_IoT",
        "fusion": fusion,
        "profil_traces": prof,
        "protocole": {
            "split": "70/15/15 NON aléatoire, blocs d'une heure entrelacés (14 train / 3 val / 3 test "
                     "sur un cycle de 20), rôles tournant à chaque répétition ; recalculé à l'entraînement "
                     "(transmission_real.block_split), plus stocké dans le jeu de données",
            "repetitions": N_RUNS,
            "seuil": "max F1 sur la validation de chaque répétition, appliqué tel quel à son test",
            "pas_secondes": 5, "zone_de_garde_pas": GUARD,
            "episodes_par_repetition": [len(e) for e in all_episodes],
        },
        "scenarios": [{"nom": a[0], "capteur": a[1], "mecanisme": a[2], "parametre": a[3]} for a in ATTACKS],
        "classement_validation": ranking,
        "resultats": results,
        "localisation": loc,
        "episodes": [e for run in all_episodes for e in run],
    }
    with open(OUT_DIR / "resultats_transmission_reel.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, default=ts._json_default)
    with open(OUT_DIR / "detecteur_statistique.json", "w", encoding="utf-8") as f:
        json.dump({**all_counts[0]["params"], "seuil": all_counts[0]["seuil_statistique"],
                   "note": "paramètres de la répétition 0"}, f, indent=2, ensure_ascii=False, default=ts._json_default)
    log(f"Résultats : {OUT_DIR / 'resultats_transmission_reel.json'}")


if __name__ == "__main__":
    main()
