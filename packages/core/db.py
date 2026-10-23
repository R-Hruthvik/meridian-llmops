"""Database connection engine and session provider using SQLAlchemy 2.0 async session."""

from collections.abc import AsyncGenerator

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from packages.core.config import get_settings
from packages.core.retry_config import retry_on_connection_failure

settings = get_settings()


def create_engine_for(url: str):
    """Create a driver-aware async engine: NullPool for SQLite, pooled otherwise."""
    if url.startswith("sqlite"):
        return create_async_engine(
            url,
            poolclass=NullPool,
            connect_args={"timeout": 60, "check_same_thread": False},
        )
    return create_async_engine(url, pool_size=10, max_overflow=20, pool_pre_ping=True)


engine = create_engine_for(settings.database_url)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@retry_on_connection_failure(max_attempts=3)
async def init_db(url: str | None = None):
    """Initializes relational database schema."""
    from packages.core.db_models import Base
    target = create_engine_for(url) if url is not None else engine
    async with target.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_migrate_document_tenant)
    if url is not None:
        await target.dispose()


def _migrate_document_tenant(connection) -> None:
    """Add tenant ownership to pre-existing document tables."""
    columns = {column["name"] for column in inspect(connection).get_columns("documents")}
    if "tenant_id" not in columns:
        connection.execute(
            text("ALTER TABLE documents ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT 'default'")
        )


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency generator providing async database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
