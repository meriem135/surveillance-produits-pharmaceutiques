# devices/ — Gestion des équipements IoT

| Fichier | Rôle |
|---------|------|
| `models.py` | Modèle SQLAlchemy : `Device`, `Telemetry` |
| `schemas.py` | Schémas Pydantic pour l'API |
| `repository.py` | Accès DB (DeviceRepository, TelemetryRepository) |
| `service.py` | Logique métier : CRUD + scoring + historique |

### Flux
```
API → DeviceService → DeviceRepository → DB
                   → TelemetryRepository
                   → IntelligenceService (ml)
```
