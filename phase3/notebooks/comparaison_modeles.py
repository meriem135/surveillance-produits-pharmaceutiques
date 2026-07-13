"""
Comparaison multi-modeles pour detection d'anomalies IoT avec saisonnalite
Modeles: IsolationForest, OneClassSVM, EllipticEnvelope, LSTM-Autoencoder
Evaluation: 4 saisons x 9 attaques
"""
import os, warnings, json, glob, sys
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
warnings.filterwarnings('ignore')

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

os.chdir(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# ML
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import IsolationForest
from sklearn.svm import OneClassSVM
from sklearn.covariance import EllipticEnvelope
from sklearn.metrics import roc_auc_score, average_precision_score, confusion_matrix, classification_report
import joblib

# Torch for LSTM
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset

SEED = 42
np.random.seed(SEED)
torch.manual_seed(SEED)

PROCESSED_DIR = 'Data/Processed'
RAW_DIR = 'Data/Raw/telemtry_data/IoT_normal'
ATTACK_DIR = 'Data/Raw/telemtry_data/IoT_original_normal_attack'
TYPES_ATTAQUE = ['IoT_DDoS_normal','IoT_DoS_normal','IoT_Injection_normal','IoT_MITM_normal',
                 'IoT_XSS_normal','IoT_backdoor_normal','IoT_password_normal','IoT_runsomware_normal','IoT_scanning_normal']

SENSOR_CONFIG = {
    'weather': {
        'amplitude': 8.0, 'raw_std': 8.21,
        'adjust_cols': ['temperature', 'temp_roll_mean_10'],
        'features': ['temperature','humidity','temp_diff_1','humidity_diff_1','temp_roll_mean_10','temp_roll_std_10','hour_sin','hour_cos']
    },
    'fridge': {
        'amplitude': 2.0, 'raw_std': 3.62,
        'adjust_cols': ['fridge_temperature', 'fridge_roll_mean_10'],
        'features': ['fridge_temperature','temp_condition_encoded','fridge_diff_1','fridge_roll_mean_10','hour_sin','hour_cos']
    },
    'thermostat': {
        'amplitude': 1.0, 'raw_std': 2.36,
        'adjust_cols': ['current_temperature'],
        'features': ['current_temperature','thermostat_status','thermo_diff_1','hour_sin','hour_cos']
    }
}

PEAK_DAY = 200
def seasonal_offset(dayofyear, amplitude):
    phi = 2 * np.pi * (PEAK_DAY - 80) / 365
    return amplitude * np.sin(2 * np.pi * (dayofyear - 1) / 365 - phi)

def adjust_features(df, sensor, dayofyear, subtract=True):
    """Apply or remove seasonal adjustment. subtract=True (default): remove season effect.
       subtract=False: ADD offset to simulate that season (for IF_baseline testing)."""
    cfg = SENSOR_CONFIG[sensor]
    offset = seasonal_offset(dayofyear, cfg['amplitude'])
    offset_z = offset / cfg['raw_std']
    if not subtract:
        offset_z = -offset_z  # add instead of subtract
    df = df.copy()
    for col in cfg['adjust_cols']:
        if col in df.columns:
            df[col] = df[col] - offset_z
    return df

SEASONS = {
    'printemps': 90,   # 1 avril
    'ete': 200,        # 19 juillet (peak)
    'automne': 290,    # 17 octobre
    'hiver': 15        # 15 janvier
}

# ─── DATA LOADING ────────────────────────────────────────────────────────────

def load_normal_data():
    data = {}
    for sensor in ['weather', 'fridge', 'thermostat']:
        fp = os.path.join(PROCESSED_DIR, f'features_{sensor}.csv')
        df = pd.read_csv(fp, parse_dates=['datetime'])
        df = df.dropna().reset_index(drop=True)
        # drop duplicates
        X = df.drop(columns=['datetime'])
        data[sensor] = (df, X)
    return data

def charger_attaque_log(dossier_attaque):
    data = {}
    for capteur in ['weather', 'fridge', 'thermostat']:
        pattern = os.path.join(dossier_attaque, f'*_{capteur}*')
        fichiers = sorted(glob.glob(pattern))
        if not fichiers:
            pattern = os.path.join(dossier_attaque, f'*_{capteur.capitalize()}*')
            fichiers = sorted(glob.glob(pattern))
        lignes = []
        for fp in fichiers:
            with open(fp, 'r', encoding='utf-8') as fh:
                for line in fh:
                    line = line.strip()
                    if line:
                        try:
                            obj = json.loads(line)
                            if isinstance(obj, dict):
                                lignes.append(obj)
                        except:
                            pass
        if lignes:
            df = pd.DataFrame(lignes)
            df.columns = [c.strip().lower().replace(' ', '_') for c in df.columns]
            data[capteur] = df
        else:
            data[capteur] = pd.DataFrame()
    return data

def engineer_features(df, type_capteur):
    d = df.copy()
    if 'timestamp' in d.columns:
        d['datetime'] = pd.to_datetime(d['timestamp'], errors='coerce', format='mixed', utc=True)
    elif 'date' in d.columns and 'time' in d.columns:
        d['datetime'] = pd.to_datetime(d['date'] + ' ' + d['time'], dayfirst=True, errors='coerce', format='mixed', utc=True)
    else:
        d['datetime'] = pd.date_range(start='2019-01-01', periods=len(d), freq='s')
    d = d.sort_values('datetime').reset_index(drop=True)
    d = d.dropna(subset=['datetime'])
    features = ['datetime']
    if type_capteur == 'weather':
        d['temperature'] = pd.to_numeric(d['temperature'], errors='coerce')
        d['humidity'] = pd.to_numeric(d['humidity'], errors='coerce')
        d['temp_diff_1'] = d['temperature'].diff(1)
        d['humidity_diff_1'] = d['humidity'].diff(1)
        d['temp_roll_mean_10'] = d['temperature'].rolling(10, min_periods=1).mean()
        d['temp_roll_std_10'] = d['temperature'].rolling(10, min_periods=1).std()
        features += ['temperature','humidity','temp_diff_1','humidity_diff_1','temp_roll_mean_10','temp_roll_std_10']
    elif type_capteur == 'fridge':
        d['fridge_temperature'] = pd.to_numeric(d['fridge_temperature'], errors='coerce')
        if 'temp_condition' in d.columns:
            d['temp_condition_encoded'] = (d['temp_condition'] == 'high').astype(int)
        else:
            d['temp_condition_encoded'] = 0
        d['fridge_diff_1'] = d['fridge_temperature'].diff(1)
        d['fridge_roll_mean_10'] = d['fridge_temperature'].rolling(10, min_periods=1).mean()
        features += ['fridge_temperature','temp_condition_encoded','fridge_diff_1','fridge_roll_mean_10']
    elif type_capteur == 'thermostat':
        d['current_temperature'] = pd.to_numeric(d['current_temperature'], errors='coerce')
        if 'thermostat_status' in d.columns:
            sc = 'thermostat_status'
        elif 'ac_state' in d.columns:
            sc = 'ac_state'
        else:
            d['thermostat_status'] = 0
            sc = None
        if sc:
            if d[sc].dtype == bool:
                d['thermostat_status'] = d[sc].astype(int)
            else:
                d['thermostat_status'] = d[sc].map({'true':1,'false':0,'TRUE':1,'FALSE':0,True:1,False:0}).fillna(0).astype(int)
        d['thermo_diff_1'] = d['current_temperature'].diff(1)
        features += ['current_temperature','thermostat_status','thermo_diff_1']
    d['hour'] = d['datetime'].dt.hour
    d['hour_sin'] = np.sin(2 * np.pi * d['hour'] / 24)
    d['hour_cos'] = np.cos(2 * np.pi * d['hour'] / 24)
    features += ['hour_sin','hour_cos']
    df_out = d[features].copy()
    df_out = df_out.replace([np.inf, -np.inf], np.nan).dropna().reset_index(drop=True)
    return df_out

# ─── MODELS ──────────────────────────────────────────────────────────────────

def train_isolation_forest(X_scaled, contamination=0.05):
    model = IsolationForest(n_estimators=200, max_samples='auto',
                            contamination=contamination, random_state=SEED, n_jobs=-1)
    model.fit(X_scaled)
    return model

def train_oneclass_svm(X_scaled, contamination=0.05):
    model = OneClassSVM(nu=contamination, kernel='rbf', gamma='auto')
    model.fit(X_scaled)
    return model

def train_elliptic_envelope(X_scaled, contamination=0.05):
    model = EllipticEnvelope(contamination=contamination, random_state=SEED)
    model.fit(X_scaled)
    return model

class LSTMAutoencoder(nn.Module):
    def __init__(self, n_features, hidden_dim=64, n_layers=2):
        super().__init__()
        self.encoder = nn.LSTM(n_features, hidden_dim, n_layers, batch_first=True, dropout=0.2)
        self.decoder = nn.LSTM(hidden_dim, n_features, n_layers, batch_first=True, dropout=0.2)
        self.hidden_dim = hidden_dim
        self.n_layers = n_layers
    def forward(self, x):
        out, _ = self.encoder(x)
        out, _ = self.decoder(out)
        return out

def train_lstm_ae(X_scaled, contamination=0.05, seq_len=20, epochs=20, batch_size=256):
    n_samples, n_feats = X_scaled.shape
    n_seq = (n_samples // seq_len) * seq_len
    X_seq = X_scaled[:n_seq].reshape(-1, seq_len, n_feats)
    X_seq = torch.FloatTensor(X_seq)
    dataset = TensorDataset(X_seq)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True)
    model = LSTMAutoencoder(n_feats)
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)
    model.train()
    for epoch in range(epochs):
        total_loss = 0
        for batch in loader:
            x = batch[0]
            recon = model(x)
            loss = criterion(recon, x)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
    model.eval()
    return model, seq_len

