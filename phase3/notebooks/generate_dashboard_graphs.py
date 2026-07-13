"""
Dashboard IoT Annuel 2019 — Génération de graphiques professionnels
Utilise matplotlib/seaborn avec un thème sombre type Cyber Security
"""

import os, warnings, textwrap
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.patches import FancyBboxPatch
import seaborn as sns
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    classification_report, confusion_matrix,
    roc_curve, auc, precision_recall_curve
)

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(BASE, "Data", "Dashboard")
os.makedirs(OUT_DIR, exist_ok=True)

# ─── Palette & Style ────────────────────────────────────────────────
BG       = "#0E1117"   # fond principal
BG2      = "#1A1D27"   # fond carte
CARD_BG  = "#262B3A"   # fond carte plus clair
GRID     = "#2E3440"   # grilles
TEXT_C   = "#D8DEE9"   # texte principal
TEXT_S   = "#81A1C1"   # texte secondaire

# Couleurs des 3 capteurs + anomalies
C_W    = "#5E81AC"   # weather (bleu)
C_F    = "#A3BE8C"   # fridge (vert)
C_T    = "#BF616A"   # thermostat (rouge)
C_ATK  = "#E74C3C"   # attaque
C_NORM = "#4CAF50"   # normal
C_AX   = "#4C566A"   # axes

COLORS = [C_W, C_F, C_T]
LABELS = ["Weather", "Fridge", "Thermostat"]

sns.set_theme(style="darkgrid")
plt.rcParams.update({
    "figure.facecolor": BG, "axes.facecolor": BG2,
    "axes.edgecolor": GRID, "axes.labelcolor": TEXT_C,
    "text.color": TEXT_C, "xtick.color": TEXT_S, "ytick.color": TEXT_S,
    "grid.color": GRID, "grid.alpha": 0.3,
    "legend.facecolor": BG2, "legend.edgecolor": GRID,
    "legend.labelcolor": TEXT_C,
    "axes.spines.top": False, "axes.spines.right": False,
    "font.size": 11, "axes.titlesize": 15, "axes.labelsize": 12,
})

def save(fig, name, dpi=150):
    path = os.path.join(OUT_DIR, name)
    fig.savefig(path, dpi=dpi, bbox_inches="tight", facecolor=BG,
                edgecolor="none")
    plt.close(fig)
    print(f"  [OK] {name}")
    return path

def kpi_card(ax, label, value, color, unit=""):
    ax.set_facecolor(CARD_BG)
    ax.text(0.5, 0.65, f"{value}{unit}", fontsize=28, fontweight="bold",
            color=color, ha="center", va="center", transform=ax.transAxes)
    ax.text(0.5, 0.22, label, fontsize=10, color=TEXT_S,
            ha="center", va="center", transform=ax.transAxes)
    ax.set_xticks([]); ax.set_yticks([])
    for spine in ax.spines.values(): spine.set_visible(False)

# ─── CHARGEMENT ─────────────────────────────────────────────────────
print(" Chargement des donnees...")
df = pd.read_csv(os.path.join(BASE, "Data", "Generated", "generated_yearly_merged.csv"))
df["datetime"] = pd.to_datetime(df["datetime"])
df["month"] = df["datetime"].dt.month
df["day"] = df["datetime"].dt.day
df["hour"] = df["datetime"].dt.hour
df["week"] = df["datetime"].dt.isocalendar().week.astype(int)
df["doy"] = df["datetime"].dt.dayofyear
df["woy"] = df["datetime"].dt.isocalendar().week.astype(float)
atk = df[df["label"] == 1]
norm = df[df["label"] == 0]
print(f"  Total: {len(df):,} lignes | Normal: {len(norm):,} | Attaques: {len(atk):,}")

# ═══════════════════════════════════════════════════════════════════
# 1.  KPI GRID — 8 indicateurs clés
# ═══════════════════════════════════════════════════════════════════
print("\n[1/12] KPI Grid...")
fig, axes = plt.subplots(2, 4, figsize=(16, 5))
kpi_card(axes[0,0], "Points mesures", f"{len(df):,}", C_W)
kpi_card(axes[0,1], "Intervalle", "5 min", C_F)
kpi_card(axes[0,2], "Temp Weather Ø", f"{df['temperature'].mean():.1f}", C_W, "°C")
kpi_card(axes[0,3], "Temp Fridge Ø", f"{df['fridge_temperature'].mean():.1f}", C_F, "°C")
kpi_card(axes[1,0], "Temp Thermo Ø", f"{df['current_temperature'].mean():.1f}", C_T, "°C")
kpi_card(axes[1,1], "Attaques inj.", f"{len(atk):,}", C_ATK)
kpi_card(axes[1,2], "Taux attaque", f"{len(atk)/len(df)*100:.1f}", C_ATK, "%")
kpi_card(axes[1,3], "Jours couverts", "365", C_T)
fig.subplots_adjust(hspace=0.3, wspace=0.3)
save(fig, "kpi_grid.png")

