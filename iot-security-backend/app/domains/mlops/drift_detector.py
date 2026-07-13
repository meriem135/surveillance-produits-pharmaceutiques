"""
Drift Detector — MLOps Phase 2
================================
Detecte quand le comportement des donnees IoT change suffisamment
pour que le modele d'anomalie ne soit plus fiable.

Deux algorithmes complementaires :

1. KS-Test (Kolmogorov-Smirnov)
   - Compare la distribution des scores recents vs la distribution de reference
   - Question posee : "Les scores recents viennent-ils de la meme distribution ?"
   - Seuil : p_value < 0.05 → drift confirme

2. Page-Hinkley
   - Detecte un changement abrupt de la moyenne des scores
   - Moins sensible au bruit, plus rapide sur les transitions soudaines
   - Seuil : delta=0.005 (sensibilite), lambda=50 (tolerance)

Pourquoi deux algorithmes ?
   - KS-Test = excellent pour detecter un changement de FORME (distribution)
   - Page-Hinkley = excellent pour detecter un changement de NIVEAU (moyenne)
   - Ensemble, ils couvrent les cas : derive lente + rupture brusque
"""

import json
import os
import numpy as np
from datetime import datetime, timedelta
from scipy.stats import ks_2samp
from typing import Optional
from dataclasses import dataclass, asdict


# ── Fichier de persistance des fenetres glissantes ──────────────────────────
DRIFT_STORE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "models",
    "mlops",
    "drift_store.json",
)


@dataclass
class DriftReport:
    """Rapport complet retourne apres chaque analyse de drift."""
    timestamp: str
    drift_detected: bool
    drift_type: str           # "aucun" | "ks_test" | "page_hinkley" | "double"
    severity: str             # "none" | "warning" | "critical"

    # KS-Test
    ks_statistic: float
    ks_p_value: float
    ks_drift: bool

    # Page-Hinkley
    ph_cumsum: float
    ph_threshold: float
    ph_drift: bool

    # Stats comparatives
    ref_mean: float
    ref_std: float
    recent_mean: float
    recent_std: float
    mean_shift_pct: float     # Ecart en % par rapport a la reference

    # Taux d'anomalies
    anomaly_rate_pct: float
    n_samples: int

    # Recommandation
    recommendation: str

    def to_dict(self) -> dict:
        return asdict(self)


class PageHinkley:
    """
    Algorithme Page-Hinkley pour detection de changement de moyenne.

    Principe :
    - On accumule les ecarts par rapport a la moyenne de reference
    - Si la somme cumulee depasse un seuil, c'est un changement detecte
    - delta : sensibilite (ignorer les petites variations)
    - lambda_ : seuil de declenchement
    """

    def __init__(self, delta: float = 0.005, lambda_: float = 50.0):
        self.delta = delta
        self.lambda_ = lambda_
        self.cumsum = 0.0
        self.n = 0
        self.sum_x = 0.0

    def update(self, x: float) -> bool:
        """Ajoute une observation. Retourne True si drift detecte."""
        self.n += 1
        self.sum_x += x
        mean_so_far = self.sum_x / self.n

        # Mise a jour de la somme cumulee (sens positif uniquement)
        self.cumsum = max(0.0, self.cumsum + (x - mean_so_far - self.delta))

        return self.cumsum > self.lambda_

    def reset(self):
        """Remet a zero apres un drift confirme (debut d'une nouvelle periode)."""
        self.cumsum = 0.0
        self.n = 0
        self.sum_x = 0.0

    @property
    def state(self) -> dict:
        return {
            "cumsum": round(self.cumsum, 4),
            "threshold": self.lambda_,
            "n": self.n,
        }


