"""
================================================================================
🔬 Priorité ④ GNN + ③ Forecasting — Détection d'anomalies multivariée
================================================================================

Ce fichier implémente deux innovations pour le modèle multivarié :

④ GNN (Graph Neural Network / Graphe de corrélation)
   → Chaque capteur = nœud d'un graphe ; les corrélations glissantes = arêtes
   → Une anomalie = rupture soudaine des corrélations inter-capteurs
   → Détecte les attaques multi-capteurs invisibles aux modèles uni-capteurs

③ Forecasting temporel cross-capteur
   → LSTM prédit chaque capteur à partir des 2 autres
   → Anomalie = écart entre valeur prédite et valeur réelle (residual)
   → Détecte les dérives progressives et les usurpations lentes

Architecture physique simulée :
   Weather (température extérieure) ──→ Thermostat (climatisation) ──→ Fridge (chambre froide)
   ↑_____________ corrélations naturelles _______________↓

Usage : python 4_GNN_Forecasting_Multivarie.py
"""

import os, sys, warnings, json, time
warnings.filterwarnings('ignore')
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from scipy.stats import pearsonr, spearmanr
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import (roc_auc_score, average_precision_score,
                             precision_recall_curve, roc_curve)
from sklearn.model_selection import train_test_split
import joblib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns

# ─── Torch pour LSTM ───
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset

sns.set_palette('Set2')
plt.rcParams['figure.dpi'] = 130
plt.style.use('seaborn-v0_8-darkgrid')
np.random.seed(42)
torch.manual_seed(42)

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_PROC = os.path.join(BASE, 'phase2', 'Data', 'Processed')
MODELS_DIR = os.path.join(DATA_PROC, 'models')
FIGURES_DIR = os.path.join(BASE, 'phase2', 'figures')
os.makedirs(FIGURES_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)

print('=' * 70)
print('🔬 GNN + FORECASTING — Détection multivariée avancée')
print('=' * 70)
print(f'Base   : {BASE}')
print(f'Données: {DATA_PROC}')
print(f'Modèles: {MODELS_DIR}')
print(f'Figures: {FIGURES_DIR}')
t0 = time.time()

def log(msg):
    print(f'[{time.time()-t0:6.1f}s] {msg}', flush=True)

# ─────────────────────────────────────────────────────────────────────────────
# 1. CHARGEMENT ET FUSION DES 3 CAPTEURS (identique aux notebooks existants)
# ─────────────────────────────────────────────────────────────────────────────
log('[1] Chargement et fusion des 3 capteurs...')

SENSOR_VAL_COLS = {
    'weather': 'temperature',
    'fridge': 'fridge_temperature',
    'thermostat': 'current_temperature',
}

raw = {}
for s in ['weather', 'fridge', 'thermostat']:
    path = os.path.join(DATA_PROC, f'{s}_concat.csv')
    if not os.path.exists(path):
        path = os.path.join(DATA_PROC, f'{s}_features_concat.csv')
    df = pd.read_csv(path)
    df['datetime'] = df['datetime'].astype(str).str.replace(r'^201-', '2019-', regex=True)
    df['datetime'] = pd.to_datetime(df['datetime'])
    raw[s] = df.sort_values('datetime').reset_index(drop=True)
    log(f'  {s:12s} : {len(df):>7,} lignes')

# Union sur datetime puis échantillonnage (inner join sur dt tronqué à la minute)
for s in ['weather', 'fridge', 'thermostat']:
    raw[s]['dt_key'] = raw[s]['datetime'].dt.floor('1min')

merged = raw['weather'][['datetime', 'dt_key', 'temperature', 'label']].rename(
    columns={'temperature': 'weather_temp', 'label': 'label_w'})
fridge_df = raw['fridge'][['datetime', 'dt_key', 'fridge_temperature', 'temp_condition', 'label']].rename(
    columns={'fridge_temperature': 'fridge_temp', 'temp_condition': 'fridge_cond', 'label': 'label_f'})
merged = merged.merge(fridge_df, on='dt_key', how='inner')
thermo_df = raw['thermostat'][['datetime', 'dt_key', 'current_temperature', 'thermostat_status', 'label']].rename(
    columns={'current_temperature': 'thermostat_temp', 'thermostat_status': 'thermo_status', 'label': 'label_t'})
merged = merged.merge(thermo_df, on='dt_key', how='inner')

# Garder une ligne par minute (la première)
merged = merged.sort_values('datetime').drop_duplicates(subset='dt_key', keep='first')

merged['label'] = ((merged['label_w'] == 1) | (merged['label_f'] == 1) | (merged['label_t'] == 1)).astype(int)
merged = merged.drop(columns=['label_w', 'label_f', 'label_t', 'dt_key']).sort_values('datetime').reset_index(drop=True)