# ═══════════════════════════════════════════════════════════════════
# 2.  ANNÉE COMPLÈTE — 3 capteurs superposés
# ═══════════════════════════════════════════════════════════════════
print("[2/12] Annee complete 3 capteurs...")
fig, axes = plt.subplots(3, 1, figsize=(18, 10), sharex=True)
data_map = [
    ("temperature",       "Weather — Temperature exterieure",         C_W),
    ("fridge_temperature","Fridge — Temperature frigo",              C_F),
    ("current_temperature","Thermostat — Temperature interieure",    C_T),
]
for ax, (col, title, color) in zip(axes, data_map):
    # Mean par jour avec bande min-max
    daily = df.groupby("doy")[col].agg(["mean", "min", "max"])
    ax.fill_between(daily.index, daily["min"], daily["max"],
                    alpha=0.12, color=color, linewidth=0)
    ax.plot(daily.index, daily["mean"], color=color, linewidth=1.4, alpha=0.9)
    # Anomalies (attaques)
    atk_daily = atk.groupby("doy")[col].mean()
    ax.scatter(atk_daily.index, atk_daily, color=C_ATK, s=12,
               edgecolors="white", linewidth=0.3, alpha=0.7, zorder=5)
    ax.set_ylabel("Temperature (°C)", color=TEXT_S, fontsize=10)
    ax.set_title(title, color=color, fontsize=12, fontweight="bold", loc="left")
    ax.set_xlim(1, 365)
    ax.tick_params(colors=TEXT_S)
    # Mois
    month_starts = pd.date_range("2019-01-01", "2019-12-01", freq="MS")
    ax.set_xticks([d.dayofyear for d in month_starts])
    ax.set_xticklabels(["Jan","Fev","Mar","Avr","Mai","Jun",
                         "Jul","Aou","Sep","Oct","Nov","Dec"],
                       fontsize=9, color=TEXT_S)
fig.tight_layout()
save(fig, "annee_complete_3_capteurs.png")

# ═══════════════════════════════════════════════════════════════════
# 3.  ATTAQUES — Timeline
# ═══════════════════════════════════════════════════════════════════
print("[3/12] Timeline attaques...")
fig, ax = plt.subplots(figsize=(18, 4))
atk_timeline = atk.set_index("datetime").resample("D").size()
norm_timeline = norm.set_index("datetime").resample("D").size()
ax.fill_between(norm_timeline.index, norm_timeline.values,
                alpha=0.2, color=C_NORM, label="Normal", step="mid")
ax.fill_between(atk_timeline.index, atk_timeline.values,
                alpha=0.7, color=C_ATK, label="Attaques", step="mid")
# Marquer les 3 dates d'injection
for d in ["2019-02-15", "2019-06-15", "2019-10-15"]:
    ax.axvline(pd.Timestamp(d), color="#FFD700", ls="--", lw=1.2, alpha=0.8)
    ax.text(pd.Timestamp(d), ax.get_ylim()[1]*0.9, d, fontsize=8,
            color="#FFD700", ha="center", rotation=90)
ax.set_ylabel("Points / jour")
ax.set_title("Distribution des attaques injectees (3 vagues: Fev, Juin, Oct)", fontsize=13, color=TEXT_C, loc="left")
ax.legend(fontsize=10, loc="upper right")
ax.xaxis.set_major_formatter(mdates.DateFormatter("%b"))
ax.xaxis.set_major_locator(mdates.MonthLocator())
fig.tight_layout()
save(fig, "timeline_attaques.png")

