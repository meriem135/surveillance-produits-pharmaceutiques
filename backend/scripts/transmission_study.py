"""
Étude « attaques de transmission » — Injection et MITM sur le trajet capteur → broker MQTT
==========================================================================================
Périmètre : uniquement les attaques qui falsifient la mesure EN TRANSIT. Les
traces réseau TON_IoT (DDoS, scanning, ransomware…) sont hors périmètre.

1. Jeu de données dédié (data/processed/dataset_transmission.csv), année 2019, pas de 5 min :
   - météo : même générateur que build_dataset.py (calibré sur les traces réelles) ;
   - salle (thermostat) et chambre froide (frigo) partagent une CHARGE THERMIQUE
     LOCALE latente (activité, portes, équipements) en plus de la météo : la salle
     devient un vrai témoin du frigo, et pas une seconde mesure de la météo ;
   - incidents thermiques réels NON falsifiés (label 0) dans toutes les semaines ;
   - 10 scénarios de transmission, du plus grossier au plus furtif (voir ATTACKS).
2. Découpage par semaines entrelacées (3 semaines train, 1 val, 1 test, en boucle) :
   chaque saison et chaque scénario figurent dans la validation ET dans le test.
3. Comparaison, avec le même protocole (seuil = max F1 sur la validation) :
   les 4 modèles de la phase 2 et un détecteur
   résiduel à deux canaux (A : variance effondrée = gel ; B : désaccord salle↔frigo,
   ajusté par régression orthogonale et lissé par EWMA = injection / rejeu / masquage).
   Le capteur falsifié est désigné par le canal A (capteur figé) ou, pour un
   désaccord du canal B, par l'écart de chaque capteur à son propre historique.
4. Le couplage salle↔frigo est une HYPOTHÈSE du modèle physique : il est mesuré sur
   les traces réelles, et --sensibilite rejoue l'étude avec un couplage plus faible.

Sorties : models/transmission/resultats_transmission.json, detecteur_residuel.json,
          sensibilite_couplage.json (avec --sensibilite)

Usage :  cd backend && .venv/bin/python scripts/transmission_study.py [--sensibilite]
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
import tempfile
import time
import traceback
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.preprocessing import StandardScaler
from sklearn.svm import OneClassSVM

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import build_dataset as bd  # noqa: E402
import train_models as tm  # noqa: E402
from app.api.v1 import phase2  # noqa: E402
from app.core import paths  # noqa: E402

SEED = 2019
STEPS_DAY = 288                 # pas de 5 min
STEP_MINUTES = 5                # durée d'un pas, pour les délais de détection
GUARD = 12                      # 1 h après chaque épisode exclue de l'évaluation (traîne des fenêtres glissantes)
EP_MIN, EP_MAX = 24, 48         # durée d'un épisode : 2 h à 4 h
FEATURES = phase2.FEATURE_COLS
OUT_DIR = paths.MODELS_DIR / "transmission"
DATASET_PATH = paths.PROCESSED_DIR / "dataset_transmission.csv"

# ── Modèle physique ────────────────────────────────────────────────────────
W_REF = 25.0
T_SET, T_W, T_L, T_NOISE = 24.0, 0.12, 0.60, 0.15     # salle   = consigne + météo + charge locale + bruit
F_SET, F_W, F_L, F_NOISE = 7.0, 0.05, 0.50, 0.35      # frigo   = consigne + météo + charge locale + bruit
L_PHI, L_STD = 0.97, 1.0                              # charge thermique locale : AR(1) lent
INCIDENT_PROB, INCIDENT_AMP = 0.7, (4.0, 7.0)         # incident réel : +2,4 à +4,2 °C salle, +2 à +3,5 °C frigo

# ── Scénarios de transmission : (nom, capteur visé, mécanisme, paramètre) ──
ATTACKS = [
    ("MITM_gel",                   "fridge",     "gel",      None),   # dernière valeur rejouée en boucle
    ("MITM_rejeu",                 "fridge",     "rejeu",    None),   # fenêtre enregistrée la veille
    ("MITM_masquage",              "fridge",     "masquage", None),   # excursion réelle cachée par un rejeu
    ("Injection_nominale",         "fridge",     "nominale", None),   # valeurs forgées autour de la consigne
    ("Injection_biais_0.5",        "fridge",     "biais",    -0.5),
    ("Injection_biais_1.0",        "fridge",     "biais",    -1.0),
    ("Injection_biais_2.0",        "fridge",     "biais",    -2.0),
    ("Injection_derive",           "fridge",     "derive",   -2.0),   # rampe lente 0 → -2 °C
    ("MITM_gel_thermostat",        "thermostat", "gel",      None),
    ("Injection_biais_thermostat", "thermostat", "biais",    -1.5),
]
ATTACK_NAMES = [a[0] for a in ATTACKS]

T0 = time.time()


def log(msg: str) -> None:
    print(f"[{time.time() - T0:6.1f}s] {msg}", flush=True)


# ════════════════════════════════════════════════════════════════════════════
# 1. Jeu de données
# ════════════════════════════════════════════════════════════════════════════

def role_of_week(week: int) -> str:
    r = week % 5
    return "val" if r == 3 else ("test" if r == 4 else "train")


def build_schedule(rng: np.random.Generator) -> tuple[list[dict], list[dict]]:
    """Un épisode d'attaque par jour (jours 0-5) des semaines val/test, un
    incident réel possible le jour 6 de chaque semaine. Rien ne chevauche minuit."""
    episodes, incidents = [], []
    counters = {"val": 0, "test": 0}
    for week in range(52):
        role = role_of_week(week)
        if role in counters:
            for d in range(6):
                start = (week * 7 + d) * STEPS_DAY + int(rng.integers(24, 228))
                length = int(rng.integers(EP_MIN, EP_MAX + 1))
                name, sensor, kind, param = ATTACKS[counters[role] % len(ATTACKS)]
                counters[role] += 1
                episodes.append({"name": name, "sensor": sensor, "kind": kind, "param": param,
                                 "start": start, "end": start + length, "split": role,
                                 "amp": float(rng.uniform(*INCIDENT_AMP))})
        if rng.random() < INCIDENT_PROB:
            start = (week * 7 + 6) * STEPS_DAY + int(rng.integers(24, 228))
            length = int(rng.integers(EP_MIN, EP_MAX + 1))
            incidents.append({"start": start, "end": start + length,
                              "amp": float(rng.uniform(*INCIDENT_AMP))})
    return episodes, incidents


def _bump_profile(length: int, amp: float) -> np.ndarray:
    ramp = max(2, min(12, length // 3))
    up = np.linspace(0.0, 1.0, ramp + 1)[1:]
    prof = np.full(length, amp)
    prof[:ramp] = amp * up
    prof[-ramp:] = amp * up[::-1]
    return prof


def _replay_source(s: int, e: int, bump_mask: np.ndarray) -> tuple[int, int]:
    """Même créneau horaire, le jour précédent le plus proche sans incident."""
    for k in (1, 2, 3):
        a, b = s - k * STEPS_DAY, e - k * STEPS_DAY
        if a >= 0 and not bump_mask[a:b].any():
            return a, b
    return s - STEPS_DAY, e - STEPS_DAY


def build_dataset(year: pd.DataFrame, rng: np.random.Generator,
                  couplage: float = 1.0) -> tuple[pd.DataFrame, list[dict], list[dict]]:
    n = len(year)
    weather = year["weather_temp"].to_numpy(float)
    week = (np.arange(n) // STEPS_DAY) // 7
    r = week % 5
    split = np.where(r == 3, "val", np.where(r == 4, "test", "train"))

    episodes, incidents = build_schedule(rng)

    # Charge thermique locale + incidents réels (y compris ceux qu'un attaquant masquera)
    bump = np.zeros(n)
    incident = np.zeros(n, dtype=int)
    for inc in incidents:
        bump[inc["start"]:inc["end"]] += _bump_profile(inc["end"] - inc["start"], inc["amp"])
        incident[inc["start"]:inc["end"]] = 1
    for ep in episodes:
        if ep["kind"] == "masquage":
            bump[ep["start"]:ep["end"]] += _bump_profile(ep["end"] - ep["start"], ep["amp"])
    bump_mask = bump > 0
    load = bd._ar1(n, L_PHI, L_STD, rng) + bump
    # couplage < 1 (étude de sensibilité) : une part de la charge du frigo lui devient
    # propre ; les incidents réels restent communs. Générateur séparé, pour que
    # couplage = 1 redonne exactement le jeu de référence.
    load_fridge = load
    if couplage < 1.0:
        own = bd._ar1(n, L_PHI, L_STD, np.random.default_rng(SEED + 1))
        load_fridge = couplage * (load - bump) + np.sqrt(1.0 - couplage ** 2) * own + bump

    dw = weather - W_REF
    true = {
        "thermostat": np.clip(T_SET + T_W * dw + T_L * load + rng.normal(0, T_NOISE, n), 16.0, 36.0),
        "fridge": np.clip(F_SET + F_W * dw + F_L * load_fridge + rng.normal(0, F_NOISE, n), 0.5, 14.0),
    }

    # Ce que le broker reçoit : la vérité, sauf pendant les épisodes de transmission
    tx = {k: v.copy() for k, v in true.items()}
    label = np.zeros(n, dtype=int)
    attack_type = np.full(n, "normal", dtype=object)
    cible = np.full(n, "", dtype=object)
    garde = np.zeros(n, dtype=bool)
    for ep in episodes:
        s, e, kind = ep["start"], ep["end"], ep["kind"]
        x_true, x_tx = true[ep["sensor"]], tx[ep["sensor"]]
        if kind == "gel":
            x_tx[s:e] = x_true[s - 1]
        elif kind in ("rejeu", "masquage"):
            a, b = _replay_source(s, e, bump_mask)
            x_tx[s:e] = x_true[a:b]
        elif kind == "nominale":
            x_tx[s:e] = F_SET + bd._ar1(e - s, 0.3, F_NOISE, rng)
        elif kind == "biais":
            x_tx[s:e] = x_true[s:e] + ep["param"]
        elif kind == "derive":
            x_tx[s:e] = x_true[s:e] + ep["param"] * np.linspace(0.0, 1.0, e - s)
        label[s:e] = 1
        attack_type[s:e] = ep["name"]
        cible[s:e] = ep["sensor"]
        garde[e:e + GUARD] = True

    df = pd.DataFrame({
        "datetime": year["datetime"].to_numpy(),
        "weather_temp": np.round(weather, 2),            # résolution capteur : 0,01 °C
        "fridge_temp": np.round(tx["fridge"], 2),
        "thermostat_temp": np.round(tx["thermostat"], 2),
        "fridge_true": np.round(true["fridge"], 2),
        "thermostat_true": np.round(true["thermostat"], 2),
        "label": label,
        "attack_type": attack_type,
        "cible": cible,
        "incident": incident,
        "split": split,
        "garde": garde,
    })
    df["fridge_cond"] = np.where(df["fridge_temp"] > 8.0, "high", "low")
    df["thermo_status"] = (np.abs(df["thermostat_temp"] - T_SET) > 1.5).astype(int)
    df = phase2._engineer_features(df)
    return df, episodes, incidents


# ════════════════════════════════════════════════════════════════════════════
# 2. Détecteurs
# ════════════════════════════════════════════════════════════════════════════

def ocsvm_scores(X_s: np.ndarray, y: np.ndarray, train_idx: np.ndarray,
                 val_idx: np.ndarray) -> tuple[np.ndarray, dict]:
    rs = np.random.RandomState(SEED)
    sub = rs.choice(train_idx, min(20000, len(train_idx)), replace=False)
    best = None
    for nu in (0.01, 0.02, 0.03):
        for gamma in ("auto", 0.1, 0.01, 0.001):
            model = OneClassSVM(nu=nu, kernel="rbf", gamma=gamma).fit(X_s[sub])
            auc = roc_auc_score(y[val_idx], -model.decision_function(X_s[val_idx]))
            if best is None or auc > best[0]:
                best = (auc, nu, gamma, model)
    auc, nu, gamma, model = best
    log(f"  OCSVM : nu={nu} gamma={gamma} (AUC val {auc:.4f})")
    return -model.decision_function(X_s), {"nu": nu, "gamma": gamma, "val_roc_auc": round(float(auc), 4)}


RES_TARGETS = {"fridge": "fridge_temp", "thermostat": "thermostat_temp"}
STD_SENSORS = {"fridge": "fridge_temp", "thermostat": "thermostat_temp", "weather": "weather_temp"}
STD_WINDOW = 6          # 30 min
FIT_WINDOW = 12         # 1 h : lissage des signaux avant l'ajustement orthogonal
LAMBDA_LENT = 0.01      # moyenne lente de l'historique propre de chaque capteur (≈ 8 h)


def _ewma(x: np.ndarray, lam: float) -> np.ndarray:
    return pd.Series(x).ewm(alpha=lam, adjust=False).mean().to_numpy()


def residual_channels(df: pd.DataFrame, train_idx: np.ndarray, lam: float) -> dict:
    """Canal A : z de « l'immobilité » (log de l'écart-type glissant, 30 min) par capteur.
    Canal B : désaccord salle↔frigo. L'effet de la météo est retiré de chaque capteur,
    puis la relation salle↔frigo est ajustée par régression ORTHOGONALE sur les signaux
    lissés (1 h). Avec des moindres carrés, le bruit de mesure tasse la pente et un
    incident réel, qui déplace les deux capteurs ensemble, laisse un résidu ; ici il
    s'annule. Le résidu est lissé par EWMA puis standardisé.
    Historique propre : écart de chaque capteur à sa propre moyenne lente ; il désigne
    le capteur falsifié quand le canal B signale un désaccord (voir accused_sensor)."""
    weather = df["weather_temp"].to_numpy(float)
    params = {"lambda": lam, "std_window": STD_WINDOW, "fit_window": FIT_WINDOW, "lambda_lent": LAMBDA_LENT,
              "meteo": {}, "desaccord": {}, "historique": {}, "immobilite": {}}

    u = {}
    for name, col in RES_TARGETS.items():
        x = df[col].to_numpy(float)
        slope, intercept = np.polyfit(weather[train_idx], x[train_idx], 1)
        u[name] = x - (intercept + slope * weather)
        params["meteo"][name] = {"intercept": float(intercept), "pente": float(slope)}

    # Direction de plus petite variance des signaux lissés = relation salle↔frigo
    U = np.column_stack([u["fridge"], u["thermostat"]])
    smooth = pd.DataFrame(U).rolling(FIT_WINDOW, min_periods=1).mean().to_numpy()
    _, vecs = np.linalg.eigh(np.cov(smooth[train_idx].T))
    normal = vecs[:, 0] * (-1.0 if vecs[1, 0] < 0 else 1.0)
    ewma = _ewma(U @ normal, lam)
    mu, sd = float(ewma[train_idx].mean()), float(ewma[train_idx].std() or 1e-9)
    z_b = (ewma - mu) / sd
    params["desaccord"] = {
        "coef_fridge": float(normal[0]), "coef_thermostat": float(normal[1]),
        "pente_salle_par_frigo": float(-normal[0] / normal[1]) if normal[1] else None,
        "ewma_mean": mu, "ewma_std": sd,
    }

    history = {}
    for name in RES_TARGETS:
        d = _ewma(u[name], lam) - _ewma(u[name], LAMBDA_LENT)
        m, v = float(d[train_idx].mean()), float(d[train_idx].std() or 1e-9)
        history[name] = np.abs(d - m) / v
        params["historique"][name] = {"ecart_mean": m, "ecart_std": v}

    z_a = {}
    for name, col in STD_SENSORS.items():
        rs = pd.Series(df[col].to_numpy(float)).rolling(STD_WINDOW, min_periods=STD_WINDOW).std(ddof=0).to_numpy()
        rs = np.where(np.isnan(rs), np.nanmedian(rs), rs)
        lg = np.log(rs + 1e-3)
        m, v = float(lg[train_idx].mean()), float(lg[train_idx].std() or 1e-9)
        z_a[name] = (m - lg) / v
        params["immobilite"][name] = {"log_std_mean": m, "log_std_std": v}

    a = np.column_stack([z_a[s] for s in STD_SENSORS]).max(axis=1)
    b = np.abs(z_b)
    return {"A": a, "B": b, "AB": np.maximum(a, b), "z_a": z_a, "historique": history, "params": params}


def accused_sensor(channels: dict, thr: float) -> tuple[np.ndarray, np.ndarray]:
    """Capteur désigné pour chaque ligne, et masque « alerte du canal A ».
    Canal A (capteur figé) : le capteur immobile, sans ambiguïté.
    Canal B (désaccord salle↔frigo) : celui des deux qui s'écarte le plus de son
    propre historique. Limite connue : si l'attaquant CACHE un vrai changement
    (masquage, injection nominale), c'est le capteur honnête qui bouge."""
    names = list(STD_SENSORS)
    still = np.array(names, dtype=object)[np.column_stack([channels["z_a"][s] for s in names]).argmax(axis=1)]
    history = channels["historique"]
    moved = np.where(history["fridge"] >= history["thermostat"], "fridge", "thermostat")
    canal_a = channels["A"] >= thr
    return np.where(canal_a, still, moved), canal_a


