# services/ — Intégrations externes

| Fichier | Rôle |
|---------|------|
| `mqtt_service.py` | Abonnement `factory/+/telemetry`, agrégation des 3 capteurs par pas, persistance |
| `mqtt_simulator.py` | Simulateur edge : publie le flux saisonnier sur 3 topics (`ENABLE_EDGE_SIMULATOR`) |

Les services sont démarrés dans `main.py` via le `lifespan`, selon les options du `.env`.