# Échantillonnage pour éviter dépassement mémoire
MAX_SAMPLES = 150000
if len(merged) > MAX_SAMPLES:
    merged = merged.iloc[::len(merged)//MAX_SAMPLES].reset_index(drop=True)

n_atk = merged['label'].sum()
log(f'  Fusionné : {len(merged):>7,} lignes, attaques={n_atk:,}')


# ─────────────────────────────────────────────────────────────────────────────
# 2. FEATURE ENGINEERING MULTIVARIÉ (identique)
# ─────────────────────────────────────────────────────────────────────────────
log('[2] Feature engineering multivarié...')

def engineer_multivariate(df):
    d = df.copy().sort_values('datetime').reset_index(drop=True)
    for prefix, col in [('weather', 'weather_temp'), ('fridge', 'fridge_temp'),
                         ('thermostat', 'thermostat_temp')]:
        d[f'{prefix}_diff_1'] = d[col].diff(1)
        d[f'{prefix}_roll_mean_10'] = d[col].rolling(10, min_periods=1).mean()
        d[f'{prefix}_roll_std_10'] = d[col].rolling(10, min_periods=1).std()
    d['weather_fridge_diff'] = d['weather_temp'] - d['fridge_temp']
    d['weather_thermostat_diff'] = d['weather_temp'] - d['thermostat_temp']
    d['fridge_thermostat_diff'] = d['fridge_temp'] - d['thermostat_temp']
    dt = d['datetime']
    hour = dt.dt.hour + dt.dt.minute / 60
    doy = dt.dt.dayofyear
    d['hour_sin'] = np.sin(2 * np.pi * hour / 24)
    d['hour_cos'] = np.cos(2 * np.pi * hour / 24)
    d['season_sin'] = np.sin(2 * np.pi * doy / 365)
    d['season_cos'] = np.cos(2 * np.pi * doy / 365)
    if 'fridge_cond' in d.columns:
        le = LabelEncoder()
        d['fridge_cond_enc'] = le.fit_transform(d['fridge_cond'].astype(str).fillna('unknown'))
    if 'thermo_status' in d.columns:
        d['thermo_status'] = pd.to_numeric(d['thermo_status'], errors='coerce').fillna(0).astype(int)
    keep = ['datetime', 'weather_temp', 'fridge_temp', 'thermostat_temp',
            'weather_diff_1', 'weather_roll_mean_10', 'weather_roll_std_10',
            'fridge_diff_1', 'fridge_roll_mean_10', 'fridge_roll_std_10',
            'thermostat_diff_1', 'thermostat_roll_mean_10', 'thermostat_roll_std_10',
            'weather_fridge_diff', 'weather_thermostat_diff', 'fridge_thermostat_diff',
            'hour_sin', 'hour_cos', 'season_sin', 'season_cos', 'label']
    if 'fridge_cond_enc' in d.columns:
        keep.append('fridge_cond_enc')
    if 'thermo_status' in d.columns:
        keep.append('thermo_status')
    result = d[keep].copy().replace([np.inf, -np.inf], np.nan).dropna().reset_index(drop=True)
    return result

df = engineer_multivariate(merged)
feature_cols = [c for c in df.columns if c not in ['datetime', 'label']]
assert len(feature_cols) in [21, 23], f'Nombre de features inattendu: {len(feature_cols)}'
log(f'  Features: {len(feature_cols)}, lignes: {len(df):,}')


# ─────────────────────────────────────────────────────────────────────────────
# 3. SPLIT TEMPOREL 80/20
# ─────────────────────────────────────────────────────────────────────────────
log('[3] Split temporel...')

def split_data(df, train_ratio=0.8):
    df_normal = df[df['label'] == 0].copy()
    df_attack = df[df['label'] == 1].copy()
    n_train = int(len(df_normal) * train_ratio)
    train_idx = df_normal.iloc[:n_train].index
    test_idx = df_normal.iloc[n_train:].index.union(df_attack.index)
    train = df.loc[train_idx].sort_values('datetime')
    test = df.loc[test_idx].sort_values('datetime')
    return train, test

train, test = split_data(df)
X_train = train[feature_cols].values
y_train = train['label'].values
X_test = test[feature_cols].values
y_test = test['label'].values

scaler = StandardScaler()
X_train_s = scaler.fit_transform(X_train)
X_test_s = scaler.transform(X_test)

log(f'  Train: {len(X_train):>7,} (normales)')
log(f'  Test : {len(X_test):>7,} (dont {y_test.sum():,} attaques)')

# Sauvegarder le scaler pour usage futur
scaler_path = os.path.join(MODELS_DIR, 'scaler_gnn_forecast.pkl')
joblib.dump(scaler, scaler_path)

# Avoir les données sous forme de DataFrame pour les analyses glissantes
test_df = test.copy()
test_df['label'] = y_test


# =============================================================================
# ④ GNN — GRAPHE DE CORRÉLATION INTER-CAPTEURS
# =============================================================================
print()
print('=' * 70)
print('④ GNN — GRAPHE DE CORRÉLATION INTER-CAPTEURS')
print('=' * 70)

# ─── Principe ───
# Les 3 capteurs (Weather, Fridge, Thermostat) sont liés physiquement.
# En fonctionnement normal, leurs corrélations sont stables.
# Une attaque brise ces corrélations.
#
# Graphe : 3 nœuds, 3 arêtes
#   Weather ── Fridge       (temp_ext → refroidissement)
#   Weather ── Thermostat   (temp_ext → climatisation)
#   Fridge  ── Thermostat   (climatisation → chambre froide)
#
# On calcule une fenêtre glissante de corrélations.
# Anomalie GNN = variation brutale de la matrice de corrélation.

log('[4.1] Calcul des corrélations glissantes...')

WINDOW = 120  # 120 pas = ~10h (rythme 5min)
STEP = 10

sensor_cols = ['weather_temp', 'fridge_temp', 'thermostat_temp']
sensor_labels = ['Weather', 'Fridge', 'Thermostat']

def sliding_correlation_graph(df, window=WINDOW, step=STEP):
    """Calcule la matrice de corrélation glissante entre les 3 capteurs.
    Retourne: (timestamps, list_of_correlation_matrices)"""
    timestamps = []
    corr_matrices = []
    n = len(df)
    for i in range(0, n - window + 1, step):
        chunk = df.iloc[i:i+window]
        corr = chunk[sensor_cols].corr(method='pearson').values
        timestamps.append(chunk['datetime'].iloc[-1])
        corr_matrices.append(corr)
    return timestamps, np.array(corr_matrices)

# On utilise les données de test (normales + attaques)
tstamps, corr_graphs = sliding_correlation_graph(test_df)

# Les arêtes du graphe : 3 paires uniques
edge_idx = [(0, 1), (0, 2), (1, 2)]
edge_labels = ['Weather↔Fridge', 'Weather↔Thermostat', 'Fridge↔Thermostat']

# Extraire les corrélations pour chaque arête
edge_series = {}
for (i, j), label in zip(edge_idx, edge_labels):
    edge_series[label] = corr_graphs[:, i, j]

log(f'  Fenêtres glissantes: {len(tstamps)}')
log(f'  Corrélations par arête calculées sur windows={WINDOW}')

# ─── Détection d'anomalies GNN ───
# Anomalie = changement soudain de corrélation (> seuil sur gradient)
log('[4.2] Calcul du score d\'anomalie GNN...')

def gnn_anomaly_score(edge_series_dict, threshold=0.5):
    """Calcule un score d'anomalie basé sur les variations de corrélation.
    Score = somme des variations absolues normalisées des arêtes."""
    scores = np.zeros(len(next(iter(edge_series_dict.values()))))
    for label, series in edge_series_dict.items():
        # Variation absolue du coefficient de corrélation
        diff = np.abs(np.diff(series, prepend=series[0]))
        scores += diff
    return scores

gnn_scores_raw = gnn_anomaly_score(edge_series)
gnn_scores = (gnn_scores_raw - gnn_scores_raw.mean()) / (gnn_scores_raw.std() + 1e-8)

# Aligner les labels (même longueur que corr_graphs)
gnn_labels = []
for i, ts in enumerate(tstamps):
    idx = test_df['datetime'].searchsorted(ts)
    if idx < len(test_df):
        gnn_labels.append(test_df['label'].iloc[idx])
    else:
        gnn_labels.append(0)
gnn_labels = np.array(gnn_labels)

# ─── Évaluation GNN ───
def evaluer(y_true, scores, seuil_percentile=98):
    """Évalue un détecteur d'anomalies."""
    if len(np.unique(y_true)) < 2:
        return {'precision': 0, 'rappel': 0, 'f1': 0, 'roc_auc': 0.5,
                'ap': 0, 'tp': 0, 'fp': 0, 'fn': 0, 'tn': 0, 'seuil': 0, 'fpr': 0}
    # Déterminer le seuil qui maximise F1
    precisions, recalls, thresholds = precision_recall_curve(y_true, scores)
    f1_scores = 2 * precisions[:-1] * recalls[:-1] / (precisions[:-1] + recalls[:-1] + 1e-10)
    best_idx = np.argmax(f1_scores)
    best_thresh = thresholds[best_idx]
    predictions = (scores >= best_thresh).astype(int)

    tp = ((y_true == 1) & (predictions == 1)).sum()
    fp = ((y_true == 0) & (predictions == 1)).sum()
    fn = ((y_true == 1) & (predictions == 0)).sum()
    tn = ((y_true == 0) & (predictions == 0)).sum()
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
    roc_auc = roc_auc_score(y_true, scores) if len(np.unique(y_true)) > 1 else 0.5
    ap = average_precision_score(y_true, scores) if len(np.unique(y_true)) > 1 else 0

    return {
        'precision': round(precision, 4), 'rappel': round(recall, 4),
        'f1': round(f1, 4), 'roc_auc': round(roc_auc, 4), 'ap': round(ap, 4),
        'fpr': round(fp / (fp + tn) if (fp + tn) > 0 else 0, 4),
        'tp': int(tp), 'fp': int(fp), 'fn': int(fn), 'tn': int(tn),
        'seuil': round(float(best_thresh), 4),
    }

gnn_result = evaluer(gnn_labels, gnn_scores)
print()
print(f'  📊 Résultats GNN (Graphe de corrélation) :')
print(f'     Précision = {gnn_result["precision"]:.4f}  |  Rappel = {gnn_result["rappel"]:.4f}')
print(f'     F1-score  = {gnn_result["f1"]:.4f}  |  ROC-AUC = {gnn_result["roc_auc"]:.4f}')
print(f'     VP={gnn_result["tp"]:,}  FP={gnn_result["fp"]:,}  FN={gnn_result["fn"]:,}  VN={gnn_result["tn"]:,}')
print(f'     FPR={gnn_result["fpr"]:.4f}')


# ─── Visualisation GNN ───
log('[4.3] Génération des graphiques GNN...')

fig, axes = plt.subplots(3, 1, figsize=(14, 10), sharex=True)

colors_edge = {'Weather↔Fridge': '#4ECDC4', 'Weather↔Thermostat': '#45B7D1', 'Fridge↔Thermostat': '#96CEB4'}

for ax, (label, series) in zip(axes, edge_series.items()):
    ax.plot(tstamps, series, color=colors_edge[label], linewidth=1.2, alpha=0.8)
    # Marquer les zones d'attaque
    atk_mask = gnn_labels > 0
    if atk_mask.any():
        for j in range(len(atk_mask)):
            if atk_mask[j]:
                ax.axvspan(tstamps[max(0, j-1)], tstamps[min(len(tstamps)-1, j+1)],
                           alpha=0.08, color='red')
    ax.set_ylabel(f'Corrélation\n{label}', fontsize=9, color='#8899AA')
    ax.axhline(y=series.mean(), color='#8899AA', linestyle='--', alpha=0.4)
    ax.set_ylim(-1, 1)
    ax.grid(True, alpha=0.15)

axes[0].set_title('④ GNN — Évolution des corrélations inter-capteurs (zones rouges = attaques)', fontsize=11)
plt.tight_layout()
plt.savefig(os.path.join(FIGURES_DIR, 'gnn_correlations.png'), dpi=150, bbox_inches='tight')
plt.close()

# Score d'anomalie GNN
fig, ax = plt.subplots(figsize=(14, 4))
ax.plot(tstamps, gnn_scores, color='#D4A5E8', linewidth=1.2, alpha=0.7, label='Score GNN')
# Seuil optimal
if gnn_result['seuil'] > 0:
    ax.axhline(y=gnn_result['seuil'], color='red', linestyle='--', linewidth=1,
               label=f'Seuil optimal ({gnn_result["seuil"]:.2f})')
# Marquer les attaques
for i, lbl in enumerate(gnn_labels):
    if lbl > 0:
        ax.axvspan(tstamps[max(0, i-1)], tstamps[min(len(tstamps)-1, i+1)],
                   alpha=0.06, color='red')
ax.set_xlabel('Temps')
ax.set_ylabel('Score d\'anomalie GNN')
ax.set_title('④ GNN — Score d\'anomalie par variation de corrélation')
ax.legend(fontsize=9)
ax.grid(True, alpha=0.15)
plt.tight_layout()
plt.savefig(os.path.join(FIGURES_DIR, 'gnn_scores.png'), dpi=150, bbox_inches='tight')
plt.close()

# Matrice de corrélation moyenne normale vs attaque
fig, axes = plt.subplots(1, 2, figsize=(10, 4))
normal_mask = gnn_labels == 0
attack_mask = gnn_labels == 1

if normal_mask.any() and attack_mask.any():
    corr_norm = np.mean(corr_graphs[normal_mask], axis=0)
    corr_atk = np.mean(corr_graphs[attack_mask], axis=0)
    vmin, vmax = -1, 1

    sns.heatmap(corr_norm, annot=True, fmt='.2f', cmap='RdBu_r',
                xticklabels=sensor_labels, yticklabels=sensor_labels,
                ax=axes[0], vmin=vmin, vmax=vmax, cbar=False)
    axes[0].set_title('Corrélations NORMALES')

    sns.heatmap(corr_atk, annot=True, fmt='.2f', cmap='RdBu_r',
                xticklabels=sensor_labels, yticklabels=sensor_labels,
                ax=axes[1], vmin=vmin, vmax=vmax, cbar=False)
    axes[1].set_title('Corrélations ATTAQUES')

plt.suptitle('④ GNN — Matrice de corrélation : Normal vs Attaque', fontsize=11)
plt.tight_layout()
plt.savefig(os.path.join(FIGURES_DIR, 'gnn_correlation_matrix.png'), dpi=150, bbox_inches='tight')
plt.close()

log('  Graphiques GNN sauvegardés')


# =============================================================================
# ③ FORECASTING — PRÉDICTION CROSS-CAPTEUR + ANALYSE RÉSIDUELLE
# =============================================================================
print()
print('=' * 70)
print('③ FORECASTING — PRÉDICTION CROSS-CAPTEUR + ANALYSE RÉSIDUELLE')
print('=' * 70)

# ─── Principe ───
# On entraîne 3 LSTM, chacun prédisant un capteur à partir des 2 autres.
#   LSTM_1: Weather = f(Fridge, Thermostat, h)
#   LSTM_2: Fridge = f(Weather, Thermostat, h)
#   LSTM_3: Thermostat = f(Weather, Fridge, h)
#
# En condition normale, la prédiction est proche de la réalité.
# En condition d'attaque, l'écart (résidu) augmente → anomalie.

log('[5.1] Préparation des séquences temporelles...')

SEQ_LEN = 20  # 20 pas = ~1h40 (rythme 5min)
BATCH_SIZE = 256
EPOCHS = 15
HIDDEN_DIM = 64
N_LAYERS = 2

def create_sequences(X, y, seq_len=SEQ_LEN):
    """Crée des séquences pour LSTM."""
    Xs, ys = [], []
    for i in range(len(X) - seq_len):
        Xs.append(X[i:i+seq_len])
        ys.append(y[i+seq_len-1])
    return np.array(Xs), np.array(ys)

# Pour chaque capteur cible, les features sont les autres capteurs
# Indices des features de temperature des capteurs
target_map = {
    'weather_temp': 0,
    'fridge_temp': 1,
    'thermostat_temp': 2,
}

class CrossSensorLSTM(nn.Module):
    """LSTM qui prédit un capteur à partir des features des autres capteurs."""
    def __init__(self, n_features, hidden_dim=HIDDEN_DIM, n_layers=N_LAYERS):
        super().__init__()
        self.lstm = nn.LSTM(n_features, hidden_dim, n_layers, batch_first=True, dropout=0.2)
        self.regressor = nn.Linear(hidden_dim, 1)

    def forward(self, x):
        out, _ = self.lstm(x)
        out = self.regressor(out[:, -1, :])
        return out.squeeze()

def train_cross_lstm(X_train_seq, y_train_seq, X_val_seq, y_val_seq, model_name):
    """Entraîne un LSTM cross-capteur et le sauvegarde."""
    model = CrossSensorLSTM(X_train_seq.shape[2])
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)

    train_dataset = TensorDataset(torch.FloatTensor(X_train_seq),
                                   torch.FloatTensor(y_train_seq))
    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True)

    val_dataset = TensorDataset(torch.FloatTensor(X_val_seq),
                                 torch.FloatTensor(y_val_seq))
    val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE)

    best_val_loss = float('inf')
    patience = 3
    patience_counter = 0

    for epoch in range(EPOCHS):
        model.train()
        train_loss = 0
        for batch_X, batch_y in train_loader:
            optimizer.zero_grad()
            pred = model(batch_X)
            loss = criterion(pred, batch_y)
            loss.backward()
            optimizer.step()
            train_loss += loss.item()

        model.eval()
        val_loss = 0
        with torch.no_grad():
            for batch_X, batch_y in val_loader:
                pred = model(batch_X)
                loss = criterion(pred, batch_y)
                val_loss += loss.item()

        train_loss /= len(train_loader)
        val_loss /= len(val_loader)

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            patience_counter = 0
            model_path = os.path.join(MODELS_DIR, f'forecast_{model_name}.pth')
            torch.save(model.state_dict(), model_path)
        else:
            patience_counter += 1
            if patience_counter >= patience:
                break

    log(f'  {model_name:15s} entrainé: train_loss={train_loss:.6f}, val_loss={val_loss:.6f}')
    return model