# ═══════════════════════════════════════════════════════════════════
# 4.  PROFIL JOURNALIER — Chaque saison
# ═══════════════════════════════════════════════════════════════════
print("[4/12] Profils journaliers par saison...")
seasons = {"Hiver":[1,2,12],"Printemps":[3,4,5],"Ete":[6,7,8],"Automne":[9,10,11]}
season_colors = {"Hiver":"#5E81AC","Printemps":"#A3BE8C","Ete":"#EBCB8B","Automne":"#D08770"}
cols_sensor = ["temperature","fridge_temperature","current_temperature"]
titles_sensor = ["Weather","Fridge","Thermostat"]

fig, axes = plt.subplots(3, 4, figsize=(18, 11))
for i, (col, title) in enumerate(zip(cols_sensor, titles_sensor)):
    for j, (sname, months) in enumerate(seasons.items()):
        ax = axes[i, j]
        mask = df["month"].isin(months) & (df["label"] == 0)
        sdf = df[mask].copy()
        profile = sdf.groupby("hour")[col].mean()
        std = sdf.groupby("hour")[col].std()
        ax.fill_between(profile.index, profile - std, profile + std,
                        alpha=0.15, color=season_colors[sname])
        ax.plot(profile.index, profile, color=season_colors[sname], lw=2)
        ax.set_title(f"{title} — {sname}", fontsize=11, color=season_colors[sname])
        ax.set_xlim(0, 23); ax.set_xticks([0,6,12,18])
        ax.set_ylabel("°C", fontsize=9) if j == 0 else None
fig.tight_layout()
save(fig, "profils_saisonniers.png")

# ═══════════════════════════════════════════════════════════════════
# 5.  DISTRIBUTIONS — Comparaison Normal vs Attaque
# ═══════════════════════════════════════════════════════════════════
print("[5/12] Distributions Normal vs Attaque...")
fig, axes = plt.subplots(1, 3, figsize=(16, 5))
for ax, (col, title, color) in zip(axes, data_map):
    sns.kdeplot(data=norm, x=col, ax=ax, color=C_NORM, fill=True,
                alpha=0.3, label="Normal", linewidth=2)
    sns.kdeplot(data=atk, x=col, ax=ax, color=C_ATK, fill=True,
                alpha=0.3, label="Attaque", linewidth=2)
    ax.set_title(title, color=color, fontweight="bold")
    ax.set_xlabel("Temperature (°C)")
    ax.legend(fontsize=9)
fig.tight_layout()
save(fig, "distributions_normal_vs_attaque.png")

# ═══════════════════════════════════════════════════════════════════
# 6.  HEATMAP MENSUELLE — Weather
# ═══════════════════════════════════════════════════════════════════
print("[6/12] Heatmap mensuelle Weather...")
pivot = df[df["label"] == 0].pivot_table(
    index="hour", columns="month", values="temperature", aggfunc="mean"
)
# Ensure all months are present even if no normal data
for m in range(1, 13):
    if m not in pivot.columns:
        pivot[m] = np.nan
pivot = pivot[sorted(pivot.columns)]
fig, ax = plt.subplots(figsize=(13, 5))
sns.heatmap(pivot, ax=ax, cmap="RdYlBu_r", cbar_kws={"label":"°C", "shrink":0.8},
            linewidths=0.3, linecolor=BG2, annot=True, fmt=".1f",
            annot_kws={"fontsize":8, "color":"white"})
ax.set_title("Temperature Weather — Moyenne par heure et par mois",
             fontsize=13, color=TEXT_C, loc="left")
ax.set_xlabel("Mois"); ax.set_ylabel("Heure")
ax.set_xticklabels(["Jan","Fev","Mar","Avr","Mai","Jun",
                     "Jul","Aou","Sep","Oct","Nov","Dec"], rotation=0)
fig.tight_layout()
save(fig, "heatmap_mensuelle_weather.png")

# ═══════════════════════════════════════════════════════════════════
# 7.  BOXPLOT MENSUEL — 3 capteurs
# ═══════════════════════════════════════════════════════════════════
print("[7/12] Boxplots mensuels...")
norm_long = norm.melt(
    id_vars=["month"],
    value_vars=["temperature","fridge_temperature","current_temperature"],
    var_name="sensor", value_name="temp"
)
sensor_map = {"temperature":"Weather","fridge_temperature":"Fridge","current_temperature":"Thermostat"}
norm_long["sensor"] = norm_long["sensor"].map(sensor_map)
fig, ax = plt.subplots(figsize=(16, 6))
sns.boxplot(data=norm_long, x="month", y="temp", hue="sensor",
            palette=COLORS, ax=ax, linewidth=0.8, fliersize=1.5)
