"""Advanced Analytics — graphes et fonctionnalités complémentaires du dashboard.

Ce module expose des ANALYSES qui n'existent pas ailleurs dans la plateforme
(gauche d'exploration des courbes de performance, distribution des scores,
réseau de corrélation inter-capteurs, historique d'entraînement, recherche
globale transverse et triage des alertes). Il ne duplique volontairement
aucun endpoint existant (fusion_insights, dataset_analytics, phase2...).

Toutes les valeurs proviennent des artefacts produits par l'entraînement réel
(ocsvm_multivarie.pkl + dataset_fusionne.csv + multivarie_inferred_ocsvm.json).
"""

import asyncio
import hashlib
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Body, Depends, Query
from pydantic import BaseModel, Field
from sklearn.metrics import precision_recall_curve, roc_curve
from sqlalchemy import select

from app.domains.auth.service import require_any_role
from app.domains.ml.entities import MLModel

router = APIRouter()

# ────────────────────────────────────────────────────────────────────────────
#  Chemins des artefacts produits par l'entraînement réel (phase2)
# ────────────────────────────────────────────────────────────────────────────

_HERE = os.path.dirname(os.path.abspath(__file__))
_BASE_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(_HERE))))
_PROJECT = _BASE_ROOT
_PHASE2 = os.path.join(_PROJECT, "phase2", "Data", "Processed")
_MODELS_DIR = os.path.join(_PHASE2, "models")

INFERRED_PATH = os.path.join(_PHASE2, "multivarie_inferred_ocsvm.json")
THRESHOLD_PATH = os.path.join(_MODELS_DIR, "threshold_ocsvm.json")
HYPERPARAMS_PATH = os.path.join(_MODELS_DIR, "hyperparams_ocsvm.json")
LIVE_RESULTS_PATH = os.path.join(_MODELS_DIR, "live_trained_results.json")
TRIAGE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(_HERE))), "alert_triage.json")

_executor = ThreadPoolExecutor(max_workers=1)
_analysis_cache: dict | None = None
_analysis_lock = threading.Lock()
_triage_lock = threading.Lock()

CURVE_MAX_POINTS = 180
DIST_BINS = 40


def _round(v, nd=6):
    try:
        f = float(v)
        return round(f, nd) if np.isfinite(f) else 0.0
    except Exception:
        return 0.0


def _auc_xy(x, y):
    """Aire sous la courbe par méthode des trapèzes (compatible numpy>=2)."""
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    return float(np.sum(np.abs(np.diff(x)) * (y[:-1] + y[1:])) / 2.0)


# ────────────────────────────────────────────────────────────────────────────
#  Génération des données (chargement dataset inféré + OCSVM)
# ────────────────────────────────────────────────────────────────────────────

def _read_json(path: str, default=None):
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return default


def _load_inferred_df() -> Optional[pd.DataFrame]:
    """Charge le dataset avec prédictions OCSVM + anomaly_scores.

    Préfère `multivarie_inferred_ocsvm.json` (déjà calculé à l'entraînement).
    Sinon délègue à phase2_timeline (qui recalcule puis met en cache).
    """
    if os.path.exists(INFERRED_PATH):
        df = pd.read_json(INFERRED_PATH)
        if "datetime" in df.columns:
            df["datetime"] = pd.to_datetime(df["datetime"])
        return df
    from app.api.v1 import phase2_timeline
    return phase2_timeline._ensure_cached()


