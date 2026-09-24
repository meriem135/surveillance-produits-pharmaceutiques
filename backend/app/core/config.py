import os
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    """
    Application settings powered by Pydantic Settings
    Loads from environment variables or .env file
    """
    APP_NAME: str = "IoT Security Service"
    APP_VERSION: str = "1.0.0"
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

    # MQTT Configuration
    MQTT_BROKER_URL: str = os.getenv("MQTT_BROKER_URL", "mosquitto")
    MQTT_BROKER_PORT: int = int(os.getenv("MQTT_BROKER_PORT", 1883))
    MQTT_USERNAME: str = os.getenv("MQTT_USERNAME", "admin")
    MQTT_PASSWORD: str = os.getenv("MQTT_PASSWORD", "public")

    # Modbus Configuration
    MODBUS_HOST: str = os.getenv("MODBUS_HOST", "modbus-simulator")
    MODBUS_PORT: int = int(os.getenv("MODBUS_PORT", 5020))
    MODBUS_POLLING_INTERVAL: int = int(os.getenv("MODBUS_POLLING_INTERVAL", 30))

    # Ollama LLM Configuration
    OLLAMA_URL: str = os.getenv("OLLAMA_URL", "http://localhost:11434")
    OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "phi:2.7b")
    # Modèle utilisé pour le rapport simple par ligne de dataset (option B)
    POINT_REPORT_MODEL: str = os.getenv("POINT_REPORT_MODEL", "qwen2.5:3b")

    # API base URL (for internal self-calls)
    API_BASE_URL: str = os.getenv("API_BASE_URL", "http://localhost:8000/api/v1")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True
    )

settings = Settings()
