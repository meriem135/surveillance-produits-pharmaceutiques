"""
MLOps Service — Point d'entree central
=========================================
Orchestre les trois composants :
  - DriftDetector    : surveille les scores
  - ModelRegistry    : versionne les modeles
  - RetrainingService: reentraine si drift

Ce service est initialise une fois au demarrage (singleton).
Il est injecte dans :
  - L'API REST  (app/api/v1/mlops.py)
  - Le scheduler (mlops_scheduler.py)
  - ml_service.py  (pour add_score a chaque prediction)
  - risk_service.py (pour les deux nouveaux facteurs de risque)

Nouveaux facteurs exposes vers Phase 3 (risk_service.py) :
  - get_drift_penalty()   : penalite si le modele IA est en drift
  - get_cross_sensor_alert() : alerte si plusieurs capteurs anormaux ensemble
"""

import joblib
import os
from collections import deque
from datetime import datetime
from app.domains.mlops.drift_detector import DriftDetector
from app.domains.mlops.model_registry import model_registry, ModelRegistry
from app.domains.mlops.retraining_service import retraining_service, RetrainingService
from app.domains.mlops.mlops_scheduler import mlops_scheduler, MLOpsScheduler


def _load_ref_stats(registry: ModelRegistry) -> tuple[float, float]:
    """
    Charge les stats de reference (mean/std des scores normaux)
    depuis le modele actif dans le registry.
    """
    model_path = registry.get_active_model_path()
    if model_path and os.path.exists(model_path):
        try:
            pipeline = joblib.load(model_path)
            ref_mean = pipeline.get("score_mean", 0.0)
            ref_std = pipeline.get("score_std", 1.0)
            print(
                f"[MLOpsService] Stats de reference chargees : "
                f"mean={ref_mean:.4f}, std={ref_std:.4f}"
            )
            return ref_mean, ref_std
        except Exception as e:
            print(f"[MLOpsService] Impossible de charger les stats : {e}")
    return 0.0, 1.0