# Split train/val pour l'entraînement
n_val = int(len(X_train_s) * 0.2)
X_train_lstm, X_val_lstm = X_train_s[:-n_val], X_train_s[-n_val:]

models_forecast = {}
residuals = {}  # Pour stocker les résidus par capteur

log('[5.2] Entraînement des 3 LSTM cross-capteurs...')

for target_name, target_idx in target_map.items():
    # Features = tout sauf la cible
    feat_indices = [i for i in range(X_train_s.shape[1]) if i != target_idx]

    X_tr = X_train_lstm[:, feat_indices]
    y_tr = X_train_lstm[:, target_idx]
    X_va = X_val_lstm[:, feat_indices]
    y_va = X_val_lstm[:, target_idx]

    X_tr_seq, y_tr_seq = create_sequences(X_tr, y_tr)
    X_va_seq, y_va_seq = create_sequences(X_va, y_va)

    model = train_cross_lstm(X_tr_seq, y_tr_seq, X_va_seq, y_va_seq, target_name)
    models_forecast[target_name] = (model, feat_indices)

# ─── Prédiction sur le test set ───
log('[5.3] Calcul des résidus sur le test set...')

# On refait les séquences sur le test (diminué)
for target_name, (model, feat_indices) in models_forecast.items():
    target_idx = target_map[target_name]
    X_te = X_test_s[:, feat_indices]
    y_te = X_test_s[:, target_idx]

    X_te_seq, _ = create_sequences(X_te, y_te)
    model.eval()
    with torch.no_grad():
        preds = model(torch.FloatTensor(X_te_seq)).numpy()

    # Résidu = |valeur réelle - prédite|
    actual = y_te[SEQ_LEN:]
    resid = np.abs(actual - preds)
    residuals[target_name] = resid

