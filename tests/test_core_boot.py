def test_production_rejects_empty_key(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("API_KEY_SECRET", "")
    from packages.core.config import Settings, validate_production
    import pytest
    with pytest.raises(RuntimeError, match="API_KEY_SECRET"):
        validate_production(Settings())
