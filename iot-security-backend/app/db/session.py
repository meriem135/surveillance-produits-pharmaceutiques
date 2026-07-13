import os
import socket
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlmodel import SQLModel
from app.core.config import settings

def is_postgres_running(host="localhost", port=5432):
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False

database_url = settings.DATABASE_URL
engine_kwargs = {}

# Parse host and port from postgres url
db_host = "localhost"
db_port = 5432
if "@" in database_url:
    try:
        host_port = database_url.split("@")[1].split("/")[0]
        if ":" in host_port:
            db_host, db_port = host_port.split(":")
            db_port = int(db_port)
        else:
            db_host = host_port
    except Exception:
        pass

# Check if PostgreSQL is specified but NOT running on host
if "postgresql" in database_url and not is_postgres_running(db_host, db_port):
    db_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "Data", "Processed")
    os.makedirs(db_dir, exist_ok=True)
    sqlite_db_path = os.path.join(db_dir, "iot_security.db")
    database_url = f"sqlite+aiosqlite:///{sqlite_db_path}"
    print(f"[!] PostgreSQL not running. DB path: {sqlite_db_path}")
    print(f"[!] DB exists: {os.path.exists(sqlite_db_path)}")
else:
    engine_kwargs = {
        "pool_size": 10,
        "max_overflow": 20,
        "pool_pre_ping": True,
        "pool_recycle": 3600,
    }

# Create async engine with connection pooling or SQLite connection
engine = create_async_engine(
    database_url,
    echo=False,
    **engine_kwargs
)

# Create async session factory
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for getting async database sessions"""
    async with AsyncSessionLocal() as session:
        yield session

async def init_db():
    """Initialize database tables"""
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)

async def close_db():
    """Close database connections"""
    await engine.dispose()
