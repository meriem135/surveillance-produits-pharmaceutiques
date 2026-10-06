# -*- coding: utf-8 -*-
"""Genere les figures SHAP du rapport (Chapitre 3) depuis le pipeline VigiloChain.

Reutilise le modele OCSVM multivarie et le scaler de la plateforme, puis calcule
les valeurs SHAP (KernelExplainer, fond k-means) sur un echantillon stratifie de
400 points (200 normaux / 200 attaques).
"""
import os
import numpy as np
import pandas as pd
import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import shap

from app.core.paths import DATASET_FUSIONNE, PROJECT_ROOT
from app.domains.intelligence.ml_service import (
    MV_MODEL_PATH, MV_SCALER_PATH, MV_FEATURE_COLS,
)

OUT_DIR = str(PROJECT_ROOT / "rapport_latex" / "Chapitre3" / "figures")
os.makedirs(OUT_DIR, exist_ok=True)
CACHE = "shap_cache.npz"

RNG = np.random.RandomState(42)

# Labels francais pour les figures
FEAT_LABELS = {
    "weather_temp": "Température extérieure",
    "fridge_temp": "Température frigo (stockage)",
    "thermostat_temp": "Température thermostat (production)",
    "weather_diff_1": "Variation météo (diff 1)",
    "fridge_diff_1": "Variation frigo (diff 1)",
    "thermostat_diff_1": "Variation thermostat (diff 1)",
    "weather_roll_mean_10": "Moyenne glissante météo",
    "fridge_roll_mean_10": "Moyenne glissante frigo",
    "thermostat_roll_mean_10": "Moyenne glissante thermostat",
    "weather_roll_std_10": "Volatilité météo (std 10)",
    "fridge_roll_std_10": "Volatilité frigo (std 10)",
    "thermostat_roll_std_10": "Volatilité thermostat (std 10)",
    "weather_fridge_diff": "Écart météo–frigo",
    "weather_thermostat_diff": "Écart météo–thermostat",
    "fridge_thermostat_diff": "Écart frigo–thermostat",
    "hour_sin": "Heure (sinus)",
    "hour_cos": "Heure (cosinus)",
    "season_sin": "Saison (sinus)",
    "season_cos": "Saison (cosinus)",
    "fridge_cond_enc": "État compresseur frigo",
    "thermo_status": "Statut thermostat (clim.)",
}


def compute_or_load():
    if os.path.exists(CACHE):
        d = np.load(CACHE, allow_pickle=True)
        print("Cache SHAP reutilise.", flush=True)
        return d["sv"], d["X_explain"], float(d["expected_value"][0]), d["y_explain"]

    model = joblib.load(MV_MODEL_PATH)
    scaler = joblib.load(MV_SCALER_PATH)

    df = pd.read_csv(DATASET_FUSIONNE)
    df = df.rename(columns={
        "w_f_diff": "weather_fridge_diff",
        "w_t_diff": "weather_thermostat_diff",
        "f_t_diff": "fridge_thermostat_diff",
    })
    X = df[MV_FEATURE_COLS].copy()
    y = df["label"].astype(int).values
    print(f"Dataset : {X.shape[0]} lignes x {X.shape[1]} features ; attaques = {y.sum()}", flush=True)

    Xs = scaler.transform(X)
    Xn = pd.DataFrame(Xs, columns=MV_FEATURE_COLS)

    idx_n = RNG.choice(np.where(y == 0)[0], size=300, replace=False)
    background = shap.kmeans(Xn.iloc[idx_n].values, 64)

    idx_n_ex = RNG.choice(np.where(y == 0)[0], size=200, replace=False)
    idx_a_ex = RNG.choice(np.where(y == 1)[0], size=200, replace=False)
    idx_ex = np.concatenate([idx_n_ex, idx_a_ex])
    X_explain = Xn.iloc[idx_ex].values
    y_explain = y[idx_ex]

    fn = lambda M: model.decision_function(M)
    explainer = shap.KernelExplainer(fn, background)
    print("Calcul SHAP (KernelExplainer, fond k-means 64)...", flush=True)
    sv = explainer.shap_values(X_explain, nsamples=150, random_state=42, silent=True)
    sv = np.asarray(sv)
    expected_value = float(explainer.expected_value)

    np.savez(CACHE, sv=sv, X_explain=X_explain, expected_value=expected_value,
             y_explain=y_explain)
    print("Cache sauvegarde.", flush=True)
    return sv, X_explain, expected_value, y_explain


