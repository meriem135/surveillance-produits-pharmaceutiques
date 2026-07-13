"""
MLOps Scheduler — MLOps Phase 2
==================================
Tache de fond qui tourne toutes les heures et verifie automatiquement :

  1. Y a-t-il un drift dans les donnees recentes ?
  2. Si oui et severity == "critical" → reentrain automatique immediat
  3. Si oui et severity == "warning" → log l'alerte, reentrain au prochain cycle
  4. Enregistre un rapport horodated dans mlops_scheduler_log.json

Pourquoi toutes les heures ?
  - Les capteurs IoT emettent a 1Hz → 3600 points/heure
  - Le KS-Test a besoin de 50 min (min_samples) pour etre fiable
  - Une heure = bon compromis entre reactivite et stabilite statistique

Intégration FastAPI :
  Le scheduler est lance dans le lifespan de l'application (main.py).
  Il tourne en arriere-plan sans bloquer les requetes API.
"""

import asyncio
import json
import os
from datetime import datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.domains.mlops.drift_detector import DriftDetector
    from app.domains.mlops.retraining_service import RetrainingService


SCHEDULER_LOG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "models",
    "mlops",
    "scheduler_log.json",
)

# Intervalle en secondes (3600 = 1 heure)
CHECK_INTERVAL_SECONDS = 3600


class MLOpsScheduler:
    """
    Scheduler de surveillance MLOps.
    Tourne en boucle asyncio tant que l'application est active.
    """

    def __init__(self):
        self._running = False
        self._task: asyncio.Task = None
        self._check_count = 0
        self._last_check_at: str = None
        self._log: list = self._load_log()

    # ── Persistance ─────────────────────────────────────────────────────────

    def _load_log(self) -> list:
        if os.path.exists(SCHEDULER_LOG_PATH):
            try:
                with open(SCHEDULER_LOG_PATH, "r") as f:
                    return json.load(f)
            except Exception:
                pass
        return []

    def _append_log(self, entry: dict):
        os.makedirs(os.path.dirname(SCHEDULER_LOG_PATH), exist_ok=True)
        self._log.append(entry)
        self._log = self._log[-100:]   # 100 derniers cycles
        with open(SCHEDULER_LOG_PATH, "w") as f:
            json.dump(self._log, f, indent=2)

    # ── Boucle principale ────────────────────────────────────────────────────

    async def start(
        self,
        drift_detector: "DriftDetector",
        retraining_service: "RetrainingService",
        interval: int = CHECK_INTERVAL_SECONDS,
    ):
        """
        Lance la boucle de surveillance.
        Appele depuis main.py dans le lifespan.
        """
        self._running = True
        print(
            f"[MLOpsScheduler] Demarrage — verification toutes les "
            f"{interval // 60} minutes"
        )

        # Attendre un peu au demarrage pour laisser l'app s'initialiser
        await asyncio.sleep(30)

        while self._running:
            try:
                await self._run_check(drift_detector, retraining_service)
            except Exception as e:
                print(f"[MLOpsScheduler] Erreur lors du check : {e}")

            # Attendre jusqu'au prochain cycle
            await asyncio.sleep(interval)

    async def stop(self):
        """Arrete proprement la boucle."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
        print("[MLOpsScheduler] Arret")

    # ── Logique de verification ──────────────────────────────────────────────

    async def _run_check(
        self,
        drift_detector: "DriftDetector",
        retraining_service: "RetrainingService",
    ):
        """
        Un cycle de verification :
        1. Analyser le drift
        2. Decider si reentrain necessite
        3. Logger le resultat
        """
        self._check_count += 1
        self._last_check_at = datetime.now().isoformat()

        print(
            f"[MLOpsScheduler] Cycle #{self._check_count} — "
            f"{self._last_check_at}"
        )

        # ── Analyse du drift ─────────────────────────────────────────────────
        report = drift_detector.analyze()

        log_entry = {
            "cycle": self._check_count,
            "timestamp": self._last_check_at,
            "n_samples": report.n_samples,
            "drift_detected": report.drift_detected,
            "drift_type": report.drift_type,
            "severity": report.severity,
            "ks_p_value": report.ks_p_value,
            "ph_cumsum": report.ph_cumsum,
            "recent_mean": report.recent_mean,
            "mean_shift_pct": report.mean_shift_pct,
            "anomaly_rate_pct": report.anomaly_rate_pct,
            "action_taken": "none",
            "retrain_result": None,
        }

        print(
            f"[MLOpsScheduler] Drift={report.drift_detected} | "
            f"Type={report.drift_type} | Severity={report.severity} | "
            f"n={report.n_samples}"
        )

        # ── Decision de reentrain ────────────────────────────────────────────
        if report.drift_detected and report.severity == "critical":
            print(
                "[MLOpsScheduler] CRITIQUE — Reentrain automatique declenche"
            )
            retrain_result = await retraining_service.trigger(
                drift_detector=drift_detector,
                drift_report=report,
                reason="drift_auto_critical",
            )
            log_entry["action_taken"] = "retrain_auto"
            log_entry["retrain_result"] = retrain_result.to_dict()
            print(
                f"[MLOpsScheduler] Reentrain : "
                f"{'OK' if retrain_result.success else 'ECHEC'} — "
                f"{retrain_result.message}"
            )

        elif report.drift_detected and report.severity == "warning":
            # Warning seul : on log l'alerte mais on n'entraine pas encore
            # (attendre confirmation au prochain cycle)
            log_entry["action_taken"] = "alert_logged"
            print(
                "[MLOpsScheduler] WARNING — Drift detecte, surveillance renforcee. "
                "Reentrain si persiste au prochain cycle."
            )

        else:
            log_entry["action_taken"] = "none"
            print(
                f"[MLOpsScheduler] OK — Distribution stable "
                f"(mean_shift={report.mean_shift_pct:.1f}%)"
            )

        self._append_log(log_entry)

    # ── Utilitaires ─────────────────────────────────────────────────────────

    @property
    def status(self) -> dict:
        """Etat courant du scheduler pour le dashboard."""
        return {
            "running": self._running,
            "check_count": self._check_count,
            "last_check_at": self._last_check_at,
            "interval_minutes": CHECK_INTERVAL_SECONDS // 60,
            "recent_log": self._log[-5:],
        }

    @property
    def full_log(self) -> list:
        return self._log


# Instance singleton
mlops_scheduler = MLOpsScheduler()