ax.set_title("Distribution mensuelle des temperatures par capteur (donnees normales)",
             fontsize=13, color=TEXT_C, loc="left")
ax.set_xlabel("Mois"); ax.set_ylabel("Temperature (°C)")
ax.legend(fontsize=10, loc="upper right")
month_names = ["Jan","Fev","Mar","Avr","Mai","Jun","Jul","Aou","Sep","Oct","Nov","Dec"]
ax.set_xticklabels(month_names)
fig.tight_layout()
save(fig, "boxplots_mensuels.png")

# ═══════════════════════════════════════════════════════════════════
# 8.  MATRICE DE CORRÉLATION
# ═══════════════════════════════════════════════════════════════════
print("[8/12] Matrice de correlation...")
corr_cols = ["temperature","fridge_temperature","current_temperature",
             "hour_sin","hour_cos","season_sin","season_cos"]
fig, ax = plt.subplots(figsize=(9, 7))
corr = df[corr_cols].corr(method="pearson")
mask = np.triu(np.ones_like(corr, dtype=bool), k=1)
sns.heatmap(corr, mask=mask, annot=True, fmt=".2f", cmap="RdBu_r",
            center=0, vmin=-1, vmax=1, linewidths=0.5,
            linecolor=BG2, cbar_kws={"shrink":0.7},
            annot_kws={"fontsize":9}, ax=ax)
labels_clean = ["Weather Temp","Fridge Temp","Thermo Temp",
                "Hour Sin","Hour Cos","Season Sin","Season Cos"]
ax.set_xticklabels(labels_clean, rotation=30, ha="right", fontsize=9)
ax.set_yticklabels(labels_clean, rotation=0, fontsize=9)
ax.set_title("Correlations entre capteurs et features cycliques", fontsize=13, color=TEXT_C, loc="left")
fig.tight_layout()
save(fig, "matrice_correlation.png")

# ═══════════════════════════════════════════════════════════════════
# 9.  ÉVOLUTION MENSUELLE — Ligne avec min/max
# ═══════════════════════════════════════════════════════════════════
print("[9/12] Evolution mensuelle...")
fig, ax = plt.subplots(figsize=(16, 6))
x = np.arange(1, 13)
for i, (col, color, label) in enumerate(zip(
    ["temperature","fridge_temperature","current_temperature"],
    [C_W, C_F, C_T], LABELS)):
    monthly = df.groupby("month")[col]
    means = monthly.mean()
    mins = monthly.min()
    maxs = monthly.max()
    ax.plot(x, means, color=color, lw=2.5, marker="o", ms=6, label=label)
    ax.fill_between(x, mins, maxs, alpha=0.08, color=color)
    ax.vlines(x, mins, maxs, color=color, alpha=0.25, lw=1)
ax.set_xticks(x); ax.set_xticklabels(month_names)
ax.set_ylabel("Temperature (°C)")
ax.set_title("Evolution mensuelle — Moyenne, min & max par capteur", fontsize=13, color=TEXT_C, loc="left")
ax.legend(fontsize=11, loc="upper right", ncol=3)
ax.set_xlim(0.5, 12.5)
fig.tight_layout()
save(fig, "evolution_mensuelle.png")

# ═══════════════════════════════════════════════════════════════════
# 10. FRIDGE — Temp Condition Analysis
# ═══════════════════════════════════════════════════════════════════
print("[10/12] Fridge — Condition analysis...")
fig, axes = plt.subplots(1, 2, figsize=(14, 5))
# Pie chart
cond_counts = df.groupby("temp_condition").size()
colors_pie = {"high": "#BF616A", "medium": "#EBCB8B", "low": "#A3BE8C"}
wedgecolors = [colors_pie.get(c, "#4C566A") for c in cond_counts.index]
wedges, texts, autotexts = axes[0].pie(
    cond_counts.values, labels=cond_counts.index, autopct="%1.1f%%",
    colors=wedgecolors, startangle=90, textprops={"color": TEXT_C, "fontsize": 11},
    wedgeprops={"edgecolor": BG2, "linewidth": 2}
)
axes[0].set_title("Repartition temp_condition (Fridge)", fontsize=13, color=C_F)
# Condition over months
cond_month = df.groupby(["month","temp_condition"]).size().unstack(fill_value=0)
cond_month_pct = cond_month.div(cond_month.sum(axis=1), axis=0)
cond_month_pct.plot(kind="bar", stacked=True, ax=axes[1],
                     color=[colors_pie.get(c, "#4C566A") for c in cond_month.columns],
                     edgecolor="none", width=0.85)
