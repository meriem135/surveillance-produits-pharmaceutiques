"""
Predictive Risk Scoring Engine (Phase 3 — Risk Intelligence)
=============================================================
Combines multiple signals into a unified 0-100 risk score.

Architecture:
  Risk = Σ(w_i * f_i)  where f_i are risk factors and w_i are learned weights

Risk Factors (f_i) — weights aligned with Phase 2 model & SHAP:
  1. ML_Anomaly_Risk  (30%) — normalized One-Class SVM anomaly score
                               + local causes explaining WHY the anomaly
  2. CVE_Risk         (25%) — CVSS + EPSS from NVD matched to firmware
  3. DPI_Alert_Risk   (15%) — frequency & severity of DPI rule violations
  4. Criticality      (10%) — device type / location importance
  5. Risk_Velocity    (10%) — first derivative of risk over time (trend)
  6. Temporal_Decay   (10%) — recency weighting (recent events matter more)

The ML factor is the direct bridge to Phase 2: it consumes the SAME
One-Class SVM model and SAME local explanations served by the
/anomalies and /api/shap endpoints, so the risk decomposition and the
SHAP dashboard tell a single coherent story.

Data Science innovations:
  - Bayesian updating: prior risk is updated with new evidence
  - EWMA (Exponentially Weighted Moving Average) for smooth risk evolution
  - Monte Carlo simulation for risk confidence intervals
  - What-if analysis: "if we patch, risk drops from 85 to ?"
  - Risk decomposition: explain exactly what drives each risk point
"""

import json
import os
import math
import numpy as np
from datetime import datetime, timedelta, timezone
from typing import Optional
from pathlib import Path

from app.domains.intelligence.nvd_service import nvd_service, _cvss_score_to_risk
from app.domains.intelligence.ml_service import ml_anomaly

HISTORY_DIR = Path(__file__).parent.parent.parent / "models" / "risk_history"
HISTORY_DIR.mkdir(parents=True, exist_ok=True)

# Device criticality by type (0-100)
DEVICE_CRITICALITY = {
    "fridge": 80,
    "thermostat": 65,
    "weather": 50,
    "unknown": 50,
}

# Location criticality
LOCATION_CRITICALITY = {
    "production": 90,
    "control_room": 85,
    "storage": 70,
    "office": 40,
    "outdoor": 30,
    "unassigned": 50,
}

# Default weights for risk factors (sum = 1.0)
# Reference model: 5 factors (DPI excluded — weight 0)
# DPI est volontairement exclu du calcul du score de risque.
DEFAULT_WEIGHTS = {
    "ml_anomaly": 0.35,   # Anomalie IA (One-Class SVM + explications locales)
    "cve":        0.29,   # Vulnerabilites CVE (NVD + EPSS)
    "dpi_alert":  0.00,   # Alertes DPI temps reel — exclu du score
    "criticality": 0.12,  # Criticite de l'equipement
    "velocity":   0.12,   # Vitesse d'evolution du risque
    "temporal":   0.12,   # Score historique lisse (EWMA)
}


def _sigmoid(x: float, center: float = 0.0, slope: float = 1.0) -> float:
    """Sigmoid transformation for smooth risk scoring."""
    return 1.0 / (1.0 + math.exp(-slope * (x - center)))


def _load_ocsvm_calibration() -> tuple[float, float]:
    """Lit le seuil et le centre normal du modele OCSVM calibres a l'entrainement.

    Seuil  -> threshold_ocsvm.json (max F1 precision/recall, anomalie >= seuil)
    Centre -> hyperparams_ocsvm.json (score_mean sur le train, converti dans
             l'unite anomaly_score = -decision_function).
    """
    from app.domains.intelligence.ml_service import _find_model
    threshold, norm_center = 20.0, -30.0
    try:
        thr_path = _find_model("threshold_ocsvm.json")
        if os.path.exists(thr_path):
            with open(thr_path, "r", encoding="utf-8") as f:
                threshold = float(json.load(f).get("threshold", threshold))
    except Exception:
        pass
    try:
        hp_path = _find_model("hyperparams_ocsvm.json")
        if os.path.exists(hp_path):
            with open(hp_path, "r", encoding="utf-8") as f:
                norm_center = -float(json.load(f).get("score_mean", -norm_center))
    except Exception:
        pass
    return threshold, norm_center


