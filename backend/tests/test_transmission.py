"""Service « attaques de transmission » : rapport opérateur et libellés, sans entraînement."""
from app.domains.transmission import service


def test_feature_labels_are_readable_french():
    assert service.feature_label("fridge_std_1min") == "écart-type sur 1 min du frigo"
    assert service.feature_label("thermostat_ewma_10min") == "moyenne lissée sur 10 min du thermostat (salle)"
    assert service.feature_label("fridge_repeat_2min") == "séquence de 2 min du frigo déjà transmise"
    assert service.feature_label("fridge_thermostat_diff").startswith("écart frigo")


def test_family_maps_every_scenario_to_a_recommendation():
    for name in ("MITM_gel", "MITM_rejeu", "Injection_nominale", "Injection_biais_0.5",
                 "Injection_derive", "MITM_gel_thermostat", "Injection_biais_thermostat"):
        assert service._family(name) in service.RECOMMANDATIONS


def test_operator_report_from_results():
    models = {
        "RandomForest": {"nom": "Random Forest", "type": "supervisé", "precision": 0.75, "recall": 0.59, "f1": 0.66,
                         "val_f1": 0.66, "fausses_alarmes_evenements_par_heure": 3.3, "delai_median_min": 1.9,
                         "episodes": 55, "episodes_detectes": 48,
                         "per_attack": {"MITM_gel": {"n": 100, "detected": 92, "rate": 92.0},
                                        "Injection_biais_0.5": {"n": 100, "detected": 8, "rate": 8.0}},
                         "per_episode": {"MITM_gel": {"n": 6, "detected": 6}}},
        "XGBoost": {"nom": "XGBoost", "type": "supervisé", "precision": 0.67, "recall": 0.51, "f1": 0.58, "val_f1": 0.59,
                    "fausses_alarmes_evenements_par_heure": 4.5, "episodes": 55, "episodes_detectes": 46},
    }
    shap_data = {"par_scenario": {"MITM_gel": [{"feature": "fridge_std_1min", "importance": 0.2}]}}
    report = service.operator_report(models, shap_data, "test")
    assert report["modele"]["nom"] == "Random Forest"
    gel = next(s for s in report["scenarios"] if s["scenario"] == "MITM_gel")
    assert gel["niveau"] == "bien détecté"
    assert gel["ce_que_le_modele_regarde"] == ["écart-type sur 1 min du frigo"]
    biais = next(s for s in report["scenarios"] if s["scenario"] == "Injection_biais_0.5")
    assert "vérification humaine" in biais["niveau"]
    assert "## Consignes par type d'attaque" in report["markdown"]
    assert len(report["scenarios"]) == 9


def test_alert_recommendation():
    out = service.alert_recommendation("MITM_rejeu", "fridge", 0.91, ["fridge_repeat_2min"])
    assert out["famille"].startswith("Rejeu")
    assert out["confiance"] == "élevée"
    assert out["indices"] == ["séquence de 2 min du frigo déjà transmise"]
    assert "contrôler la température sur place" in out["consigne"]
