"""Database configuration and session management."""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from zoltag.settings import settings


def get_engine_kwargs() -> dict:
    """Return SQLAlchemy engine kwargs with safe defaults for long-running jobs."""
    kwargs = {
        "pool_pre_ping": settings.db_pool_pre_ping,
        "pool_recycle": settings.db_pool_recycle,
        "pool_timeout": settings.db_pool_timeout,
        "pool_use_lifo": settings.db_pool_use_lifo,
    }

    # QueuePool sizing only applies to non-sqlite engines.
    if not settings.database_url.startswith("sqlite"):
        kwargs["pool_size"] = settings.db_pool_size
        kwargs["max_overflow"] = settings.db_max_overflow

    if settings.database_url.startswith("postgresql"):
        kwargs["connect_args"] = {
            "connect_timeout": settings.db_connect_timeout,
            "keepalives": settings.db_keepalives,
            "keepalives_idle": settings.db_keepalives_idle,
            "keepalives_interval": settings.db_keepalives_interval,
            "keepalives_count": settings.db_keepalives_count,
        }

    return kwargs


def build_engine():
    """Build a database engine using configured pool and connectivity options."""
    return create_engine(settings.database_url, **get_engine_kwargs())


# Create database engine
engine = build_engine()

# Create session factory
SessionLocal = sessionmaker(bind=engine)


def get_db():
    """Get database session for dependency injection."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