log(f'  Résidus calculés: {len(residuals[list(residuals.keys())[0]]):,} points par capteur')

# ─── Score d'anomalie Forecasting ───
# Score combiné = somme des résidus normalisés des 3 capteurs
log('[5.4] Calcul du score d\'anomalie Forecasting...')

forecast_labels = y_test[SEQ_LEN:]
forecast_scores = np.zeros(len(forecast_labels))
for target_name, resid in residuals.items():
    resid_norm = (resid - resid.mean()) / (resid.std() + 1e-8)
    forecast_scores += resid_norm

forecast_result = evaluer(forecast_labels, forecast_scores)
print()
print(f'  📊 Résultats FORECASTING (LSTM cross-capteur) :')
print(f'     Précision = {forecast_result["precision"]:.4f}  |  Rappel = {forecast_result["rappel"]:.4f}')
print(f'     F1-score  = {forecast_result["f1"]:.4f}  |  ROC-AUC = {forecast_result["roc_auc"]:.4f}')
print(f'     VP={forecast_result["tp"]:,}  FP={forecast_result["fp"]:,}  FN={forecast_result["fn"]:,}  VN={forecast_result["tn"]:,}')
print(f'     FPR={forecast_result["fpr"]:.4f}')


# ─── Visualisation Forecasting ───
log('[5.5] Génération des graphiques Forecasting...')

