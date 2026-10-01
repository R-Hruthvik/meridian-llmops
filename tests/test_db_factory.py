"""Driver-aware engine factory tests (Task 6)."""


def test_sqlite_factory_has_no_pool_size():
    from packages.core.db import create_engine_for
    e = create_engine_for("sqlite+aiosqlite:///./t.db")
    assert "pool_size" not in str(e.url)


def test_sqlite_factory_uses_null_pool():
    from sqlalchemy.pool import NullPool

    from packages.core.db import create_engine_for
    e = create_engine_for("sqlite+aiosqlite:///./t.db")
    assert isinstance(e.pool, NullPool)
