# -*- coding: utf-8 -*-
"""Régénère episodes_transmission_reel.json pour qu'il colle au nouveau dataset (run 0)."""
import sys, io, contextlib, json
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import numpy as np
import build_dataset as bd
import transmission_real as tr
from app.core import paths

with contextlib.redirect_stdout(io.StringIO()):
    real = bd.load_normal_traces()
base, _ = tr.fuse_real(real)
rng = np.random.default_rng(tr.SEED)
episodes = tr.build_schedule(len(base), rng, 0, roles=("train", "val", "test"))

out = paths.PROCESSED_DIR / "episodes_transmission_reel.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump(episodes, f, indent=1, ensure_ascii=False)
print(f"{out.name} : {len(episodes)} épisodes")
sp = {}
for e in episodes:
    sp[e["split"]] = sp.get(e["split"], 0) + 1
print("répartition :", sp)
