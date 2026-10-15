import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from packages.core.db import create_engine_for, init_db


@pytest.mark.asyncio
async def test_init_db_adds_tenant_id_to_existing_documents(tmp_path):
    database = tmp_path / "legacy.sqlite"
    url = f"sqlite+aiosqlite:///{database}"
    legacy_engine = create_async_engine(url)
    async with legacy_engine.begin() as connection:
        await connection.execute(
            text(
                "CREATE TABLE documents (id VARCHAR(36) PRIMARY KEY, title VARCHAR(255) NOT NULL, "
                "file_type VARCHAR(50) NOT NULL, source_uri VARCHAR(512), "
                "processing_status VARCHAR(50), created_at DATETIME)"
            )
        )
        await connection.execute(
            text(
                "INSERT INTO documents (id, title, file_type, processing_status) "
                "VALUES ('legacy', 'Legacy', 'md', 'processed')"
            )
        )
    await legacy_engine.dispose()

    await init_db(url)

    migrated_engine = create_engine_for(url)
    async with migrated_engine.connect() as connection:
        tenant_id = await connection.scalar(
            text("SELECT tenant_id FROM documents WHERE id = 'legacy'")
        )
    await migrated_engine.dispose()

    assert tenant_id == "default"
