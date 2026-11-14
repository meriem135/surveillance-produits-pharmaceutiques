import os
import sys
from pathlib import Path

os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
# Adresse factice : la connexion n'est jamais ouverte, chaque test crée sa propre base temporaire en mémoire.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
