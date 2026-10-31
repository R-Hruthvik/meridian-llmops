from scripts import chunk_report, ingest_folder, make_synthetic_corpus


class _Result:
    def __init__(self, filename, status="indexed", **values):
        self.filename = filename
        self.status = status
        self.format = values.get("format", "markdown")
        self.pages = values.get("pages", 0)
        self.chunks = values.get("chunks", 1)
        self.warnings = values.get("warnings", [])
        self.duplicate_of = values.get("duplicate_of")


def test_ingest_folder_reports_duplicates_and_returns_failure_for_bad_file(
    tmp_path, monkeypatch, capsys
):
    source = tmp_path / "inputs"
    source.mkdir()
    (source / "first.md").write_text("first", encoding="utf-8")
    (source / "duplicate.md").write_text("same", encoding="utf-8")
    (source / "broken.md").write_text("broken", encoding="utf-8")

    class Pipeline:
        def __init__(self, **_kwargs):
            pass

        def ingest_file(self, filename, _data, tenant_id):
            assert tenant_id == "tenant-a"
            if filename == "broken.md":
                raise RuntimeError("parse failed")
            if filename == "duplicate.md":
                return _Result(filename, "duplicate", duplicate_of="doc-existing")
            return _Result(filename, format="markdown", pages=0, chunks=2)

    _patch_pipeline_dependencies(monkeypatch, ingest_folder, Pipeline)
    code = ingest_folder.main([str(source), "--tenant", "tenant-a"])
    output = capsys.readouterr().out

    assert code == 1
    assert "duplicate.md" in output and "duplicate_of=doc-existing" in output
    assert "broken.md" in output and "parse failed" in output
    assert "Total        3" in output
    assert "Indexed chunks 2" in output


def test_isolated_storage_root_uses_persistent_qdrant_and_hash_duplicate(tmp_path, monkeypatch):
    class Settings:
        embedding_model = "test-model"
        fastembed_cache_path = "unused"
        qdrant_vector_dim = 8
        max_upload_mb = 1
        qdrant_collection = "persistent_ingest_test"
        vector_backend = "qdrant"
        qdrant_local_path = "unused"
        qdrant_host = "localhost"
        qdrant_port = 6333

    class Embedder:
        model_name = "test-model"
        dim = 8

        def __init__(self, *_args, **_kwargs):
            pass

        def embed_passages(self, texts):
            import numpy as np

            return np.tile(np.array([[1.0] + [0.0] * 7], dtype=np.float32), (len(texts), 1))

        def embed_query(self, _text):
            raise AssertionError("ingestion does not embed queries")

    monkeypatch.setattr(ingest_folder, "get_settings", lambda: Settings())
    monkeypatch.setattr("packages.core.settings.get_settings", lambda: Settings())
    monkeypatch.setattr(ingest_folder, "FastEmbedEmbedder", Embedder)
    root = tmp_path / "isolated"

    pipeline, client = ingest_folder.build_pipeline(root, None)
    assert pipeline.max_upload_bytes == 1024 * 1024
    first = pipeline.ingest_file("sample.md", b"# Heading\n\nPersistent vector passage.")
    assert pipeline.vector_store.count() == first.chunks
    client.close()

    reopened, client = ingest_folder.build_pipeline(root, None)
    duplicate = reopened.ingest_file("same-content.md", b"# Heading\n\nPersistent vector passage.")
    assert (root / "qdrant").is_dir()
    assert reopened.vector_store.count() == first.chunks
    assert duplicate.status == "duplicate"
    assert duplicate.duplicate_of == first.document_id
    client.close()


def test_chunk_report_prints_token_summary_texts_and_empty_pages(tmp_path, monkeypatch, capsys):
    source = tmp_path / "sample.md"
    source.write_text("# Title\n\nA short first passage.", encoding="utf-8")
    monkeypatch.setattr(chunk_report, "count_tokens", lambda value: len(value.split()))

    assert chunk_report.main([str(source)]) == 0
    output = capsys.readouterr().out
    assert "token counts: min=4 median=4 p95=4 max=4" in output
    assert "A short first passage." in output
    assert "pages covered: []" in output
    assert "empty pages: []" in output


def test_chunk_report_marks_pages_below_parser_text_threshold_empty(tmp_path, monkeypatch, capsys):
    from packages.core.models import DocumentFormat
    from services.ingestion.parsers.base import ParsedDocument, ParsedPage

    source = tmp_path / "sample.pdf"
    source.write_bytes(b"%PDF-test")
    parsed = ParsedDocument(
        title="sample",
        format=DocumentFormat.PDF,
        pages=[
            ParsedPage(number=1, text="short content"),
            ParsedPage(number=2, text="This page has enough extracted text."),
        ],
    )
    monkeypatch.setattr(chunk_report, "parse_file", lambda *_args, **_kwargs: parsed)

    assert chunk_report.main([str(source)]) == 0
    assert "empty pages: [1]" in capsys.readouterr().out


def test_chunk_report_loads_document_by_id_from_selected_storage(tmp_path, monkeypatch, capsys):
    from services.ingestion.storage import DocumentStorageManager

    storage = DocumentStorageManager(tmp_path)
    storage.meta_dir.joinpath("doc-1.json").write_text(
        '{"id":"doc-1","filename":"one.md","format":"markdown","source":"one.md",'
        '"original_path":"","tenant_id":"default"}',
        encoding="utf-8",
    )
    storage.chunks_dir.joinpath("doc-1.json").write_text(
        '[{"id":"c1","text":"retrievable text","chunk_index":0,"metadata":{}}]',
        encoding="utf-8",
    )
    assert chunk_report.main(["doc-1", "--storage-root", str(tmp_path)]) == 0
    assert "retrievable text" in capsys.readouterr().out


def test_synthetic_corpus_creates_at_least_200_files_in_multiple_formats(tmp_path):
    paths = make_synthetic_corpus.generate_corpus(tmp_path, count=200)

    assert len(paths) == 200
    assert {path.suffix for path in paths} >= {".md", ".txt", ".html"}
    assert all(path.stat().st_size > 0 for path in paths)


def _patch_pipeline_dependencies(monkeypatch, module, pipeline_class):
    class Settings:
        embedding_model = "test-model"
        fastembed_cache_path = "unused"
        qdrant_vector_dim = 3
        max_upload_mb = 25
        qdrant_collection = "test-collection"
        vector_backend = "qdrant_local"
        qdrant_local_path = ":memory:"
        qdrant_host = "localhost"
        qdrant_port = 6333

    class Embedder:
        dim = 3

        def __init__(self, *_args, **_kwargs):
            pass

    class Store:
        def __init__(self, *_args, **_kwargs):
            pass

        def ensure_collection(self):
            pass

    class Client:
        def __init__(self, *_args, **_kwargs):
            pass

        def close(self):
            pass

    monkeypatch.setattr(module, "get_settings", lambda: Settings())
    monkeypatch.setattr(module, "FastEmbedEmbedder", Embedder)
    monkeypatch.setattr(module, "QdrantClient", Client)
    monkeypatch.setattr(module, "QdrantChunkStore", Store)
    monkeypatch.setattr(module, "IngestionPipeline", pipeline_class)
