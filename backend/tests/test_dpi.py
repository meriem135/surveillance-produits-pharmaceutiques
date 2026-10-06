from app.domains.intelligence.mqtt_dpi_service import MqttDPIService, compute_risk_score


def payload(weather=25.0, fridge=7.0, thermo=24.0, **extra):
    return {"device_type": "multi-sensor", "weather_temperature": weather,
            "fridge_temperature": fridge, "thermostat_temperature": thermo,
            "weather_roll_std_10": 0.3, **extra}


def test_normal_point_raises_no_alert():
    svc = MqttDPIService()
    state = {}
    assert svc.inspect_payload(payload(), state) is None
    assert svc.inspect_payload(payload(fridge=7.3), state) is None


def test_fridge_out_of_range_triggers_dpi_002():
    alert = MqttDPIService().inspect_payload(payload(fridge=11.0), {})
    assert alert["rule"]["id"] == "DPI-002"
    assert alert["data"]["recommendation"]["consigne"]


def test_jump_rule_uses_the_sensor_that_jumped():
    svc = MqttDPIService()
    state = {}
    svc.inspect_payload(payload(fridge=2.0), state)
    alert = svc.inspect_payload(payload(fridge=8.0), state)   # saut frigo de 6 °C > 5 °C
    detail = alert["data"]["match_detail"]
    assert alert["rule"]["id"] == "DPI-001"
    assert detail["field"] == "fridge_temperature"

    # Le score dépend du saut mesuré, plus de la température absolue du thermostat
    cold = compute_risk_score(alert, payload(fridge=8.0, thermo=17.0))
    warm = compute_risk_score(alert, payload(fridge=8.0, thermo=30.0))
    assert cold == warm


def test_bigger_jump_scores_higher():
    def score(jump):
        svc = MqttDPIService()
        state = {}
        svc.inspect_payload(payload(fridge=1.0), state)
        alert = svc.inspect_payload(payload(fridge=1.0 + jump), state)
        return compute_risk_score(alert, payload())

    assert score(9.0) > score(5.5)


def test_streams_do_not_share_jump_history():
    svc = MqttDPIService()
    a, b = {}, {}
    svc.inspect_payload(payload(fridge=2.0), a)
    svc.inspect_payload(payload(fridge=8.5), b)       # autre client, autre historique
    assert svc.inspect_payload(payload(fridge=2.2), a) is None