class DriftDetector:
    """
    Detecteur de drift principal.

    Utilise une fenetre glissante de `window_size` scores recents,
    comparee a la distribution de reference capturee lors de l'entrainement.

    Usage:
        detector = DriftDetector(ref_mean=-0.15, ref_std=0.05)
        detector.add_score(score=-0.12, is_anomaly=False)
        report = detector.analyze()
        if report.drift_detected:
            print("Reentrain le modele !")
    """

    def __init__(
        self,
        ref_mean: float,
        ref_std: float,
        window_size: int = 300,
        ks_threshold: float = 0.05,
        ph_delta: float = 0.005,
        ph_lambda: float = 50.0,
    ):
        self.ref_mean = ref_mean
        self.ref_std = max(ref_std, 1e-6)   # eviter division par zero
        self.window_size = window_size
        self.ks_threshold = ks_threshold

        # Historique glissant : liste de dicts {score, is_anomaly, timestamp}
        self._window: list[dict] = []

        # Algorithme Page-Hinkley
        self.ph = PageHinkley(delta=ph_delta, lambda_=ph_lambda)

        # Compteur de drifts detectes depuis le debut
        self.drift_count = 0
        self.last_drift_at: Optional[str] = None

        self._load()

    # ── Persistance ─────────────────────────────────────────────────────────

    def _load(self):
        """Charge l'historique depuis le fichier JSON si disponible."""
        if os.path.exists(DRIFT_STORE_PATH):
            try:
                with open(DRIFT_STORE_PATH, "r") as f:
                    data = json.load(f)
                self._window = data.get("window", [])[-self.window_size:]
                self.drift_count = data.get("drift_count", 0)
                self.last_drift_at = data.get("last_drift_at")
                # Rejouer Page-Hinkley depuis l'historique
                for entry in self._window:
                    self.ph.update(entry["score"])
            except Exception:
                pass   # Fichier corrompu → on repart de zero

    def _save(self):
        """Persiste l'etat courant."""
        os.makedirs(os.path.dirname(DRIFT_STORE_PATH), exist_ok=True)
        with open(DRIFT_STORE_PATH, "w") as f:
            json.dump(
                {
                    "window": self._window[-self.window_size:],
                    "drift_count": self.drift_count,
                    "last_drift_at": self.last_drift_at,
                    "ref_mean": self.ref_mean,
                    "ref_std": self.ref_std,
                },
                f,
                indent=2,
            )

    # ── Ajout de donnees ────────────────────────────────────────────────────

    def add_score(self, score: float, is_anomaly: bool):
        """
        Enregistre un nouveau score de prediction dans la fenetre.
        Appele a chaque analyse IoT en temps reel.
        """
        self._window.append(
            {
                "score": float(score),
                "is_anomaly": bool(is_anomaly),
                "timestamp": datetime.now().isoformat(),
            }
        )
        # Garder seulement les N derniers
        if len(self._window) > self.window_size:
            self._window = self._window[-self.window_size:]

        # Mise a jour Page-Hinkley en continu
        self.ph.update(score)

        self._save()

    # ── Analyse de drift ────────────────────────────────────────────────────

    def analyze(self) -> DriftReport:
        """
        Analyse complete de la fenetre courante.
        Retourne un DriftReport avec tous les indicateurs.
        """
        n = len(self._window)
        timestamp = datetime.now().isoformat()

        # Pas assez de donnees pour une analyse fiable
        if n < 50:
            return DriftReport(
                timestamp=timestamp,
                drift_detected=False,
                drift_type="aucun",
                severity="none",
                ks_statistic=0.0,
                ks_p_value=1.0,
                ks_drift=False,
                ph_cumsum=self.ph.cumsum,
                ph_threshold=self.ph.lambda_,
                ph_drift=False,
                ref_mean=round(self.ref_mean, 4),
                ref_std=round(self.ref_std, 4),
                recent_mean=0.0,
                recent_std=0.0,
                mean_shift_pct=0.0,
                anomaly_rate_pct=0.0,
                n_samples=n,
                recommendation=f"Donnees insuffisantes ({n}/50 min). Continuer la collecte.",
            )

        recent_scores = np.array([e["score"] for e in self._window])
        recent_mean = float(recent_scores.mean())
        recent_std = float(recent_scores.std())

        # ── KS-Test ─────────────────────────────────────────────────────────
        # On genere une distribution de reference theorique (gaussienne)
        # basee sur les stats calculees lors de l'entrainement du modele
        ref_samples = np.random.normal(self.ref_mean, self.ref_std, size=n)
        ks_stat, ks_p = ks_2samp(recent_scores, ref_samples)
        ks_drift = bool(ks_p < self.ks_threshold)

        # ── Page-Hinkley ────────────────────────────────────────────────────
        ph_drift = self.ph.cumsum > self.ph.lambda_

        # ── Bilan global ────────────────────────────────────────────────────
        drift_detected = ks_drift or ph_drift

        if ks_drift and ph_drift:
            drift_type = "double"
            severity = "critical"
        elif ks_drift:
            drift_type = "ks_test"
            severity = "warning"
        elif ph_drift:
            drift_type = "page_hinkley"
            severity = "warning"
        else:
            drift_type = "aucun"
            severity = "none"

        # Ecart de la moyenne en % par rapport a la reference
        mean_shift_pct = abs(recent_mean - self.ref_mean) / (abs(self.ref_mean) + 1e-8) * 100

        anomaly_rate = float(np.mean([e["is_anomaly"] for e in self._window]) * 100)

        # Mise a jour du compteur de drifts
        if drift_detected:
            self.drift_count += 1
            self.last_drift_at = timestamp
            self._save()

        # ── Recommandation textuelle ─────────────────────────────────────────
        if severity == "critical":
            recommendation = (
                "CRITIQUE : Les deux detecteurs signalent un drift. "
                "Reentrain immediat recommande."
            )
        elif severity == "warning":
            algo = "KS-Test" if ks_drift else "Page-Hinkley"
            recommendation = (
                f"ATTENTION : Drift detecte par {algo}. "
                f"Ecart moyen = {mean_shift_pct:.1f}%. "
                "Surveiller et preparer un reentrain."
            )
        else:
            recommendation = (
                f"Distribution stable. Ecart moyen = {mean_shift_pct:.1f}%. "
                "Aucune action requise."
            )

        return DriftReport(
            timestamp=timestamp,
            drift_detected=drift_detected,
            drift_type=drift_type,
            severity=severity,
            ks_statistic=round(float(ks_stat), 4),
            ks_p_value=round(float(ks_p), 4),
            ks_drift=ks_drift,
            ph_cumsum=round(self.ph.cumsum, 4),
            ph_threshold=self.ph.lambda_,
            ph_drift=ph_drift,
            ref_mean=round(self.ref_mean, 4),
            ref_std=round(self.ref_std, 4),
            recent_mean=round(recent_mean, 4),
            recent_std=round(recent_std, 4),
            mean_shift_pct=round(mean_shift_pct, 2),
            anomaly_rate_pct=round(anomaly_rate, 2),
            n_samples=n,
            recommendation=recommendation,
        )

    # ── Utilitaires ─────────────────────────────────────────────────────────

    def reset_after_retrain(self):
        """
        Appele apres un reentrain reussi.
        Remet la fenetre et Page-Hinkley a zero pour une nouvelle reference.
        """
        self._window = []
        self.ph.reset()
        self._save()

    @property
    def window_stats(self) -> dict:
        """Stats rapides sur la fenetre courante (pour le dashboard)."""
        if not self._window:
            return {"n": 0, "mean": None, "std": None, "anomaly_rate": None}
        scores = np.array([e["score"] for e in self._window])
        anomaly_rate = np.mean([e["is_anomaly"] for e in self._window]) * 100
        return {
            "n": len(self._window),
            "mean": round(float(scores.mean()), 4),
            "std": round(float(scores.std()), 4),
            "anomaly_rate_pct": round(float(anomaly_rate), 2),
            "oldest": self._window[0]["timestamp"] if self._window else None,
            "newest": self._window[-1]["timestamp"] if self._window else None,
        }

    @property
    def history_summary(self) -> list:
        """Derniers 100 points pour le graphique de drift."""
        return self._window[-100:]
