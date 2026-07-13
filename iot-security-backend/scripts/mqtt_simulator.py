#!/usr/bin/env python
"""
Simple MQTT telemetry simulator for the IoT Security Backend.

Sends telemetry messages for a few demo devices to the Mosquitto broker
on topics of the form:

    factory/{device_id}/telemetry

Usage (from project root or iot-security-backend/):

    python scripts/mqtt_simulator.py --host localhost --port 1883 --count 10 --interval 1

This is intended to satisfy:
- Roadmap Phase 2, Week 5, Day 3/4: "Test with simulated messages"
"""

import argparse
import json
import os
import random
import sys
import time
from datetime import datetime, timezone
from typing import List

import paho.mqtt.client as mqtt


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="MQTT telemetry simulator")
    parser.add_argument(
        "--host",
        default=os.getenv("MQTT_HOST", "localhost"),
        help="MQTT broker host (default: localhost or MQTT_HOST env)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("MQTT_PORT", "1883")),
        help="MQTT broker port (default: 1883 or MQTT_PORT env)",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=10,
        help="Number of messages to send per device (default: 10)",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=1.0,
        help="Seconds between messages (default: 1.0)",
    )
    parser.add_argument(
        "--devices",
        nargs="*",
        default=["dev-weather-01", "dev-fridge-01", "dev-thermostat-01"],
        help="List of device IDs to simulate (default: dev-weather-01 dev-fridge-01 dev-thermostat-01)",
    )
    return parser.parse_args()


def build_payload(device_id: str) -> str:
    """
    Build a simple JSON payload with temperature and pressure.
    Matches the backend expectation of a top-level JSON object with
    metric keys and an ISO8601 timestamp.
    """
    now = datetime.now(timezone.utc).isoformat()
    temperature = round(random.uniform(20.0, 30.0), 2)
    pressure = random.randint(990, 1030)

    payload = {
        "timestamp": now,
        "temperature": temperature,
        "pressure": pressure,
        "status": "ok",
    }
    return json.dumps(payload)


def main() -> int:
    args = parse_args()

    client = mqtt.Client()

    try:
        client.connect(args.host, args.port, keepalive=60)
    except Exception as exc:  # pragma: no cover - diagnostic path
        print(f"❌ Failed to connect to MQTT broker at {args.host}:{args.port}: {exc}", file=sys.stderr)
        return 1

    print(f"🚀 Connected to MQTT broker at {args.host}:{args.port}")
    print(f"📡 Simulating devices: {', '.join(args.devices)}")

    for i in range(args.count):
        for device_id in args.devices:
            topic = f"factory/{device_id}/telemetry"
            payload = build_payload(device_id)
            result = client.publish(topic, payload=payload, qos=1)
            status = result[0]
            if status == mqtt.MQTT_ERR_SUCCESS:
                print(f"[{i+1}/{args.count}] ✅ Published to {topic}: {payload}")
            else:  # pragma: no cover - rare error branch
                print(f"[{i+1}/{args.count}] ❌ Failed to publish to {topic}, status={status}", file=sys.stderr)
        time.sleep(args.interval)

    client.disconnect()
    print("✅ Simulation completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

