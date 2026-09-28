def test_post_never_returns_raw_key():
    d = {"groq_api_key": "sk-SAVED-GROQ"}
    from services.rag_engine.app import masked_llm_view
    v = masked_llm_view(d)
    assert "sk-SAVED-GROQ" not in str(v)
    assert v["groq_api_key"]["configured"] is True
    assert v["groq_api_key"]["hint"] == "GROQ"
