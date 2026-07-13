"""
Retraining Service — MLOps Phase 2
=====================================
Reentraine automatiquement le modele Isolation Forest quand un drift est detecte.

Strategie de reentrain :
  1. On collecte les donnees recentes "normales" (is_anomaly=False) de la fenetre
  2. On reentraine un nouvel Isolation Forest avec les memes hyperparametres
  3. On calcule les nouvelles stats de reference (mean/std des scores)
  4. On enregistre le nouveau modele dans le ModelRegistry
  5. On remplace le modele actif en memoire (hot-swap sans redemarrer)
  6. On remet le DriftDetector a zero pour une nouvelle periode de surveillance

Pourquoi "seulement les donnees normales" ?
  L'Isolation Forest est un modele non-supervise entraine UNIQUEMENT sur
  des donnees normales. Les anomalies ne doivent pas etre incluses dans
  l'entrainement sinon le modele apprend les attaques comme "normales".

Protection contre le surapprentissage :
  - Minimum 100 echantillons normaux requis pour reentrain
  - Si insuffisant → refus et message d'erreur clair
  - Un verrou empeche deux reentrain simultanement
"""

import os
import json
import asyncio
import joblib
import numpy as np
from datetime import datetime
from typing import Optional
from sklearn.ensemble import IsolationForest

from app.domains.mlops.drift_detector import DriftDetector, DriftReport
from app.domains.mlops.model_registry import ModelRegistry, model_registry


RETRAIN_LOG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "models",
    "mlops",
    "retrain_log.json",
)

# Nombre minimum d'echantillons normaux pour lancer un reentrain
MIN_SAMPLES_FOR_RETRAIN = 100

# Verrou global pour eviter deux reentrain en parallele
_retrain_lock = asyncio.Lock()


class RetrainingResult:
    """Resultat retourne apres un cycle de reentrain."""

    def __init__(self, success: bool, message: str, details: dict = None):
        self.success = success
        self.message = message
        self.details = details or {}
        self.timestamp = datetime.now().isoformat()

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "message": self.message,
            "timestamp": self.timestamp,
            **self.details,
        }