def _apply_stride(values, max_points: int):
    """Échantillonne une séquence en couvrant toute l'étendue (stride)."""
    n = len(values)
    if n <= max_points:
        return values
    step = max(1, n // max_points)
    return values[::step]


def _compute_curves_distribution(df: pd.DataFrame, threshold: float | None) -> dict:
    y = df["label"].astype(int).to_numpy()
    s = df["anomaly_score"].to_numpy(dtype=float)
    pred = df["prediction"].astype(int).to_numpy()

    n = len(y)
    max_sample = 25000
    step = max(1, n // max_sample)
    idx = np.arange(0, n, step)
    y_s, s_s, pred_s = y[idx], s[idx], pred[idx]

    n_normal = int((y_s == 0).sum())
    n_attack = int((y_s == 1).sum())

    roc = {"points": [], "auc": None, "op": None}
    pr = {"points": [], "ap": None, "op": None}

    if n_normal > 0 and n_attack > 0:
        # ── Courbe ROC ─────────────────────────────────────────────
        fpr, tpr, _ = roc_curve(y_s, s_s)
        fpr_l = _apply_stride([_round(v) for v in fpr.tolist()], CURVE_MAX_POINTS)
        tpr_l = _apply_stride([_round(v) for v in tpr.tolist()], CURVE_MAX_POINTS)
        roc["points"] = [dict(x=fpr_l[i], y=tpr_l[i]) for i in range(len(fpr_l))]
        roc["auc"] = _round(_auc_xy(fpr, tpr))

        # ── Courbe Precision-Rappel ─────────────────────────────────
        prec, rec, _ = precision_recall_curve(y_s, s_s)
        prec_l = _apply_stride([_round(v) for v in prec.tolist()], CURVE_MAX_POINTS)
        rec_l = _apply_stride([_round(v) for v in rec.tolist()], CURVE_MAX_POINTS)
        pr["points"] = [dict(x=rec_l[i], y=prec_l[i]) for i in range(len(rec_l))]
        pr["ap"] = _round(_auc_xy(rec_l, prec_l))

    # ── Point de fonctionnement au seuil PR retenu ──────────────────
    if threshold is not None:
        mask = s_s >= threshold
        tp = int((mask & (y_s == 1)).sum())
        fp = int((mask & (y_s == 0)).sum())
        tn = int((~mask & (y_s == 0)).sum())
        fn = int((~mask & (y_s == 1)).sum())
        op_tpr = tp / (tp + fn) if (tp + fn) else 0.0
        op_fpr = fp / (fp + tn) if (fp + tn) else 0.0
        op_prec = tp / (tp + fp) if (tp + fp) else 0.0
        op_rec = op_tpr
        roc["op"] = {"x": _round(op_fpr), "y": _round(op_tpr), "fpr": _round(op_fpr), "tpr": _round(op_tpr)}
        pr["op"] = {"x": _round(op_rec), "y": _round(op_prec), "recall": _round(op_rec), "precision": _round(op_prec)}

    # ── Distribution des scores d'anomalie (normaux vs attaques) ──
    dist = {"bins": [], "normal": [], "attack": [], "threshold_bin": None, "threshold_value": threshold}
    vmin, vmax = float(s_s.min()), float(s_s.max())
    if vmax > vmin:
        bin_edges = np.linspace(vmin, vmax, DIST_BINS + 1)
        centers = [(bin_edges[i] + bin_edges[i + 1]) / 2 for i in range(DIST_BINS)]
        hist_n, _ = np.histogram(s_s[y_s == 0], bins=bin_edges)
        hist_a, _ = np.histogram(s_s[y_s == 1], bins=bin_edges)
        dist["bins"] = [_round(c, 4) for c in centers]
        dist["normal"] = [int(x) for x in hist_n]
        dist["attack"] = [int(x) for x in hist_a]
        if threshold is not None and vmin <= threshold <= vmax:
            edge_hits = [i for i in range(DIST_BINS) if bin_edges[i] <= threshold <= bin_edges[i + 1]]
            dist["threshold_bin"] = edge_hits[-1] if edge_hits else None

    return {
        "sampled": {"n_total": int(len(idx)), "n_normal": n_normal, "n_attack": n_attack},
        "roc": roc,
        "pr": pr,
        "distribution": dist,
    }


def _compute_correlations(df: pd.DataFrame) -> dict:
    """Corrélations de Pearson entre les températures et leurs écarts inter-capteurs."""
    feats = [
        ("weather_temp", "Weather"),
        ("fridge_temp", "Fridge"),
        ("thermostat_temp", "Thermostat"),
        ("w_f_diff", "Weather−Fridge"),
        ("w_t_diff", "Weather−Thermostat"),
        ("f_t_diff", "Fridge−Thermostat"),
    ]
    cols = [f[0] for f in feats]
    arr = np.column_stack([
        df["weather_temp"].astype(float).to_numpy(),
        df["fridge_temp"].astype(float).to_numpy(),
        df["thermostat_temp"].astype(float).to_numpy(),
        (df["weather_temp"] - df["fridge_temp"]).astype(float).to_numpy(),
        (df["weather_temp"] - df["thermostat_temp"]).astype(float).to_numpy(),
        (df["fridge_temp"] - df["thermostat_temp"]).astype(float).to_numpy(),
    ])
    corr = np.corrcoef(arr.T)
    corr = np.nan_to_num(corr, nan=0.0)
    n = len(cols)
    edges = []
    for i in range(n):
        for j in range(i + 1, n):
            w = float(corr[i, j])
            if abs(w) >= 0.1:
                edges.append({
                    "source": cols[i], "target": cols[j],
                    "label": feats[i][1], "label_target": feats[j][1],
                    "weight": _round(w, 4),
                })
    return {
        "nodes": [{"id": cols[i], "label": feats[i][1], "group": "sensor" if i < 3 else "delta"} for i in range(n)],
        "edges": sorted(edges, key=lambda e: abs(e["weight"]), reverse=True),
    }


def _compute_analysis() -> dict:
    df = _load_inferred_df()
    if df is None or len(df) == 0 or not {"anomaly_score", "label", "prediction"} <= set(df.columns):
        return {"available": False, "error": "Aucun résultat d'entraînement disponible — lancez l'entraînement depuis la page ML."}

    threshold = None
    thr_json = _read_json(THRESHOLD_PATH)
    if isinstance(thr_json, dict):
        threshold = thr_json.get("threshold")

    metrics = {}
    live = _read_json(LIVE_RESULTS_PATH)
    if isinstance(live, dict):
        metrics = live.get("OCSVM_Multivarie") or {}

    hyper = _read_json(HYPERPARAMS_PATH) or {}
    params = hyper.get("best_params") or {}

    body = _compute_curves_distribution(df, threshold)
    body["available"] = True
    body["model_meta"] = {
        "model_type": "OneClassSVM",
        "params": params,
        "threshold": _round(threshold) if threshold is not None else None,
        "n_samples_total": int(len(df)),
        "trained_at": metrics.get("trained_at") or thr_json.get("trained_at"),
        "metrics": {
            "f1": metrics.get("f1"),
            "roc_auc": metrics.get("roc_auc"),
            "recall": metrics.get("recall"),
            "precision": metrics.get("precision"),
            "ap": metrics.get("ap"),
            "fpr": metrics.get("fpr"),
        },
    }
    body["correlations"] = _compute_correlations(df)
    return body


@router.get("/advanced-analytics/model-analysis")
async def get_model_analysis(_user=Depends(require_any_role())):
    """Courbes ROC / Precision-Recall, distribution des scores et réseau de corrélation."""
    global _analysis_cache
    if _analysis_cache is None:
        loop = asyncio.get_event_loop()
        with _analysis_lock:
            if _analysis_cache is None:
                _analysis_cache = await loop.run_in_executor(_executor, _compute_analysis)
    return _analysis_cache


# ────────────────────────────────────────────────────────────────────────────
#  Historique des métriques sur les runs d'entraînement
# ────────────────────────────────────────────────────────────────────────────

async def _load_history_from_db() -> dict:
    """Runs persistés en base (ml_models) — id normalisé sans suffixe horodaté."""
    result = {}
    try:
        from app.db.session import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(
                select(MLModel).where(MLModel.status.in_(["trained", "deployed"]))
            )).scalars().all()
        for m in rows:
            mid = str(m.id or "")
            if mid.lower().startswith("if_"):
                continue
            if m.roc_auc or m.f1:
                result[mid] = {
                    "id": mid,
                    "name": m.name,
                    "model_type": m.model_type,
                    "trained_at": (m.trained_at.isoformat() if m.trained_at else None),
                    "f1": _round(m.f1, 4), "roc_auc": _round(m.roc_auc, 4),
                    "precision": _round(m.precision, 4), "recall": _round(m.recall, 4),
                    "ap": _round(m.ap, 4), "fpr": _round(m.fpr, 4),
                }
    except Exception:
        pass
    return result


def _load_history_from_disk() -> dict:
    """Runs du fichier live_trained_results.json."""
    result = {}
    live = _read_json(LIVE_RESULTS_PATH)
    if not isinstance(live, dict):
        return result
    for mid, m in live.items():
        if mid.lower().startswith("if_") and mid not in ("IF_Multivarie",):
            continue
        result[mid] = {
            "id": mid,
            "name": f"Modèle {mid}",
            "model_type": "IF_Multivarie" if mid.lower().startswith("if_") else "one_class_svm",
            "trained_at": m.get("trained_at"),
            "f1": _round(m.get("f1")) if m.get("f1") is not None else 0.0,
            "roc_auc": _round(m.get("roc_auc")) if m.get("roc_auc") is not None else 0.0,
            "precision": _round(m.get("precision")) if m.get("precision") is not None else 0.0,
            "recall": _round(m.get("recall")) if m.get("recall") is not None else 0.0,
            "ap": _round(m.get("ap")) if m.get("ap") is not None else 0.0,
            "fpr": _round(m.get("fpr")) if m.get("fpr") is not None else 0.0,
        }
    return result


@router.get("/advanced-analytics/metrics-history")
async def get_metrics_history(_user=Depends(require_any_role())):
    """Évolution des métriques (F1, ROC-AUC, rappel, précision) par run d'entraînement."""
    merged: dict = {}
    merged.update(_load_history_from_disk())
    merged.update(await _load_history_from_db())

    def _sort_key(row: dict):
        ts = row.get("trained_at")
        try:
            if ts:
                return datetime.fromisoformat(str(ts)).timestamp()
        except Exception:
            pass
        return float("inf")

    rows = sorted(merged.values(), key=_sort_key)
    return {"available": len(rows) > 0, "runs": rows}


# ────────────────────────────────────────────────────────────────────────────
#  Recherche globale transverse
# ────────────────────────────────────────────────────────────────────────────

def _alert_text_fields(a: dict) -> str:
    parts = [str(a.get("rule", {}).get("id", "")), str(a.get("rule", {}).get("name", "")),
             str(a.get("rule", {}).get("description", "")), str(a.get("data", {}).get("device", "")),
             str(a.get("timestamp", ""))]
    return " ".join(parts).lower()


@router.get("/advanced-analytics/global-search")
async def global_search(
    q: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(8, ge=1, le=25),
    _user=Depends(require_any_role()),
):
    """Recherche globale transverse : alertes DPI, équipements IoT, modèles ML."""
    query = q.strip().lower()
    if len(query) < 2:
        return {"query": q, "total": 0, "groups": []}

    if not isinstance(limit, int):
        _default = getattr(limit, "default", 8)
        limit = int(_default) if isinstance(_default, int) else 8
    limit = max(1, min(limit, 25))

    groups = []

    # ── 1. Alertes DPI (fichier log Wazuh-compatible) ─────────────
    try:
        from app.api.v1 import alerts as alerts_api
        alert_rows = alerts_api._read_alerts()
        matched = [a for a in alert_rows if query in _alert_text_fields(a)]
        matched = sorted(matched, key=lambda a: a.get("timestamp", ""), reverse=True)[:limit]
        if matched:
            items = []
            for a in matched:
                rule = a.get("rule", {}) or {}
                dev = (a.get("data", {}) or {}).get("device") or "inconnu"
                items.append({
                    "key": f"{a.get('timestamp', '')}|{rule.get('id', '')}|{dev}",
                    "title": rule.get("description") or rule.get("name") or "Alerte",
                    "subtitle": f"{rule.get('id', 'N/A')} · {dev}",
                    "meta": f"LVL {rule.get('level', '?')}",
                    "level": rule.get("level"),
                    "href": "/dashboard/phase1",
                })
            groups.append({"key": "alerts", "label": "Alertes DPI", "items": items})
    except Exception:
        pass

    # ── 2. Équipements IoT (PostgreSQL / SQLite) ───────────────────
    try:
        from app.db.session import AsyncSessionLocal
        from app.domains.devices.repository import DeviceRepository
        async with AsyncSessionLocal() as db:
            repo = DeviceRepository(db)
            devices = await repo.get_with_filters()
        matched_dev = []
        for d in devices:
            hay = " ".join([str(d.name), str(d.ip_address or ""), str(d.device_type or ""), str(d.location or "")]).lower()
            if query in hay:
                matched_dev.append(d)
        if matched_dev:
            items = []
            for d in matched_dev[:limit]:
                st_color = "#22C55E" if d.status == "online" else "#EF4444"
                items.append({
                    "key": d.id,
                    "title": d.name or d.id,
                    "subtitle": f"{d.device_type} · {d.location or '—'}",
                    "meta": d.status,
                    "status": st_color,
                    "risk": d.risk_score,
                    "href": "/dashboard/phase1",
                })
            groups.append({"key": "devices", "label": "Équipements IoT", "items": items})
    except Exception:
        pass

    # ── 3. Modèles ML (PostgreSQL / SQLite) ────────────────────────
    try:
        from app.db.session import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(MLModel).order_by(MLModel.trained_at.desc()).limit(50))).scalars().all()
        matched_models = []
        for m in rows:
            if m.id and m.id.lower().startswith("if_"):
                continue
            hay = " ".join([str(m.id or ""), str(m.name or ""), str(m.model_type or "")]).lower()
            if query in hay:
                matched_models.append(m)
        if matched_models:
            items = []
            for m in matched_models[:limit]:
                items.append({
                    "key": m.id,
                    "title": m.name or m.id,
                    "subtitle": f"{m.model_type} · {m.sensor or 'combine'}",
                    "meta": f"F1 {_round(m.f1, 3) * 100:.1f}%" if m.f1 else m.status,
                    "href": "/dashboard/results",
                })
            groups.append({"key": "models", "label": "Modèles ML", "items": items})
    except Exception:
        pass

    total = sum(len(g["items"]) for g in groups)
    return {"query": q, "total": total, "groups": groups}