def residual_detector(df: pd.DataFrame, y: np.ndarray, train_idx: np.ndarray,
                      val_idx: np.ndarray) -> dict:
    best = None
    for lam in (0.05, 0.1, 0.2):
        ch = residual_channels(df, train_idx, lam)
        ap = average_precision_score(y[val_idx], ch["AB"][val_idx])
        log(f"  résiduel : lambda={lam}  AP val {ap:.4f}")
        if best is None or ap > best[0]:
            best = (ap, ch)
    return best[1]


# ════════════════════════════════════════════════════════════════════════════
# 3. Évaluation commune
# ════════════════════════════════════════════════════════════════════════════

def summarize(pred: np.ndarray, df: pd.DataFrame, idx: np.ndarray, episodes: list[dict],
              split: str) -> dict:
    y = df["label"].to_numpy()[idx] == 1
    p = pred[idx]
    inc = df["incident"].to_numpy()[idx] == 1
    types = df["attack_type"].to_numpy()[idx]

    tp, fn = int((p & y).sum()), int((~p & y).sum())
    fp_inc, fp_nom = int((p & ~y & inc).sum()), int((p & ~y & ~inc).sum())
    fp, tn = fp_inc + fp_nom, int((~p & ~y).sum())
    days_nominal = max(1e-9, int((~y & ~inc).sum()) / STEPS_DAY)

    # Fausses alarmes comptées en ÉVÉNEMENTS (suites de lignes consécutives)
    fa = np.zeros(len(df), dtype=bool)
    fa[idx] = p & ~y & ~inc
    fa_events = int((fa & ~np.r_[False, fa[:-1]]).sum())

    # Incidents réels (non falsifiés) qui déclenchent au moins une alerte
    inc_all = (df["incident"].to_numpy() == 1) & (df["split"].to_numpy() == split)
    inc_starts = np.flatnonzero(inc_all & ~np.r_[False, inc_all[:-1]])
    inc_ends = np.flatnonzero(inc_all & ~np.r_[inc_all[1:], False]) + 1
    inc_hit = sum(bool(pred[s:e].any()) for s, e in zip(inc_starts, inc_ends))

    per_attack = {}
    for name in ATTACK_NAMES:
        m = types == name
        per_attack[name] = {"n": int(m.sum()), "detected": int((p & m).sum()),
                            "rate": round(100 * float((p & m).sum()) / max(1, int(m.sum())), 1)}

    per_episode, delays_all, hits = {}, [], 0
    eps = [ep for ep in episodes if ep["split"] == split]
    for name in ATTACK_NAMES:
        delays, n_hit, n_ep = [], 0, 0
        for ep in eps:
            if ep["name"] != name:
                continue
            n_ep += 1
            seg = pred[ep["start"]:ep["end"]]
            if seg.any():
                n_hit += 1
                delays.append(int(np.argmax(seg)) * STEP_MINUTES)
        hits += n_hit
        delays_all += delays
        per_episode[name] = {"n": n_ep, "detected": n_hit,
                             "delai_median_min": float(np.median(delays)) if delays else None}

    return {
        "precision": round(tp / (tp + fp), 4) if tp + fp else 0.0,
        "recall": round(tp / (tp + fn), 4) if tp + fn else 0.0,
        "f1": round(2 * tp / (2 * tp + fp + fn), 4) if 2 * tp + fp + fn else 0.0,
        "fpr": round(fp / (fp + tn), 5) if fp + tn else 0.0,
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "fp_nominal": fp_nom, "fp_incident": fp_inc,
        "fausses_alarmes_par_jour": round(fp_nom / days_nominal, 2),
        "evenements_fausse_alarme_par_jour": round(fa_events / days_nominal, 2),
        "incidents_reels": len(inc_starts), "incidents_signales": inc_hit,
        "episodes": len(eps), "episodes_detectes": hits,
        "delai_median_min": float(np.median(delays_all)) if delays_all else None,
        "per_attack": per_attack, "per_episode": per_episode,
    }


