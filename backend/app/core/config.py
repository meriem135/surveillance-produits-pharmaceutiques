# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/core/config.py
#   CONFIGURATION. Tous les réglages de l'application (base de données, secret JWT, compte
#   admin, CORS), lus dans backend/.env.
# ══════════════════════════════════════════════════════════════════════════
import os
from pydantic_settings import BaseSettings, SettingsConfigDict

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] Settings
#   Rôle   : TOUS LES RÉGLAGES de l'application, lus dans backend/.env ou les variables d'environnement :
#            base de données, secret JWT, compte admin, CORS…
# ──────────────────────────────────────────────────────────────────────
class Settings(BaseSettings):
    """
    Application settings powered by Pydantic Settings
    Loads from environment variables or .env file
    """
    APP_NAME: str = "VigiloChain"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = False
    
    # API Configuration
    API_V1_STR: str = "/api/v1"
    
    # JWT secret (lue depuis .env ; os.getenv prend le dessus)
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "")
    
    # Database Configuration
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://iot_user:iot_secure_password@localhost:5432/iot_security"
    )
    
    # Compte administrateur créé au démarrage s'il n'existe aucun admin
    # (l'inscription publique ne crée que des opérateurs).
    ADMIN_USERNAME: str = "admin"
    ADMIN_EMAIL: str = "admin@peaksoft.local"
    ADMIN_PASSWORD: str = ""

    # API base URL (for internal self-calls)
    API_BASE_URL: str = os.getenv("API_BASE_URL", "http://localhost:8000/api/v1")

    # Origines autorisées par CORS, séparées par des virgules (lue depuis .env ou l'environnement)
    CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        # Un ancien .env peut encore contenir ENABLE_MQTT, MQTT_BROKER_URL… : on les ignore
        # au lieu de refuser de démarrer.
        extra="ignore",
    )

settings = Settings()