# ────────────────────────────────────────────────────────────────────────────
#  Triage des alertes (acknowledge / résolu / faux positif)
# ────────────────────────────────────────────────────────────────────────────

VALID_STATUSES = {"open", "acknowledged", "resolved", "false_positive"}


def alert_key(alert: dict) -> str:
    """Clé stable d'une alerte (timestamp | rule.id | device)."""
    ts = alert.get("timestamp", "")
    rid = (alert.get("rule", {}) or {}).get("id", "")
    dev = (alert.get("data", {}) or {}).get("device", "")
    return f"{ts}|{rid}|{dev}"


def _read_triage() -> dict:
    try:
        if os.path.exists(TRIAGE_PATH):
            with open(TRIAGE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, dict) else {}
    except Exception:
        pass
    return {}


def _write_triage(data: dict):
    os.makedirs(os.path.dirname(TRIAGE_PATH) or ".", exist_ok=True)
    tmp = TRIAGE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, TRIAGE_PATH)


class TriageBody(BaseModel):
    key: str = Field(..., min_length=3, max_length=300)
    status: str = "open"
    note: str = Field("", max_length=500)


@router.get("/advanced-analytics/alerts/triage")
async def get_alert_triage(_user=Depends(require_any_role())):
    """Cartographie des statuts de triage (acknowledged / resolved / false_positive)."""
    return _read_triage()


@router.post("/advanced-analytics/alerts/triage")
async def set_alert_triage(
    body: TriageBody = Body(...),
    _user=Depends(require_any_role("operator")),
):
    """Change le statut de triage d'une alerte (ou réinitialise à 'open')."""
    status = body.status.lower()
    if status not in VALID_STATUSES:
        return {"ok": False, "error": f"Statut invalide: {status}"}
    with _triage_lock:
        data = _read_triage()
        data[body.key] = {
            "status": status,
            "note": (body.note or "").strip(),
            "updated_at": datetime.now().isoformat(timespec="seconds"),
        }
        _write_triage(data)
    return {"ok": True, "key": body.key, "status": status}