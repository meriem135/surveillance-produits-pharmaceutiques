"""Protocole de l'étude « attaques de transmission » : découpage par blocs, prévalence,
seuil au rappel cible, sélection sur la validation, validation croisée groupée par bloc.
Aucun entraînement lourd : planning synthétique et petits jeux aléatoires."""
import sys
from pathlib import Path

import numpy as np
import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import comparer_supervises as cs  # noqa: E402
import transmission_models as tm  # noqa: E402
import transmission_real as tr  # noqa: E402

N = 44_443                       # lignes des traces réelles fusionnées (62 h à 5 s)
N_BLOCKS = N // tr.STEPS_HOUR


def _labels(episodes, n=N):
    lab = np.zeros(n, dtype=bool)
    garde = np.zeros(n, dtype=bool)
    for e in episodes:
        lab[e["start"]:e["end"]] = True
        garde[e["end"]:e["end"] + tr.GUARD] = True
    return lab, garde


def test_block_split_is_70_15_15_by_whole_blocks():
    for run in (0, 1, 13):
        split = tr.block_split(20 * tr.STEPS_HOUR, run)
        blocks = split.reshape(20, tr.STEPS_HOUR)
        assert all(len(set(b)) == 1 for b in blocks), "un bloc n'a qu'un rôle"
        roles = [b[0] for b in blocks]
        assert (roles.count("train"), roles.count("val"), roles.count("test")) == (14, 3, 3)


def test_twenty_runs_cover_every_rotation():
    assert tr.N_RUNS == tr.BLOCK_CYCLE == 20
    test_count = np.zeros(N_BLOCKS, dtype=int)
    val_count = np.zeros(N_BLOCKS, dtype=int)
    for run in range(tr.N_RUNS):
        for b in range(N_BLOCKS):
            role = tr.role_of_block(b, run)
            test_count[b] += role == "test"
            val_count[b] += role == "val"
    assert set(test_count) == {3} and set(val_count) == {3}, "chaque heure sert 3 fois de test et de validation"


@pytest.mark.parametrize("run", [0, 5, 19])
def test_no_episode_crosses_a_block_or_a_role(run):
    episodes = tr.build_schedule(N, np.random.default_rng(tr.SEED + run), run, roles=("train", "val", "test"))
    split = tr.block_split(N, run)
    for e in episodes:
        assert e["start"] // tr.STEPS_HOUR == (e["end"] - 1) // tr.STEPS_HOUR
        assert set(split[e["start"]:e["end"]]) == {e["split"]}
        assert tr.EP_MIN <= e["end"] - e["start"] <= tr.EP_MAX


def test_prevalence_per_role_train_rich_eval_realistic():
    shares = {"train": [], "val": [], "test": []}
    for run in range(tr.N_RUNS):
        episodes = tr.build_schedule(N, np.random.default_rng(tr.SEED + run), run, roles=("train", "val", "test"))
        lab, garde = _labels(episodes)
        split = tr.block_split(N, run)
        for role in shares:
            m = (split == role) & ~garde
            shares[role].append((lab[m].sum(), m.sum()))
    part = {r: sum(a for a, _ in v) / sum(b for _, b in v) for r, v in shares.items()}
    assert 0.40 <= part["train"] <= 0.55      # la zone de garde de 20 min retire des lignes normales
    assert 0.12 <= part["val"] <= 0.16 and 0.12 <= part["test"] <= 0.16


def test_all_nine_scenarios_including_small_biases_are_tested():
    assert {"Injection_biais_0.5", "Injection_biais_1.0"} <= set(tr.ATTACK_NAMES) and len(tr.ATTACK_NAMES) == 9
    seen = set()
    for run in range(tr.N_RUNS):
        episodes = tr.build_schedule(N, np.random.default_rng(tr.SEED + run), run, roles=("train", "val", "test"))
        seen |= {e["name"] for e in episodes if e["split"] == "test"}
    assert seen == set(tr.ATTACK_NAMES)


