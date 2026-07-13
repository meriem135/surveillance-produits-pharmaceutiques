"""
Demo MLOps — Script de demonstration pas a pas
================================================
Ce script simule ce qui se passe dans le backend :

  1. Simulation de donnees normales (pas de drift)
  2. Simulation d'un drift graduel (la moyenne change)
  3. Detection du drift par KS-Test et Page-Hinkley
  4. Simulation du reentrain automatique
  5. Verification que le detecteur est remis a zero

Lancer avec :
  cd C:\\peaksoft-security-platform-main\\peaksoft-security-platform-main
  python scripts/demo_mlops.py
"""

import sys
import os
import numpy as np
import json

# Ajouter le dossier backend au path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "iot-security-backend"))

from app.domains.mlops.drift_detector import DriftDetector, DriftReport

SEPARATOR = "=" * 65


def print_section(title: str):
    print(f"\n{SEPARATOR}")
    print(f"  {title}")
    print(SEPARATOR)


def print_report(report: DriftReport, indent: str = "  "):
    status_icon = {
        "none": "✅",
        "warning": "⚠️ ",
        "critical": "🔴",
    }.get(report.severity, "?")

    print(f"{indent}Drift detecte   : {'OUI' if report.drift_detected else 'NON'}")
    print(f"{indent}Severite        : {status_icon} {report.severity.upper()}")
    print(f"{indent}Type de drift   : {report.drift_type}")
    print(f"{indent}")
    print(f"{indent}── KS-Test ─────────────────────────────────────")
    print(f"{indent}  p-value         : {report.ks_p_value:.4f} {'⚠️  DRIFT' if report.ks_drift else '✅ OK'}")
    print(f"{indent}  KS statistic    : {report.ks_statistic:.4f}")
    print(f"{indent}")
    print(f"{indent}── Page-Hinkley ─────────────────────────────────")
    print(f"{indent}  Cumsum actuel   : {report.ph_cumsum:.4f}")
    print(f"{indent}  Seuil           : {report.ph_threshold:.1f} {'⚠️  DRIFT' if report.ph_drift else '✅ OK'}")
    print(f"{indent}")
    print(f"{indent}── Stats ────────────────────────────────────────")
    print(f"{indent}  Ref mean        : {report.ref_mean:.4f}")
    print(f"{indent}  Recent mean     : {report.recent_mean:.4f}")
    print(f"{indent}  Ecart moyen     : {report.mean_shift_pct:.1f}%")
    print(f"{indent}  Taux anomalies  : {report.anomaly_rate_pct:.1f}%")
    print(f"{indent}  N echantillons  : {report.n_samples}")
    print(f"{indent}")
    print(f"{indent}Recommandation  : {report.recommendation}")


# ─────────────────────────────────────────────────────────────────────────────

