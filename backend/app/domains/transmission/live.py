# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/domains/transmission/live.py
#   TEMPS RÉEL : fait passer les mesures enregistrées une par une dans le modèle sauvegardé et
#   suit les alertes.
# ══════════════════════════════════════════════════════════════════════════
"""
Temps réel : les mesures du jeu de données passent une à une dans le modèle sauvegardé
=====================================================================================
Les lignes brutes (températures transmises, état du frigo et du thermostat) sont lues dans la
table transmission_dataset de l'étude de référence. Les features sont causales (elles ne
regardent que le passé, ≤ 15 min) : les calculer d'un coup sur l'historique donne exactement
ce qu'un flux calculerait mesure après mesure. Le SCORE, lui, est calculé en direct par le
modèle sauvegardé (models/transmission_reel/meilleur_modele.pkl) sur chaque paquet de mesures
envoyé, puis le seuil et la règle de persistance (k sur n) décident de l'alerte.
"""
from __future__ import annotations

import asyncio
import json
from collections import deque
from typing import Any

import numpy as np
import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.domains.transmission import repository, service
from app.domains.transmission.models import TransmissionDatasetRow

MODEL_PATH = service.OUT_DIR / "meilleur_modele.pkl"
CONFIG_PATH = service.OUT_DIR / "meilleur_modele.json"
_cache: dict[str, Any] = {}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _load_model
#   Rôle   : Charge le modèle sauvegardé (meilleur_modele.pkl) et son réglage (meilleur_modele.json).
#   Entrée : rien
#   Sortie : (modèle, réglage)
# ──────────────────────────────────────────────────────────────────────
def _load_model():
    import joblib  # noqa: PLC0415
    with open(CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    return joblib.load(MODEL_PATH), cfg


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] stream_source
#   Rôle   : Prépare le TEMPS RÉEL : lit les mesures en base, calcule les features et charge le modèle. Le
#            résultat est gardé en mémoire pour ne pas tout recalculer.
#   Entrée : session : connexion à la base
#   Sortie : dictionnaire (mesures, features, modèle, réglage) ou None
# ──────────────────────────────────────────────────────────────────────
async def stream_source(session: AsyncSession) -> dict | None:
    """Modèle, réglage et features du jeu de données en base (mis en cache par étude)."""
    run = await repository.reference_run(session)
    if run is None or not MODEL_PATH.exists() or not CONFIG_PATH.exists():
        return None
    if _cache.get("run_id") == run.id:
        return _cache
    rows = (await session.execute(
        select(TransmissionDatasetRow).where(TransmissionDatasetRow.run_id == run.id)
        .order_by(TransmissionDatasetRow.idx))).scalars().all()
    if not rows:
        return None
    df = pd.DataFrame([{"datetime": r.ts, "weather_temp": r.weather_temp, "fridge_temp": r.fridge_temp,
                        "thermostat_temp": r.thermostat_temp, "fridge_cond": r.fridge_cond,
                        "thermo_status": r.thermo_status, "label": r.label, "attack_type": r.attack_type,
                        "role": r.role, "evaluee": r.evaluee, "idx": r.idx} for r in rows])
    _, tm = service._scripts()
    model, cfg = await asyncio.to_thread(_load_model)
    feats_df, feats = await asyncio.to_thread(tm.engineer, df)
    if feats != cfg["features"]:
        return None
    _cache.clear()
    _cache.update(run_id=run.id, df=df, X=feats_df[feats].to_numpy(np.float32), model=model, cfg=cfg)
    return _cache


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] info
#   Rôle   : Résumé affiché sur la page Temps réel : modèle, seuil, règle k sur n, nombre de lignes par rôle.
#   Entrée : src : sortie de stream_source
#   Sortie : dictionnaire
# ──────────────────────────────────────────────────────────────────────
def info(src: dict) -> dict:
    df, cfg = src["df"], src["cfg"]
    return {"modele": cfg["modele"], "nom": cfg["nom"], "seuil": cfg["seuil"], "k": cfg["k"], "n": cfg["n"],
            "critere": cfg.get("critere"), "run_id": src["run_id"],
            "roles": {r: {"lignes": int(((df["role"] == r) & df["evaluee"]).sum()),
                          "episodes": int(((df["role"] == r) & (df["label"] == 1) &
                                           (df["label"].shift(1, fill_value=0) == 0)).sum())}
                      for r in ("train", "val", "test")}}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] Streamer