def test_guard_covers_the_longest_window_and_the_persistence_rule():
    import transmission_alertes as ta
    assert tr.GUARD >= tr.W_MAX + ta.N_MAX
    assert max(tm.WINDOWS.values()) <= tr.W_MAX and max(tm.SHAPE_WINDOWS.values()) <= tr.W_MAX


@pytest.mark.parametrize("run", [0, 3, 11, 19])
def test_no_feature_window_crosses_a_role_boundary_or_an_episode(run):
    """Pour chaque ligne apprise ou évaluée, la fenêtre [t − GUARD + 1, t] (plus longue fenêtre
    des features + persistance des alertes) ne contient que des lignes du MÊME rôle, et, pour
    une ligne normale, aucune ligne d'attaque."""
    episodes = tr.build_schedule(N, np.random.default_rng(tr.SEED + run), run, roles=("train", "val", "test"))
    lab, garde = _labels(episodes)
    split = tr.block_split(N, run)
    excl = tr.excluded_rows(garde, run)
    kept = np.where(~excl)[0]
    kept = kept[kept >= tr.GUARD]                       # début des traces : pas de passé du tout
    code = np.unique(split, return_inverse=True)[1]
    c = np.concatenate([[0], np.cumsum(lab)])
    win = np.arange(tr.GUARD)
    for t in kept[::7]:
        w = t - win
        assert (code[w] == code[t]).all(), f"fenêtre de la ligne {t} sur deux rôles"
    normal = kept[~lab[kept]]
    attacks_in_window = c[normal + 1] - c[normal + 1 - tr.GUARD]
    assert (attacks_in_window == 0).all(), "une ligne normale évaluée voit un épisode dans sa fenêtre"
    # les épisodes des blocs qui changent de rôle commencent après la zone de garde
    for e in episodes:
        b = e["start"] // tr.STEPS_HOUR
        if b and tr.role_of_block(b - 1, run) != tr.role_of_block(b, run):
            assert e["start"] - b * tr.STEPS_HOUR >= tr.GUARD


def test_features_are_causal_and_bounded_by_the_longest_window():
    """Modifier le futur ne change rien ; modifier un passé plus vieux que W_MAX ne change que
    l'indicateur de rejeu (mémoire des séquences déjà vues, pas une fenêtre glissante)."""
    import pandas as pd
    rng = np.random.default_rng(1)
    n = 1500
    df = pd.DataFrame({"datetime": pd.date_range("2019-04-01", periods=n, freq="5s"),
                       "weather_temp": rng.uniform(20, 45, n).round(2), "fridge_temp": rng.uniform(1, 14, n).round(2),
                       "thermostat_temp": rng.uniform(25, 35, n).round(2), "fridge_cond": "low", "thermo_status": 0})
    t = 1000
    ref, feats = tm.engineer(df)
    fut = df.copy(); fut.loc[t + 1:, ["fridge_temp", "thermostat_temp", "weather_temp"]] += 5.0
    old = df.copy(); old.loc[: t - tr.W_MAX, ["fridge_temp", "thermostat_temp", "weather_temp"]] += 5.0
    a, _ = tm.engineer(fut)
    b, _ = tm.engineer(old)
    window_feats = [f for f in feats if not f.endswith("repeat_2min")]
    assert np.allclose(ref.loc[t, feats].to_numpy(float), a.loc[t, feats].to_numpy(float))
    assert np.allclose(ref.loc[t, window_feats].to_numpy(float), b.loc[t, window_feats].to_numpy(float))
    assert not any("ewma" in f for f in feats)


def test_debounce_requires_k_of_the_last_n_rows():
    import transmission_alertes as ta
    flags = np.array([1, 0, 1, 1, 0, 0, 0, 1, 1, 1], dtype=bool)
    assert ta.debounce(flags, 1, 1).tolist() == flags.tolist()
    assert ta.debounce(flags, 2, 3).tolist() == [0, 0, 1, 1, 1, 0, 0, 0, 1, 1]
    assert ta.debounce(flags, 3, 3).tolist() == [0, 0, 0, 0, 0, 0, 0, 0, 0, 1]


