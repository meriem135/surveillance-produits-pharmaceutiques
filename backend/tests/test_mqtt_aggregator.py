from app.services.mqtt_service import StepAggregator


def msg(device, value, step):
    return {"device": device, "value": value, "step": step, "season": "Hiver", "month": 1,
            "timestamp": f"2019-01-01T00:0{step}:00"}


def test_payload_is_built_once_all_three_sensors_arrived():
    agg = StepAggregator()
    assert agg.add(msg("weather-01", 20.0, 1)) is None
    assert agg.add(msg("fridge-01", 7.0, 1)) is None
    p = agg.add(msg("thermostat-01", 24.0, 1))
    assert p["device_type"] == "multi-sensor"
    assert (p["weather_temperature"], p["fridge_temperature"], p["thermostat_temperature"]) == (20.0, 7.0, 24.0)
    assert p["fridge_diff_1"] == 0.0


def test_derivatives_use_previous_complete_step():
    agg = StepAggregator()
    for d, v in (("weather-01", 20.0), ("fridge-01", 7.0), ("thermostat-01", 24.0)):
        agg.add(msg(d, v, 1))
    for d, v in (("thermostat-01", 27.0), ("weather-01", 22.0), ("fridge-01", 6.5)):
        p = agg.add(msg(d, v, 2))
    assert p["fridge_diff_1"] == -0.5
    assert p["thermostat_diff_1"] == 3.0
    assert p["weather_roll_std_10"] == 1.0


def test_incomplete_steps_are_dropped():
    agg = StepAggregator(max_pending=3)
    for step in range(10):
        agg.add(msg("weather-01", 20.0, step))
    assert len(agg._pending) == 3
