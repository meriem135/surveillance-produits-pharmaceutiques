"""Configuration : les variables documentées dans .env.example sont acceptées."""
from app.core.config import Settings


def test_cors_origins_from_env_file(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    # ENABLE_MQTT : variable d'un ancien .env, ignorée sans faire échouer le démarrage
    env.write_text("CORS_ORIGINS=https://exemple.fr,http://localhost:5173\nENABLE_MQTT=false\n", encoding="utf-8")
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    s = Settings(_env_file=env)
    assert s.CORS_ORIGINS.split(",") == ["https://exemple.fr", "http://localhost:5173"]
    assert not hasattr(s, "ENABLE_MQTT")