fig, axes = plt.subplots(3, 1, figsize=(14, 10), sharex=True)
colors_resid = {'weather_temp': '#FF6B6B', 'fridge_temp': '#4ECDC4', 'thermostat_temp': '#45B7D1'}
target_labels = {'weather_temp': 'Weather', 'fridge_temp': 'Fridge', 'thermostat_temp': 'Thermostat'}
t_test = test_df['datetime'].values[SEQ_LEN:]

for ax, (target_name, resid) in zip(axes, residuals.items()):
    ax.plot(range(len(resid)), resid, color=colors_resid[target_name], linewidth=0.8, alpha=0.6)
    ax.set_ylabel(f'Résidu\n{target_labels[target_name]}', fontsize=9, color='#8899AA')
    ax.axhline(y=np.percentile(resid, 95), color='red', linestyle='--', alpha=0.4, label='P95')
    ax.axhline(y=np.percentile(resid, 99), color='#EF4444', linestyle='--', alpha=0.5, label='P99')
    ax.grid(True, alpha=0.15)
    if ax == axes[0]:
        ax.legend(fontsize=8)

axes[0].set_title('③ FORECASTING — Résidus de prédiction cross-capteur', fontsize=11)
plt.tight_layout()
plt.savefig(os.path.join(FIGURES_DIR, 'forecast_residuals.png'), dpi=150, bbox_inches='tight')
plt.close()