_ML_THRESHOLD, _ML_NORM_CENTER = _load_ocsvm_calibration()


def _normalize_ml_score(anomaly_score: float) -> float:
    """Convert OCSVM anomaly score (-decision_function, positif=anomalie) to 0-100 risk.

    Calibration post-entrainement : les points normaux se centrent vers
    _ML_NORM_CENTER (< 0) et les anomalies depassent _ML_THRESHOLD (> 0).
    On applique un sigmoide centre entre les deux pour un gradient lisse.
    """
    center = (_ML_NORM_CENTER + _ML_THRESHOLD) / 2.0
    scale = round(max((_ML_THRESHOLD - _ML_NORM_CENTER) / 6.0, 1.0), 4)
    return round(100.0 / (1.0 + math.exp(-(anomaly_score - center) / scale)), 1)


def _dpi_alert_to_risk(dpi_alerts_count: int, max_severity: int, timeframe_hours: int = 1) -> float:
    """Convert DPI alert activity to a risk score 0-100."""
    if dpi_alerts_count == 0:
        return 0
    frequency_risk = _sigmoid(dpi_alerts_count, center=10, slope=0.3) * 50
    severity_risk = (max_severity / 15.0) * 50
    return min(100, frequency_risk + severity_risk)


def _compute_criticality(device_type: str, location: str) -> float:
    """Compute static criticality score for a device."""
    type_score = DEVICE_CRITICALITY.get(device_type.lower(), 50)
    loc_score = LOCATION_CRITICALITY.get(location.lower(), 50)
    return type_score * 0.6 + loc_score * 0.4


class RiskHistory:
    """Persistent risk score history for a device with EWMA smoothing."""

    def __init__(self, device_id: str):
        self.device_id = device_id
        self.path = HISTORY_DIR / f"risk_{device_id}.json"
        self.history: list[dict] = self._load()

    def _load(self) -> list[dict]:
        if self.path.exists():
            try:
                with open(self.path, "r") as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError):
                return []
        return []

    def _save(self):
        try:
            with open(self.path, "w") as f:
                json.dump(self.history[-500:], f)  # keep last 500
        except OSError:
            pass

    def add(self, score: float, decomposition: dict):
        self.history.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "risk_score": round(score, 1),
            "decomposition": decomposition,
        })
        self._save()

    def get_recent(self, n: int = 10) -> list[dict]:
        return self.history[-n:]

    def get_smoothed(self, alpha: float = 0.3) -> Optional[float]:
        """EWMA-smoothed risk score."""
        if not self.history:
            return None
        scores = [h["risk_score"] for h in self.history]
        ema = scores[0]
        for s in scores[1:]:
            ema = alpha * s + (1 - alpha) * ema
        return round(ema, 1)

    def compute_velocity(self) -> float:
        """Compute risk velocity: rate of change over last N points.
        
        Positive = risk increasing, negative = decreasing.
        Returns value in range -100 to +100.
        """
        if len(self.history) < 3:
            return 0.0
        recent = self.history[-5:]
        if len(recent) < 3:
            return 0.0
        scores = [h["risk_score"] for h in recent]
        xs = list(range(len(scores)))
        slope = np.polyfit(xs, scores, 1)[0] if len(scores) > 1 else 0
        return round(float(np.clip(slope * 10, -100, 100)), 1)

    def get_status(self) -> str:
        """Categorize current trend."""
        vel = self.compute_velocity()
        if vel > 15:
            return "rapidly_increasing"
        elif vel > 5:
            return "increasing"
        elif vel < -15:
            return "rapidly_decreasing"
        elif vel < -5:
            return "decreasing"
        return "stable"