def main():
    sv, X_explain, expected_value, y_explain = compute_or_load()
    labels = [FEAT_LABELS[c] for c in MV_FEATURE_COLS]

    # --- Tableau (moyenne |SHAP| par feature) ---
    mean_abs = np.abs(sv).mean(axis=0)
    order = np.argsort(mean_abs)[::-1]
    sort_vals = mean_abs[order]
    sort_keys = [MV_FEATURE_COLS[i] for i in order]
    pct = sort_vals / sort_vals.sum() * 100

    print("=== TABLEAU (ordre decroissant) ===", flush=True)
    for k, v, p in zip(sort_keys, sort_vals, pct):
        print(f"{FEAT_LABELS[k]:40s} {v:12.4f} {p:7.1f} %", flush=True)
    print(f"expected_value = {expected_value:.4f}", flush=True)

    EXPL = shap.Explanation(values=sv, base_values=expected_value,
                            data=X_explain, feature_names=labels)

    # --- Figure 1 : importance globale ---
    sort_names = [labels[i] for i in order]
    fig, ax = plt.subplots(figsize=(9.2, 6.0))
    ypos = np.arange(len(sort_vals))[::-1]
    ax.barh(ypos, sort_vals, color="#2563EB", edgecolor="#1E3A8A", linewidth=0.6)
    for yi, v, p in zip(ypos, sort_vals, pct):
        ax.text(v + sort_vals.max() * 0.012, yi, f"{p:.1f} %", va="center", fontsize=9, color="#1E293B")
    ax.set_yticks(ypos)
    ax.set_yticklabels(sort_names, fontsize=10)
    ax.set_xlabel("Importance SHAP - moyenne de |valeur SHAP|", fontsize=10)
    ax.set_title("Importance globale des caracteristiques (One-Class SVM, KernelExplainer, 400 points)",
                 fontsize=11)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.grid(axis="x", color="#CBD5E1", linewidth=0.5, alpha=0.6)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT_DIR, "shap_global.png"), dpi=150, bbox_inches="tight")
    plt.close(fig)
    print("-> shap_global.png", flush=True)

    # --- Figure 2 : beeswarm ---
    try:
        shap.summary_plot(sv, X_explain, feature_names=labels, show=False, max_display=21)
        plt.title("Distribution des valeurs SHAP par caracteristique (rouge = valeur elevee)",
                  fontsize=11)
        plt.gcf().savefig(os.path.join(OUT_DIR, "shap_beeswarm.png"), dpi=150, bbox_inches="tight")
        plt.close("all")
        print("-> shap_beeswarm.png", flush=True)
    except Exception as exc:
        print(f"beeswarm ignore ({exc})", flush=True)

    # --- Figure 3 : waterfall d'un point d'attaque ---
    model = joblib.load(MV_MODEL_PATH)
    try:
        fig3 = plt.figure(figsize=(9.2, 6.0))
        scores = model.decision_function(X_explain)
        i_min = int(np.argmin(scores))  # point le plus anormal
        shap.plots.waterfall(EXPL[i_min], max_display=12, show=False)
        fig3.savefig(os.path.join(OUT_DIR, "shap_point_anomalie.png"), dpi=150, bbox_inches="tight")
        plt.close(fig3)
        print("-> shap_point_anomalie.png", flush=True)
    except Exception as exc:
        print(f"waterfall ignore ({exc})", flush=True)

    print("FIN OK", flush=True)


if __name__ == "__main__":
    main()