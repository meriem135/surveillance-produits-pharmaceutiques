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
    assert 0.30 <= part["train"] <= 0.40
    assert 0.12 <= part["val"] <= 0.16 and 0.12 <= part["test"] <= 0.16


def test_all_nine_scenarios_including_small_biases_are_tested():
    assert {"Injection_biais_0.5", "Injection_biais_1.0"} <= set(tr.ATTACK_NAMES) and len(tr.ATTACK_NAMES) == 9
    seen = set()
    for run in range(tr.N_RUNS):
        episodes = tr.build_schedule(N, np.random.default_rng(tr.SEED + run), run, roles=("train", "val", "test"))
        seen |= {e["name"] for e in episodes if e["split"] == "test"}
    assert seen == set(tr.ATTACK_NAMES)


def test_threshold_for_recall_reaches_the_target_on_validation():
    rng = np.random.default_rng(0)
    y = (rng.random(5000) < 0.14).astype(int)
    s = rng.normal(size=5000) + 1.2 * y
    for target in (0.80, 0.90, 0.95):
        thr = tm.threshold_for_recall(y, s, target)
        recall = ((s >= thr) & (y == 1)).sum() / y.sum()
        assert recall >= target
        # seuil le plus haut : un cran au-dessus, le rappel passe sous la cible
        above = ((s > thr) & (y == 1)).sum() / y.sum()
        assert above < target
    assert tm.threshold_for_recall(np.zeros(10, int), s[:10], 0.9) == float("inf")


def test_f2_weights_recall():
    assert tr.f_beta(0.5, 1.0, 2.0) == pytest.approx(5 * 0.5 / (4 * 0.5 + 1.0))
    assert tr.f_beta(0.0, 0.0, 2.0) == 0.0


def _fake_results():
    """Le classement de validation et celui du test sont volontairement opposés."""
    def point(f2_val, f2_test):
        mk = lambda f2: {"recall": 0.9, "precision": 0.5, "f1": 0.6, "f2": f2, "delai_median_min": 2.0,
                         "fausses_alarmes_evenements_par_heure": 1.0, "episodes": 10, "episodes_detectes": 9}
        return {"val": mk(f2_val), "test": mk(f2_test)}
    res = {}
    for k, (v, t) in {"RandomForest": (0.70, 0.60), "XGBoost": (0.60, 0.80), "Logistique": (0.50, 0.90),
                      "MLP": (0.65, 0.70)}.items():
        pts = {"max_f1": point(v, t), "rappel_0.90": point(v, t)}
        res[k] = {"points_fonctionnement": pts, "val_recall": 0.9, "val_f1": v, "val_fausses_alarmes_par_heure": 1.0}
    return res


def test_model_selection_uses_validation_only():
    res = _fake_results()
    assert tm.rank_models(res, "rappel_0.90") == ["RandomForest", "MLP", "XGBoost", "Logistique"]
    assert cs.classer(res, "rappel_0.90")[0] == "RandomForest"     # et non Logistique, meilleur sur le test


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