def test_alert_counting_episodes_false_alerts_and_delay():
    import transmission_alertes as ta
    n = 2 * tr.STEPS_HOUR
    y = np.zeros(n, dtype=int); y[100:300] = 1
    alarm = np.zeros(n, dtype=bool); alarm[124:200] = True; alarm[900:910] = True; alarm[1000:1001] = True
    ev = np.ones(n, dtype=bool)
    eps = [{"name": "MITM_gel", "split": "val", "start": 100, "end": 300}]
    c = ta.count(alarm, y, ev, eps, "val", np.where(y == 1, "MITM_gel", "normal"), ["MITM_gel"])
    p = ta.pool([c])
    assert p["alertes"] == 3 and p["fausses_alertes"] == 2
    assert p["episodes_detectes"] == 1 and p["delai_median_min"] == pytest.approx(24 * 5 / 60, abs=0.05)
    assert p["fausses_alarmes_evenements_par_heure"] == pytest.approx(2 / ((n - 200) / tr.STEPS_HOUR), rel=1e-3)
    assert p["precision"] == pytest.approx(76 / 87, rel=1e-3)


def test_single_operating_point_maximises_recall_under_the_constraints():
    import transmission_alertes as ta
    rows = [{"seuil": 0.5, "k": 1, "n": 1, "precision": 0.80, "recall": 0.9, "f1": 0.85, "fa_h": 3.0},
            {"seuil": 0.7, "k": 6, "n": 12, "precision": 0.93, "recall": 0.6, "f1": 0.73, "fa_h": 0.4},
            {"seuil": 0.8, "k": 6, "n": 12, "precision": 0.97, "recall": 0.5, "f1": 0.66, "fa_h": 0.1},
            {"seuil": 0.6, "k": 3, "n": 6, "precision": 0.91, "recall": 0.65, "f1": 0.76, "fa_h": 0.9}]
    op = ta.choose(rows, 0.90, 0.5)
    assert (op["seuil"], op["k"], op["n"], op["contrainte_tenue"]) == (0.7, 6, 12, True)
    op = ta.choose(rows, 0.99, 0.05)
    assert op["contrainte_tenue"] is False and op["seuil"] == 0.8


def _fake_results():
    """Le classement de validation et celui du test sont volontairement opposés."""
    res = {}
    for k, (rv, rt, ok) in {"RandomForest": (0.70, 0.60, True), "XGBoost": (0.60, 0.80, True),
                            "Logistique": (0.90, 0.95, False), "MLP": (0.65, 0.70, True)}.items():
        res[k] = {"val_recall": rv, "recall": rt, "val_fausses_alarmes_par_heure": 0.4, "val_delai_median_min": 3.0,
                  "point_fonctionnement": {"contrainte_tenue": ok}}
    return res


def test_model_selection_uses_validation_only_and_the_constraint_first():
    res = _fake_results()
    assert tm.rank_models(res) == ["RandomForest", "MLP", "XGBoost", "Logistique"]
    assert cs.classer(res)[0] == "RandomForest"     # et non Logistique, meilleure sans tenir la contrainte


def test_group_cv_uses_one_hour_blocks():
    n = 12 * tr.STEPS_HOUR
    groups = tr.block_index(n)
    assert groups[0] == 0 and groups[tr.STEPS_HOUR] == 1 and groups[-1] == 11
    y = np.zeros(n, dtype=int)
    for b in range(12):                         # une attaque par bloc, comme à l'entraînement
        y[b * tr.STEPS_HOUR + 100: b * tr.STEPS_HOUR + 300] = 1
    X = np.zeros((n, 1))
    splitters = tm.cv_splitters(4)
    assert tm.shared_blocks(splitters["groupes_blocs"], X, y, groups) == 0
    assert tm.shared_blocks(splitters["naif"], X, y, groups) > 0