def evaluate_scores(scores: np.ndarray, df: pd.DataFrame, y: np.ndarray, val_idx: np.ndarray,
                    test_idx: np.ndarray, episodes: list[dict]) -> tuple[dict, np.ndarray]:
    s = np.nan_to_num(np.asarray(scores, dtype=float), nan=0.0)
    thr = phase2._best_f1_threshold(y[val_idx], s[val_idx])
    pred = s >= thr
    res = summarize(pred, df, test_idx, episodes, "test")
    res["roc_auc"] = round(float(roc_auc_score(y[test_idx], s[test_idx])), 4)
    res["avg_precision"] = round(float(average_precision_score(y[test_idx], s[test_idx])), 4)
    res["threshold"] = float(thr)
    res["val_f1"] = summarize(pred, df, val_idx, episodes, "val")["f1"]
    return res, pred


def localisation(guess: np.ndarray, canal_a: np.ndarray, pred: np.ndarray, df: pd.DataFrame,
                 test_idx: np.ndarray) -> dict:
    """Parmi les lignes d'attaque détectées : le capteur désigné est-il le capteur visé ?
    Donné par scénario, puis par canal à l'origine de l'alerte."""
    cible = df["cible"].to_numpy()
    types = df["attack_type"].to_numpy()
    detected = np.zeros(len(df), dtype=bool)
    detected[test_idx] = True
    detected &= (df["label"].to_numpy() == 1) & pred

    def accuracy(m: np.ndarray) -> dict:
        n = int(m.sum())
        return {"n": n, "exact": round(100 * float((guess[m] == cible[m]).mean()), 1) if n else None}

    out = {name: accuracy(detected & (types == name)) for name in ATTACK_NAMES}
    out["TOUTES"] = accuracy(detected)
    out["canal_A"] = accuracy(detected & canal_a)
    out["canal_B"] = accuracy(detected & ~canal_a)
    return out


