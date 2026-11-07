# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/scripts/transmission_real.py
#   SCRIPT 2 — PROTOCOLE DE L'ÉTUDE. Fusionne les 3 capteurs, découpe train / validation / test
#   par blocs d'une heure, zone de garde, injecte les 9 scénarios d'attaque. Aucun modèle ici.
# ══════════════════════════════════════════════════════════════════════════
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
   rôles (pas de fuite temporelle).
   Prévalence : un épisode dans CHAQUE bloc d'entraînement (~33 % d'attaques : les
   modèles supervisés ont besoin d'exemples), mais une prévalence RÉALISTE en
   validation et en test : un épisode dans 2 blocs sur 5 (≈ 13–15 % des lignes).
   La précision et le F1 dépendent de la prévalence : à 33 % d'attaques, le seuil
   « max F1 » glisse vers « tout signaler » et la précision mesurée est flatteuse.
   9 scénarios, dont les petits biais −0,5 et −1 °C, gardés comme LIMITE CONNUE et
   mesurés scénario par scénario (le « masquage » n'a pas de sens ici : ces traces
   n'ont pas d'excursion réelle). Les traces ne durent que 62 h : l'étude est donc
   RÉPÉTÉE 20 fois en décalant le cycle de 20 blocs d'un cran à chaque répétition,
   ce qui parcourt TOUTES les rotations : chaque heure sert 3 fois de test et 3 fois
   de validation ; les scénarios tournent aussi, les résultats sont cumulés.
3. Ce module ne contient AUCUN modèle : il fournit le protocole commun (fusion,
   découpage, zone de garde, injection) aux 6 modèles supervisés de
   transmission_models.py (Random Forest, Extra Trees, XGBoost, HistGradientBoosting,
   Régression Logistique, MLP) et à l'application.

Sortie : models/transmission_reel/resultats_transmission_reel.json (fusion et profil des traces,
         lus par l'application) ; le jeu de données dataset_transmission_reel.csv est écrit
         par transmission_models.py.
Usage :  cd backend && .venv/bin/python scripts/transmission_real.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import build_dataset as bd  # noqa: E402
from app.domains.ml import features  # noqa: E402
from app.core import paths  # noqa: E402

SEED = 2019
STEP = "5s"
STEPS_HOUR = 720
STEPS_DAY = 24 * STEPS_HOUR
STEP_MINUTES = 5 / 60
MAX_GAP = 12                    # trous ≤ 1 min comblés par la dernière valeur
# Zone de garde. La plus longue fenêtre glissante des features fait W_MAX = 15 min (180 pas)
# et la règle de persistance des alertes regarde encore jusqu'à 3 min (36 pas) en arrière :
# une ligne dont la fenêtre contient des mesures d'un autre rôle (train / val / test) ou
# d'un épisode terminé ne doit être ni apprise ni évaluée. GUARD = 20 min (240 pas) ≥
# 15 + 3 min, appliquée (1) après chaque épisode et (2) au début de chaque bloc dont le
# rôle diffère du bloc précédent (boundary_guard). Avant : 5 min seulement, plus courte
# que la fenêtre de 15 min (fuite signalée à la relecture).
W_MAX = 180                     # plus longue fenêtre glissante des features (15 min)
GUARD = 240                     # 20 min exclues après chaque épisode et en début de bloc changeant de rôle
EP_MIN, EP_MAX = 180, 300       # durée d'un épisode : 15 à 25 min (≈ 33 % d'un bloc)
N_RUNS = 20                     # répétitions : les 20 rotations du cycle de blocs (voir BLOCK_CYCLE)
FEATURES = features.FEATURE_COLS
OUT_DIR = paths.MODELS_DIR / "transmission_reel"
DATASET_PATH = paths.PROCESSED_DIR / "dataset_transmission_reel.csv"

F_SET, F_NOISE = 7.0, 0.35      # injection « nominale » : valeurs forgées autour de la consigne
RANGE = {"fridge": (1.0, 14.0), "thermostat": (25.0, 35.0)}   # plages observées dans les traces

# Périmètre : les biais faibles -0.5 °C et -1.0 °C sont GARDÉS dans l'étude. Leur amplitude
# est sous le bruit du capteur (σ ≈ 3,4 °C par mesure) : ils sont mal détectés en 15–25 min,
# et c'est justement ce qu'il faut montrer (limite connue, chiffrée scénario par scénario).
# L'étude complémentaire transmission_biais_long.py mesure à partir de quelle durée
# (1 à 3 h) ils deviennent détectables.
ATTACKS = [
    ("MITM_gel",                   "fridge",     "gel",      None),   # dernière valeur rejouée en boucle
    ("MITM_rejeu",                 "fridge",     "rejeu",    None),   # fenêtre passée (≥ 1 h plus tôt) rejouée
    ("Injection_nominale",         "fridge",     "nominale", None),   # valeurs forgées ~7 °C, peu bruitées
    ("Injection_biais_0.5",        "fridge",     "biais",    -0.5),   # limite connue (sous le bruit)
    ("Injection_biais_1.0",        "fridge",     "biais",    -1.0),   # limite connue (sous le bruit)
    ("Injection_biais_2.0",        "fridge",     "biais",    -2.0),
    ("Injection_derive",           "fridge",     "derive",   -2.0),   # rampe lente 0 → -2 °C
    ("MITM_gel_thermostat",        "thermostat", "gel",      None),
    ("Injection_biais_thermostat", "thermostat", "biais",    -1.5),
]
ATTACK_NAMES = [a[0] for a in ATTACKS]

T0 = time.time()


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] log
#   Rôle   : Affiche un message avec le temps écoulé depuis le lancement.
#   Entrée : msg : texte
#   Sortie : rien
# ──────────────────────────────────────────────────────────────────────
def log(msg: str) -> None:
    print(f"[{time.time() - T0:6.1f}s] {msg}", flush=True)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _json_default
