# services/ — Intégrations externes

| Fichier | Rôle |
|---------|------|
| `mqtt_service.py` | Connexion broker MQTT (capteurs IoT) |
| `modbus_service.py` | Simulation/polling Modbus |
| `realtime_service.py` | WebSocket manager pour temps réel |
| `wazuh_service.py` | Intégration Wazuh SIEM |
| `seasonal_adjustment.py` | Ajustement saisonnier des données |

Tous les services sont démarrés dans `main.py` via le `lifespan`.