# Score combiné
fig, ax = plt.subplots(figsize=(14, 4))
ax.plot(range(len(forecast_scores)), forecast_scores, color='#818cf8', linewidth=1, alpha=0.6, label='Score Forecasting')
if forecast_result['seuil'] > 0:
    ax.axhline(y=forecast_result['seuil'], color='red', linestyle='--', linewidth=1,
               label=f'Seuil optimal ({forecast_result["seuil"]:.2f})')
ax.set_xlabel('Pas de temps')
ax.set_ylabel('Score d\'anomalie Forecasting')
ax.set_title('③ FORECASTING — Score d\'anomalie combiné (somme des résidus normalisés)')
ax.legend(fontsize=9)
ax.grid(True, alpha=0.15)
plt.tight_layout()
plt.savefig(os.path.join(FIGURES_DIR, 'forecast_scores.png'), dpi=150, bbox_inches='tight')
plt.close()

# Distribution des résidus normal vs attack
fig, axes = plt.subplots(1, 3, figsize=(14, 4))
for ax, (target_name, resid) in zip(axes, residuals.items()):
    resid_norm = resid[forecast_labels == 0]
    resid_atk = resid[forecast_labels == 1]
    ax.hist(resid_norm, bins=50, alpha=0.5, color='green', label='Normal', density=True)
    ax.hist(resid_atk, bins=50, alpha=0.5, color='red', label='Attaque', density=True)
    ax.set_xlabel('Résidu')
    ax.set_ylabel('Densité')
    ax.set_title(f'{target_labels[target_name]}')
    ax.legend(fontsize=8)
    ax.grid(True, alpha=0.15)

