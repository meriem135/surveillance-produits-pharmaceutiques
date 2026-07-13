import joblib
import numpy as np
import json
import os
from datetime import datetime
from collections import deque

MODEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "models",
    "pipeline_complete.joblib",
)

MV_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "..", "..", "phase2", "Data", "Processed", "models", "if_multivarie.pkl",
)

MV_SCALER_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "..", "..", "phase2", "Data", "Processed", "models", "scaler_multivarie.pkl",
)

REGISTERS = ["FC1_Input_Register", "FC2_Discrete_Input", "FC3_Holding_Register", "FC4_Coil"]

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


def _build_features_single(telemetry: dict) -> dict:
    row = {}
    for r in REGISTERS:
        val = float(telemetry.get(r, 0))
        row[r] = val
        row[f"{r}_lag_1"] = val
        row[f"{r}_lag_5"] = val
        row[f"{r}_lag_10"] = val
        row[f"zscore_{r}"] = 0

    vals = np.array([row[r] for r in REGISTERS])
    mean_val = vals.mean()

    row["rolling_mean_5"] = mean_val
    row["rolling_mean_30"] = mean_val
    row["rolling_mean_60"] = mean_val
    row["rolling_std_5"] = 0
    row["rolling_std_30"] = 0
    row["diff_1"] = 0
    row["diff_5"] = 0
    row["ratio_FC1_FC3"] = row["FC1_Input_Register"] / (row["FC3_Holding_Register"] + 1e-8)
    row["ratio_FC2_FC4"] = row["FC2_Discrete_Input"] / (row["FC4_Coil"] + 1e-8)

    return row


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

        if len(self._weather) >= 1:
            fts["weather_diff_1"] = weather_temp - self._weather[-1]
            fts["fridge_diff_1"] = fridge_temp - self._fridge[-1]
            fts["thermostat_diff_1"] = thermostat_temp - self._thermostat[-1]
        else:
            fts["weather_diff_1"] = 0.0
            fts["fridge_diff_1"] = 0.0
            fts["thermostat_diff_1"] = 0.0

        window_w = list(self._weather) + [weather_temp]
        window_f = list(self._fridge) + [fridge_temp]
        window_t = list(self._thermostat) + [thermostat_temp]

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
    """Modele Isolation Forest multivarie (21 features, 3 capteurs fusionnes)."""

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

    def __init__(self):
        self._available = os.path.exists(MV_MODEL_PATH) and os.path.exists(MV_SCALER_PATH)
        self.shap_explainer = None
        if not self._available:
            print("[Multivarie] Modele ou scaler introuvable — desactive")
            return

        self.model = joblib.load(MV_MODEL_PATH)
        self.scaler = joblib.load(MV_SCALER_PATH)
        self.buffer = MultivariateBuffer()
        self.feature_cols = MV_FEATURE_COLS
        self._init_shap()
        print(f"[Multivarie] IF charge: {self.model.n_estimators} arbres, "
              f"{self.model.n_features_in_} features")
        print(f"[Multivarie] Scaler: {self.scaler.n_features_in_} features, "
              f"{self.scaler.n_samples_seen_} echantillons")
        print(f"[Multivarie] SHAP: {'OK' if self.shap_explainer else 'non disponible'}")

    def _init_shap(self):
        try:
            import shap
            self.shap_explainer = shap.TreeExplainer(
                self.model,
                feature_perturbation="tree_path_dependent",
            )
        except Exception as e:
            print(f"[Multivarie] SHAP TreeExplainer non disponible: {e}")
            try:
                self.shap_explainer = shap.explainers.Permutation(
                    self.model.score_samples,
                    np.zeros((1, self.model.n_features_in_)),
                )
                print("[Multivarie] SHAP Permutation explainer initialise")
            except Exception as e2:
                print(f"[Multivarie] SHAP indisponible: {e2}")

    def _explain_shap(self, X_scaled: np.ndarray) -> list:
        if self.shap_explainer is None:
            return []
        try:
            import shap
            if isinstance(self.shap_explainer, shap.TreeExplainer):
                shap_values = self.shap_explainer.shap_values(X_scaled)[0]
            elif isinstance(self.shap_explainer, shap.explainers.Permutation):
                shap_values = self.shap_explainer.shap_values(X_scaled)[0]
            else:
                return []

            top_indices = np.argsort(np.abs(shap_values))[::-1][:5]
            explanations = []
            for idx in top_indices:
                feat_name = self.feature_cols[idx]
                impact = float(shap_values[idx])
                base = self.MV_FEATURE_EXPLANATIONS.get(
                    feat_name, f"Feature {feat_name}"
                )
                if impact < 0:
                    detail = f"{base} -> pousse vers ANOMALIE"
                else:
                    detail = f"{base} -> pousse vers NORMAL"
                explanations.append({
                    "feature": feat_name,
                    "valeur": round(float(X_scaled[0, idx]), 4),
                    "impact": round(impact, 4),
                    "interpretation": detail,
                })
            return explanations
        except Exception as e:
            print(f"[Multivarie] SHAP error: {e}")
            return []

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
        score = float(self.model.score_samples(X_scaled)[0])
        pred = int(self.model.predict(X_scaled)[0])
        is_anomaly = pred == -1

        result = {
            "is_anomaly": is_anomaly,
            "anomaly_score": round(score, 4),
            "confidence": "haute" if abs(score) < 0.15 else "moyenne",
            "model": "multivarie",
            "sensors": {
                "weather_temp": round(weather_t, 2),
                "fridge_temp": round(fridge_t, 2),
                "thermostat_temp": round(thermo_t, 2),
            },
        }

        shap_explanations = self._explain_shap(X_scaled)
        if shap_explanations:
            result["top_causes"] = shap_explanations

        return result


