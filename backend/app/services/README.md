# services/ — Intégrations externes

| Fichier | Rôle |
|---------|------|
| `mqtt_service.py` | Abonnement `factory/+/telemetry`, agrégation des 3 capteurs par pas, DPI, persistance |
| `mqtt_simulator.py` | Simulateur edge : publie le flux saisonnier sur 3 topics (`ENABLE_EDGE_SIMULATOR`) |
| `modbus_service.py` | Polling Modbus TCP d'un automate (`ENABLE_MODBUS`) |
| `realtime_service.py` | Flux WebSocket `/ws/stream` : rejeu saisonnier + verdict DPI + score de risque |
| `realtime/feature_engineer.py` | Features multivariées temps réel (mêmes encodages que l'entraînement) |

Les services sont démarrés dans `main.py` via le `lifespan`, selon les options du `.env`.