#   Rôle   : Aide l'écriture JSON : convertit les nombres numpy et les dates en types simples.
#   Entrée : o : objet
#   Sortie : valeur écrivable en JSON
# ──────────────────────────────────────────────────────────────────────
def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _fmt
#   Rôle   : Formate un nombre pour l'affichage (« — » si absent).
#   Entrée : v : valeur ; spec : format ; width : largeur
#   Sortie : texte
# ──────────────────────────────────────────────────────────────────────
def _fmt(v, spec: str, width: int) -> str:
    return f"{'—':>{width}s}" if v is None else f"{v:>{width}{spec}}"


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _partial_corr
#   Rôle   : Corrélation entre deux capteurs une fois l'effet de la météo retiré.
#   Entrée : a, b : séries ; w : série à neutraliser
#   Sortie : un nombre entre -1 et 1
# ──────────────────────────────────────────────────────────────────────
def _partial_corr(a, b, w) -> float:
    """Corrélation entre a et b une fois l'effet (linéaire) de w retiré de chacun."""
    a, b, w = (np.asarray(v, dtype=float) for v in (a, b, w))
    ra = a - np.polyval(np.polyfit(w, a, 1), w)
    rb = b - np.polyval(np.polyfit(w, b, 1), w)
    return float(np.corrcoef(ra, rb)[0, 1])


PHASE2_ONLY_COLS = ("hour_sin", "hour_cos", "season_sin", "season_cos")


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] drop_legacy_cols
#   Rôle   : Supprime les anciennes colonnes inutiles (heure, saison…) pour garder un jeu de données propre.
#   Entrée : df : tableau
#   Sortie : tableau nettoyé
# ──────────────────────────────────────────────────────────────────────
def drop_legacy_cols(df: pd.DataFrame) -> pd.DataFrame:
    """Retire les colonnes héritées du pré-calcul historique (heure, saison, moyennes et
    écarts glissants sur 10 pas). Elles ne font pas partie des 35 features du modèle
    de transmission : on garde un jeu de données propre et reproductible."""
    cols = [c for c in df.columns if c.endswith(("_roll_mean_10", "_roll_std_10"))]
    cols += [c for c in PHASE2_ONLY_COLS if c in df.columns]
    return df.drop(columns=cols, errors="ignore")


