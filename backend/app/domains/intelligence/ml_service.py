import joblib
import numpy as np
import json
import os
from datetime import datetime
from collections import deque

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(_HERE)))
_NOTEBOOKS = os.path.join(os.path.dirname(_ROOT), "notebooks")

def _find_model(*sub):
    """Cherche le modele dans models/ (racine), puis backend/models/, puis notebooks/
    et surtout phase2/Data/Processed/models/ (racine canonique, voir shap_analysis)."""
    root_models = os.path.join(os.path.dirname(_ROOT), "models", sub[-1])
    if os.path.exists(root_models):
        return root_models
    prod_path = os.path.join(_ROOT, "models", sub[-1])
    if os.path.exists(prod_path):
        return prod_path
    pb2_path = os.path.join(os.path.dirname(_ROOT), "phase2", "Data", "Processed", "models", sub[-1])
    if os.path.exists(pb2_path):
        return pb2_path
    nb_path = os.path.join(_NOTEBOOKS, "phase2", "Data", "Processed", "models", sub[-1])
    if os.path.exists(nb_path):
        return nb_path
    return pb2_path

MV_MODEL_PATH = _find_model("ocsvm_multivarie.pkl")
MV_SCALER_PATH = _find_model("scaler_ocsvm.pkl")

# Ordre exact des 21 features du modele multivarie (doit matcher le notebook)
MV_FEATURE_COLS = [
    "weather_temp", "fridge_temp", "thermostat_temp",
    "weather_diff_1", "weather_roll_mean_10", "weather_roll_std_10",
    "fridge_diff_1", "fridge_roll_mean_10", "fridge_roll_std_10",
    "thermostat_diff_1", "thermostat_roll_mean_10", "thermostat_roll_std_10",
    "weather_fridge_diff", "weather_thermostat_diff", "fridge_thermostat_diff",
    "hour_sin", "hour_cos", "season_sin", "season_cos",
    "fridge_cond_enc", "thermo_status",
]


class MultivariateBuffer:
    """Buffer glissant pour le feature engineering multivarie (3 capteurs)."""

    WINDOW = 10

    def __init__(self):
        self._weather = deque(maxlen=self.WINDOW)
        self._fridge = deque(maxlen=self.WINDOW)
        self._thermostat = deque(maxlen=self.WINDOW)

    def add(self, weather_temp: float, fridge_temp: float, thermostat_temp: float):
        self._weather.append(weather_temp)
        self._fridge.append(fridge_temp)
        self._thermostat.append(thermostat_temp)

    def build_features(self, weather_temp: float, fridge_temp: float,
                       thermostat_temp: float, timestamp=None) -> dict:
        fts = {}
        fts["weather_temp"] = weather_temp
        fts["fridge_temp"] = fridge_temp
        fts["thermostat_temp"] = thermostat_temp

        # Le buffer contient deja la valeur courante (add() est appele avant build).
        # diff_1 compare donc a la valeur precedente (avant la courante).
        if len(self._weather) >= 2:
            fts["weather_diff_1"] = weather_temp - self._weather[-2]
            fts["fridge_diff_1"] = fridge_temp - self._fridge[-2]
            fts["thermostat_diff_1"] = thermostat_temp - self._thermostat[-2]
        else:
            fts["weather_diff_1"] = 0.0
            fts["fridge_diff_1"] = 0.0
            fts["thermostat_diff_1"] = 0.0

        # Fenetre glissante exactement WINDOW=10 valeurs (current inclus, backward-looking)
        window_w = list(self._weather)[-self.WINDOW:]
        window_f = list(self._fridge)[-self.WINDOW:]
        window_t = list(self._thermostat)[-self.WINDOW:]

        fts["weather_roll_mean_10"] = float(np.mean(window_w))
        fts["weather_roll_std_10"] = float(np.std(window_w))
        fts["fridge_roll_mean_10"] = float(np.mean(window_f))
        fts["fridge_roll_std_10"] = float(np.std(window_f))
        fts["thermostat_roll_mean_10"] = float(np.mean(window_t))
        fts["thermostat_roll_std_10"] = float(np.std(window_t))

        fts["weather_fridge_diff"] = weather_temp - fridge_temp
        fts["weather_thermostat_diff"] = weather_temp - thermostat_temp
        fts["fridge_thermostat_diff"] = fridge_temp - thermostat_temp

        if timestamp is None:
            timestamp = datetime.now()
        if isinstance(timestamp, str):
            timestamp = datetime.fromisoformat(timestamp)
        hour = timestamp.hour + timestamp.minute / 60
        doy = timestamp.timetuple().tm_yday
        fts["hour_sin"] = float(np.sin(2 * np.pi * hour / 24))
        fts["hour_cos"] = float(np.cos(2 * np.pi * hour / 24))
        fts["season_sin"] = float(np.sin(2 * np.pi * doy / 365))
        fts["season_cos"] = float(np.cos(2 * np.pi * doy / 365))

        fts["fridge_cond_enc"] = 0.0
        fts["thermo_status"] = 1.0

        return fts


