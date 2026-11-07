# Domaines métier

Chaque dossier correspond à un domaine fonctionnel de la plateforme :

| Dossier | Rôle | Fichiers principaux |
|---------|------|---------------------|
| `ml/` | Features de base des capteurs, progression d'entraînement | `features.py`, `progress.py` |
| `intelligence/` | Score de risque (criticité, tendance) | `risk_service.py` |
| `devices/` | Gestion des équipements IoT & télémétrie | `service.py`, `repository.py` |
| `auth/` | Authentification JWT & audit | `service.py`, `models.py`, `audit.py` |
