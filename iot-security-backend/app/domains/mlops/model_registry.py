"""
Model Registry — MLOps Phase 2
================================
Gere le versioning des modeles entraines.

Concept :
  Chaque modele a un numero de version (v1, v2, v3...).
  Le registry garde trace de :
    - Quand chaque version a ete entrainee
    - Pourquoi elle a ete creee (initial, drift_ks, drift_ph, manual)
    - Ses performances (score moyen, taux d'anomalies de reference)
    - Son statut : "active" | "archived" | "staging"

  Un seul modele est "active" a la fois.
  L'ancien modele passe en "archived" automatiquement.

Structure du fichier registry.json :
  {
    "current_version": "v3",
    "models": [
      {
        "version": "v1",
        "path": ".../models/mlops/model_v1.joblib",
        "trained_at": "2025-01-01T10:00:00",
        "reason": "initial",
        "status": "archived",
        "score_mean": -0.15,
        "score_std": 0.05,
        "n_training_samples": 399188
      },
      ...
    ]
  }
"""

import json
import os
import shutil
from datetime import datetime
from typing import Optional


REGISTRY_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "models",
    "mlops",
)
REGISTRY_FILE = os.path.join(REGISTRY_DIR, "registry.json")

# Modele de production original (pointe vers le .joblib existant)
PRODUCTION_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "models",
    "pipeline_complete.joblib",
)


class ModelVersion:
    """Represente une version enregistree dans le registry."""

    def __init__(self, data: dict):
        self.version: str = data["version"]
        self.path: str = data["path"]
        self.trained_at: str = data["trained_at"]
        self.reason: str = data.get("reason", "unknown")
        self.status: str = data.get("status", "archived")
        self.score_mean: float = data.get("score_mean", 0.0)
        self.score_std: float = data.get("score_std", 1.0)
        self.n_training_samples: int = data.get("n_training_samples", 0)
        self.drift_severity: str = data.get("drift_severity", "none")
        self.notes: str = data.get("notes", "")

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "path": self.path,
            "trained_at": self.trained_at,
            "reason": self.reason,
            "status": self.status,
            "score_mean": self.score_mean,
            "score_std": self.score_std,
            "n_training_samples": self.n_training_samples,
            "drift_severity": self.drift_severity,
            "notes": self.notes,
        }