def _partial_corr(a, b, w) -> float:
    """Corrélation entre a et b une fois l'effet (linéaire) de w retiré de chacun."""
    a, b, w = (np.asarray(v, dtype=float) for v in (a, b, w))
    ra = a - np.polyval(np.polyfit(w, a, 1), w)
    rb = b - np.polyval(np.polyfit(w, b, 1), w)
    return float(np.corrcoef(ra, rb)[0, 1])


def real_coupling(real: dict[str, pd.DataFrame]) -> dict:
    """Corrélation frigo↔salle à météo fixée sur les traces réelles (moyennes par pas de 5 min)."""
    cols = {"weather": "temperature", "fridge": "fridge_temperature", "thermostat": "current_temperature"}
    joined = pd.concat({k: real[k].set_index("datetime")[c].resample("5min").mean() for k, c in cols.items()},
                       axis=1).dropna()
    return {"source": "traces normales TON_IoT (notebook/Raw/Normal)", "n_points": int(len(joined)),
            "correlation": round(_partial_corr(joined["fridge"], joined["thermostat"], joined["weather"]), 3)}


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)


def _fmt(v, spec: str, width: int) -> str:
    return f"{'—':>{width}s}" if v is None else f"{v:>{width}{spec}}"


def print_tables(results: dict) -> None:
    keys = list(results)
    print()
    print("═" * 118)
    print("ATTAQUES DE TRANSMISSION — jeu de TEST (seuil choisi sur la validation)")
    print("═" * 118)
    print(f"{'Détecteur':24s} {'AUC':>6s} {'AP':>6s} {'Préc.':>6s} {'Rappel':>7s} {'F1':>6s} "
          f"{'FP nom.':>8s} {'FA/jour':>8s} {'FP incid.':>9s} {'Incidents':>9s} {'Épisodes':>9s} {'Délai méd.':>11s}")
    for k in keys:
        r = results[k]
        ep = f"{r['episodes_detectes']}/{r['episodes']}"
        incid = f"{r['incidents_signales']}/{r['incidents_reels']}"
        delai = "—" if r["delai_median_min"] is None else f"{r['delai_median_min']:.0f} min"
        print(f"{r['nom']:24s} {_fmt(r.get('roc_auc'), '.3f', 6)} {_fmt(r.get('avg_precision'), '.3f', 6)} "
              f"{r['precision']:>6.3f} {r['recall']:>7.3f} {r['f1']:>6.3f} {r['fp_nominal']:>8d} "
              f"{r['fausses_alarmes_par_jour']:>8.2f} {r['fp_incident']:>9d} {incid:>9s} {ep:>9s} {delai:>11s}")
    print("FA/jour : lignes de fausse alarme par jour nominal. Incidents : incidents réels, non falsifiés, "
          "qui déclenchent une alerte.")

    print()
    print("Détection par scénario — % des LIGNES d'attaque détectées (test)")
    print(f"{'Scénario':28s} {'n':>5s} " + " ".join(f"{k:>9s}" for k in keys))
    for name in ATTACK_NAMES:
        n = results[keys[0]]["per_attack"][name]["n"]
        print(f"{name:28s} {n:>5d} " + " ".join(f"{results[k]['per_attack'][name]['rate']:>8.1f}%" for k in keys))

    print()
    print("Détection par scénario — ÉPISODES détectés (test)")
    print(f"{'Scénario':28s} {'n':>5s} " + " ".join(f"{k:>9s}" for k in keys))
    for name in ATTACK_NAMES:
        n = results[keys[0]]["per_episode"][name]["n"]
        print(f"{name:28s} {n:>5d} " + " ".join(
            f"{results[k]['per_episode'][name]['detected']:>7d}/{n:<1d}" for k in keys))


