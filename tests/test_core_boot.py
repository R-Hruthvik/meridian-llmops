def test_production_rejects_empty_key(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("API_KEY_SECRET", "")
    from packages.core.config import Settings, validate_production
    import pytest
    with pytest.raises(RuntimeError, match="API_KEY_SECRET"):
        validate_production(Settings())


def test_production_rejects_empty_litellm_key(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("API_KEY_SECRET", "real-prod-secret")
    monkeypatch.setenv("LITELLM_MASTER_KEY", "")
    from packages.core.config import Settings, validate_production
    import pytest
    with pytest.raises(RuntimeError, match="LITELLM_MASTER_KEY"):
        validate_production(Settings())


def test_production_rejects_test_default_secrets(monkeypatch):
    import pytest
    from packages.core.config import Settings, validate_production
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("API_KEY_SECRET", "meridian-test-secret-key-2026")
    monkeypatch.setenv("LITELLM_MASTER_KEY", "real-prod-secret")
    with pytest.raises(RuntimeError, match="API_KEY_SECRET"):
        validate_production(Settings())
    monkeypatch.setenv("API_KEY_SECRET", "real-prod-secret")
    monkeypatch.setenv("LITELLM_MASTER_KEY", "sk-litellm-master-key")
    with pytest.raises(RuntimeError, match="LITELLM_MASTER_KEY"):
        validate_production(Settings())
    monkeypatch.setenv("LITELLM_MASTER_KEY", "changeme")
    with pytest.raises(RuntimeError, match="LITELLM_MASTER_KEY"):
        validate_production(Settings())


def test_non_production_never_raises(monkeypatch):
    from packages.core.config import Settings, validate_production
    for env in ("development", "testing", ""):
        monkeypatch.setenv("APP_ENV", env)
        monkeypatch.setenv("API_KEY_SECRET", "")
        monkeypatch.setenv("LITELLM_MASTER_KEY", "")
        validate_production(Settings())