class MLOpsService:
    """
    Service central MLOps.

    Responsabilites :
      - Initialiser le DriftDetector avec les bonnes stats de reference
      - Exposer add_score() pour l'integrer dans ml_service.py
      - Exposer analyze_drift() pour l'API
      - Exposer trigger_retrain() pour l'API manuelle
      - Demarrer le scheduler
    """

    def __init__(
        self,
        registry: ModelRegistry,
        retrain_svc: RetrainingService,
        scheduler: MLOpsScheduler,
    ):
        self.registry = registry
        self.retrain_svc = retrain_svc
        self.scheduler = scheduler

        # Charger les stats de reference depuis le modele actif
        ref_mean, ref_std = _load_ref_stats(registry)

        # Initialiser le detecteur avec la fenetre glissante de 300 points
        self.drift_detector = DriftDetector(
            ref_mean=ref_mean,
            ref_std=ref_std,
            window_size=300,
            ks_threshold=0.05,
            ph_delta=0.005,
            ph_lambda=50.0,
        )

        # ── Cohérence inter-capteurs ─────────────────────────────────────
        # Pour chaque capteur, on garde les 20 dernières anomalies (True/False)
        # Structure : { "weather": deque([False, True, ...], maxlen=20), ... }
        self._sensor_windows: dict[str, deque] = {}

        print("[MLOpsService] Initialise")

    # ── Integration temps reel ───────────────────────────────────────────────

    def add_score(self, score: float, is_anomaly: bool, sensor_id: str = "default"):
        """
        Appele a chaque prediction de ml_service.analyze().
        Enregistre le score dans la fenetre glissante globale ET
        dans la fenetre par capteur (pour la coherence inter-capteurs).

        Args:
            score      : score Isolation Forest (negatif = anomalie)
            is_anomaly : True si le modele a classe ce point comme anomalie
            sensor_id  : identifiant du capteur ("weather", "fridge", etc.)
        """
        # Fenetre globale du drift detector
        self.drift_detector.add_score(score, is_anomaly)

        # Fenetre par capteur (20 derniers points)
        if sensor_id not in self._sensor_windows:
            self._sensor_windows[sensor_id] = deque(maxlen=20)
        self._sensor_windows[sensor_id].append(
            {"is_anomaly": is_anomaly, "score": score, "ts": datetime.now().isoformat()}
        )

    # ── Analyse a la demande ────────────────────────────────────────────────

    def analyze_drift(self) -> dict:
        """Retourne le rapport de drift complet (pour l'API)."""
        report = self.drift_detector.analyze()
        return report.to_dict()

    # ── Pont vers Phase 3 : facteurs de risque enrichis ──────────────────────

    def get_drift_penalty(self) -> dict:
        """
        Facteur 7 pour le score de risque Phase 3.

        Repond a la question : "Dans quelle mesure peut-on faire confiance
        au modele IA en ce moment ?"

        Si le modele est en drift, ses predictions sont moins fiables.
        On penalise donc le facteur ml_anomaly dans le calcul du risque.

        Retourne :
          penalty_score  : 0 (confiance totale) a 100 (modele non fiable)
          confidence_pct : 100 (fiable) a 0 (non fiable)
          severity       : "none" | "warning" | "critical"
          explanation    : texte pour l'operateur
        """
        report = self.drift_detector.analyze()

        if not report.drift_detected:
            return {
                "penalty_score": 0.0,
                "confidence_pct": 100.0,
                "severity": "none",
                "drift_type": "aucun",
                "explanation": "Modele stable — predictions IA fiables a 100%",
            }

        # Warning = confiance reduite de 30%
        # Critical = confiance reduite de 70%
        if report.severity == "critical":
            penalty = 70.0
            confidence = 30.0
            expl = (
                f"CRITIQUE : drift detecte ({report.drift_type}). "
                f"Ecart moyen = {report.mean_shift_pct:.0f}%. "
                "Le score IA est penalise de 70% dans le calcul du risque."
            )
        else:  # warning
            penalty = 30.0
            confidence = 70.0
            expl = (
                f"ATTENTION : drift possible ({report.drift_type}). "
                f"Ecart moyen = {report.mean_shift_pct:.0f}%. "
                "Le score IA est penalise de 30% dans le calcul du risque."
            )

        return {
            "penalty_score": penalty,
            "confidence_pct": confidence,
            "severity": report.severity,
            "drift_type": report.drift_type,
            "ks_p_value": report.ks_p_value,
            "mean_shift_pct": report.mean_shift_pct,
            "explanation": expl,
        }

    def get_cross_sensor_alert(self) -> dict:
        """
        Facteur 8 pour le score de risque Phase 3.

        Repond a la question : "Est-ce que plusieurs capteurs sont
        anormaux EN MEME TEMPS ?"

        Si weather + fridge + thermostat ont tous un taux d'anomalie
        eleve sur leurs 20 derniers points → c'est suspect.
        Un seul capteur anormal = peut-etre une panne isolee.
        Plusieurs capteurs anormaux en meme temps = attaque coordonnee tres probable.

        Retourne :
          alert_score      : 0 a 100
          n_sensors_active : nb de capteurs surveilles
          n_sensors_alert  : nb de capteurs avec anomalies elevees
          sensor_details   : taux d'anomalie par capteur
          interpretation   : texte explicatif
        """
        if not self._sensor_windows:
            return {
                "alert_score": 0.0,
                "n_sensors_active": 0,
                "n_sensors_alert": 0,
                "sensor_details": {},
                "interpretation": "Aucune donnee inter-capteurs disponible.",
            }

        sensor_details = {}
        n_alert = 0
        ALERT_THRESHOLD = 0.30  # 30% d'anomalies sur les 20 derniers points = alerte

        for sensor_id, window in self._sensor_windows.items():
            if len(window) == 0:
                continue
            anomaly_rate = sum(1 for e in window if e["is_anomaly"]) / len(window)
            is_alerting = anomaly_rate >= ALERT_THRESHOLD
            sensor_details[sensor_id] = {
                "anomaly_rate_pct": round(anomaly_rate * 100, 1),
                "n_points": len(window),
                "is_alerting": is_alerting,
            }
            if is_alerting:
                n_alert += 1

        n_total = len(sensor_details)

        # Score selon le ratio de capteurs en alerte
        if n_total == 0:
            alert_score = 0.0
        elif n_alert == 0:
            alert_score = 0.0
        elif n_alert == 1:
            alert_score = 25.0   # Un seul capteur = panne isolee possible
        elif n_alert == 2:
            alert_score = 65.0   # Deux capteurs = suspect
        else:
            alert_score = 90.0   # Trois capteurs ou plus = tres probablement une attaque

        # Interpretation textuelle
        if n_alert == 0:
            interpretation = f"Tous les {n_total} capteurs sont dans la norme."
        elif n_alert == 1:
            alerting = [s for s, d in sensor_details.items() if d["is_alerting"]]
            interpretation = (
                f"1 capteur en anomalie ({alerting[0]}). "
                "Peut etre une panne isolee. Surveiller."
            )
        elif n_alert >= 2:
            alerting = [s for s, d in sensor_details.items() if d["is_alerting"]]
            interpretation = (
                f"ALERTE : {n_alert}/{n_total} capteurs anormaux simultanement "
                f"({', '.join(alerting)}). "
                "Attaque coordonnee probable !"
            )
        else:
            interpretation = "Surveillance en cours."

        return {
            "alert_score": alert_score,
            "n_sensors_active": n_total,
            "n_sensors_alert": n_alert,
            "sensor_details": sensor_details,
            "interpretation": interpretation,
        }

    # ── Reentrain manuel ─────────────────────────────────────────────────────

    async def trigger_retrain(self, reason: str = "manual") -> dict:
        """
        Declenche un reentrain manuel (appele par l'API).
        Pas besoin de drift detecte : l'operateur decide.
        """
        # Generer un rapport de drift minimal pour le retraining service
        report = self.drift_detector.analyze()
        result = await self.retrain_svc.trigger(
            drift_detector=self.drift_detector,
            drift_report=report,
            reason=reason,
        )
        return result.to_dict()

    # ── Dashboard complet ────────────────────────────────────────────────────

    def get_dashboard(self) -> dict:
        """
        Retourne toutes les informations MLOps pour le dashboard :
          - Etat du drift (rapport complet)
          - Fenetre glissante (stats)
          - Registry (versions)
          - Scheduler (etat)
          - Dernier reentrain
        """
        drift_report = self.drift_detector.analyze()
        return {
            "drift": drift_report.to_dict(),
            "window": self.drift_detector.window_stats,
            "registry": self.registry.summary(),
            "scheduler": self.scheduler.status,
            "last_retrain": self.retrain_svc.last_result,
            "is_retraining": self.retrain_svc.is_retraining,
        }

    # ── Rollback ────────────────────────────────────────────────────────────

    def rollback(self, version: str) -> dict:
        """Revient a une version anterieure du modele."""
        rolled = self.registry.rollback(version)
        if rolled:
            return {
                "success": True,
                "message": f"Rollback vers {version} reussi",
                "version": rolled.to_dict(),
            }
        return {"success": False, "message": f"Version {version} introuvable"}

    # ── Scheduler ────────────────────────────────────────────────────────────

    async def start_scheduler(self, interval: int = 3600):
        """Lance le scheduler de surveillance (appele depuis main.py)."""
        await self.scheduler.start(
            drift_detector=self.drift_detector,
            retraining_service=self.retrain_svc,
            interval=interval,
        )


# Instance singleton partagee dans toute l'application
mlops_service = MLOpsService(
    registry=model_registry,
    retrain_svc=retraining_service,
    scheduler=mlops_scheduler,
)