class RiskScore:
    """A single computed risk score with full decomposition."""

    def __init__(self, score: float, factors: dict[str, float],
                 weights: dict[str, float], decomposition: list[dict],
                 confidence_interval: tuple[float, float],
                 trend: str, velocity: float, status: str):
        self.score = score
        self.factors = factors
        self.weights = weights
        self.decomposition = decomposition
        self.confidence_interval = confidence_interval
        self.trend = trend
        self.velocity = velocity
        self.status = status
    def to_dict(self) -> dict:
        return {
            "risk_score": round(self.score, 1),
            "severity": self._severity_label(),
            "factors": self.factors,
            "weights": self.weights,
            "decomposition": self.decomposition,
            "confidence_interval": {
                "low": round(self.confidence_interval[0], 1),
                "high": round(self.confidence_interval[1], 1),
            },
            "trend": self.trend,
            "velocity": self.velocity,
            "status": self.status,
        }

    def _severity_label(self) -> str:
        if self.score >= 80:
            return "CRITICAL"
        elif self.score >= 60:
            return "HIGH"
        elif self.score >= 40:
            return "MEDIUM"
        elif self.score >= 20:
            return "LOW"
        return "NONE"


class RiskScoringEngine:
    """Main predictive risk scoring engine.

    Combines ML anomaly detection, CVE intelligence, DPI alerts,
    and device context into a unified risk score with full explainability.
    """

    def __init__(self, weights: Optional[dict[str, float]] = None):
        self.weights = weights or DEFAULT_WEIGHTS.copy()
        self._histories: dict[str, RiskHistory] = {}

    def _get_history(self, device_id: str) -> RiskHistory:
        if device_id not in self._histories:
            self._histories[device_id] = RiskHistory(device_id)
        return self._histories[device_id]

    async def compute_risk(self, device_id: str, device_type: str,
                            firmware_version: Optional[str] = None,
                            location: str = "Unassigned",
                            ml_telemetry: Optional[dict] = None,
                            dpi_alerts_count: int = 0,
                            dpi_max_severity: int = 0) -> RiskScore:
        """Compute full risk score with all factors."""
        history = self._get_history(device_id)

        # 1. ML Anomaly Risk (+ SHAP explanations bridging Phase 2)
        ml_risk = 0.0
        ml_raw_score = 0.0
        ml_shap_causes: list = []
        if ml_telemetry:
            try:
                analysis = ml_anomaly.analyze(ml_telemetry)
                ml_raw_score = analysis["anomaly_score"]
                ml_risk = _normalize_ml_score(ml_raw_score)
                # top_causes = SHAP explanations (same model/dashboard as Phase 2)
                ml_shap_causes = analysis.get("top_causes", [])
            except Exception as e:
                print(f"ML analysis failed for {device_id}: {e}")

        # 2. CVE Risk
        cve_risk = 0.0
        cve_count = 0
        try:
            cve_summary = await nvd_service.get_device_vulnerability_summary(
                device_type, firmware_version
            )
            cve_risk = cve_summary["overall_vulnerability_score"]
            cve_count = cve_summary["total_cves"]
        except Exception as e:
            print(f"CVE fetch failed for {device_type}: {e}")

        # 3. DPI Alert Risk
        dpi_risk = _dpi_alert_to_risk(dpi_alerts_count, dpi_max_severity)

        # 4. Criticality
        criticality = _compute_criticality(device_type, location)

        # 5. Risk Velocity (from history)
        velocity = history.compute_velocity()
        velocity_risk = _sigmoid(velocity, center=0, slope=0.05) * 100

        # 6. Temporal decay (recent history weighted more)
        prev_risk = history.get_smoothed()
        temporal_risk = prev_risk if prev_risk is not None else 50

        # ── Calcul du score pondere ──────────────────────────────────────────
        factors = {
            "ml_anomaly":    round(ml_risk, 1),
            "cve":           round(cve_risk, 1),
            "dpi_alert":     round(dpi_risk, 1),
            "criticality":   round(criticality, 1),
            "velocity":      round(velocity_risk, 1),
            "temporal":      round(temporal_risk, 1),
        }

        raw_score = sum(factors[k] * self.weights.get(k, 0) for k in factors)

        # Monte Carlo confidence interval (simulate weight uncertainty)
        n_simulations = 1000
        sim_scores = []
        rng = np.random.default_rng(42)
        for _ in range(n_simulations):
            noisy_weights = {k: max(0, v + rng.normal(0, 0.05))
                            for k, v in self.weights.items()}
            noisy_weights["dpi_alert"] = 0  # DPI exclu du score
            total_w = sum(noisy_weights.values())
            noisy_weights = {k: v / total_w for k, v in noisy_weights.items()}
            sim = sum(factors[k] * noisy_weights.get(k, 0) for k in factors)
            sim_scores.append(sim)
        ci_low = float(np.percentile(sim_scores, 5))
        ci_high = float(np.percentile(sim_scores, 95))

        # Clamp to 0-100
        final_score = max(0, min(100, raw_score))

        # Build decomposition for explainability
        decomposition = []
        for factor_name in self.weights:
            contribution = factors.get(factor_name, 0) * self.weights[factor_name]
            entry = {
                "factor": factor_name,
                "label": self._factor_label(factor_name),
                "raw_value": factors.get(factor_name, 0),
                "weight": self.weights[factor_name],
                "contribution": round(contribution, 1),
                "contribution_pct": round(contribution / max(final_score, 1) * 100, 1),
            }
            # SHAP bridge: attach the Phase 2 explanations to the ML factor
            if factor_name == "ml_anomaly" and ml_shap_causes:
                entry["shap_causes"] = ml_shap_causes
            decomposition.append(entry)
        decomposition.sort(key=lambda x: x["contribution"], reverse=True)

        # Determine trend
        trend = history.get_status()

        # Build domain-specific labels
        status_parts = []
        if ml_risk > 70:
            status_parts.append("comportement anormal detecte par IA")
        if cve_risk > 70:
            status_parts.append(f"{cve_count} vulnerabilites critiques")
        if dpi_risk > 50:
            status_parts.append("alertes DPI frequentes")
        if velocity > 10:
            status_parts.append("risque en augmentation rapide")
        status = ", ".join(status_parts) if status_parts else "aucun risque majeur detecte"

        # Record in history
        history.add(final_score, {k: factors[k] for k in factors})

        risk = RiskScore(
            score=final_score,
            factors=factors,
            weights=self.weights,
            decomposition=decomposition,
            confidence_interval=(ci_low, ci_high),
            trend=trend,
            velocity=velocity,
            status=status,
        )

        return risk

    def _factor_label(self, key: str) -> str:
        labels = {
            "ml_anomaly":    "Score d'anomalie IA (One-Class SVM + explications locales)",
            "cve":           "Vulnerabilites CVE (NVD + EPSS)",
            "dpi_alert":     "Alertes DPI en temps reel",
            "criticality":   "Criticite de l'equipement",
            "velocity":      "Vitesse d'evolution du risque",
            "temporal":      "Historique du risque (EWMA)",
        }
        return labels.get(key, key)

    async def what_if_analysis(self, device_id: str, device_type: str,
                                firmware_version: Optional[str] = None,
                                location: str = "Unassigned",
                                current_risk: int = 0) -> list[dict]:
        """What-if scenarios: how risk changes with different actions."""
        history = self._get_history(device_id)
        scenarios = []

        # Scenario 1: Patch firmware
        if firmware_version:
            try:
                cve_summary = await nvd_service.get_device_vulnerability_summary(
                    device_type, "99.99.99"  # pretend fully patched
                )
                patched_cve_risk = cve_summary["overall_vulnerability_score"]
                current_cve_risk = (await nvd_service.get_device_vulnerability_summary(
                    device_type, firmware_version
                ))["overall_vulnerability_score"]
                cve_reduction = max(0, current_cve_risk - patched_cve_risk)
                new_risk = max(0, current_risk - cve_reduction * self.weights.get("cve", 0.25))
                scenarios.append({
                    "scenario": "Mise a jour du firmware",
                    "description": f"Passage de {firmware_version} a la version recente",
                    "current_risk": current_risk,
                    "predicted_risk": round(new_risk, 1),
                    "risk_reduction": round(current_risk - new_risk, 1),
                    "confidence": "haute" if cve_reduction > 20 else "moyenne",
                })
            except Exception:
                pass

        # Scenario 2: Reboot / reset device
        prev_smoothed = history.get_smoothed()
        if prev_smoothed:
            reset_risk = prev_smoothed * 0.7
            scenarios.append({
                "scenario": "Redemarrage / reinitialisation",
                "description": "Reinitialisation de l'etat du device",
                "current_risk": current_risk,
                "predicted_risk": round(reset_risk, 1),
                "risk_reduction": round(current_risk - reset_risk, 1),
                "confidence": "basse",
            })

        # Scenario 3: Isolation / network disconnect
        is_risk = current_risk * 0.3
        scenarios.append({
            "scenario": "Isolement reseau",
            "description": "Deconnexion du reseau industriel",
            "current_risk": current_risk,
            "predicted_risk": round(is_risk, 1),
            "risk_reduction": round(current_risk - is_risk, 1),
            "confidence": "haute",
        })

        scenarios.sort(key=lambda x: x["risk_reduction"], reverse=True)
        return scenarios

    def get_risk_history(self, device_id: str, n: int = 20,
                         start_date: Optional[str] = None,
                         end_date: Optional[str] = None) -> list[dict]:
        """Get risk score history for a device, optionally filtered by date range.

        start_date/end_date are ISO-8601 strings (e.g. "2025-08-05" or full
        "2025-08-05T14:30:00Z"). Filters on the stored timestamp of each point.
        """
        history = self._get_history(device_id)
        if not start_date and not end_date:
            return history.get_recent(n)

        points = history.history
        if start_date:
            points = [p for p in points if p.get("timestamp", "") >= start_date]
        if end_date:
            points = [p for p in points if p.get("timestamp", "") <= end_date]
        return points[-n:]

    def update_weights(self, new_weights: dict[str, float]):
        """Update risk factor weights dynamically."""
        total = sum(new_weights.values())
        if abs(total - 1.0) > 0.01:
            new_weights = {k: v / total for k, v in new_weights.items()}
        self.weights.update(new_weights)

    def detect_risk_anomaly(self, device_id: str, z_threshold: float = 2.0) -> dict:
        """Detect when the risk score itself behaves anomalously (risk-on-risk).

        Uses Z-score on the velocity series. A risk anomaly means
        the risk is changing in an unexpected way, even if the level is moderate.
        """
        history = self._get_history(device_id)
        if len(history.history) < 10:
            return {"is_risk_anomaly": False, "message": "Pas assez d'historique"}

        velocities = []
        for i in range(5, len(history.history)):
            segment = [h["risk_score"] for h in history.history[i-5:i+1]]
            xs = list(range(len(segment)))
            slope = np.polyfit(xs, segment, 1)[0] if len(segment) > 1 else 0
            velocities.append(slope * 10)

        if not velocities:
            return {"is_risk_anomaly": False}

        recent_vel = np.mean(velocities[-3:]) if len(velocities) >= 3 else velocities[-1]
        vel_mean = np.mean(velocities)
        vel_std = max(np.std(velocities), 0.01)
        z_score = (recent_vel - vel_mean) / vel_std

        is_anomaly = abs(z_score) > z_threshold
        current = history.history[-1]["risk_score"]

        return {
            "is_risk_anomaly": bool(is_anomaly),
            "z_score": round(float(z_score), 2),
            "recent_velocity": round(float(recent_vel), 1),
            "mean_velocity": round(float(vel_mean), 1),
            "current_risk": current,
            "message": (
                f"Comportement de risque anormal detecte (Z={z_score:.1f})"
                if is_anomaly else
                "Evolution du risque normale"
            ),
        }

    def decompose_trend(self, device_id: str) -> dict:
        """Simple trend decomposition of risk history.

        Decomposes into:
        - trend: long-term direction (polyfit)
        - volatility: short-term variability (rolling std)
        - noise: residual after removing trend
        """
        history = self._get_history(device_id)
        if len(history.history) < 10:
            return {"error": "Pas assez de donnees"}

        scores = np.array([h["risk_score"] for h in history.history])
        xs = np.arange(len(scores))

        # Trend: 2nd degree polynomial
        coeffs = np.polyfit(xs, scores, 2)
        trend = np.polyval(coeffs, xs)

        # Residual = noise
        residual = scores - trend

        # Volatility = rolling std
        window = max(5, len(scores) // 10)
        volatility = np.array([np.std(scores[max(0, i-window):i+1])
                               for i in range(len(scores))])

        return {
            "current_trend_direction": "haussiere" if coeffs[0] > 0 else "baissiere",
            "trend_strength": round(float(abs(coeffs[0]) * 100), 2),
            "avg_volatility": round(float(np.mean(volatility)), 1),
            "current_volatility": round(float(volatility[-1]), 1),
            "noise_level": round(float(np.std(residual)), 1),
            "signal_to_noise": round(float(np.std(trend) / max(np.std(residual), 0.01)), 1),
        }

    def forecast_risk(self, device_id: str, steps: int = 12) -> list[dict]:
        """Simple risk forecast using linear extrapolation with confidence bounds.

        Uses the trend component to project forward and adds expanding
        confidence intervals based on historical volatility.
        """
        history = self._get_history(device_id)
        if len(history.history) < 5:
            return []

        scores = np.array([h["risk_score"] for h in history.history[-20:]])
        xs = np.arange(len(scores))

        coeffs = np.polyfit(xs, scores, 1)
        volatility = np.std(scores)

        forecasts = []
        last_x = len(scores) - 1
        for i in range(1, steps + 1):
            pred_x = last_x + i
            pred = np.polyval(coeffs, pred_x)
            ci_width = volatility * np.sqrt(1 + i) * 1.645  # 90% CI
            forecasts.append({
                "step": i,
                "predicted_risk": round(float(np.clip(pred, 0, 100)), 1),
                "ci_low": round(float(np.clip(pred - ci_width, 0, 100)), 1),
                "ci_high": round(float(np.clip(pred + ci_width, 0, 100)), 1),
            })

        return forecasts

    def compute_correlation(self, device_ids: list[str]) -> list[dict]:
        """Compute pairwise risk correlation between devices.

        High correlation suggests a shared risk driver (e.g., environmental
        change or coordinated attack).
        """
        if len(device_ids) < 2:
            return []

        histories = []
        for did in device_ids:
            h = self._get_history(did)
            if len(h.history) >= 5:
                scores = [x["risk_score"] for x in h.history]
                histories.append((did, scores))

        if len(histories) < 2:
            return []

        min_len = min(len(h[1]) for h in histories)
        correlations = []
        for i in range(len(histories)):
            for j in range(i + 1, len(histories)):
                a = histories[i][1][-min_len:]
                b = histories[j][1][-min_len:]
                if np.std(a) > 0 and np.std(b) > 0:
                    corr = np.corrcoef(a, b)[0, 1]
                else:
                    corr = 0
                correlations.append({
                    "device_1": histories[i][0],
                    "device_2": histories[j][0],
                    "risk_correlation": round(float(corr), 3),
                    "interpretation": (
                        "forte" if abs(corr) > 0.7 else
                        "moderee" if abs(corr) > 0.4 else
                        "faible"
                    ),
                })

        return correlations


risk_engine = RiskScoringEngine()
