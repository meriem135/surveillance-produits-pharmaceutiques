# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/domains/intelligence/risk_service.py
#   MOTEUR DE SCORE DE RISQUE des équipements : importance de l'équipement, vitesse d'évolution,
#   historique lissé ; historique, « et si », anomalie, prévision.
# ══════════════════════════════════════════════════════════════════════════
"""
Predictive Risk Scoring Engine (Phase 3 — Risk Intelligence)
=============================================================
Combines multiple signals into a unified 0-100 risk score.

Architecture:
  Risk = Σ(w_i * f_i)  where f_i are risk factors and w_i are learned weights

Risk Factors (f_i):
  1. Criticality      (34%) — device type / location importance
  2. Risk_Velocity    (33%) — first derivative of risk over time (trend)
  3. Temporal_Decay   (33%) — recency weighting (recent events matter more)

Data Science innovations:
  - Bayesian updating: prior risk is updated with new evidence
  - EWMA (Exponentially Weighted Moving Average) for smooth risk evolution
  - Monte Carlo simulation for risk confidence intervals
  - What-if analysis: "if we patch, risk drops from 85 to ?"
  - Risk decomposition: explain exactly what drives each risk point
"""

import json
import math
import numpy as np
from datetime import datetime, timedelta, timezone
from typing import Optional
from pathlib import Path


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

# Default weights for risk factors (sum = 1.0) — 3 factors
DEFAULT_WEIGHTS = {
    "criticality": 0.34,  # Criticite de l'equipement
    "velocity":    0.33,  # Vitesse d'evolution du risque
    "temporal":    0.33,  # Score historique lisse (EWMA)
}


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _sigmoid
#   Rôle   : Courbe en S qui lisse un score.
#   Entrée : x, center, slope
#   Sortie : valeur 0–1
# ──────────────────────────────────────────────────────────────────────
def _sigmoid(x: float, center: float = 0.0, slope: float = 1.0) -> float:
    """Sigmoid transformation for smooth risk scoring."""
    return 1.0 / (1.0 + math.exp(-slope * (x - center)))


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] _compute_criticality
#   Rôle   : Importance d'un équipement selon son type et son emplacement.
#   Entrée : device_type ; location
#   Sortie : score 0–100
# ──────────────────────────────────────────────────────────────────────
def _compute_criticality(device_type: str, location: str) -> float:
    """Compute static criticality score for a device."""
    type_score = DEVICE_CRITICALITY.get(device_type.lower(), 50)
    loc_score = LOCATION_CRITICALITY.get(location.lower(), 50)
    return type_score * 0.6 + loc_score * 0.4


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] RiskHistory
#   Rôle   : HISTORIQUE DU RISQUE d'un équipement, sauvegardé en JSON (500 derniers points).
# ──────────────────────────────────────────────────────────────────────
class RiskHistory:
    """Persistent risk score history for a device with EWMA smoothing."""

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskHistory.__init__
    #   Rôle   : Charge l'historique de l'équipement.
    #   Entrée : device_id
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    def __init__(self, device_id: str):
        self.device_id = device_id
        self.path = HISTORY_DIR / f"risk_{device_id}.json"
        self.history: list[dict] = self._load()

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskHistory._load
    #   Rôle   : Lit le fichier d'historique.
    #   Entrée : rien
    #   Sortie : liste
    # ──────────────────────────────────────────────────────────────────────
    def _load(self) -> list[dict]:
        if self.path.exists():
            try:
                with open(self.path, "r") as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError):
                return []
        return []

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskHistory._save
    #   Rôle   : Écrit le fichier d'historique.
    #   Entrée : rien
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    def _save(self):
        try:
            with open(self.path, "w") as f:
                json.dump(self.history[-500:], f)  # keep last 500
        except OSError:
            pass

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskHistory.add
    #   Rôle   : Ajoute un nouveau score à l'historique.
    #   Entrée : score ; decomposition
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    def add(self, score: float, decomposition: dict):
        self.history.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "risk_score": round(score, 1),
            "decomposition": decomposition,
        })
        self._save()

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskHistory.get_recent
    #   Rôle   : Les n derniers points.
    #   Entrée : n
    #   Sortie : liste
    # ──────────────────────────────────────────────────────────────────────
    def get_recent(self, n: int = 10) -> list[dict]:
        return self.history[-n:]

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskHistory.get_smoothed
    #   Rôle   : Score lissé (moyenne mobile exponentielle).
    #   Entrée : alpha
    #   Sortie : score ou None
    # ──────────────────────────────────────────────────────────────────────
    def get_smoothed(self, alpha: float = 0.3) -> Optional[float]:
        """EWMA-smoothed risk score."""
        if not self.history:
            return None
        scores = [h["risk_score"] for h in self.history]
        ema = scores[0]
        for s in scores[1:]:
            ema = alpha * s + (1 - alpha) * ema
        return round(ema, 1)

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskHistory.compute_velocity
    #   Rôle   : Vitesse d'évolution du risque (positif = monte).
    #   Entrée : rien
    #   Sortie : valeur -100 à +100
    # ──────────────────────────────────────────────────────────────────────
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

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskHistory.get_status
    #   Rôle   : Tendance : monte vite, monte, stable, baisse…
    #   Entrée : rien
    #   Sortie : texte
    # ──────────────────────────────────────────────────────────────────────
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


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] RiskScore
#   Rôle   : UN SCORE DE RISQUE calculé, avec ses causes et son intervalle de confiance.
# ──────────────────────────────────────────────────────────────────────
class RiskScore:
    """A single computed risk score with full decomposition."""

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskScore.__init__
    #   Rôle   : Remplit le score et ses détails.
    #   Entrée : score, facteurs, poids…
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
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
    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskScore.to_dict
    #   Rôle   : Le score en dictionnaire (pour l'API).
    #   Entrée : rien
    #   Sortie : dictionnaire
    # ──────────────────────────────────────────────────────────────────────
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

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskScore._severity_label
    #   Rôle   : Niveau : CRITICAL ≥ 80, HIGH ≥ 60, MEDIUM ≥ 40, sinon LOW.
    #   Entrée : rien
    #   Sortie : texte
    # ──────────────────────────────────────────────────────────────────────
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