def main():
    print_section("DEMO MLOps — Drift Detection & Auto-Retraining")
    print("  Ce script simule 3 scenarios :")
    print("  1. Distribution normale (pas de drift)")
    print("  2. Drift progressif (la moyenne glisse)")
    print("  3. Drift abrupt (rupture soudaine)")

    # ─── Parametres de reference ──────────────────────────────────────────────
    REF_MEAN = -0.15    # Score moyen des donnees normales (Isolation Forest)
    REF_STD = 0.05      # Ecart-type des scores normaux

    # ═══════════════════════════════════════════════════════════════════════════
    print_section("SCENARIO 1 : Distribution Normale (pas de drift attendu)")
    # ═══════════════════════════════════════════════════════════════════════════

    detector = DriftDetector(
        ref_mean=REF_MEAN,
        ref_std=REF_STD,
        window_size=200,
        ks_threshold=0.05,
        ph_lambda=50.0,
    )

    np.random.seed(42)
    print("  Injection de 200 scores normaux (mean=-0.15, std=0.05)...")
    for i in range(200):
        score = np.random.normal(REF_MEAN, REF_STD)
        is_anomaly = score < -0.25
        detector.add_score(score, is_anomaly)

    report = detector.analyze()
    print_report(report)

    assert not report.drift_detected, "ERREUR : drift detecte a tort sur donnees normales"
    print("\n  ✅ Test passe : pas de faux positif sur donnees normales")

    # ═══════════════════════════════════════════════════════════════════════════
    print_section("SCENARIO 2 : Drift Progressif (la moyenne glisse de -0.15 a -0.25)")
    # ═══════════════════════════════════════════════════════════════════════════

    detector2 = DriftDetector(
        ref_mean=REF_MEAN,
        ref_std=REF_STD,
        window_size=200,
    )

    print("  Phase 1 : 100 points normaux...")
    for i in range(100):
        score = np.random.normal(REF_MEAN, REF_STD)
        detector2.add_score(score, score < -0.25)

    print("  Phase 2 : 150 points avec derive progressive (-0.15 → -0.25)...")
    for i in range(150):
        # La moyenne glisse lineairement vers -0.25
        drifted_mean = REF_MEAN - (i / 150) * 0.10
        score = np.random.normal(drifted_mean, REF_STD)
        detector2.add_score(score, score < -0.25)

    report2 = detector2.analyze()
    print_report(report2)

    if report2.drift_detected:
        print(f"\n  ✅ Drift progressif detecte (type={report2.drift_type})")
    else:
        print(f"\n  ⚠️  Drift progressif NON detecte (fenetre peut etre insuffisante)")

    # ═══════════════════════════════════════════════════════════════════════════
    print_section("SCENARIO 3 : Drift Abrupt (attaque qui change tout d'un coup)")
    # ═══════════════════════════════════════════════════════════════════════════

    detector3 = DriftDetector(
        ref_mean=REF_MEAN,
        ref_std=REF_STD,
        window_size=200,
    )

    print("  Phase 1 : 80 points normaux...")
    for i in range(80):
        score = np.random.normal(REF_MEAN, REF_STD)
        detector3.add_score(score, score < -0.25)

    print("  Phase 2 : ATTAQUE — 120 points avec distribution completement differente...")
    print(f"  (mean=-0.35, std=0.15 au lieu de mean={REF_MEAN}, std={REF_STD})")
    for i in range(120):
        score = np.random.normal(-0.35, 0.15)
        detector3.add_score(score, True)  # Toutes anomalies

    report3 = detector3.analyze()
    print_report(report3)

    if report3.drift_detected:
        print(f"\n  ✅ Drift abrupt detecte (severity={report3.severity})")
    else:
        print(f"\n  ⚠️  Drift abrupt non detecte")

    # ═══════════════════════════════════════════════════════════════════════════
    print_section("SIMULATION DU RESET APRES REENTRAIN")
    # ═══════════════════════════════════════════════════════════════════════════

    print("  Avant reset :")
    print(f"    Window size = {detector3.window_stats['n']}")
    print(f"    PH cumsum   = {detector3.ph.cumsum:.4f}")

    # Simuler le reentrain : nouvelles stats de reference
    new_ref_mean = -0.35
    new_ref_std = 0.15

    detector3.reset_after_retrain()
    detector3.ref_mean = new_ref_mean
    detector3.ref_std = new_ref_std

    print("\n  Apres reset + nouvelles references :")
    print(f"    Window size     = {detector3.window_stats['n']}")
    print(f"    PH cumsum       = {detector3.ph.cumsum:.4f}")
    print(f"    Nouvelle ref    = mean={new_ref_mean}, std={new_ref_std}")

    # Reinjecter des donnees normales avec la nouvelle distribution
    print("\n  Injection de 60 points avec la nouvelle distribution...")
    for i in range(60):
        score = np.random.normal(new_ref_mean, new_ref_std)
        detector3.add_score(score, False)

    report_after = detector3.analyze()
    print(f"\n  Apres reentrain :")
    print(f"    Drift detecte = {'OUI' if report_after.drift_detected else 'NON'}")
    print(f"    Recent mean   = {report_after.recent_mean:.4f}")
    print(f"    Ref mean      = {report_after.ref_mean:.4f}")

    # ═══════════════════════════════════════════════════════════════════════════
    print_section("RESUME — Ce qui se passe dans le backend")
    # ═══════════════════════════════════════════════════════════════════════════

    print("""
  Flux de donnees en production :

  ┌─────────────────────────────────────────────────────────────┐
  │  Capteur IoT → mqtt/modbus → ml_service.analyze()          │
  │       ↓                                                      │
  │  score = model.score_samples(features)                      │
  │       ↓                                                      │
  │  mlops_service.add_score(score, is_anomaly)  ← NOUVEAU      │
  │       ↓                                                      │
  │  DriftDetector.add_score()  [fenetre 300 points]            │
  │       ↓ (toutes les heures)                                  │
  │  MLOpsScheduler._run_check()                                │
  │       ↓                                                      │
  │  DriftDetector.analyze()                                    │
  │       ├── KS-Test (distribution globale)                    │
  │       └── Page-Hinkley (changement de niveau)               │
  │       ↓ (si severity == critical)                            │
  │  RetrainingService.trigger()                                │
  │       ├── Collecter donnees normales                        │
  │       ├── Reentrain IsolationForest                         │
  │       ├── ModelRegistry.register() → v2, v3...              │
  │       └── DriftDetector.reset_after_retrain()               │
  └─────────────────────────────────────────────────────────────┘

  API disponibles apres demarrage du backend :
    GET  /api/v1/mlops/dashboard     → Vue complete
    GET  /api/v1/mlops/drift         → Rapport de drift
    GET  /api/v1/mlops/models        → Versions du registry
    POST /api/v1/mlops/retrain       → Reentrain manuel
    POST /api/v1/mlops/rollback/v1   → Revenir a v1
    GET  /api/v1/mlops/scheduler     → Etat du scheduler
    GET  /api/v1/mlops/retrain/log   → Journal des reentrain
    """)

    print(f"{SEPARATOR}")
    print("  Demo terminee avec succes !")
    print(f"{SEPARATOR}\n")


if __name__ == "__main__":
    main()