axes[1].set_title("Condition frigo par mois", fontsize=13, color=C_F)
axes[1].set_xlabel("Mois"); axes[1].set_ylabel("Proportion")
axes[1].set_xticklabels(month_names, rotation=0)
axes[1].legend(fontsize=9, loc="upper right")
fig.tight_layout()
save(fig, "fridge_condition.png")

# ═══════════════════════════════════════════════════════════════════
# 11. THERMOSTAT — Status Analysis
# ═══════════════════════════════════════════════════════════════════
print("[11/12] Thermostat — Status analysis...")
fig, axes = plt.subplots(1, 2, figsize=(14, 5))
# Daily profile of thermostat_status
status_hour = df.groupby("hour")["thermostat_status"].mean()
axes[0].plot(status_hour.index, status_hour * 100, color=C_T, lw=2.5, marker="o", ms=5)
axes[0].fill_between(status_hour.index, status_hour * 100, alpha=0.15, color=C_T)
axes[0].set_xlim(0, 23); axes[0].set_xticks([0,6,12,18])
axes[0].set_xlabel("Heure"); axes[0].set_ylabel("% de chauffage actif")
axes[0].set_title("Activation du chauffage par heure", fontsize=12, color=C_T)
# Status by month
status_month = df.groupby("month")["thermostat_status"].mean()
axes[1].bar(x, status_month.reindex(range(1,13), fill_value=0).values * 100,
            color=C_T, alpha=0.8, width=0.6, edgecolor="none")
axes[1].set_xticks(x); axes[1].set_xticklabels(month_names, rotation=0)
axes[1].set_xlabel("Mois"); axes[1].set_ylabel("% de chauffage actif")
axes[1].set_title("Activation du chauffage par mois", fontsize=12, color=C_T)
axes[1].set_xlim(0.5, 12.5)
fig.tight_layout()
save(fig, "thermostat_status.png")

# ═══════════════════════════════════════════════════════════════════
# 12. ML — Isolation Forest & Détection d'anomalies
# ═══════════════════════════════════════════════════════════════════
print("[12/12] ML — Isolation Forest...")
ml_features = ["temperature","fridge_temperature","current_temperature",
               "hour_sin","hour_cos","season_sin","season_cos"]
# Échantillon pour l'entraînement (normal uniquement, limiter pour la vitesse)
train_sample = norm.sample(min(20000, len(norm)), random_state=42)
scaler = StandardScaler()
X_train = scaler.fit_transform(train_sample[ml_features])
iso = IsolationForest(contamination=0.05, n_estimators=200,
                       random_state=42, n_jobs=-1)
iso.fit(X_train)

# Prédiction sur toutes les données (échantillon pour la vitesse)
eval_sample = df.sample(min(30000, len(df)), random_state=42)
X_eval = scaler.transform(eval_sample[ml_features])
eval_sample = eval_sample.copy()
eval_sample["anomaly_score"] = iso.score_samples(X_eval)
eval_sample["anomaly_pred"] = iso.predict(X_eval)  # -1 = anomalie, 1 = normal

# ── 12a: ROC Curve ──
fig, axes = plt.subplots(2, 3, figsize=(16, 9))
# ROC
y_true = eval_sample["label"].values
y_scores = -eval_sample["anomaly_score"].values  # plus haut = plus anormal
fpr, tpr, _ = roc_curve(y_true, y_scores)
roc_auc = auc(fpr, tpr)
axes[0,0].plot(fpr, tpr, color="#5E81AC", lw=2.5, label=f"AUC = {roc_auc:.3f}")
axes[0,0].plot([0,1],[0,1], "--", color="#4C566A", lw=1)
axes[0,0].fill_between(fpr, tpr, alpha=0.1, color="#5E81AC")
axes[0,0].set_xlabel("False Positive Rate"); axes[0,0].set_ylabel("True Positive Rate")
axes[0,0].set_title("Courbe ROC — Isolation Forest", fontsize=12, loc="left")
axes[0,0].legend(fontsize=10)
axes[0,0].set_xlim(0,1); axes[0,0].set_ylim(0,1)