def predict_lstm_ae(model, X_scaled, seq_len, threshold_percentile=95):
    model.eval()
    n_samples, n_feats = X_scaled.shape
    n_seq = (n_samples // seq_len) * seq_len
    if n_seq == 0:
        return np.zeros(n_samples), np.zeros(n_samples)
    X_seq = X_scaled[:n_seq].reshape(-1, seq_len, n_feats)
    X_seq_t = torch.FloatTensor(X_seq)
    with torch.no_grad():
        recon = model(X_seq_t)
        errors = ((recon - X_seq_t) ** 2).mean(dim=(1, 2)).numpy()
    # Threshold at given percentile
    thr = np.percentile(errors, threshold_percentile)
    scores = np.zeros(n_samples)
    pred = np.zeros(n_samples)
    scores[:n_seq:seq_len] = errors  # one score per sequence start
    for i in range(n_seq):
        scores[i] = errors[i // seq_len]
    pred = (scores > thr).astype(int)
    if n_seq < n_samples:
        pred[n_seq:] = 1  # remaining are anomalies
    return pred, scores

# ─── EVALUATION ──────────────────────────────────────────────────────────────

def evaluer_modele(model, scaler, X_normal_adjusted, X_attack_adjusted, normal_labels, attack_labels, model_type='iforest'):
    # Normal data
    if model_type == 'iforest':
        pred_norm = model.predict(X_normal_adjusted)
        scores_norm = model.decision_function(X_normal_adjusted)
        fp = (pred_norm == -1).sum()
    elif model_type == 'svm':
        pred_norm = model.predict(X_normal_adjusted)
        scores_norm = model.decision_function(X_normal_adjusted)
        fp = (pred_norm == -1).sum()
    elif model_type == 'elliptic':
        pred_norm = model.predict(X_normal_adjusted)
        scores_norm = model.decision_function(X_normal_adjusted)
        fp = (pred_norm == -1).sum()
    elif model_type == 'lstm':
        pred_norm, scores_norm = predict_lstm_ae(model, X_normal_adjusted, model['seq_len'])
        fp = pred_norm.sum()
    
    n_normal = len(X_normal_adjusted)
    fp_rate = fp / n_normal * 100
    
    # Attack data
    if X_attack_adjusted is not None and len(X_attack_adjusted) > 10:
        X_test = np.vstack([X_normal_adjusted, X_attack_adjusted])
        y_true = np.hstack([np.zeros(n_normal), np.ones(len(X_attack_adjusted))])
        if model_type == 'iforest':
            y_pred = model.predict(X_test)
            y_scores = -model.decision_function(X_test)
        elif model_type == 'svm':
            y_pred = model.predict(X_test)
            y_scores = -model.decision_function(X_test)
        elif model_type == 'elliptic':
            y_pred = model.predict(X_test)
            y_scores = -model.decision_function(X_test)
        elif model_type == 'lstm':
            y_pred, y_scores = predict_lstm_ae(model, X_test, model['seq_len'])
        y_pred_bin = (y_pred == -1).astype(int) if model_type in ['iforest','svm','elliptic'] else y_pred
        try:
            roc_auc = roc_auc_score(y_true, y_scores)
        except:
            roc_auc = 0.5
        try:
            avg_prec = average_precision_score(y_true, y_scores)
        except:
            avg_prec = 0.0
        tp = ((y_pred_bin == 1) & (y_true == 1)).sum()
        fn = ((y_pred_bin == 0) & (y_true == 1)).sum()
        detection_rate = tp / (tp + fn) * 100 if (tp + fn) > 0 else 0.0
    else:
        detection_rate = 0.0
        roc_auc = 0.0
        avg_prec = 0.0
    
    return fp_rate, detection_rate, roc_auc, avg_prec

# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    import time
    t0 = time.time()
    def log(msg):
        elapsed = time.time() - t0
        print(f"[{elapsed:6.0f}s] {msg}", flush=True)
    
    log("=" * 50)
    log("COMPARAISON MULTI-MODELES - DETECTION D'ANOMALIES IoT")
    log("=" * 50)
    log("Demarrage")
    
    # 1. Charger donnees normales
    log("[1] Chargement des donnees normales...")
    normal_data = load_normal_data()
    
    # 2. Charger attaques
    log("[2] Chargement des attaques...")
    attack_raw = {}
    for attaque in TYPES_ATTAQUE:
        dossier = os.path.join(ATTACK_DIR, attaque)
        if os.path.isdir(dossier):
            attack_raw[attaque] = charger_attaque_log(dossier)
    
    attack_fe = {}
    for attaque, data in attack_raw.items():
        attack_fe[attaque] = {}
        for capteur in ['weather','fridge','thermostat']:
            if not data[capteur].empty:
                attack_fe[attaque][capteur] = engineer_features(data[capteur], capteur)
    
    # 3. Entrainer modeles sur printemps (jour 90)
    log("[3] Entrainement des modeles sur printemps...")
    
    models = {}
    scalers = {}
    
    for sensor in ['weather', 'fridge', 'thermostat']:
        df, X = normal_data[sensor]
        spring_X = X.values.astype(np.float64)
        cfg = SENSOR_CONFIG[sensor]
        
        # Scaler pour ce capteur
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(spring_X)
        scalers[sensor] = scaler
        
        log(f"  {sensor.upper()}: {spring_X.shape[0]:,} echantillons, {spring_X.shape[1]} features")
        
        # Subsampling for O(n^2) models
        max_svm = 10000
        if len(X_scaled) > max_svm:
            idx = np.random.choice(len(X_scaled), max_svm, replace=False)
            X_sub = X_scaled[idx]
        else:
            X_sub = X_scaled
        
        # Isolation Forest (baseline)
        models[(sensor, 'IF_baseline')] = train_isolation_forest(X_scaled)
        
        log(f"    OneClassSVM en cours... (subsample {len(X_sub)})"); sys.stdout.flush()
        models[(sensor, 'SVM')] = train_oneclass_svm(X_sub)
        
        # EllipticEnvelope (subsampled)
        try:
            models[(sensor, 'Elliptic')] = train_elliptic_envelope(X_sub)
            log(f"    EllipticEnvelope OK")
        except Exception as e:
            log(f"    EllipticEnvelope echoue: {e}")
        
        # LSTM Autoencoder (subsampled for speed)
        log(f"    LSTM-Autoencoder en cours..."); sys.stdout.flush()
        max_lstm = 40000
        if len(X_scaled) > max_lstm:
            idx_lstm = np.random.choice(len(X_scaled), max_lstm, replace=False)
            X_lstm = X_scaled[idx_lstm]
        else:
            X_lstm = X_scaled
        lstm_model, seq_len = train_lstm_ae(X_lstm, epochs=8)
        models[(sensor, 'LSTM')] = {'model': lstm_model, 'seq_len': seq_len}
        log(f"    LSTM-Autoencoder OK")
        
        # Isolation Forest + seasonal adjustment (entraine sur printemps, mais on va ajuster l'entree)
        # Meme modele que IF_baseline, on ajuste juste les donnes d'entree
        models[(sensor, 'IF_saisonnier')] = models[(sensor, 'IF_baseline')]
    
    # 4. Evaluation par saison
    log("[4] EVALUATION PAR SAISON")
    
    model_names = ['IF_baseline', 'IF_saisonnier', 'SVM', 'Elliptic', 'LSTM']
    model_labels = {
        'IF_baseline': 'Isolation Forest (brut)',
        'IF_saisonnier': 'Isolation Forest + saison',
        'SVM': 'OneClassSVM + saison',
        'Elliptic': 'EllipticEnvelope + saison',
        'LSTM': 'LSTM-Autoencoder + saison'
    }
    
    results_fp = {}  # (sensor, model) -> {season: fp_rate}
    results_det = {}  # (sensor, model, attack) -> {season: detection_rate}
    results_auc = {}
    
    # Pre-compute seasonally simulated data for each sensor
    eval_subsample = 50000
    eval_cache = {}  # (sensor, season) -> (X_sim_scaled, X_sim_adj_scaled, X_spring_scaled)
    # X_sim_scaled = spring data + offset (simulates being in that season) - for IF_baseline
    # X_sim_adj_scaled = X_sim_scaled then adjusted back (subtract offset) = spring-like - for seasonal models
    # X_spring_scaled = original spring data (no simulation) - for reference
    
    for sensor in ['weather', 'fridge', 'thermostat']:
        df, X = normal_data[sensor]
        X_raw = X.values.astype(np.float64)
        
        n_total = len(X_raw)
        if n_total > eval_subsample:
            idx_fp = np.random.choice(n_total, eval_subsample, replace=False)
        else:
            idx_fp = np.arange(n_total)
        
        X_sub = X_raw[idx_fp]
        scaler = scalers[sensor]
        
        for season_name, day in SEASONS.items():
            # 1. Simulate what spring data would look like in this season: X + offset
            X_sim = adjust_features(X.iloc[idx_fp] if n_total > eval_subsample else X, sensor, day, subtract=False).values.astype(np.float64)
            X_sim_scaled = scaler.transform(X_sim)
            
            # 2. Adjust back to spring: (X + offset) - offset = X
            X_sim_adj = adjust_features(pd.DataFrame(X_sim, columns=X.columns), sensor, day, subtract=True).values.astype(np.float64)
            X_sim_adj_scaled = scaler.transform(X_sim_adj)
            
            # 3. Original spring (no simulation, no adjustment)
            X_spring_scaled = scaler.transform(X_sub)
            
            eval_cache[(sensor, season_name)] = (X_sim_scaled, X_sim_adj_scaled, X_spring_scaled)
            
            log(f"  {sensor.upper()} - {season_name.upper()} (jour {day})")
            
            for mname in model_names:
                if (sensor, mname) not in models:
                    continue
                model_obj = models[(sensor, mname)]
                
                # Determine model type and which data to use
                if mname == 'IF_baseline':
                    # NO seasonal adjustment -> sees raw simulated data -> HIGH FP in non-spring
                    X_eval = X_sim_scaled
                    mtype = 'iforest'
                elif mname == 'IF_saisonnier':
                    # WITH seasonal adjustment -> sees adjusted data (back to spring-like) -> LOW FP
                    X_eval = X_sim_adj_scaled
                    mtype = 'iforest'
                elif mname == 'SVM':
                    X_eval = X_sim_adj_scaled
                    mtype = 'svm'
                elif mname == 'Elliptic':
                    X_eval = X_sim_adj_scaled
                    mtype = 'elliptic'
                elif mname == 'LSTM':
                    X_eval = X_sim_adj_scaled
                    mtype = 'lstm'
                
                if mtype in ('iforest', 'svm', 'elliptic'):
                    pred = model_obj.predict(X_eval)
                    fp = (pred == -1).sum()
                elif mtype == 'lstm':
                    pred, _ = predict_lstm_ae(model_obj['model'], X_eval, model_obj['seq_len'])
                    fp = pred.sum()
                
                fp_rate = fp / len(X_eval) * 100
                results_fp.setdefault((sensor, mname), {})[season_name] = fp_rate
    
    # 5. Evaluation par attaque x saison (optimise: subsample normal, use cached adjusted)
    log("[5] EVALUATION PAR ATTAQUE x SAISON")
    
    for sensor in ['weather', 'fridge', 'thermostat']:
        df, X = normal_data[sensor]
        scaler = scalers[sensor]
        log(f"  {sensor} - {len(TYPES_ATTAQUE)} attaques x 4 saisons...")
        
        for attaque in TYPES_ATTAQUE:
            if attaque not in attack_fe or sensor not in attack_fe[attaque]:
                continue
            df_att = attack_fe[attaque][sensor]
            if df_att.empty or len(df_att) < 10:
                continue
            
            att_name = attaque.replace('IoT_','')
            
            for season_name, day in SEASONS.items():
                X_sim_scaled, X_sim_adj_scaled, X_spring_scaled = eval_cache[(sensor, season_name)]
                
                # Simulate attack in this season: attack + offset
                X_att_sim = adjust_features(df_att.drop(columns=['datetime']), sensor, day, subtract=False).values.astype(np.float64)
                X_att_sim_scaled = scaler.transform(X_att_sim)
                
                # Adjusted attack: (attack + offset) - offset = attack (back to spring)
                X_att_sim_adj = adjust_features(pd.DataFrame(X_att_sim, columns=X.columns), sensor, day, subtract=True).values.astype(np.float64)
                X_att_adj_scaled = scaler.transform(X_att_sim_adj)
                
                n_att = min(len(X_att_sim_scaled), 10000)
                
                # For IF_baseline: use simulated (unadjusted) data
                # For IF_saisonnier: use adjusted data (back to spring)
                n_norm = min(2 * n_att, len(X_sim_scaled), 10000)
                
                idx_sim = np.random.choice(len(X_sim_scaled), n_norm, replace=False)
                X_norm_sim = X_sim_scaled[idx_sim]
                X_norm_adj = X_sim_adj_scaled[np.random.choice(len(X_sim_adj_scaled), n_norm, replace=False)]
                
                for mname in ['IF_baseline', 'IF_saisonnier']:
                    if (sensor, mname) not in models:
                        continue
                    model_obj = models[(sensor, mname)]
                    
                    if mname == 'IF_baseline':
                        X_norm = X_norm_sim  # simulated seasonal, no adjustment
                        X_att = X_att_sim_scaled[:n_att]
                    else:
                        X_norm = X_norm_adj  # simulated + adjusted back to spring
                        X_att = X_att_adj_scaled[:n_att]
                    
                    X_test = np.vstack([X_norm, X_att])
                    y_true = np.hstack([np.zeros(len(X_norm)), np.ones(n_att)])
                    
                    mtype = 'iforest'
                    
                    if mtype == 'iforest':
                        y_pred = model_obj.predict(X_test)
                        y_scores = -model_obj.decision_function(X_test)
                    
                    y_pred_bin = (y_pred == -1).astype(int) if mtype in ['iforest','svm','elliptic'] else y_pred
                    tp = ((y_pred_bin == 1) & (y_true == 1)).sum()
                    fn = ((y_pred_bin == 0) & (y_true == 1)).sum()
                    det_rate = tp / (tp + fn) * 100 if (tp + fn) > 0 else 0.0
                    try:
                        auc = roc_auc_score(y_true, y_scores)
                    except:
                        auc = 0.0
                    
                    results_det.setdefault((sensor, mname, att_name), {})[season_name] = det_rate
                    results_auc.setdefault((sensor, mname, att_name), {})[season_name] = auc
    
    # 6. PRINT RESULTS
    log("=" * 80)
    log("RESULTATS FINAUX")
    log("=" * 80)
    
    for sensor in ['weather', 'fridge', 'thermostat']:
        log(f"\n{'='*120}")
        log(f"  {sensor.upper()}")
        log(f"{'='*120}")
        
        log(f"\n  --- FAUX POSITIFS (%) par saison ---")
        log(f"  {'Modele':<35s} | {'Printemps':>10s} | {'Ete':>10s} | {'Automne':>10s} | {'Hiver':>10s} | {'Moyenne':>10s}")
        log(f"  {'-'*35}-+-{'-'*10}-+-{'-'*10}-+-{'-'*10}-+-{'-'*10}-+-{'-'*10}")
        for mname in model_names:
            if (sensor, mname) in results_fp:
                r = results_fp[(sensor, mname)]
                vals = [r.get(s, 0) for s in SEASONS]
                avg = np.mean(vals)
                log(f"  {model_labels.get(mname, mname):<35s} | {vals[0]:>8.2f}%  | {vals[1]:>8.2f}%  | {vals[2]:>8.2f}%  | {vals[3]:>8.2f}%  | {avg:>8.2f}%  ")
        
        log(f"\n  --- DETECTION (%) par attaque (moyenne 4 saisons) ---")
        log(f"  {'Modele':<35s} | {'Attaque':<20s} | {'Detection':>10s} | {'AUC':>10s}")
        log(f"  {'-'*35}-+-{'-'*20}-+-{'-'*10}-+-{'-'*10}")
        
        det_avg = {}
        for mname in model_names:
            for (s, m, att), seas in results_det.items():
                if s == sensor and m == mname:
                    vals = list(seas.values())
                    auc_vals = list(results_auc.get((s, m, att), {}).values())
                    det_avg.setdefault(mname, {})[att] = (np.mean(vals), np.mean(auc_vals) if auc_vals else 0)
        
        for mname in model_names:
            if mname not in det_avg or not det_avg[mname]:
                continue
            for att, (det, auc) in sorted(det_avg[mname].items()):
                log(f"  {model_labels.get(mname, mname):<35s} | {att:<20s} | {det:>8.2f}%  | {auc:>8.3f}")
        
        log(f"\n  --- SCORE GLOBAL par modele ---")
        log(f"  {'Modele':<35s} | {'FP moyen':>10s} | {'Det moyen':>10s} | {'AUC moyen':>10s} | {'Score':>10s}")
        log(f"  {'-'*35}-+-{'-'*10}-+-{'-'*10}-+-{'-'*10}-+-{'-'*10}")
        
        for mname in model_names:
            if (sensor, mname) not in results_fp:
                continue
            fp_vals = list(results_fp[(sensor, mname)].values())
            avg_fp = np.mean(fp_vals)
            if mname in det_avg and det_avg[mname]:
                avg_det = np.mean([v[0] for v in det_avg[mname].values()])
                avg_auc = np.mean([v[1] for v in det_avg[mname].values()])
            else:
                avg_det = 0
                avg_auc = 0
            score = (100 - avg_fp) * 0.3 + avg_det * 0.5 + avg_auc * 100 * 0.2
            log(f"  {model_labels.get(mname, mname):<35s} | {avg_fp:>8.2f}%  | {avg_det:>8.2f}%  | {avg_auc:>8.3f}  | {score:>8.2f}")
    
    log(f"\n{'='*120}")
    log("RECOMMANDATION FINALE")
    log(f"{'='*120}")
    
    overall = {}
    for sensor in ['weather', 'fridge', 'thermostat']:
        for mname in model_names:
            if (sensor, mname) not in results_fp:
                continue
            fp_vals = list(results_fp[(sensor, mname)].values())
            avg_fp = np.mean(fp_vals)
            dets = []
            aucs = []
            for (s, m, att), seas in results_det.items():
                if s == sensor and m == mname:
                    dets.append(np.mean(list(seas.values())))
                    if (s, m, att) in results_auc:
                        aucs.append(np.mean(list(results_auc[(s, m, att)].values())))
            avg_det = np.mean(dets) if dets else 0
            avg_auc = np.mean(aucs) if aucs else 0
            score = (100 - avg_fp) * 0.3 + avg_det * 0.5 + avg_auc * 100 * 0.2
            overall.setdefault(mname, []).append((avg_fp, avg_det, avg_auc, score))
    
    log(f"\n  {'Modele':<35s} | {'FP moyen':>10s} | {'Det moyen':>10s} | {'AUC moyen':>10s} | {'Score':>10s}")
    log(f"  {'-'*35}-+-{'-'*10}-+-{'-'*10}-+-{'-'*10}-+-{'-'*10}")
    for mname in model_names:
        if mname not in overall:
            continue
        vals = overall[mname]
        afp = np.mean([v[0] for v in vals])
        adet = np.mean([v[1] for v in vals])
        aauc = np.mean([v[2] for v in vals])
        asc = np.mean([v[3] for v in vals])
        log(f"  {model_labels.get(mname, mname):<35s} | {afp:>8.2f}%  | {adet:>8.2f}%  | {aauc:>8.3f}  | {asc:>8.2f}")
    
    best = max(overall.keys(), key=lambda m: np.mean([v[3] for v in overall[m]]))
    log(f"\n  >>> MEILLEUR MODELE: {model_labels.get(best, best)} <<<")
    log(f"  >>> Score: {np.mean([v[3] for v in overall[best]]):.2f}/100 <<<")
    
    os.makedirs('Data/Results', exist_ok=True)
    results_summary = {
        'model': [], 'sensor': [], 'season': [], 'fp_rate': [],
    }
    for (sensor, mname), seasons in results_fp.items():
        for season, fp in seasons.items():
            results_summary['model'].append(mname)
            results_summary['sensor'].append(sensor)
            results_summary['season'].append(season)
            results_summary['fp_rate'].append(fp)
    pd.DataFrame(results_summary).to_csv('Data/Results/comparaison_fp.csv', index=False)
    
    det_rows = []
    for (sensor, mname, att), seasons in results_det.items():
        for season, det in seasons.items():
            auc_val = results_auc.get((sensor, mname, att), {}).get(season, 0)
            det_rows.append({'model': mname, 'sensor': sensor, 'attack': att, 'season': season, 'detection_rate': det, 'auc': auc_val})
    if det_rows:
        pd.DataFrame(det_rows).to_csv('Data/Results/comparaison_detection.csv', index=False)
    
    log(f"\n  Resultats sauvegardes dans Data/Results/")

if __name__ == '__main__':
    main()