class MultivariateMLService:
    """Modele One-Class SVM multivarie (21 features, 3 capteurs fusionnes).

    Convention de score (identique a phase2.py / fusion_insights.py) :
      anomaly_score = -decision_function  -> plus grand = plus anormal
      anomalie si anomaly_score >= seuil calibre (threshold_ocsvm.json,
      max F1 precision/recall = -20.55, mesure sur -decision_function).
    """

    MV_FEATURE_EXPLANATIONS = {
        "weather_temp": "Température extérieure (Weather) anormale",
        "fridge_temp": "Température du frigo anormale",
        "thermostat_temp": "Température du thermostat anormale",
        "weather_diff_1": "Variation brutale de la température extérieure",
        "weather_roll_mean_10": "Dérive de la tendance météo (moyenne 10 pas)",
        "weather_roll_std_10": "Volatilité anormale de la météo",
        "fridge_diff_1": "Variation brutale de la température frigo",
        "fridge_roll_mean_10": "Dérive de la température frigo (moyenne 10 pas)",
        "fridge_roll_std_10": "Volatilité anormale du frigo",
        "thermostat_diff_1": "Variation brutale du thermostat",
        "thermostat_roll_mean_10": "Dérive du thermostat (moyenne 10 pas)",
        "thermostat_roll_std_10": "Volatilité anormale du thermostat",
        "weather_fridge_diff": "Incohérence entre météo et frigo (écart anormal)",
        "weather_thermostat_diff": "Incohérence entre météo et thermostat",
        "fridge_thermostat_diff": "Incohérence entre frigo et thermostat",
        "hour_sin": "Comportement horaire inhabituel (sinus)",
        "hour_cos": "Comportement horaire inhabituel (cosinus)",
        "season_sin": "Comportement saisonnier inhabituel (sinus)",
        "season_cos": "Comportement saisonnier inhabituel (cosinus)",
        "fridge_cond_enc": "État compresseur frigo anormal",
        "thermo_status": "Statut du thermostat anormal",
    }

    DEFAULT_THRESHOLD = 20.0

    def __init__(self):
        self._available = os.path.exists(MV_MODEL_PATH) and os.path.exists(MV_SCALER_PATH)
        self.selector = None
        self.threshold = self._load_threshold()
        if not self._available:
            print("[Multivarie] Modele ou scaler introuvable — desactive")
            return

        self.model = joblib.load(MV_MODEL_PATH)
        self.scaler = joblib.load(MV_SCALER_PATH)
        self.buffer = MultivariateBuffer()
        self.feature_cols = MV_FEATURE_COLS

        # Feature selection supprimee (data leakage detecte en research).
        # Le modele travaille donc sur les 21 features completes.
        self.selector = None
        self.selected_feature_cols = MV_FEATURE_COLS

        n_support = int(getattr(self.model, "n_support_", np.array([0])).sum()) \
            if hasattr(self.model, "n_support_") else 0
        print(f"[Multivarie] OCSVM charge: {n_support} vecteurs de support, "
              f"{self.model.n_features_in_} features, seuil={self.threshold:.2f}")
        print(f"[Multivarie] Scaler: {self.scaler.n_features_in_} features, "
              f"{self.scaler.n_samples_seen_} echantillons")

        if self.scaler.n_features_in_ != len(MV_FEATURE_COLS):
            print(f"[Multivarie] WARNING: scaler attend {self.scaler.n_features_in_} features, "
                  f"config a {len(MV_FEATURE_COLS)}")
        if self.model.n_features_in_ != len(MV_FEATURE_COLS):
            print(f"[Multivarie] CRITIQUE: modele attend {self.model.n_features_in_} features, "
                  f"config fournit {len(MV_FEATURE_COLS)} — inference invalide")
        print("[Multivarie] Explications locales: ablation (deterministe, temps reel)")

    def reset_buffer(self):
        """Vide le buffer glissant : chaque échantillon est évalué de façon
        indépendante (indispensable pour un protocole scientifique où les
        échantillons ne doivent pas se contaminer les uns les autres)."""
        self.buffer = MultivariateBuffer()

    def _load_threshold(self) -> float:
        try:
            path = _find_model("threshold_ocsvm.json")
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    return float(json.load(f).get("threshold", self.DEFAULT_THRESHOLD))
        except Exception:
            pass
        return self.DEFAULT_THRESHOLD

    def _ablation_impacts(self, X_scaled: np.ndarray) -> list:
        """Impacts locaux par ablation (leave-one-out au centre = 0 du scaler).

        Methode deterministe et instantanee (42 evaluations decision_function),
        sans dependance SHAP. On remplace chaque feature par sa valeur moyenne
        (0 apres standardisation) et on mesure la chute de decision_function.
        Convention de signe : impact negatif = pousse vers ANOMALIE (decision
        basse), positif = vers NORMAL.
        """
        try:
            base = float(self.model.decision_function(X_scaled)[0])
        except Exception:
            return []
        impacts = []
        for idx in range(X_scaled.shape[1]):
            X_pert = X_scaled.copy()
            X_pert[0, idx] = 0.0
            try:
                perturbed = float(self.model.decision_function(X_pert)[0])
            except Exception:
                continue
            impacts.append((idx, float(X_scaled[0, idx]), base - perturbed))
        impacts.sort(key=lambda t: abs(t[2]), reverse=True)
        explanations = []
        for rank, (idx, value, impact) in enumerate(impacts[:5]):
            if rank == 0 and abs(impact) < 1e-6:
                continue
            feat_name = self.selected_feature_cols[idx]
            base_text = self.MV_FEATURE_EXPLANATIONS.get(feat_name, f"Feature {feat_name}")
            if impact < 0:
                detail = f"{base_text} -> pousse vers ANOMALIE"
            else:
                detail = f"{base_text} -> pousse vers NORMAL"
            explanations.append({
                "feature": feat_name,
                "valeur": round(float(value), 4),
                "impact": round(float(impact), 4),
                "interpretation": detail,
            })
        return explanations

    def _explain(self, X_scaled: np.ndarray) -> list:
        return self._ablation_impacts(X_scaled)

    def analyze(self, telemetry: dict) -> dict:
        if not self._available:
            return {"is_anomaly": False, "anomaly_score": 0, "confidence": "non disponible",
                    "error": "Modele multivarie non disponible"}

        try:
            weather_t = float(telemetry.get("temperature", telemetry.get("weather_temp", 25)))
            fridge_t = float(telemetry.get("fridge_temperature", telemetry.get("fridge_temp", 5)))
            thermo_t = float(telemetry.get("current_temperature", telemetry.get("thermostat_temp", 25)))
        except (ValueError, TypeError):
            return {"is_anomaly": False, "anomaly_score": 0, "confidence": "non disponible",
                    "error": "Donnees capteurs invalides"}

        ts = telemetry.get("timestamp", datetime.now().isoformat())
        self.buffer.add(weather_t, fridge_t, thermo_t)
        features = self.buffer.build_features(weather_t, fridge_t, thermo_t, ts)

        X = np.array([[features[c] for c in self.feature_cols]])
        X_scaled = self.scaler.transform(X)
        # Convention OCSVM (phase2.py:548 et fusion_insights.py:210) :
        #   anomaly_score = -decision_function  -> plus grand = plus anormal
        #   anomalie si anomaly_score >= threshold calibre (threshold_ocsvm.json)
        score = -float(self.model.decision_function(X_scaled)[0])
        is_anomaly = score >= self.threshold

        # Confidence basee sur la marge au seuil calibre (marge > 10 = decision nette)
        margin = score - self.threshold
        confidence = "haute" if abs(margin) > 10.0 else "moyenne"

        result = {
            "is_anomaly": is_anomaly,
            "anomaly_score": round(score, 4),
            "confidence": confidence,
            "model": "multivarie-ocsvm",
            "threshold": round(self.threshold, 4),
            "sensors": {
                "weather_temp": round(weather_t, 2),
                "fridge_temp": round(fridge_t, 2),
                "thermostat_temp": round(thermo_t, 2),
            },
        }

        explanations = self._explain(X_scaled)
        if explanations:
            result["top_causes"] = explanations

        return result


ml_anomaly = MultivariateMLService()