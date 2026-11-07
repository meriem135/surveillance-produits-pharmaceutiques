# ══════════════════════════════════════════════════════════════════════════
# [RÔLE DU FICHIER] backend/app/core/config.py
#   CONFIGURATION. Tous les réglages de l'application (base de données, secret JWT, compte
#   admin, MQTT, CORS), lus dans backend/.env.
# ══════════════════════════════════════════════════════════════════════════
import os
from pydantic_settings import BaseSettings, SettingsConfigDict

# ──────────────────────────────────────────────────────────────────────
# [EN BREF] Settings
#   Rôle   : TOUS LES RÉGLAGES de l'application, lus dans backend/.env ou les variables d'environnement :
#            base de données, secret JWT, compte admin, MQTT, CORS…
# ──────────────────────────────────────────────────────────────────────
class Settings(BaseSettings):
    """
    Application settings powered by Pydantic Settings
    Loads from environment variables or .env file
    """
    APP_NAME: str = "PeakSoft Security Platform"
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
    
    # OpenSearch/Wazuh Configuration
    OPENSEARCH_URL: str = os.getenv("OPENSEARCH_URL", "https://localhost:9200")
    OPENSEARCH_USERNAME: str = os.getenv("OPENSEARCH_USERNAME", "admin")
    OPENSEARCH_PASSWORD: str = os.getenv("OPENSEARCH_PASSWORD", "admin")

    # Compte administrateur créé au démarrage s'il n'existe aucun admin
    # (l'inscription publique ne crée que des opérateurs).
    ADMIN_USERNAME: str = "admin"
    ADMIN_EMAIL: str = "admin@peaksoft.local"
    ADMIN_PASSWORD: str = ""

    # Service d'ingestion (désactivable quand le broker n'est pas présent)
    ENABLE_MQTT: bool = True
    # Simulateur edge : publie le flux saisonnier sur le broker MQTT (démo Industrie 4.0)
    ENABLE_EDGE_SIMULATOR: bool = False

    # MQTT Configuration
    MQTT_BROKER_URL: str = os.getenv("MQTT_BROKER_URL", "localhost")
    MQTT_BROKER_PORT: int = int(os.getenv("MQTT_BROKER_PORT", 1883))
    MQTT_USERNAME: str = os.getenv("MQTT_USERNAME", "admin")
    MQTT_PASSWORD: str = os.getenv("MQTT_PASSWORD", "public")

    # API base URL (for internal self-calls)
    API_BASE_URL: str = os.getenv("API_BASE_URL", "http://localhost:8000/api/v1")

    # Origines autorisées par CORS, séparées par des virgules (lue depuis .env ou l'environnement)
    CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True
    )

settings = Settings()