# ════════════════════════════════════════════════════════════════════════════
# 4. Programme
# ════════════════════════════════════════════════════════════════════════════

SENSITIVITY_LEVELS = (0.8, 0.6, 0.3, 0.0)   # part de charge commune salle↔frigo (1.0 = étude de référence)


def run_study(real: dict[str, pd.DataFrame], couplage: float = 1.0, out_dir: Path = OUT_DIR,
              dataset_path: Path = DATASET_PATH) -> dict:
    """Une étude complète pour un niveau de couplage salle↔frigo. Les modèles de
    comparaison vont dans `out_dir`, sans toucher aux modèles de production de models/."""
    out_dir.mkdir(parents=True, exist_ok=True)
    production_model_file = paths.model_file
    paths.model_file = lambda name: str(out_dir / name)
    try:
        return _run_study(real, couplage, out_dir, dataset_path)
    finally:
        paths.model_file = production_model_file


def _run_study(real: dict[str, pd.DataFrame], couplage: float, out_dir: Path, dataset_path: Path) -> dict:
    rng = np.random.default_rng(SEED)
    year = bd.generate_year(real, rng)

    log(f"[2] Jeu de données « transmission » (couplage salle ↔ frigo {couplage:.1f}, incidents réels, 10 scénarios)")
    df, episodes, incidents = build_dataset(year, rng, couplage)
    df.to_csv(dataset_path, index=False, float_format="%.4f")

    y = df["label"].to_numpy().astype(int)
    split = df["split"].to_numpy()
    garde = df["garde"].to_numpy().astype(bool)
    train_idx = np.where((split == "train") & (y == 0))[0]
    val_idx = np.where((split == "val") & ~garde)[0]
    test_idx = np.where((split == "test") & ~garde)[0]
    val_norm_idx = val_idx[y[val_idx] == 0]

    normal = df[(df["label"] == 0) & (df["incident"] == 0)]
    corr_sim = _partial_corr(normal["fridge_temp"], normal["thermostat_temp"], normal["weather_temp"])
    corr_real = real_coupling(real)
    log(f"    {dataset_path.name} : {len(df):,} lignes | train {len(train_idx):,} normales | "
        f"val {len(val_idx):,} ({int(y[val_idx].sum()):,} att.) | test {len(test_idx):,} ({int(y[test_idx].sum()):,} att.)")
    log(f"    {len(episodes)} épisodes d'attaque, {len(incidents)} incidents réels non falsifiés")
    log(f"    frigo normal : {normal['fridge_temp'].mean():.2f} °C σ {normal['fridge_temp'].std():.2f} | "
        f"salle : {normal['thermostat_temp'].mean():.2f} °C σ {normal['thermostat_temp'].std():.2f}")
    log(f"    corrélation frigo↔salle à météo fixée : {corr_sim:.2f} dans ce jeu (hypothèse du modèle physique) | "
        f"{corr_real['correlation']:.2f} mesurée sur les traces réelles ({corr_real['n_points']} points de 5 min)")

    X = df[FEATURES].to_numpy(float)
    X_s = StandardScaler().fit(X[train_idx]).transform(X)

    results: dict = {}
    extras: dict = {}

    def run(key: str, nom: str, fn) -> None:
        log(f"[3] {nom}")
        try:
            out = fn()
            out["nom"] = nom
            results[key] = out
        except Exception:  # noqa: BLE001 — un modèle en échec ne doit pas arrêter l'étude
            traceback.print_exc()
            log(f"  !! {nom} : échec, ignoré")

    def from_scores(scores, params=None):
        res, pred = evaluate_scores(scores, df, y, val_idx, test_idx, episodes)
        if params is not None:
            res["hyperparameters"] = params
        return res, pred

    def ocsvm():
        s, p = ocsvm_scores(X_s, y, train_idx, val_idx)
        return from_scores(s, p)[0]

    def pca():
        s, p = tm.train_autoencoder_pca(X_s, train_idx)
        return from_scores(s, p)[0]

    def gnn():
        s, p = tm.train_gnn_correlation(df, train_idx)
        return from_scores(s, p)[0]

    def lstm():
        s, p = tm.train_forecasting_lstm(df, X_s, train_idx, val_norm_idx, y == 1)
        return from_scores(s, p)[0]

    run("OCSVM", "OCSVM_Multivarie", ocsvm)
    run("PCA", "Autoencodeur_PCA", pca)
    run("GNN", "GNN_Correlation", gnn)
    run("LSTM", "Forecasting_LSTM", lstm)

    log("[4] Détecteur résiduel à deux canaux")
    channels = residual_detector(df, y, train_idx, val_idx)

    def canal(which: str):
        def _f():
            res, pred = from_scores(channels[which])
            if which == "AB":
                extras["pred_ab"] = pred
            return res
        return _f

    run("Canal A", "Canal A seul (gel)", canal("A"))
    run("Canal B", "Canal B seul (désaccord)", canal("B"))
    run("Résiduel", "Détecteur résiduel A+B", canal("AB"))

    print_tables(results)

    loc = None
    if "pred_ab" in extras:
        guess, canal_a = accused_sensor(channels, results["Résiduel"]["threshold"])
        loc = localisation(guess, canal_a, extras["pred_ab"], df, test_idx)
        print()
        print("Capteur désigné (détecteur résiduel, lignes d'attaque détectées du test)")
        labels = {"TOUTES": "TOUTES", "canal_A": "… alertes du canal A (gel)",
                  "canal_B": "… alertes du canal B (désaccord)"}
        for name in ATTACK_NAMES + list(labels):
            v = loc[name]
            print(f"  {labels.get(name, name):34s} n={v['n']:>5d}  capteur correct : "
                  + ("—" if v["exact"] is None else f"{v['exact']:.1f} %"))

    scored = {k: r for k, r in results.items() if r.get("val_f1") is not None}
    ranking = sorted(scored, key=lambda k: scored[k]["val_f1"], reverse=True)
    print()
    print("Classement sur la VALIDATION (F1) : "
          + " > ".join(f"{k} ({scored[k]['val_f1']:.3f})" for k in ranking))
    if ranking:
        b = results[ranking[0]]
        print(f"→ Meilleur détecteur pour les attaques de transmission : {b['nom']} "
              f"(test : F1 {b['f1']:.3f}, rappel {b['recall']:.3f}, "
              f"{b['fausses_alarmes_par_jour']:.2f} fausse(s) alarme(s)/jour, "
              f"{b['episodes_detectes']}/{b['episodes']} épisodes)")

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "dataset": dataset_path.name,
        "perimetre": "attaques de transmission (Injection + MITM)",
        "couplage": {
            "part_de_charge_commune": couplage,
            "correlation_frigo_salle_simulee": round(corr_sim, 3),
            "traces_reelles": corr_real,
        },
        "protocole": {
            "split": "semaines entrelacées : 3 train / 1 val / 1 test",
            "seuil": "max F1 sur la validation, appliqué tel quel au test",
            "zone_de_garde_pas": GUARD,
            "n_train": int(len(train_idx)), "n_val": int(len(val_idx)), "n_test": int(len(test_idx)),
            "n_attack_val": int(y[val_idx].sum()), "n_attack_test": int(y[test_idx].sum()),
            "episodes": len(episodes), "incidents_reels": len(incidents),
        },
        "modele_physique": {
            "salle": f"{T_SET} + {T_W}*(meteo-{W_REF}) + {T_L}*charge + bruit({T_NOISE})",
            "frigo": f"{F_SET} + {F_W}*(meteo-{W_REF}) + {F_L}*charge + bruit({F_NOISE})",
            "charge": f"AR(1) phi={L_PHI} sigma={L_STD} + incidents {INCIDENT_AMP}",
        },
        "scenarios": [{"nom": a[0], "capteur": a[1], "mecanisme": a[2], "parametre": a[3]} for a in ATTACKS],
        "classement_validation": ranking,
        "resultats": results,
        "localisation": loc,
    }
    with open(out_dir / "resultats_transmission.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, default=_json_default)
    with open(out_dir / "detecteur_residuel.json", "w", encoding="utf-8") as f:
        json.dump({**channels["params"],
                   "seuil": results.get("Résiduel", {}).get("threshold")},
                  f, indent=2, ensure_ascii=False, default=_json_default)
    log(f"Résultats : {out_dir / 'resultats_transmission.json'}")
    return summary


def sensitivity(real: dict[str, pd.DataFrame], reference: dict) -> None:
    """Rejoue l'étude avec un couplage salle↔frigo plus faible : le score du détecteur
    résiduel repose sur ce couplage, qui est une hypothèse du modèle physique."""
    log("[5] Sensibilité au couplage salle ↔ frigo")
    runs = [reference]
    for couplage in SENSITIVITY_LEVELS:
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()):
            runs.append(run_study(real, couplage, Path(tmp), Path(tmp) / "dataset.csv"))
        log(f"    couplage {couplage:.1f} : terminé")

    rows = []
    for s in runs:
        res = s["resultats"]
        others = {k: r["f1"] for k, r in res.items() if k not in ("Résiduel", "Canal A", "Canal B")}
        best_other = max(others, key=others.get)
        rows.append({
            "part_de_charge_commune": s["couplage"]["part_de_charge_commune"],
            "correlation_frigo_salle": s["couplage"]["correlation_frigo_salle_simulee"],
            "f1": {k: r["f1"] for k, r in res.items()},
            "meilleur_autre": best_other,
            "residuel": {k: res["Résiduel"][k] for k in (
                "precision", "recall", "f1", "fausses_alarmes_par_jour", "evenements_fausse_alarme_par_jour",
                "episodes_detectes", "episodes", "incidents_signales", "incidents_reels")},
        })

    print()
    print("SENSIBILITÉ AU COUPLAGE — F1 sur le test")
    print(f"{'Part commune':>12s} {'Corrélation':>11s} {'Résiduel':>9s} {'Meilleur autre':>22s} "
          f"{'FA/jour':>8s} {'Incidents':>9s} {'Épisodes':>9s}")
    for row in rows:
        r = row["residuel"]
        other = f"{row['f1'][row['meilleur_autre']]:.3f} ({row['meilleur_autre']})"
        print(f"{row['part_de_charge_commune']:>12.1f} {row['correlation_frigo_salle']:>11.2f} {r['f1']:>9.3f} "
              f"{other:>22s} {r['fausses_alarmes_par_jour']:>8.2f} "
              f"{str(r['incidents_signales']) + '/' + str(r['incidents_reels']):>9s} "
              f"{str(r['episodes_detectes']) + '/' + str(r['episodes']):>9s}")
    real_corr = reference["couplage"]["traces_reelles"]
    print(f"Traces réelles : corrélation {real_corr['correlation']:.2f} ({real_corr['n_points']} points de 5 min).")

    with open(OUT_DIR / "sensibilite_couplage.json", "w", encoding="utf-8") as f:
        json.dump({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "traces_reelles": real_corr,
                   "niveaux": rows}, f, indent=2, ensure_ascii=False, default=_json_default)
    log(f"Sensibilité : {OUT_DIR / 'sensibilite_couplage.json'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Étude des attaques de transmission (Injection + MITM).")
    parser.add_argument("--sensibilite", action="store_true",
                        help="rejoue aussi l'étude avec un couplage salle↔frigo plus faible (~1 min de plus)")
    args = parser.parse_args()

    paths.ensure_dirs()
    log("[1] Météo de référence (générateur calibré sur les traces réelles)")
    real = bd.load_normal_traces()
    reference = run_study(real)
    if args.sensibilite:
        sensitivity(real, reference)


if __name__ == "__main__":
    main()
