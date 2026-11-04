"""Service « attaques de transmission » : rapport opérateur et libellés, sans entraînement."""
from app.domains.transmission import service


def test_feature_labels_are_readable_french():
    assert service.feature_label("fridge_std_1min") == "écart-type sur 1 min du frigo"
    assert service.feature_label("fridge_q90_15min") == "quantile 90 % sur 15 min du frigo"
    assert service.feature_label("fridge_repeat_2min") == "séquence de 2 min du frigo déjà transmise"
    assert service.feature_label("fridge_thermostat_diff").startswith("écart frigo")


def test_family_maps_every_scenario_to_a_recommendation():
    for name in ("MITM_gel", "MITM_rejeu", "Injection_nominale", "Injection_biais_0.5",
                 "Injection_derive", "MITM_gel_thermostat", "Injection_biais_thermostat"):
        assert service._family(name) in service.RECOMMANDATIONS


def _model(nom, recall_val, ok=True, per_episode=None):
    return {"nom": nom, "type": "supervisé", "precision": 0.93, "recall": 0.6, "f1": 0.73, "val_recall": recall_val,
            "val_precision": 0.92, "val_fausses_alarmes_par_heure": 0.4, "val_delai_median_min": 4.0,
            "fausses_alarmes_evenements_par_heure": 0.35, "delai_median_min": 4.2, "episodes": 55,
            "episodes_detectes": 54,
            "point_fonctionnement": {"seuil": 0.7, "k": 6, "n": 12, "contrainte_tenue": ok},
            "per_attack": {"MITM_gel": {"n": 100, "detected": 92, "rate": 92.0},
                           "Injection_biais_0.5": {"n": 100, "detected": 8, "rate": 8.0}},
            "per_episode": per_episode or {"MITM_gel": {"n": 6, "detected": 6, "delai_median_min": 1.0},
                                           "Injection_biais_0.5": {"n": 6, "detected": 2, "delai_median_min": 12.0}}}


def test_operator_report_from_results():
    models = {"RandomForest": _model("Random Forest", 0.62), "XGBoost": _model("XGBoost", 0.55)}
    shap_data = {"par_scenario": {"MITM_gel": [{"feature": "fridge_std_1min", "importance": 0.2}]}}
    report = service.operator_report(models, shap_data, "test")
    assert report["modele"]["nom"] == "Random Forest"
    assert report["modele"]["point_fonctionnement"] == "seuil 0.70, 6 sur 12 mesures"
    gel = next(s for s in report["scenarios"] if s["scenario"] == "MITM_gel")
    assert gel["niveau"] == "bien détecté" and gel["episodes"] == "6/6"
    assert gel["ce_que_le_modele_regarde"] == ["écart-type sur 1 min du frigo"]
    biais = next(s for s in report["scenarios"] if s["scenario"] == "Injection_biais_0.5")
    assert "vérification humaine" in biais["niveau"]
    assert "## Consignes par type d'attaque" in report["markdown"]
    assert "persistance" in report["modele"]["seuil"]
    assert len(report["scenarios"]) == len(service.scenarios()) == 9


def test_operator_report_picks_the_model_on_validation_with_the_constraint_first():
    models = {"RandomForest": _model("Random Forest", 0.60), "MLP": _model("MLP", 0.80, ok=False),
              "HistGB": _model("HistGradientBoosting", 0.65), "RF_v1": _model("ancien", 0.99)}
    report = service.operator_report(models, None, "test")
    assert report["modele"]["cle"] == "HistGB"          # MLP ne tient pas la contrainte, RF_v1 n'est qu'une référence
    assert "SMOTE" in report["markdown"]


def test_alert_recommendation():
    out = service.alert_recommendation("MITM_rejeu", "fridge", 0.91, ["fridge_repeat_2min"])
    assert out["famille"].startswith("Rejeu")
    assert out["confiance"] == "élevée"
    assert out["indices"] == ["séquence de 2 min du frigo déjà transmise"]
    assert "contrôler la température sur place" in out["consigne"]


def test_public_kpis_come_from_the_reference_results():
    kpis = service.public_kpis()
    assert kpis is not None, "models/transmission_reel/comparaison_modeles.json est versionné"
    best = kpis["meilleur"]
    assert best["id"] in ("RandomForest", "ExtraTrees", "XGBoost", "HistGB", "Logistique", "MLP")
    assert 0 < best["recall"] <= 1 and best["seuil"] is not None and best["k"] >= 1
    assert 0.10 <= kpis["part_attaques_test"] <= 0.20
    assert kpis["traces"]["mesures"] > 40_000 and kpis["traces"]["pas"] == "5s"
    assert kpis["scenarios"] == len(service.scenarios()) == len(kpis["detection_par_scenario"])
    taux = [s["taux"] for s in kpis["detection_par_scenario"]]
    assert taux == sorted(taux, reverse=True)