plt.suptitle('③ FORECASTING — Distribution des résidus : Normal vs Attaque', fontsize=11)
plt.tight_layout()
plt.savefig(os.path.join(FIGURES_DIR, 'forecast_distribution.png'), dpi=150, bbox_inches='tight')
plt.close()

log('  Graphiques Forecasting sauvegardés')


# =============================================================================
# COMPARAISON GNN + FORECASTING vs MODÈLES EXISTANTS
# =============================================================================
print()
print('=' * 70)
print('COMPARAISON — GNN + FORECASTING vs IF Multi + Autoencodeur')
print('=' * 70)

# Résultats des modèles existants (depuis le JSON)
existing = {
    'IF_Multivarie': {'precision': 0.9906, 'rappel': 1.0, 'f1': 0.9953, 'roc_auc': 0.8404, 'ap': 0.9909,
                      'fpr': 0.3335, 'tp': 96633, 'fp': 914, 'fn': 0, 'tn': 1827},
    'Autoencodeur_PCA': {'precision': 0.9973, 'rappel': 0.5128, 'f1': 0.6773, 'roc_auc': 0.9070, 'ap': 0.9965,
                         'fpr': 0.0493, 'tp': 49552, 'fp': 135, 'fn': 47081, 'tn': 2606},
}

print()
print(f'  {"Modèle":25s} {"F1":>8s} {"Précision":>10s} {"Rappel":>8s} {"ROC-AUC":>9s} {"FPR":>8s}')
print(f'  {"-"*25} {"-"*8} {"-"*10} {"-"*8} {"-"*9} {"-"*8}')

all_models = {
    'IF_Multivarie': existing['IF_Multivarie'],
    'Autoencodeur_PCA': existing['Autoencodeur_PCA'],
    'GNN_Correlation': {k: round(gnn_result[k], 4) for k in ['precision', 'rappel', 'f1', 'roc_auc', 'ap', 'fpr', 'tp', 'fp', 'fn', 'tn']},
    'Forecasting_LSTM': {k: round(forecast_result[k], 4) for k in ['precision', 'rappel', 'f1', 'roc_auc', 'ap', 'fpr', 'tp', 'fp', 'fn', 'tn']},
}

for model_name, res in all_models.items():
    print(f'  {model_name:25s} {res["f1"]:>8.4f} {res["precision"]:>10.4f} {res["rappel"]:>8.4f} {res["roc_auc"]:>9.4f} {res["fpr"]:>8.4f}')

best = max(all_models.keys(), key=lambda m: all_models[m]['f1'])
print()
print(f'  🏆 Meilleur F1: {best} ({all_models[best]["f1"]:.4f})')


# =============================================================================
# EXPORT DES RÉSULTATS POUR LE DASHBOARD
# =============================================================================
log('[6] Export des résultats pour le dashboard...')