# ──────────────────────────────────────────────────────────────────────
# [EN BREF] RiskScoringEngine
#   Rôle   : MOTEUR DE SCORE DE RISQUE : combine l'importance de l'équipement, la vitesse d'évolution du
#            risque et son historique lissé (3 facteurs pondérés).
# ──────────────────────────────────────────────────────────────────────
class RiskScoringEngine:
    """Main predictive risk scoring engine.

    Combines device context and risk history
    into a unified risk score with full explainability.
    """

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskScoringEngine.__init__
    #   Rôle   : Prépare les poids des facteurs et les historiques.
    #   Entrée : weights
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    def __init__(self, weights: Optional[dict[str, float]] = None):
        self.weights = weights or DEFAULT_WEIGHTS.copy()
        self._histories: dict[str, RiskHistory] = {}

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskScoringEngine._get_history
    #   Rôle   : Historique d'un équipement (créé au besoin).
    #   Entrée : device_id
    #   Sortie : RiskHistory
    # ──────────────────────────────────────────────────────────────────────
    def _get_history(self, device_id: str) -> RiskHistory:
        if device_id not in self._histories:
            self._histories[device_id] = RiskHistory(device_id)
        return self._histories[device_id]

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskScoringEngine.compute_risk
    #   Rôle   : CALCULE LE SCORE DE RISQUE d'un équipement : chaque facteur pondéré, puis enregistré dans
    #            l'historique.
    #   Entrée : device_id, device_type, location…
    #   Sortie : RiskScore
    # ──────────────────────────────────────────────────────────────────────
    async def compute_risk(self, device_id: str, device_type: str,
                            location: str = "Unassigned") -> RiskScore:
        """Compute full risk score with all factors."""
        history = self._get_history(device_id)

        # 1. Criticality
        criticality = _compute_criticality(device_type, location)

        # 2. Risk Velocity (from history)
        velocity = history.compute_velocity()
        velocity_risk = _sigmoid(velocity, center=0, slope=0.05) * 100

        # 3. Temporal decay (recent history weighted more)
        prev_risk = history.get_smoothed()
        temporal_risk = prev_risk if prev_risk is not None else 50

        # ── Calcul du score pondere ──────────────────────────────────────────
        factors = {
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
            decomposition.append(entry)
        decomposition.sort(key=lambda x: x["contribution"], reverse=True)

        # Determine trend
        trend = history.get_status()

        # Build domain-specific labels
        status_parts = []
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

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskScoringEngine._factor_label
    #   Rôle   : Nom lisible d'un facteur de risque.
    #   Entrée : key
    #   Sortie : texte
    # ──────────────────────────────────────────────────────────────────────
    def _factor_label(self, key: str) -> str:
        labels = {
            "criticality":   "Criticite de l'equipement",
            "velocity":      "Vitesse d'evolution du risque",
            "temporal":      "Historique du risque (EWMA)",
        }
        return labels.get(key, key)

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskScoringEngine.what_if_analysis
    #   Rôle   : « Et si… » : risque estimé après un redémarrage de l'équipement, une isolation réseau, etc.
    #   Entrée : device_id, device_type, location…
    #   Sortie : liste de scénarios
    # ──────────────────────────────────────────────────────────────────────
    async def what_if_analysis(self, device_id: str, device_type: str,
                                location: str = "Unassigned",
                                current_risk: int = 0) -> list[dict]:
        """What-if scenarios: how risk changes with different actions."""
        history = self._get_history(device_id)
        scenarios = []

        # Scenario 1: Reboot / reset device
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

        # Scenario 2: Isolation / network disconnect
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

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskScoringEngine.get_risk_history
    #   Rôle   : Historique du risque, filtrable par dates.
    #   Entrée : device_id ; n ; start_date ; end_date
    #   Sortie : liste
    # ──────────────────────────────────────────────────────────────────────
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

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskScoringEngine.update_weights
    #   Rôle   : Change les poids des facteurs (la somme reste 1).
    #   Entrée : new_weights
    #   Sortie : rien
    # ──────────────────────────────────────────────────────────────────────
    def update_weights(self, new_weights: dict[str, float]):
        """Update risk factor weights dynamically."""
        total = sum(new_weights.values())
        if abs(total - 1.0) > 0.01:
            new_weights = {k: v / total for k, v in new_weights.items()}
        self.weights.update(new_weights)

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskScoringEngine.detect_risk_anomaly
    #   Rôle   : Le risque change-t-il anormalement vite ? (Z-score sur la vitesse).
    #   Entrée : device_id ; z_threshold
    #   Sortie : dictionnaire
    # ──────────────────────────────────────────────────────────────────────
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

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskScoringEngine.decompose_trend
    #   Rôle   : Sépare l'historique en tendance de fond et en variations courtes.
    #   Entrée : device_id
    #   Sortie : dictionnaire
    # ──────────────────────────────────────────────────────────────────────
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

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskScoringEngine.forecast_risk
    #   Rôle   : Prévision du risque futur (prolongement de la tendance + marge d'erreur).
    #   Entrée : device_id ; steps
    #   Sortie : liste de points
    # ──────────────────────────────────────────────────────────────────────
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

    # ──────────────────────────────────────────────────────────────────────
    # [EN BREF] RiskScoringEngine.compute_correlation
    #   Rôle   : Corrélation entre les risques de plusieurs équipements.
    #   Entrée : device_ids
    #   Sortie : liste de paires
    # ──────────────────────────────────────────────────────────────────────
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
