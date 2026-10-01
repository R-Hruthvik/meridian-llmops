def test_prefs_file_is_0600_and_secretless(tmp_path):
    from packages.core.secrets_store import save_prefs
    p = tmp_path / "prefs.json"
    save_prefs(p, {"default_model": "gpt-4o-mini", "groq_api_key": "sk-X"})
    assert oct(p.stat().st_mode & 0o777) == "0o600"
    assert "groq_api_key" not in p.read_text()
