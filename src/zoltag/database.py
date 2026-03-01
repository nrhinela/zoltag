"""Database configuration and session management."""

import uuid as _uuid

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from zoltag.settings import settings


def _patch_uuid_for_sqlite():
    """
    Monkey-patch SQLAlchemy's PostgreSQL UUID type so it stores as TEXT on SQLite.

    UUID(as_uuid=True) normally calls value.hex in its bind_processor, which
    fails on SQLite (where the column is stored as TEXT). We override
    bind_processor and result_processor for the sqlite dialect.
    """
    from sqlalchemy.dialects.postgresql import UUID as PgUUID

    _original_bind = PgUUID.bind_processor

    def _patched_bind(self, dialect):
        if dialect.name == "sqlite":
            def process(value):
                if value is None:
                    return None
                if isinstance(value, _uuid.UUID):
                    return str(value)
                return str(value) if value else None
            return process
        return _original_bind(self, dialect)

    _original_result = PgUUID.result_processor

    def _patched_result(self, dialect, coltype):
        if dialect.name == "sqlite":
            def process(value):
                if value is None:
                    return None
                if isinstance(value, _uuid.UUID):
                    return value
                try:
                    return _uuid.UUID(str(value))
                except (ValueError, AttributeError):
                    return value
            return process
        return _original_result(self, dialect, coltype)

    PgUUID.bind_processor = _patched_bind
    PgUUID.result_processor = _patched_result


def _postgres_session_options() -> str:
    """Build Postgres session options for API/worker safety rails."""
    options: list[str] = []

    # Global guardrail: apply to all app sessions (API + worker).
    idle_timeout_ms = int(settings.db_idle_in_transaction_session_timeout_ms or 0)

    # Worker mode can override idle timeout and adds tighter statement/lock limits.
    if settings.worker_mode:
        worker_idle_timeout_ms = int(settings.worker_db_idle_in_transaction_session_timeout_ms or 0)
        if worker_idle_timeout_ms > 0:
            idle_timeout_ms = worker_idle_timeout_ms
        if settings.worker_db_statement_timeout_ms > 0:
            options.append(f"-c statement_timeout={int(settings.worker_db_statement_timeout_ms)}")
        if settings.worker_db_lock_timeout_ms > 0:
            options.append(f"-c lock_timeout={int(settings.worker_db_lock_timeout_ms)}")

    if idle_timeout_ms > 0:
        options.append(
            "-c idle_in_transaction_session_timeout="
            f"{idle_timeout_ms}"
        )
    return " ".join(options).strip()


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
        connect_args = {
            "connect_timeout": settings.db_connect_timeout,
            "keepalives": settings.db_keepalives,
            "keepalives_idle": settings.db_keepalives_idle,
            "keepalives_interval": settings.db_keepalives_interval,
            "keepalives_count": settings.db_keepalives_count,
        }
        session_options = _postgres_session_options()
        if session_options:
            connect_args["options"] = session_options
        kwargs["connect_args"] = connect_args

    return kwargs


def build_engine():
    """Build a database engine using configured pool and connectivity options."""
    return create_engine(settings.database_url, **get_engine_kwargs())


# Create database engine
engine = build_engine()

# Register SQLite compatibility shims when running in local/desktop mode.
if settings.database_url.startswith("sqlite"):
    _patch_uuid_for_sqlite()

# Create session factory
SessionLocal = sessionmaker(bind=engine)


def get_db():
    """Get database session for dependency injection."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