class MLAnomalyService:
    def __init__(self):
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(
                f"Modele introuvable: {MODEL_PATH}\n"
                "Execute d'abord le notebook notebooks/pipeline_complet.ipynb"
            )
        pipeline = joblib.load(MODEL_PATH)
        self.model = pipeline["model"]
        self.feature_cols = pipeline["feature_cols"]
        self.shap_reference = pipeline.get("shap_reference", None)
        self.shap_explainer = None

        self.mv_service = MultivariateMLService()

        self._init_shap()
        print(f"Modele: {type(self.model).__name__}, {len(self.feature_cols)} features")
        print(f"SHAP: {'OK' if self.shap_explainer else 'non disponible'}")
        print(f"Multivarie: {'DISPONIBLE' if self.mv_service._available else 'NON DISPONIBLE (voir phase2/notebooks/)'}")

    def _init_shap(self):
        if self.shap_reference is not None:
            try:
                import shap
                self.shap_explainer = shap.TreeExplainer(
                    self.model,
                    self.shap_reference,
                    feature_perturbation="tree_path_dependent",
                )
                print(f"SHAP initialise avec {len(self.shap_reference)} references")
            except Exception as e:
                print(f"SHAP non disponible: {e}")

    def _to_features(self, telemetry: dict) -> np.ndarray:
        row = _build_features_single(telemetry)
        features = np.array([[row.get(c, 0) for c in self.feature_cols]])
        return features

    FEATURE_EXPLANATIONS = {
        "ratio_FC1_FC3": "Deséquilibre entre débits FC1 (lecture) et FC3 (écriture)",
        "ratio_FC2_FC4": "Déséquilibre entre entrées discrètes FC2 et sorties FC4",
        "rolling_mean_5": "Moyenne des 5 dernières secondes anormale",
        "rolling_mean_30": "Tendance des 30 dernières secondes anormale",
        "rolling_mean_60": "Comportement moyen des 60 dernières secondes anormal",
        "rolling_std_5": "Variabilité soudaine des 5 dernières secondes",
        "rolling_std_30": "Instabilité des 30 dernières secondes",
        "diff_1": "Variation instantanée brutale des registres",
        "diff_5": "Dérive progressive sur les 5 dernières secondes",
        "FC1_Input_Register_lag_1": "Valeur FC1 anormale il y a 1 seconde",
        "FC2_Discrete_Input_lag_1": "Valeur FC2 anormale il y a 1 seconde",
        "FC3_Holding_Register_lag_1": "Valeur FC3 anormale il y a 1 seconde",
        "FC4_Coil_lag_1": "Valeur FC4 anormale il y a 1 seconde",
        "FC1_Input_Register_lag_5": "Valeur FC1 anormale il y a 5 secondes",
        "FC2_Discrete_Input_lag_5": "Valeur FC2 anormale il y a 5 secondes",
        "FC3_Holding_Register_lag_5": "Valeur FC3 anormale il y a 5 secondes",
        "FC4_Coil_lag_5": "Valeur FC4 anormale il y a 5 secondes",
        "FC1_Input_Register_lag_10": "Valeur FC1 anormale il y a 10 secondes",
        "FC2_Discrete_Input_lag_10": "Valeur FC2 anormale il y a 10 secondes",
        "FC3_Holding_Register_lag_10": "Valeur FC3 anormale il y a 10 secondes",
        "FC4_Coil_lag_10": "Valeur FC4 anormale il y a 10 secondes",
        "zscore_FC1_Input_Register": "Écart-type FC1 hors norme",
        "zscore_FC2_Discrete_Input": "Écart-type FC2 hors norme",
        "zscore_FC3_Holding_Register": "Écart-type FC3 hors norme",
        "zscore_FC4_Coil": "Écart-type FC4 hors norme",
    }

    def _explain_shap(self, X: np.ndarray) -> list:
        if self.shap_explainer is None:
            return []
        try:
            shap_values = self.shap_explainer.shap_values(X)[0]
            top_indices = np.argsort(np.abs(shap_values))[::-1][:3]

            explanations = []
            for idx in top_indices:
                feat_name = self.feature_cols[idx]
                impact = float(shap_values[idx])
                base = self.FEATURE_EXPLANATIONS.get(feat_name, f"Feature {feat_name}")
                if impact < 0:
                    detail = f"{base} -> pousse vers ANOMALIE (score anormal)"
                else:
                    detail = f"{base} -> pousse vers NORMAL (score sain)"
                explanations.append({
                    "feature": feat_name,
                    "valeur": round(float(X[0, idx]), 4),
                    "impact": round(impact, 4),
                    "interpretation": detail,
                })
            return explanations
        except Exception as e:
            print(f"SHAP error: {e}")
            return []

    def analyze(self, telemetry: dict) -> dict:
        has_sensors = (
            "temperature" in telemetry
            or "fridge_temperature" in telemetry
            or "current_temperature" in telemetry
            or "weather_temp" in telemetry
        )
        if has_sensors and self.mv_service._available:
            return self.mv_service.analyze(telemetry)

        X = self._to_features(telemetry)
        score = self.model.score_samples(X)[0]
        pred = self.model.predict(X)[0]
        is_anomaly = bool(pred == -1)

        result = {
            "is_anomaly": is_anomaly,
            "anomaly_score": round(float(score), 4),
            "confidence": "haute" if abs(score) < 0.15 else "moyenne",
            "model": "modbus",
        }

        shap_explanations = self._explain_shap(X)
        if shap_explanations:
            result["top_causes"] = shap_explanations

        return result


ml_anomaly = MLAnomalyService()
