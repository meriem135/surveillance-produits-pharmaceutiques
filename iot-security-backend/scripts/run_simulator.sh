#!/usr/bin/env bash

# Simple helper to run existing simulators inside the Docker stack
# so you don't need a local Python environment.
#
# Simulators:
#   1) MQTT telemetry simulator      -> scripts/mqtt_simulator.py
#   2) Wazuh / OpenSearch alerts sim -> scripts/simulate_alerts.py
#
# Usage:
#   From repo root or from iot-security-backend/:
#     bash iot-security-backend/scripts/run_simulator.sh
#
# Make executable once:
#   chmod +x iot-security-backend/scripts/run_simulator.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_DIR="${PROJECT_ROOT}/wazuh-docker/multi-node"

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ docker command not found. Please install Docker first."
  exit 1
fi

if [ ! -f "${COMPOSE_DIR}/docker-compose.yml" ]; then
  echo "❌ Could not find docker-compose.yml at: ${COMPOSE_DIR}/docker-compose.yml"
  echo "   Make sure you're using the expected project structure."
  exit 1
fi

echo "==========================================="
echo " PeakSoft IIoT Simulators"
echo "==========================================="
echo "1) MQTT Telemetry Simulator (factory/*/telemetry)"
echo "2) Modbus TCP Simulator (port 5020)"
echo "3) Wazuh / OpenSearch Alerts Simulator"
echo "q) Quit"
echo
echo "Note: For Modbus, make sure port 5020 is accessible if running from host."
echo
read -rp "Select an option [1-3/q]: " CHOICE

case "${CHOICE}" in
  1)
    echo
    read -rp "Messages per device (default 10): " COUNT
    read -rp "Interval between messages in seconds (default 1.0): " INTERVAL

    COUNT=${COUNT:-10}
    INTERVAL=${INTERVAL:-1.0}

    echo
    echo "🚀 Running MQTT telemetry simulator inside 'iot-security-backend' container..."
    echo "   - Messages per device: ${COUNT}"
    echo "   - Interval (s):        ${INTERVAL}"
    echo

    (
      cd "${COMPOSE_DIR}"
      docker compose exec iot-security-backend \
        python scripts/mqtt_simulator.py \
          --count "${COUNT}" \
          --interval "${INTERVAL}"
    )
    ;;

  2)
    echo
    echo "🚀 Running Modbus TCP simulator inside 'iot-security-backend' container..."
    echo "   Listening on port 5020"
    echo

    (
      cd "${COMPOSE_DIR}"
      docker compose exec iot-security-backend \
        python scripts/modbus_simulator.py --port 5020
    )
    ;;

  3)
    echo
    echo "🚀 Running Wazuh / OpenSearch alerts simulator inside 'iot-security-backend' container..."
    echo "   This will create mock alerts in OpenSearch for testing dashboards and risk scores."
    echo

    (
      cd "${COMPOSE_DIR}"
      docker compose exec iot-security-backend \
        python scripts/simulate_alerts.py
    )
    ;;

  q|Q)
    echo "Bye."
    exit 0
    ;;

  *)
    echo "❌ Invalid option. Please run the script again and choose 1, 2, or q."
    exit 1
    ;;
esac