class ModelRegistry:
    """
    Registry de versioning des modeles ML.

    Responsabilites :
    - Enregistrer un nouveau modele entraine
    - Activer une version (l'ancienne est archivee)
    - Lister l'historique des versions
    - Charger le modele actif
    - Rollback vers une version precedente
    """

    def __init__(self):
        os.makedirs(REGISTRY_DIR, exist_ok=True)
        self._data = self._load()

        # Si le registry est vide, enregistrer le modele de production existant
        if not self._data["models"]:
            self._bootstrap_initial_model()

    # ── Persistance ─────────────────────────────────────────────────────────

    def _load(self) -> dict:
        if os.path.exists(REGISTRY_FILE):
            try:
                with open(REGISTRY_FILE, "r") as f:
                    return json.load(f)
            except Exception:
                pass
        return {"current_version": None, "models": []}

    def _save(self):
        with open(REGISTRY_FILE, "w") as f:
            json.dump(self._data, f, indent=2)

    # ── Bootstrap ───────────────────────────────────────────────────────────

    def _bootstrap_initial_model(self):
        """
        Enregistre le modele pipeline_complete.joblib existant comme v1.
        Appele une seule fois au premier demarrage.
        """
        if not os.path.exists(PRODUCTION_MODEL_PATH):
            return  # Pas de modele existant, rien a faire

        # Copier le modele dans le dossier versionne
        dest_path = os.path.join(REGISTRY_DIR, "model_v1.joblib")
        if not os.path.exists(dest_path):
            shutil.copy2(PRODUCTION_MODEL_PATH, dest_path)

        v1 = {
            "version": "v1",
            "path": dest_path,
            "trained_at": datetime.now().isoformat(),
            "reason": "initial",
            "status": "active",
            "score_mean": 0.0,
            "score_std": 1.0,
            "n_training_samples": 0,
            "drift_severity": "none",
            "notes": "Modele initial importe depuis pipeline_complete.joblib",
        }
        self._data["models"].append(v1)
        self._data["current_version"] = "v1"
        self._save()
        print("[ModelRegistry] Modele initial enregistre comme v1")

    # ── API publique ─────────────────────────────────────────────────────────

    def get_current_version(self) -> Optional[ModelVersion]:
        """Retourne la version active."""
        cv = self._data.get("current_version")
        if not cv:
            return None
        for m in self._data["models"]:
            if m["version"] == cv:
                return ModelVersion(m)
        return None

    def list_versions(self) -> list[ModelVersion]:
        """Retourne toutes les versions, de la plus recente a la plus ancienne."""
        return [ModelVersion(m) for m in reversed(self._data["models"])]

    def register(
        self,
        model_path: str,
        score_mean: float,
        score_std: float,
        n_training_samples: int,
        reason: str = "retrain",
        drift_severity: str = "none",
        notes: str = "",
    ) -> ModelVersion:
        """
        Enregistre un nouveau modele entraine.
        - Genere automatiquement le prochain numero de version
        - Archive la version precedente
        - Active la nouvelle version
        """
        # Generer le prochain numero de version
        existing_versions = [m["version"] for m in self._data["models"]]
        next_num = len(existing_versions) + 1
        new_version = f"v{next_num}"

        # Copier le fichier dans le repertoire versionne
        dest_path = os.path.join(REGISTRY_DIR, f"model_{new_version}.joblib")
        if model_path != dest_path:
            shutil.copy2(model_path, dest_path)

        # Archiver la version active precedente
        for m in self._data["models"]:
            if m["status"] == "active":
                m["status"] = "archived"

        # Enregistrer la nouvelle version
        new_entry = {
            "version": new_version,
            "path": dest_path,
            "trained_at": datetime.now().isoformat(),
            "reason": reason,
            "status": "active",
            "score_mean": round(score_mean, 6),
            "score_std": round(score_std, 6),
            "n_training_samples": n_training_samples,
            "drift_severity": drift_severity,
            "notes": notes,
        }
        self._data["models"].append(new_entry)
        self._data["current_version"] = new_version
        self._save()

        print(f"[ModelRegistry] Nouvelle version enregistree : {new_version} ({reason})")
        return ModelVersion(new_entry)

    def rollback(self, version: str) -> Optional[ModelVersion]:
        """
        Revient a une version anterieure.
        Utile si le nouveau modele est moins bon.
        """
        target = None
        for m in self._data["models"]:
            if m["version"] == version:
                target = m
                break

        if not target:
            return None

        # Archiver la version active
        for m in self._data["models"]:
            if m["status"] == "active":
                m["status"] = "archived"

        # Reactiver la version cible
        target["status"] = "active"
        self._data["current_version"] = version
        self._save()

        print(f"[ModelRegistry] Rollback vers {version}")
        return ModelVersion(target)

    def get_version(self, version: str) -> Optional[ModelVersion]:
        """Retourne une version specifique."""
        for m in self._data["models"]:
            if m["version"] == version:
                return ModelVersion(m)
        return None

    def summary(self) -> dict:
        """
        Resume pour le dashboard : version active, nb versions, historique.
        """
        current = self.get_current_version()
        versions = self.list_versions()
        return {
            "current_version": self._data.get("current_version"),
            "total_versions": len(versions),
            "active_model": current.to_dict() if current else None,
            "history": [v.to_dict() for v in versions[:10]],  # 10 dernieres
        }

    def get_active_model_path(self) -> Optional[str]:
        """Retourne le chemin du modele actif (pour le charger avec joblib)."""
        current = self.get_current_version()
        if current and os.path.exists(current.path):
            return current.path
        # Fallback vers le modele de production original
        if os.path.exists(PRODUCTION_MODEL_PATH):
            return PRODUCTION_MODEL_PATH
        return None


# Instance singleton partagee
model_registry = ModelRegistry()