#   Rôle   : LECTEUR TEMPS RÉEL : fait passer les mesures une par une dans le modèle, comme un vrai flux de
#            capteurs, et suit les alertes (début, fin, vraie ou fausse).
# ──────────────────────────────────────────────────────────────────────
class Streamer:
    """Fait passer les lignes d'un rôle dans le modèle, paquet par paquet, avec l'état de persistance."""

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] Streamer.__init__
    #   Rôle   : Prépare la lecture des lignes d'un rôle (train, val ou test).
    #   Entrée : src : données et modèle ; role : rôle ; start : ligne de départ
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    def __init__(self, src: dict, role: str, start: int = 0):
        self.src = src
        df = src["df"]
        # Lignes évaluées seulement (hors zone de garde), comme l'évaluation hors ligne : les compteurs
        # d'alertes du temps réel sont ainsi comparables aux métriques de la page Résultats.
        self.rows = np.where((df["role"].to_numpy() == role) & df["evaluee"].to_numpy(bool))[0]
        self.pos = int(np.searchsorted(self.rows, start)) if start else 0
        self.k, self.n, self.seuil = int(src["cfg"]["k"]), int(src["cfg"]["n"]), float(src["cfg"]["seuil"])
        self.window: deque[bool] = deque(maxlen=self.n)
        self.prev_idx = None
        self.alarm = False
        self.alert_start = None
        self.stats = {"mesures": 0, "alertes": 0, "vraies": 0, "fausses": 0, "attaque_lignes": 0}
        self.alert_true = False

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] Streamer.done
    #   Rôle   : Vrai quand toutes les lignes ont été lues.
    #   Entrée : rien
    #   Sortie : vrai/faux
    # ──────────────────────────────────────────────────────────────────────
    def done(self) -> bool:
        return self.pos >= len(self.rows)

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] Streamer.next_batch
    #   Rôle   : LIT LE PAQUET SUIVANT de mesures : calcule le score du modèle, applique le seuil et la règle
    #            k sur n, détecte le début/la fin des alertes et met à jour les compteurs.
    #   Entrée : size : nombre de mesures du paquet
    #   Sortie : points pour le graphique, événements, statistiques, progression
    # ──────────────────────────────────────────────────────────────────────
    def next_batch(self, size: int) -> dict:
        df = self.src["df"]
        batch = self.rows[self.pos:self.pos + size]
        self.pos += len(batch)
        scores = self.src["model"].predict_proba(self.src["X"][batch])[:, 1]
        points, events = [], []
        for i, s in zip(batch.tolist(), scores.tolist()):
            if self.prev_idx is not None and i != self.prev_idx + 1:      # saut de bloc : nouvel historique
                self.window.clear()
                if self.alarm:
                    events.append(self._end(self.prev_idx))
                self.alarm = False
            self.prev_idx = i
            flag = s >= self.seuil
            self.window.append(flag)
            alarm = sum(self.window) >= self.k
            label = int(df.at[i, "label"])
            self.stats["mesures"] += 1
            self.stats["attaque_lignes"] += label
            if alarm and not self.alarm:
                self.alert_start, self.alert_true = i, bool(label)
                self.stats["alertes"] += 1
                events.append({"type": "debut", "idx": i, "ts": str(df.at[i, "datetime"]),
                               "attaque_reelle": str(df.at[i, "attack_type"]), "score": round(s, 4)})
            if alarm and label:
                self.alert_true = True
            if not alarm and self.alarm:
                events.append(self._end(i))
            self.alarm = alarm
            points.append({"idx": i, "ts": str(df.at[i, "datetime"]), "fridge": float(df.at[i, "fridge_temp"]),
                           "thermostat": float(df.at[i, "thermostat_temp"]), "weather": float(df.at[i, "weather_temp"]),
                           "score": round(s, 4), "signal": bool(flag), "alarme": bool(alarm), "label": label,
                           "attack_type": str(df.at[i, "attack_type"]), "evaluee": bool(df.at[i, "evaluee"])})
        return {"type": "mesures", "points": points, "evenements": events, "stats": dict(self.stats),
                "progression": round(self.pos / max(1, len(self.rows)), 4), "fini": self.done()}

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] Streamer._end
    #   Rôle   : Clôt une alerte et dit si elle était vraie (elle touchait une attaque) ou fausse.
    #   Entrée : i : ligne de fin
    #   Sortie : événement « fin »
    # ──────────────────────────────────────────────────────────────────────
    def _end(self, i: int) -> dict:
        vraie = self.alert_true
        self.stats["vraies" if vraie else "fausses"] += 1
        return {"type": "fin", "idx": i, "debut_idx": self.alert_start,
                "duree_min": round((i - (self.alert_start or i)) * 5 / 60, 2), "vraie": vraie}
