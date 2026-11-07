"""
Entraînement et comparaison des 4 modèles de la Phase 2
=======================================================
Les 4 détecteurs apprennent UNIQUEMENT le comportement normal (apprentissage
non supervisé) sur le même split temporel que l'API (`phase2._split_tvt`) :

  train      = les 70 % premières lignes normales de l'année
  validation = moitié des normales restantes + première moitié des attaques
               -> choix des hyperparamètres et du seuil de décision (max F1)
  test       = le reste, jamais utilisé pour régler quoi que ce soit

  1. OCSVM_Multivarie   One-Class SVM RBF sur les 21 features (grille nu x gamma)
                        -> pipeline complet de l'API (SHAP, base, fichiers)
  2. Autoencodeur_PCA   autoencodeur linéaire (PCA, 95 % de variance) ;
                        score = erreur de reconstruction
  3. GNN_Correlation    graphe à 3 nœuds (capteurs) dont les arêtes sont les
                        corrélations glissantes ; score = écart des arêtes au
                        graphe normal appris
  4. Forecasting_LSTM   3 LSTM prédisent chaque capteur à partir des 2 autres ;
                        score = résidus de prévision normalisés

Usage :  cd backend && .venv/bin/python scripts/train_models.py
         (prérequis : scripts/build_dataset.py)
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.v1 import phase2  # noqa: E402
from app.core import paths  # noqa: E402
from app.db.session import AsyncSessionLocal, init_db  # noqa: E402
from app.domains.ml.entities import MLModel, ModelMetric  # noqa: E402

SEED = 42
FEATURES = phase2.FEATURE_COLS
SENSORS = {"weather": "weather_temp", "fridge": "fridge_temp", "thermostat": "thermostat_temp"}

GNN_WINDOW = 72          # 6 h au pas de 5 min
LSTM_SEQ = 12            # 1 h d'historique
LSTM_HIDDEN = 32
LSTM_EPOCHS = 8
LSTM_MAX_TRAIN = 50_000

T0 = time.time()


def log(msg: str) -> None:
    print(f"[{time.time() - T0:6.1f}s] {msg}", flush=True)


# ════════════════════════════════════════════════════════════════════════════
# Modèles 2 à 4 : chacun renvoie un score d'anomalie par ligne (plus grand = plus anormal)
# ════════════════════════════════════════════════════════════════════════════

def train_autoencoder_pca(X_s: np.ndarray, train_idx: np.ndarray) -> tuple[np.ndarray, dict]:
    from sklearn.decomposition import PCA

    pca = PCA(n_components=0.95, random_state=SEED).fit(X_s[train_idx])
    recon = pca.inverse_transform(pca.transform(X_s))
    scores = np.mean((X_s - recon) ** 2, axis=1)
    joblib.dump(pca, paths.model_file("autoencoder_pca.pkl"))
    params = {"n_components": int(pca.n_components_), "variance_kept": 0.95,
              "explained_variance": round(float(pca.explained_variance_ratio_.sum()), 4)}
    log(f"  Autoencodeur PCA : {pca.n_components_} composantes / {X_s.shape[1]}")
    return scores, params


def train_gnn_correlation(df: pd.DataFrame, train_idx: np.ndarray) -> tuple[np.ndarray, dict]:
    edges = {
        "weather-fridge": ("weather_temp", "fridge_temp"),
        "weather-thermostat": ("weather_temp", "thermostat_temp"),
        "fridge-thermostat": ("fridge_temp", "thermostat_temp"),
    }
    corr = {}
    for name, (a, b) in edges.items():
        # Corrélation de Pearson glissante = poids de l'arête ; un capteur figé
        # (variance nulle) coupe l'arête -> 0.
        corr[name] = df[a].rolling(GNN_WINDOW, min_periods=GNN_WINDOW).corr(df[b])
    corr = pd.DataFrame(corr)
    warmup = corr.isna().all(axis=1)
    corr = corr.fillna(0.0)

    normal = corr.iloc[train_idx][~warmup.iloc[train_idx].to_numpy()]
    mu, sigma = normal.mean(), normal.std().replace(0, 1e-6)
    z = ((corr - mu) / sigma).abs()
    scores = z.sum(axis=1).to_numpy()
    scores[warmup.to_numpy()] = 0.0

    stats = {"window": GNN_WINDOW, "edges": list(edges),
             "edge_mean": mu.round(4).to_dict(), "edge_std": sigma.round(4).to_dict()}
    with open(paths.model_file("gnn_correlation.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2)
    log(f"  GNN corrélation : arêtes normales {mu.round(3).to_dict()}")
    return scores, {"window_steps": GNN_WINDOW, "window_hours": GNN_WINDOW * 5 / 60,
                    "edge_mean": stats["edge_mean"]}


def train_forecasting_lstm(df: pd.DataFrame, X_s: np.ndarray, train_idx: np.ndarray,
                           val_norm_idx: np.ndarray, is_attack: np.ndarray) -> tuple[np.ndarray, dict]:
    import torch
    import torch.nn as nn

    torch.manual_seed(SEED)
    torch.set_num_threads(8)
    rng = np.random.default_rng(SEED)
    col = {c: i for i, c in enumerate(FEATURES)}
    time_cols = [col[c] for c in ("hour_sin", "hour_cos", "season_sin", "season_cos")]
    n = len(X_s)

    # Une fenêtre se termine à t ; elle est utilisable pour l'apprentissage si
    # aucune de ses lignes n'est une attaque.
    attack_cum = np.concatenate([[0], np.cumsum(is_attack.astype(int))])
    ends = np.arange(LSTM_SEQ - 1, n)
    clean = (attack_cum[ends + 1] - attack_cum[ends + 1 - LSTM_SEQ]) == 0
    train_set, val_set = set(train_idx.tolist()), set(val_norm_idx.tolist())
    tr_ends = np.array([t for t, ok in zip(ends, clean) if ok and t in train_set])
    va_ends = np.array([t for t, ok in zip(ends, clean) if ok and t in val_set])
    if len(tr_ends) > LSTM_MAX_TRAIN:
        tr_ends = np.sort(rng.choice(tr_ends, LSTM_MAX_TRAIN, replace=False))

    class CrossSensorLSTM(nn.Module):
        def __init__(self, n_in: int):
            super().__init__()
            self.lstm = nn.LSTM(n_in, LSTM_HIDDEN, num_layers=1, batch_first=True)
            self.head = nn.Linear(LSTM_HIDDEN, 1)

        def forward(self, x):
            out, _ = self.lstm(x)
            return self.head(out[:, -1, :]).squeeze(-1)

    def windows(inputs: np.ndarray, end_idx: np.ndarray) -> np.ndarray:
        offs = np.arange(-LSTM_SEQ + 1, 1)
        return inputs[end_idx[:, None] + offs[None, :]]

    residuals, configs = {}, {}
    for target, tcol in SENSORS.items():
        others = [s for s in SENSORS if s != target]
        in_cols = ([col[SENSORS[o]] for o in others] + [col[f"{o}_diff_1"] for o in others]
                   + time_cols)
        inputs = X_s[:, in_cols].astype(np.float32)
        y = X_s[:, col[tcol]].astype(np.float32)

        model = CrossSensorLSTM(len(in_cols))
        opt = torch.optim.Adam(model.parameters(), lr=1e-3)
        loss_fn = nn.MSELoss()
        Xtr = torch.from_numpy(windows(inputs, tr_ends)); ytr = torch.from_numpy(y[tr_ends])
        Xva = torch.from_numpy(windows(inputs, va_ends)); yva = torch.from_numpy(y[va_ends])

        best, best_state, patience = float("inf"), None, 0
        for epoch in range(LSTM_EPOCHS):
            model.train()
            perm = torch.randperm(len(Xtr))
            for i in range(0, len(Xtr), 512):
                b = perm[i:i + 512]
                opt.zero_grad()
                loss = loss_fn(model(Xtr[b]), ytr[b])
                loss.backward()
                opt.step()
            model.eval()
            with torch.no_grad():
                val_loss = float(loss_fn(model(Xva), yva))
            if val_loss < best - 1e-5:
                best, patience = val_loss, 0
                best_state = {k: v.clone() for k, v in model.state_dict().items()}
            else:
                patience += 1
                if patience >= 2:
                    break
        model.load_state_dict(best_state)
        torch.save(model.state_dict(), paths.model_file(f"forecast_lstm_{target}.pt"))

        model.eval()
        pred = np.zeros(n, dtype=np.float32)
        with torch.no_grad():
            for i in range(0, len(ends), 8192):
                e = ends[i:i + 8192]
                pred[e] = model(torch.from_numpy(windows(inputs, e))).numpy()
        resid = np.abs(y - pred)
        resid[: LSTM_SEQ - 1] = np.nan
        residuals[target] = resid
        configs[target] = {"inputs": [FEATURES[c] for c in in_cols], "val_mse": round(best, 5),
                           "epochs": epoch + 1}
        log(f"  LSTM {target:10s} val MSE {best:.4f} ({epoch + 1} époques)")

    scores = np.zeros(n)
    norm = {}
    for target, resid in residuals.items():
        mu, sd = float(np.nanmean(resid[va_ends])), float(np.nanstd(resid[va_ends]) or 1e-6)
        norm[target] = {"mean": round(mu, 5), "std": round(sd, 5)}
        scores += np.nan_to_num((resid - mu) / sd, nan=0.0)
    with open(paths.model_file("forecast_lstm.json"), "w", encoding="utf-8") as f:
        json.dump({"seq_len": LSTM_SEQ, "hidden": LSTM_HIDDEN, "sensors": configs,
                   "residual_norm": norm}, f, indent=2)
    return scores, {"seq_len": LSTM_SEQ, "hidden": LSTM_HIDDEN, "per_sensor": configs}


# ════════════════════════════════════════════════════════════════════════════
# Évaluation commune
# ════════════════════════════════════════════════════════════════════════════

def evaluate(scores: np.ndarray, y: np.ndarray, attack_type: pd.Series,
             val_idx: np.ndarray, test_idx: np.ndarray) -> dict:
    thr = phase2._best_f1_threshold(y[val_idx], scores[val_idx])
    val_auc = phase2._evaluate_pr(y[val_idx], scores[val_idx], thr)["roc_auc"]
    m = phase2._evaluate_pr(y[test_idx], scores[test_idx], thr)
    metrics = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in m.items()}
    metrics["val_roc_auc"] = round(val_auc, 4)

    per_attack = []
    t_types = attack_type.iloc[test_idx]
    t_scores, t_y = scores[test_idx], y[test_idx]
    for atk in sorted(t_types[t_y == 1].unique()):
        mask = (t_types == atk).to_numpy() & (t_y == 1)
        det = int((t_scores[mask] >= thr).sum())
        per_attack.append({"attack_type": atk, "n_total": int(mask.sum()), "n_detected": det,
                           "detection_rate": round(det / max(1, mask.sum()) * 100, 1),
                           "avg_score": round(float(t_scores[mask].mean()), 4)})
    return {"metrics": metrics, "per_attack": per_attack}


async def persist(model_id: str, name: str, model_type: str, params: dict, result: dict,
                  n_train: int, trained_at: datetime, model_path: str) -> None:
    m = result["metrics"]
    async with AsyncSessionLocal() as db:
        db.add(MLModel(
            id=model_id, name=name, model_type=model_type, sensor="combine", version="1.0.0",
            hyperparameters=params, features=FEATURES, feature_count=len(FEATURES),
            training_samples=n_train, contamination=0.0, n_estimators=0,
            anomaly_rate_normal=m["fpr"], precision=m["precision"], recall=m["recall"],
            f1=m["f1"], roc_auc=m["roc_auc"], ap=m["avg_precision"], fpr=m["fpr"],
            tp=m["tp"], fp=m["fp"], fn=m["fn"], tn=m["tn"], status="trained",
            trained_at=trained_at, model_path=model_path,
            result_json={"model_metrics": m, "attack_metrics": result["per_attack"],
                         "hyperparameters": params},
        ))
        for atk in result["per_attack"]:
            db.add(ModelMetric(
                model_id=model_id, attack_type=atk["attack_type"], capteur="combine",
                n_total=atk["n_total"], n_anomalies=atk["n_detected"],
                taux_detection=atk["detection_rate"], score_moyen=atk["avg_score"],
                roc_auc=m["roc_auc"], avg_precision=m["avg_precision"],
                precision_normal=m["precision"], recall_normal=m["recall"], f1_normal=m["f1"],
            ))
        await db.commit()


async def main() -> None:
    if not paths.DATASET_FUSIONNE.exists():
        sys.exit(f"Dataset absent : {paths.DATASET_FUSIONNE}\nLancez d'abord scripts/build_dataset.py")
    await init_db()
    trained_at = datetime.now()
    stamp = trained_at.strftime("%Y%m%d_%H%M%S")

    log("[1/4] OCSVM_Multivarie — pipeline complet de l'API (grille, SHAP, base)")
    ocsvm = await phase2._run_training(files={})
    log(f"  OCSVM test : {json.dumps({k: ocsvm['model_metrics'][k] for k in ('roc_auc', 'precision', 'recall', 'f1', 'fpr')})}")

    df = phase2._load_fusionne_dataset()
    train, val, test = phase2._split_tvt(df)
    train_idx, val_idx, test_idx = train.index.to_numpy(), val.index.to_numpy(), test.index.to_numpy()
    y = df["label"].to_numpy().astype(int)
    val_norm_idx = val_idx[y[val_idx] == 0]
    attack_type = df["attack_type"].fillna("normal").astype(str)
    scaler = joblib.load(paths.OCSVM_SCALER)
    X_s = scaler.transform(df[FEATURES].to_numpy())

    results = {"OCSVM_Multivarie": {
        "name": "One-Class SVM multivarié", "model_type": "one_class_svm",
        "metrics": {**ocsvm["model_metrics"], "avg_precision": ocsvm["model_metrics"]["average_precision"]},
        "per_attack": [{k: a[k] for k in ("attack_type", "n_total", "n_detected", "detection_rate", "avg_score")}
                       for a in ocsvm["attack_metrics"]],
        "hyperparameters": ocsvm["best_params"],
    }}

    specs = [
        ("Autoencodeur_PCA", "Autoencodeur linéaire (PCA)", "autoencoder",
         lambda: train_autoencoder_pca(X_s, train_idx), "autoencoder_pca.pkl"),
        ("GNN_Correlation", "Graphe de corrélation inter-capteurs", "gnn_correlation",
         lambda: train_gnn_correlation(df, train_idx), "gnn_correlation.json"),
        ("Forecasting_LSTM", "Prévision croisée LSTM", "lstm",
         lambda: train_forecasting_lstm(df, X_s, train_idx, val_norm_idx, y == 1), "forecast_lstm.json"),
    ]
    for step, (mid, name, mtype, fn, fname) in enumerate(specs, start=2):
        log(f"[{step}/4] {mid}")
        scores, params = fn()
        res = evaluate(scores, y, attack_type, val_idx, test_idx)
        m = res["metrics"]
        log(f"  {mid} test : AUC {m['roc_auc']:.4f} | P {m['precision']:.3f} R {m['recall']:.3f} "
            f"F1 {m['f1']:.3f} FPR {m['fpr']:.4f}")
        await persist(f"{mid}_{stamp}", name, mtype, params, res, len(train_idx), trained_at,
                      paths.model_file(fname))
        results[mid] = {"name": name, "model_type": mtype, "metrics": m,
                        "per_attack": res["per_attack"], "hyperparameters": params}

    summary = {
        "generated_at": trained_at.isoformat(timespec="seconds"),
        "dataset": str(paths.DATASET_FUSIONNE.name),
        "split": {"n_train": len(train_idx), "n_val": len(val_idx), "n_test": len(test_idx),
                  "n_attack_val": int(y[val_idx].sum()), "n_attack_test": int(y[test_idx].sum()),
                  "threshold_rule": "max F1 sur la validation, appliqué au test"},
        "models": results,
    }
    with open(paths.RESULTS_COMPARISON, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, default=str)
    live = {mid: {**r["metrics"], "trained_at": summary["generated_at"]} for mid, r in results.items()}
    with open(paths.LIVE_RESULTS, "w", encoding="utf-8") as f:
        json.dump(live, f, indent=2, default=str)

    log("Comparaison (test) :")
    print(f"{'Modèle':20s} {'AUC':>7s} {'AP':>7s} {'Préc.':>7s} {'Rappel':>7s} {'F1':>7s} {'FPR':>7s}")
    for mid, r in results.items():
        m = r["metrics"]
        print(f"{mid:20s} {m['roc_auc']:7.4f} {m['avg_precision']:7.4f} {m['precision']:7.3f} "
              f"{m['recall']:7.3f} {m['f1']:7.3f} {m['fpr']:7.4f}")
    log(f"Résultats : {paths.RESULTS_COMPARISON}")


if __name__ == "__main__":
    asyncio.run(main())