# Precision-Recall
prec, rec, _ = precision_recall_curve(y_true, y_scores)
axes[0,1].plot(rec, prec, color="#A3BE8C", lw=2.5)
axes[0,1].fill_between(rec, prec, alpha=0.1, color="#A3BE8C")
axes[0,1].set_xlabel("Recall"); axes[0,1].set_ylabel("Precision")
axes[0,1].set_title("Courbe Precision-Recall", fontsize=12, loc="left")

# Confusion Matrix
cm = confusion_matrix(y_true, eval_sample["anomaly_pred"] == -1)
sns.heatmap(cm, annot=True, fmt="d", cmap="RdBu_r", cbar=False,
            xticklabels=["Normal","Attaque"], yticklabels=["Normal","Attaque"],
            ax=axes[0,2], linewidths=0.5, linecolor=BG2, annot_kws={"fontsize":12})
axes[0,2].set_title("Matrice de confusion", fontsize=12, loc="left")
axes[0,2].set_ylabel("Reel"); axes[0,2].set_xlabel("Prediction")

# Score distribution
axes[1,0].hist(eval_sample[eval_sample["label"]==0]["anomaly_score"],
               bins=50, alpha=0.5, color=C_NORM, label="Normal", density=True)
axes[1,0].hist(eval_sample[eval_sample["label"]==1]["anomaly_score"],
               bins=50, alpha=0.5, color=C_ATK, label="Attaque", density=True)
axes[1,0].set_xlabel("Score d'anomalie"); axes[1,0].set_ylabel("Densite")
axes[1,0].set_title("Distribution des scores d'anomalie", fontsize=12, loc="left")
axes[1,0].legend(fontsize=9)

# Feature importance (mean score contribution)
fi = np.abs(iso.feature_importances_) if hasattr(iso, "feature_importances_") else np.random.rand(len(ml_features))
# Use SHAP-like approximation: feature_importances_ from each tree
fi = np.zeros(len(ml_features))
for est in iso.estimators_:
    fi += est.feature_importances_
fi /= len(iso.estimators_)
idx_sort = np.argsort(fi)
axes[1,1].barh(range(len(ml_features)), fi[idx_sort], color=[C_W, C_F, C_T, "#EBCB8B", "#D08770", "#B48EAD", "#88C0D0"])
axes[1,1].set_yticks(range(len(ml_features)))
axes[1,1].set_yticklabels([ml_features[i] for i in idx_sort], fontsize=9)
axes[1,1].set_xlabel("Importance relative")
axes[1,1].set_title("Importance des features (Isolation Forest)", fontsize=12, loc="left")

# Daily anomaly rate
eval_sample["doy"] = eval_sample["datetime"].dt.dayofyear
daily_atk_rate = eval_sample.groupby("doy")["anomaly_pred"].apply(lambda x: (x == -1).mean())
axes[1,2].plot(daily_atk_rate.index, daily_atk_rate.values * 100,
               color="#BF616A", lw=1.2, alpha=0.7)
axes[1,2].axhline(y=5, color="#FFD700", ls="--", lw=1, alpha=0.6, label="Seuil 5%")
axes[1,2].set_xlabel("Jour de l'annee"); axes[1,2].set_ylabel("Taux d'anomalies (%)")
axes[1,2].set_title("Taux d'anomalies detectees par jour", fontsize=12, loc="left")
axes[1,2].legend(fontsize=8)
axes[1,2].set_xlim(1, 365)

fig.tight_layout()
save(fig, "ml_isolation_forest.png")

# ─── Classification Report ──────────────────────────────────────────
report = classification_report(y_true, eval_sample["anomaly_pred"] == -1,
                                target_names=["Normal", "Attaque"], output_dict=True)
print("\n Rapport de classification (Isolation Forest):")
print(f"  Normal  -> Precision: {report['Normal']['precision']:.3f}, "
      f"Recall: {report['Normal']['recall']:.3f}, "
      f"F1: {report['Normal']['f1-score']:.3f}")
print(f"  Attaque -> Precision: {report['Attaque']['precision']:.3f}, "
      f"Recall: {report['Attaque']['recall']:.3f}, "
      f"F1: {report['Attaque']['f1-score']:.3f}")

print(f"\n Tous les graphiques sauvegardes dans: {OUT_DIR}")
print(" Termine!")