# ════════════════════════════════════════════════════════════════════════════
# 1. Jeu de données : traces réelles fusionnées + attaques de transmission
# ════════════════════════════════════════════════════════════════════════════

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] fuse_real
#   Rôle   : FUSIONNE LES 3 CAPTEURS (météo, frigo, thermostat) sur une même grille de temps, une ligne
#            toutes les 5 s ; les petits trous (< 1 min) sont comblés par la dernière valeur.
#   Entrée : real : les 3 traces TON_IoT nettoyées
#   Sortie : (tableau fusionné, statistiques de fusion)
# ──────────────────────────────────────────────────────────────────────
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


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] profile
#   Rôle   : Décrit les traces : moyenne, dispersion, mémoire dans le temps, lien entre capteurs.
#   Entrée : df : tableau fusionné
#   Sortie : dictionnaire de statistiques
# ──────────────────────────────────────────────────────────────────────
def profile(df: pd.DataFrame) -> dict:
    """Ce que sont ces traces : niveau, dispersion, mémoire (autocorrélation) et lien entre capteurs."""
    out = {}
    for s in ("weather", "fridge", "thermostat"):
        x = df[f"{s}_temp"]
        out[s] = {"moyenne": round(float(x.mean()), 2), "ecart_type": round(float(x.std()), 2),
                  "autocorr_5s": round(float(x.autocorr(1)), 3), "autocorr_1min": round(float(x.autocorr(12)), 3)}
    out["correlation_frigo_salle_meteo_fixee"] = round(
        _partial_corr(df["fridge_temp"], df["thermostat_temp"], df["weather_temp"]), 3)
    return out


# Découpage train / val / test : NON aléatoire, 70 / 15 / 15.
# On découpe les heures en blocs entrelacés : sur un cycle de 20 blocs consécutifs,
# 14 vont au train, 3 à la validation et 3 au test. Comme une attaque tient
# ENTIÈREMENT dans un bloc d'une heure, aucune attaque n'est jamais coupée entre
# deux rôles (pas de fuite temporelle). `run` décale le motif d'un cran à chaque
# répétition (rôles tournants de l'étude cumulée) : le découpage reste déterministe.
# Avec N_RUNS = BLOCK_CYCLE = 20 répétitions, toutes les rotations sont parcourues :
# chaque bloc est 14 fois en train, 3 fois en validation et 3 fois en test.
BLOCK_CYCLE = 20
TRAIN_BLOCKS = 14          # 14/20 = 70 %
VAL_BLOCKS = 3             # 3/20 = 15 %  (le reste, 3/20 = 15 %, part au test)