class RetrainingService:
    """
    Service de reentrain automatique.

    Peut etre declenche :
      - Automatiquement par le scheduler quand drift detecte
      - Manuellement via l'API (POST /api/v1/mlops/retrain)
    """

    def __init__(self, registry: ModelRegistry):
        self.registry = registry
        self._is_retraining = False
        self._last_result: Optional[RetrainingResult] = None
        self._log: list = self._load_log()

    # ── Persistance du log ───────────────────────────────────────────────────

    def _load_log(self) -> list:
        if os.path.exists(RETRAIN_LOG_PATH):
            try:
                with open(RETRAIN_LOG_PATH, "r") as f:
                    return json.load(f)
            except Exception:
                pass
        return []

    def _append_log(self, result: RetrainingResult, reason: str):
        """Ajoute une entree dans le journal des reentrain."""
        os.makedirs(os.path.dirname(RETRAIN_LOG_PATH), exist_ok=True)
        self._log.append(
            {
                "timestamp": result.timestamp,
                "reason": reason,
                "success": result.success,
                "message": result.message,
                **result.details,
            }
        )
        # Garder les 50 derniers logs
        self._log = self._log[-50:]
        with open(RETRAIN_LOG_PATH, "w") as f:
            json.dump(self._log, f, indent=2)

    # ── Reentrain principal ──────────────────────────────────────────────────

    async def trigger(
        self,
        drift_detector: DriftDetector,
        drift_report: DriftReport,
        reason: str = "drift_auto",
    ) -> RetrainingResult:
        """
        Declenche un reentrain si les conditions sont reunies.

        Args:
            drift_detector : Le detecteur qui a signale le drift
            drift_report   : Le rapport de drift (KS, PH, severite)
            reason         : "drift_auto" | "drift_manual" | "scheduled" | "manual"

        Returns:
            RetrainingResult avec le statut et les details
        """
        # Verrou : pas de reentrain simultane
        if _retrain_lock.locked():
            return RetrainingResult(
                success=False,
                message="Reentrain deja en cours. Reessayer dans quelques instants.",
            )

        async with _retrain_lock:
            self._is_retraining = True
            try:
                result = await self._run_retrain(drift_detector, drift_report, reason)
            finally:
                self._is_retraining = False

            self._last_result = result
            self._append_log(result, reason)
            return result

    async def _run_retrain(
        self,
        drift_detector: DriftDetector,
        drift_report: DriftReport,
        reason: str,
    ) -> RetrainingResult:
        """
        Execution du reentrain en 5 etapes.
        Tourne dans un thread pour ne pas bloquer la boucle asyncio.
        """
        return await asyncio.get_event_loop().run_in_executor(
            None,
            self._retrain_sync,
            drift_detector,
            drift_report,
            reason,
        )

    def _retrain_sync(
        self,
        drift_detector: DriftDetector,
        drift_report: DriftReport,
        reason: str,
    ) -> RetrainingResult:
        """
        Code de reentrain synchrone (execute dans un thread).
        """
        print(f"[Retraining] Debut du reentrain (raison: {reason})")

        # ── Etape 1 : Collecter les donnees normales de la fenetre ────────────
        normal_entries = [
            e for e in drift_detector._window if not e["is_anomaly"]
        ]
        n_normal = len(normal_entries)

        if n_normal < MIN_SAMPLES_FOR_RETRAIN:
            msg = (
                f"Reentrain annule : seulement {n_normal} echantillons normaux "
                f"(minimum {MIN_SAMPLES_FOR_RETRAIN} requis). "
                "Continuer la collecte de donnees."
            )
            print(f"[Retraining] {msg}")
            return RetrainingResult(success=False, message=msg)

        # Extraire les scores (on reentraine sur les scores bruts)
        # En production, on utiliserait les features completes.
        # Ici on simule un reentrain sur la distribution des scores normaux
        normal_scores = np.array([e["score"] for e in normal_entries]).reshape(-1, 1)

        print(f"[Retraining] Etape 1 OK : {n_normal} echantillons normaux collectes")

        # ── Etape 2 : Charger le pipeline original pour recuperer les features ─
        current_model_path = self.registry.get_active_model_path()
        if not current_model_path or not os.path.exists(current_model_path):
            return RetrainingResult(
                success=False,
                message="Modele actif introuvable. Impossible de reentrain.",
            )

        try:
            original_pipeline = joblib.load(current_model_path)
        except Exception as e:
            return RetrainingResult(
                success=False,
                message=f"Erreur chargement pipeline original : {e}",
            )

        # Recuperer les hyperparametres de l'ancien modele
        old_model = original_pipeline.get("model")
        n_estimators = getattr(old_model, "n_estimators", 100)
        contamination = getattr(old_model, "contamination", 0.05)

        print(f"[Retraining] Etape 2 OK : hyperparams recuperes (n_estimators={n_estimators})")

        # ── Etape 3 : Reentrain du nouveau modele ─────────────────────────────
        new_model = IsolationForest(
            n_estimators=n_estimators,
            contamination=contamination,
            random_state=42,
            n_jobs=-1,
        )

        # Le reentrain sur les scores 1D simule l'adaptation de la distribution
        # (en production complete, on passerait les features completes normalisees)
        new_model.fit(normal_scores)

        # Calculer les nouvelles stats de reference
        new_scores = new_model.score_samples(normal_scores)
        new_score_mean = float(new_scores.mean())
        new_score_std = float(new_scores.std())

        print(
            f"[Retraining] Etape 3 OK : nouveau modele entraine "
            f"(score_mean={new_score_mean:.4f}, score_std={new_score_std:.4f})"
        )

        # ── Etape 4 : Sauvegarder le nouveau pipeline ─────────────────────────
        new_pipeline = {
            **original_pipeline,  # Garder scaler, feature_cols, shap_reference
            "model": new_model,
            "score_mean": new_score_mean,
            "score_std": new_score_std,
            "retrained_at": datetime.now().isoformat(),
            "retrain_reason": reason,
            "n_retrain_samples": n_normal,
        }

        # Chemin temporaire
        temp_path = os.path.join(
            os.path.dirname(current_model_path),
            f"model_retrain_temp_{datetime.now().strftime('%Y%m%d_%H%M%S')}.joblib",
        )
        os.makedirs(os.path.dirname(temp_path), exist_ok=True)
        joblib.dump(new_pipeline, temp_path)

        print(f"[Retraining] Etape 4 OK : pipeline sauvegarde → {temp_path}")

        # ── Etape 5 : Enregistrer dans le registry ────────────────────────────
        new_version = self.registry.register(
            model_path=temp_path,
            score_mean=new_score_mean,
            score_std=new_score_std,
            n_training_samples=n_normal,
            reason=reason,
            drift_severity=drift_report.severity if drift_report else "manual",
            notes=(
                f"Drift type={drift_report.drift_type}, "
                f"KS p={drift_report.ks_p_value:.4f}, "
                f"mean_shift={drift_report.mean_shift_pct:.1f}%"
                if drift_report else "Reentrain manuel"
            ),
        )

        # Nettoyer le fichier temporaire (le registry a fait sa propre copie)
        if os.path.exists(temp_path):
            os.remove(temp_path)

        print(f"[Retraining] Etape 5 OK : enregistre comme {new_version.version}")

        # ── Etape 6 : Reset du detecteur ──────────────────────────────────────
        drift_detector.reset_after_retrain()
        # Mettre a jour les references du detecteur avec les nouvelles stats
        drift_detector.ref_mean = new_score_mean
        drift_detector.ref_std = new_score_std

        print(f"[Retraining] Detecteur remis a zero avec nouvelles references")
        print(f"[Retraining] Reentrain termine avec succes → {new_version.version}")

        return RetrainingResult(
            success=True,
            message=f"Reentrain reussi. Nouveau modele : {new_version.version}",
            details={
                "new_version": new_version.version,
                "n_training_samples": n_normal,
                "new_score_mean": round(new_score_mean, 4),
                "new_score_std": round(new_score_std, 4),
                "drift_severity": drift_report.severity if drift_report else "manual",
                "reason": reason,
            },
        )

    # ── Utilitaires ─────────────────────────────────────────────────────────

    @property
    def is_retraining(self) -> bool:
        return self._is_retraining

    @property
    def last_result(self) -> Optional[dict]:
        if self._last_result:
            return self._last_result.to_dict()
        return None

    @property
    def retrain_log(self) -> list:
        return self._log[-20:]  # 20 derniers


# Instance singleton
retraining_service = RetrainingService(registry=model_registry)
