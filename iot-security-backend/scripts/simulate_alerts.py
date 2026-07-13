import os
import json
import uuid
from datetime import datetime
from opensearchpy import OpenSearch

# Configuration - same as Wazuh Cluster
HOST = 'wazuh1.indexer'
PORT = 9200
USER = 'admin'
PASSWORD = 'SecretPassword'

client = OpenSearch(
    hosts=[{'host': HOST, 'port': PORT}],
    http_compress=True,
    http_auth=(USER, PASSWORD),
    use_ssl=True,
    verify_certs=False,
    ssl_assert_hostname=False,
    ssl_show_warn=False,
)

def create_mock_alert(ip_address, level, description):
    """
    Creates a mock Wazuh alert in OpenSearch (Objective 7.1)
    """
    index_name = f"wazuh-alerts-4.x-{datetime.now().strftime('%Y.%m.%d')}"
    timestamp = datetime.now().strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + "+0000"
    
    alert = {
        "timestamp": timestamp,
        "@timestamp": datetime.now().strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + "Z",
        "rule": {
            "level": level,
            "description": description,
            "id": str(uuid.uuid4())[:8],
            "firedtimes": 1,
            "groups": ["iot"]
        },
        "agent": {
            "id": "001",
            "name": "iot-gateway"
        },
        "manager": {
            "name": "wazuh.master"
        },
        "cluster": {
            "name": "wazuh",
            "node": "master-node"
        },
        "data": {
            "srcip": ip_address,
            "protocol": "mqtt"
        },
        "decoder": {
            "name": "mqtt-decoder"
        },
        "location": "network-traffic"
    }

    try:
        client.index(index=index_name, body=alert, refresh=True)
        print(f"✅ Alert created for {ip_address} (Level {level}): {description}")
    except Exception as e:
        print(f"❌ Failed to create alert: {e}")

def create_protocol_alert(ip_address, log_string):
    """
    Creates a mock protocol alert (MQTT/Modbus/CoAP) in OpenSearch (Objective 7.2)
    """
    index_name = f"wazuh-alerts-4.x-{datetime.now().strftime('%Y.%m.%d')}"
    timestamp = datetime.now().strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + "+0000"
    
    # Simple logic to assign level based on protocol
    level = 10
    if "MQTT" in log_string and "admin" in log_string: level = 12
    elif "MODBUS" in log_string: level = 14
    
    alert = {
        "timestamp": timestamp,
        "@timestamp": datetime.now().strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + "Z",
        "full_log": log_string,
        "rule": {
            "level": level,
            "description": f"IoT Protocol Anomaly: {log_string.split()[0]}",
            "id": str(uuid.uuid4())[:8],
            "firedtimes": 1,
            "groups": ["iot"]
        },
        "agent": {
            "id": "001",
            "name": "industrial-gateway"
        },
        "manager": {
            "name": "wazuh.master"
        },
        "cluster": {
            "name": "wazuh",
            "node": "master-node"
        },
        "data": {
            "srcip": ip_address,
            "protocol": "industrial"
        },
        "decoder": {
            "name": "iot-protocol"
        },
        "location": "protocol-analysis"
    }

    try:
        client.index(index=index_name, body=alert, refresh=True)
        print(f"✅ Protocol Alert created for {ip_address}: {log_string}")
    except Exception as e:
        print(f"❌ Failed to create protocol alert: {e}")

if __name__ == "__main__":
    print("🚀 Simulating Global IoT Strategic Threats (Objectives 7.1 & 7.2)...")
    
    # --- Phase 1: Standard Attacks (7.1) ---
    create_mock_alert("192.168.1.102", 15, "Unauthorized RTSP stream access detected")
    create_mock_alert("192.168.1.102", 12, "Brute force attack on camera login")
    
    # --- Phase 2: Protocol Specific Attacks (7.2) ---
    # 1. MQTT Impersonation (Admin Topic Access)
    create_protocol_alert("192.168.1.105", "MQTT_PUB TOPIC:factory/system/admin PAYLOAD:REBOOT CLIENT:attacker-01")
    
    # 2. Modbus Industrial Sabotage
    create_protocol_alert("192.168.1.101", "MODBUS_CMD UNIT:1 FUNC:15 REG:40001 DATA:OFF")
    
    # 3. CoAP Reflection/Flooding
    create_protocol_alert("192.168.1.103", "COAP_REQ METHOD:PUT URI:/sensor/threshold PAYLOAD:100")
    
    print("\nCheck the Peaksoft Dashboard now! Risk Scores now include Protocol Analysis (7.2).")