# Prévalence des attaques par rôle. Train : un épisode dans CHAQUE bloc (~33 % des
# lignes), les modèles supervisés ont besoin d'exemples. Validation et test : un
# épisode dans 2 blocs sur 5 seulement (≈ 13–15 % des lignes), une prévalence
# réaliste : la précision, le F1 et le seuil « max F1 » en dépendent directement.
EVAL_PATTERN = (True, False, True, False, False)   # blocs de val / test successifs : épisode ou non


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] block_index
#   Rôle   : Numéro du bloc d'une heure de chaque ligne (720 lignes de 5 s = 1 h).
#   Entrée : n : nombre de lignes
#   Sortie : tableau des numéros de bloc
# ──────────────────────────────────────────────────────────────────────
def block_index(n: int) -> np.ndarray:
    """Numéro du bloc d'une heure de chaque ligne (sert aussi de groupe pour la
    validation croisée par groupes : une attaque et ses fenêtres glissantes restent
    dans leur bloc)."""
    return np.arange(n) // STEPS_HOUR


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] role_of_block
#   Rôle   : Dit si un bloc d'une heure sert au train, à la validation ou au test (cycle de 20 blocs : 14 / 3
#            / 3, décalé d'un cran à chaque répétition).
#   Entrée : block : numéro du bloc ; run : numéro de répétition
#   Sortie : "train", "val" ou "test"
# ──────────────────────────────────────────────────────────────────────
def role_of_block(block: int, run: int = 0) -> str:
    r = (block + run) % BLOCK_CYCLE
    if r < TRAIN_BLOCKS:
        return "train"
    return "val" if r < TRAIN_BLOCKS + VAL_BLOCKS else "test"


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] block_split
#   Rôle   : DÉCOUPAGE 70 / 15 / 15 NON ALÉATOIRE : donne le rôle de chaque ligne d'après son bloc d'une
#            heure. Une attaque reste entière dans un seul rôle : pas de fuite.
#   Entrée : n : nombre de lignes ; run : répétition
#   Sortie : un rôle par ligne
# ──────────────────────────────────────────────────────────────────────
def block_split(n: int, run: int = 0) -> np.ndarray:
    """Rôle (train / val / test) de CHAQUE ligne, déduit de son bloc horaire.
    Le découpage n'est plus stocké dans le jeu de données : il est recalculé ICI,
    au moment de l'entraînement. Non aléatoire et reproductible : mêmes blocs,
    mêmes rôles à chaque exécution."""
    return np.array([role_of_block(i // STEPS_HOUR, run) for i in range(n)], dtype=object)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] boundary_guard
#   Rôle   : ZONE DE GARDE en début de bloc : les 20 premières minutes d'un bloc qui change de rôle sont
#            exclues, car leurs fenêtres de 15 min regarderaient dans le bloc d'à côté.
#   Entrée : n : lignes ; run : répétition ; guard : taille de la zone
#   Sortie : vrai/faux par ligne
# ──────────────────────────────────────────────────────────────────────
def boundary_guard(n: int, run: int = 0, guard: int = GUARD) -> np.ndarray:
    """Vrai pour les `guard` premières lignes de chaque bloc dont le rôle diffère de celui
    du bloc précédent : leurs fenêtres glissantes (≤ W_MAX) et la persistance des alertes
    regarderaient dans un bloc d'un autre rôle. Ces lignes ne sont ni apprises ni évaluées."""
    out = np.zeros(n, dtype=bool)
    for b in range(1, (n - 1) // STEPS_HOUR + 1):
        if role_of_block(b, run) != role_of_block(b - 1, run):
            out[b * STEPS_HOUR:b * STEPS_HOUR + guard] = True
    return out


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] excluded_rows
#   Rôle   : Toutes les lignes exclues (ni apprises ni évaluées) : garde après chaque attaque + garde en
#            début de bloc.
#   Entrée : garde : colonne « garde » du jeu de données ; run : répétition
#   Sortie : vrai/faux par ligne
# ──────────────────────────────────────────────────────────────────────
def excluded_rows(garde: np.ndarray, run: int = 0) -> np.ndarray:
    """Lignes hors apprentissage et hors évaluation : zone de garde après les épisodes
    (colonne `garde` du jeu de données) et en début de bloc changeant de rôle."""
    garde = np.asarray(garde, dtype=bool)
    return garde | boundary_guard(len(garde), run)


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] build_schedule
#   Rôle   : PLANNING DES ATTAQUES : décide où placer chaque épisode (15 à 25 min) et quel scénario. Une
#            attaque dans chaque bloc de train, dans 2 blocs sur 5 en validation et test (proportion
#            réaliste).
#   Entrée : n : lignes ; rng : hasard reproductible ; run : répétition ; roles : rôles qui reçoivent des
#            attaques
#   Sortie : liste d'épisodes {nom, capteur, type, début, fin, rôle}
# ──────────────────────────────────────────────────────────────────────
def build_schedule(n: int, rng: np.random.Generator, run: int = 0,
                   roles: tuple[str, ...] = ("val", "test")) -> list[dict]:
    """Planning des épisodes : un épisode dans CHAQUE bloc d'entraînement (~33 %
    d'attaques), dans 2 blocs sur 5 de validation et de test (EVAL_PATTERN, ≈ 13–15 %).
    Les scénarios tournent avec la répétition, pour que chacun soit testé plusieurs
    fois. Les modèles supervisés (transmission_models.py) demandent des attaques dans
    tous les rôles : roles=("train", "val", "test"). Chaque épisode (15 à 25 min) tient
    entièrement dans son bloc d'une heure."""
    episodes, counters = [], {r: run for r in roles}
    seen = {r: run for r in roles}
    for block in range(n // STEPS_HOUR):
        role = role_of_block(block, run)
        if role not in counters:
            continue
        if role != "train":
            keep = EVAL_PATTERN[seen[role] % len(EVAL_PATTERN)]
            seen[role] += 1
            if not keep:
                continue
        # Un bloc qui change de rôle commence par la zone de garde : l'épisode démarre après.
        lo = GUARD if block and role_of_block(block - 1, run) != role else 12
        s = block * STEPS_HOUR + int(rng.integers(lo, STEPS_HOUR - EP_MAX - 12))
        e = s + int(rng.integers(EP_MIN, EP_MAX + 1))
        name, sensor, kind, param = ATTACKS[counters[role] % len(ATTACKS)]
        counters[role] += 1
        episodes.append({"name": name, "sensor": sensor, "kind": kind, "param": param,
                         "start": s, "end": e, "split": role})
    return episodes


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] inject
#   Rôle   : INJECTE LES ATTAQUES dans les traces : modifie la température transmise selon le scénario (gel =
#            valeur bloquée, rejeu = vieille séquence renvoyée, nominale = fausses valeurs ~7 °C, biais =
#            décalage, dérive = décalage progressif). Met label = 1 sur ces lignes et garde la vraie valeur à
#            côté.
#   Entrée : df : traces fusionnées ; episodes : planning ; rng : hasard ; run : répétition
#   Sortie : tableau avec label, attack_type, garde et valeurs falsifiées
# ──────────────────────────────────────────────────────────────────────
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
    return features._engineer_features(out)


# ════════════════════════════════════════════════════════════════════════════
# 2. Rejeu exact (feature « repeat_2min » des modèles supervisés)
# ════════════════════════════════════════════════════════════════════════════

HASH_WINDOW = 24            # 2 min de valeurs brutes
HASH_MIN_DISTINCT = 8       # une suite constante (thermostat à 25 °C) n'est pas un rejeu


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] replay_flags
#   Rôle   : Détecte un REJEU EXACT : vrai quand les 2 dernières minutes de valeurs ont déjà été vues telles
#            quelles.
#   Entrée : x : valeurs d'un capteur
#   Sortie : vrai/faux par ligne
# ──────────────────────────────────────────────────────────────────────
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


# ════════════════════════════════════════════════════════════════════════════
# 3. Programme : fusion et profil des traces (lus par l'application)
# ════════════════════════════════════════════════════════════════════════════

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] main
#   Rôle   : Programme : fusionne les traces, calcule leur profil et écrit resultats_transmission_reel.json
#            (lu par le site).
#   Entrée : rien
#   Sortie : fichier JSON dans models/transmission_reel/
# ──────────────────────────────────────────────────────────────────────
def main() -> None:
    paths.ensure_dirs()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
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
    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "dataset": DATASET_PATH.name,
        "perimetre": "attaques de transmission (Injection + MITM) sur les traces réelles TON_IoT",
        "fusion": fusion,
        "profil_traces": prof,
        "scenarios": [{"nom": a[0], "capteur": a[1], "mecanisme": a[2], "parametre": a[3]} for a in ATTACKS],
    }
    with open(OUT_DIR / "resultats_transmission_reel.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, default=_json_default)
    log(f"Résultats : {OUT_DIR / 'resultats_transmission_reel.json'}")


if __name__ == "__main__":
    main()
