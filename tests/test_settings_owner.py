def test_reader_returns_no_secrets():
    from services.rag_engine.app import get_active_llm_config
    cfg = get_active_llm_config()
    assert set(cfg) <= {"provider", "model", "base_url"}
