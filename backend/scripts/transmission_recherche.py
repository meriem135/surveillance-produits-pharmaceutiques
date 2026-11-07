# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/scripts/transmission_recherche.py
#   RECHERCHE D'HYPERPARAMÈTRES. Petite grille par modèle, validation croisée groupée par bloc
#   sur le train uniquement.
# ══════════════════════════════════════════════════════════════════════════
"""
Recherche d'hyperparamètres (petite grille) — validation croisée GROUPÉE par bloc
==================================================================================
Sur les lignes d'ENTRAÎNEMENT de la répétition 0 uniquement (ni la validation ni le test
ne sont regardés) : StratifiedGroupKFold à 4 plis, le groupe est le bloc d'une heure,
score = précision moyenne (average precision, aire sous la courbe précision-rappel, qui
ne dépend pas d'un seuil). Le réglage retenu par modèle est écrit dans
models/transmission_reel/recherche_hyperparametres.json et relu par transmission_models.py.

Usage :  cd backend && nice -n 10 .venv/bin/python scripts/transmission_recherche.py
"""
from __future__ import annotations

import os as _os

# Le serveur héberge d'autres sites : 3 cœurs au plus, y compris pour OpenMP (HistGradientBoosting, XGBoost).
_os.environ.setdefault("OMP_NUM_THREADS", _os.environ.get("N_JOBS", "3"))

import contextlib
import io
import json
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import build_dataset as bd  # noqa: E402
import transmission_models as tm  # noqa: E402
import transmission_real as tr  # noqa: E402

OUT = tr.OUT_DIR / "recherche_hyperparametres.json"

GRID = {
    "RandomForest": [{"min_samples_leaf": 5, "max_features": "sqrt"}, {"min_samples_leaf": 10, "max_features": 0.3},
                     {"min_samples_leaf": 2, "max_features": "sqrt"}],
    "ExtraTrees": [{"min_samples_leaf": 2, "max_features": "sqrt"}, {"min_samples_leaf": 5, "max_features": 0.5}],
    "XGBoost": [{"max_depth": 4, "min_child_weight": 5}, {"max_depth": 6, "min_child_weight": 1},
                {"max_depth": 8, "min_child_weight": 5}],
    "HistGB": [{"max_leaf_nodes": 15, "learning_rate": 0.05}, {"max_leaf_nodes": 31, "learning_rate": 0.05},
               {"max_leaf_nodes": 63, "learning_rate": 0.03}],
}
N_SPLITS = 4


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] main
#   Rôle   : RECHERCHE D'HYPERPARAMÈTRES : essaie une petite grille de réglages pour chaque modèle, en
#            validation croisée groupée par bloc sur le train uniquement, et écrit
#            recherche_hyperparametres.json.
#   Entrée : rien
#   Sortie : fichier JSON lu ensuite par _tuned()
# ──────────────────────────────────────────────────────────────────────
def main() -> None:
    from sklearn.metrics import average_precision_score
    from sklearn.model_selection import StratifiedGroupKFold

    with contextlib.redirect_stdout(io.StringIO()):
        base, _ = tr.fuse_real(bd.load_normal_traces())
    rng = np.random.default_rng(tr.SEED)
    episodes = tr.build_schedule(len(base), rng, 0, roles=("train", "val", "test"))
    df, feats = tm.engineer(tr.inject(base, episodes, rng, 0))
    y = df["label"].to_numpy().astype(int)
    split = tr.block_split(len(df), 0)
    excl = tr.excluded_rows(df["garde"].to_numpy().astype(bool), 0)
    tri = np.where((split == "train") & ~excl)[0]
    X, yt, groups = df[feats].to_numpy(np.float32)[tri], y[tri], tr.block_index(len(df))[tri]
    folds = list(StratifiedGroupKFold(n_splits=N_SPLITS, shuffle=True, random_state=tr.SEED).split(X, yt, groups))
    out = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "lignes": int(len(tri)), "attaques": int(yt.sum()),
           "blocs": int(len(np.unique(groups))), "plis": N_SPLITS, "score": "average precision (moyenne des plis)",
           "validation": "StratifiedGroupKFold, groupe = bloc d'une heure, lignes d'entraînement de la répétition 0",
           "modeles": {}}
    for key, configs in GRID.items():
        res = []
        for params in configs:
            t0 = time.time()
            aps = []
            for a, b in folds:
                pos = max(1, int(yt[a].sum()))
                model = tm.make_model(key, ratio=(len(a) - pos) / pos, **params)
                model.fit(X[a], yt[a])
                aps.append(float(average_precision_score(yt[b], model.predict_proba(X[b])[:, 1])))
            res.append({"params": params, "ap_moyenne": round(float(np.mean(aps)), 4),
                        "ap_ecart_type": round(float(np.std(aps)), 4), "duree_s": round(time.time() - t0, 1)})
            print(f"{key:13s} {params} AP {np.mean(aps):.4f} ± {np.std(aps):.4f} ({time.time() - t0:.0f} s)", flush=True)
        best = max(res, key=lambda r: r["ap_moyenne"])
        out["modeles"][key] = {"essais": res, "retenu": best["params"], "ap_retenu": best["ap_moyenne"]}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"→ {OUT}")


if __name__ == "__main__":
    main()