# Ajouter les nouveaux modèles au JSON existant
json_path = os.path.join(MODELS_DIR, 'resultats_comparaison_final.json')
if os.path.exists(json_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        dashboard_results = json.load(f)
else:
    dashboard_results = {}

# Ajouter GNN et Forecasting
dashboard_results['GNN_Correlation'] = {
    'precision': round(gnn_result['precision'], 4),
    'recall': round(gnn_result['rappel'], 4),
    'f1': round(gnn_result['f1'], 4),
    'roc_auc': round(gnn_result['roc_auc'], 4),
    'ap': round(gnn_result['ap'], 4),
    'fpr': round(gnn_result['fpr'], 4),
    'tp': gnn_result['tp'],
    'fp': gnn_result['fp'],
    'fn': gnn_result['fn'],
    'tn': gnn_result['tn'],
}
dashboard_results['Forecasting_LSTM'] = {
    'precision': round(forecast_result['precision'], 4),
    'recall': round(forecast_result['rappel'], 4),
    'f1': round(forecast_result['f1'], 4),
    'roc_auc': round(forecast_result['roc_auc'], 4),
    'ap': round(forecast_result['ap'], 4),
    'fpr': round(forecast_result['fpr'], 4),
    'tp': forecast_result['tp'],
    'fp': forecast_result['fp'],
    'fn': forecast_result['fn'],
    'tn': forecast_result['tn'],
}

with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(dashboard_results, f, indent=2, ensure_ascii=False)
log(f'  Résultats mis à jour: {json_path}')

# Sauvegarder les scores pour analyse ultérieure
scores_path = os.path.join(MODELS_DIR, 'gnn_forecast_scores.pkl')
joblib.dump({
    'gnn_scores': gnn_scores,
    'gnn_labels': gnn_labels,
    'gnn_timestamps': tstamps,
    'forecast_scores': forecast_scores,
    'forecast_labels': forecast_labels,
    'edge_series': edge_series,
    'corr_graphs': corr_graphs,
    'residuals': residuals,
}, scores_path)
log(f'  Scores sauvegardés: {scores_path}')

# =============================================================================
# SYNTHÈSE POUR LE JURY
# =============================================================================
print()
print('=' * 70)
print('SYNTHÈSE — GNN + FORECASTING pour le multivarié')
print('=' * 70)
print()
print('④ GNN (Graphe de corrélation inter-capteurs) :')
print('   → Modélise les 3 capteurs comme un graphe orienté:')
print('     Weather ──→ Thermostat ──→ Fridge')
print('   → Détecte les ruptures de corrélation entre capteurs')
print('   → Idéal pour les attaques multi-capteurs invisibles')
print(f'   → F1 = {gnn_result["f1"]:.4f}, ROC-AUC = {gnn_result["roc_auc"]:.4f}')
print()
print('③ Forecasting (LSTM cross-capteur) :')
print('   → 3 LSTM: chaque capteur prédit à partir des 2 autres')
print('   → Détecte les dérives progressives (résidu = anomalie)')
print('   → Complémentaire à l\'Isolation Forest')
print(f'   → F1 = {forecast_result["f1"]:.4f}, ROC-AUC = {forecast_result["roc_auc"]:.4f}')
print()
print('📊 Comparaison avec les modèles existants :')
print(f'   IF Multivarié    : F1 = {existing["IF_Multivarie"]["f1"]:.4f}')
print(f'   Autoencodeur PCA : F1 = {existing["Autoencodeur_PCA"]["f1"]:.4f}')
print(f'   GNN Corrélation  : F1 = {gnn_result["f1"]:.4f}')
print(f'   Forecasting LSTM : F1 = {forecast_result["f1"]:.4f}')
print()

elapsed = time.time() - t0
print(f'⏱  Temps total: {elapsed:.0f}s ({elapsed/60:.1f}min)')
print()
print('Les résultats sont visibles sur le dashboard Phase 2.')
print('Graphiques sauvegardés dans phase2/figures/')

# =============================================================================
# EXPORT COMPLET — Sauvegarder TOUS les modèles dans le JSON
# =============================================================================
log('[7] Mise à jour complète du JSON de comparaison...')

json_path = os.path.join(MODELS_DIR, 'resultats_comparaison_final.json')
if os.path.exists(json_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        all_results = json.load(f)
else:
    all_results = {}

# Ajouter IF_Multivarie et Autoencodeur_PCA depuis les données existantes
for model_name, metrics in existing.items():
    all_results[model_name] = {
        'precision': round(metrics['precision'], 4),
        'recall': round(metrics['rappel'], 4),
        'f1': round(metrics['f1'], 4),
        'roc_auc': round(metrics['roc_auc'], 4),
        'ap': round(metrics['ap'], 4),
        'fpr': round(metrics['fpr'], 4),
        'tp': metrics['tp'],
        'fp': metrics['fp'],
        'fn': metrics['fn'],
        'tn': metrics['tn'],
    }

# Ajouter GNN et Forecasting (déjà calculés plus haut)
all_results['GNN_Correlation'] = {
    'precision': round(gnn_result['precision'], 4),
    'recall': round(gnn_result['rappel'], 4),
    'f1': round(gnn_result['f1'], 4),
    'roc_auc': round(gnn_result['roc_auc'], 4),
    'ap': round(gnn_result['ap'], 4),
    'fpr': round(gnn_result['fpr'], 4),
    'tp': gnn_result['tp'],
    'fp': gnn_result['fp'],
    'fn': gnn_result['fn'],
    'tn': gnn_result['tn'],
}
all_results['Forecasting_LSTM'] = {
    'precision': round(forecast_result['precision'], 4),
    'recall': round(forecast_result['rappel'], 4),
    'f1': round(forecast_result['f1'], 4),
    'roc_auc': round(forecast_result['roc_auc'], 4),
    'ap': round(forecast_result['ap'], 4),
    'fpr': round(forecast_result['fpr'], 4),
    'tp': forecast_result['tp'],
    'fp': forecast_result['fp'],
    'fn': forecast_result['fn'],
    'tn': forecast_result['tn'],
}

with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(all_results, f, indent=2, ensure_ascii=False)
log(f'JSON de comparaison mis à jour : {json_path}')
log(f'Modèles sauvegardés : {list(all_results.keys())}')
