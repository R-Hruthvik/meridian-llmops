from scripts import retrieval_check
from tests.fakes import FakeEmbedder


def test_build_engine_parses_supported_files_and_scopes_the_requested_tenant(tmp_path, monkeypatch):
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "guide.html").write_text(
        "<html><body><h1>HTML Guide</h1><p>Qdrant parses this HTML passage.</p></body></html>",
        encoding="utf-8",
    )
    (docs / "notes.txt").write_text("Plain text passage for the corpus.", encoding="utf-8")
    (docs / "ignored.json").write_text('{"ignored": true}', encoding="utf-8")
    monkeypatch.setattr(retrieval_check, "FastEmbedEmbedder", lambda *_args, **_kwargs: FakeEmbedder())
    from packages.core.settings import Settings

    monkeypatch.setattr(
        "packages.core.settings.get_settings",
        lambda: Settings(_env_file=None, _secrets_dir=str(tmp_path)),
    )

    retriever, store = retrieval_check.build_engine(
        docs, tmp_path / "storage", FakeEmbedder.model_name, "unused-cache", tenant_id="benchmark"
    )

    chunks = store.get_all_chunks("benchmark")
    assert {chunk.metadata["source_format"] for chunk in chunks} == {"html", "txt"}
    assert {chunk.metadata["tenant_id"] for chunk in chunks} == {"benchmark"}
    html_chunk = next(chunk for chunk in chunks if chunk.metadata["source"] == "guide.html")
    assert "Qdrant parses this HTML passage." in html_chunk.text
    assert "<p>" not in html_chunk.text
    assert store.get_all_chunks("other-tenant") == []
    assert retriever.retrieve("HTML passage", tenant_id="benchmark").chunks
