# Ingestion & Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix BM25 ghosts and split-brain deletes; restructure ingestion on modern Qdrant/Neo4j clients.

**Architecture:** Thin `IngestionPipeline` over ingest→chunk→embed→index→evict; `MemoryCoordinator` owns eviction with receipts; `HybridRetriever.remove_document` ends caller rebuilds.

**Tech Stack:** Python, Qdrant 1.19 `query_points`, Neo4j driver 6.2, rank-bm25, numpy, FastAPI.

**Spec:** `2026-09-28_PLAN_INGESTION_MEMORY.md`

## Global Constraints

- No new vector DB.
- No async queue / Celery.
- No LLM-based entity extraction.
- No Python base-image jump.
- No LangChain v1 agent rewrite.
- Qdrant upgrade stepwise 1.11→1.15→1.17→1.19, never direct.
- Merge gates: `tests/test_ingestion.py` + `tests/test_retrieval.py` pass.

---

## File Structure

- `pipeline.py` — thin coordinator; evict delegates to `MemoryCoordinator`.
- `memory_coordinator.py` — NEW sole eviction owner; keys `disk/vector/graph/lexical`.
- `embedder.py` — NEW `Embedder` protocol + `DeterministicEmbedder` (tests only).
- `vector_store.py` — Qdrant I/O; `query_points`-only; `list[float]`; batched upserts.
- `graph_store.py` — NER + Neo4j writes; loud errors; `is_fallback` flag.
- `chunker.py` + `parsers/__init__.py` — parse-only in; overlap-window chunks out; `ParserError` on failure.
- `retrieval/bm25.py` + `hybrid.py` — own `remove_document` + `clear`.
- `rag_engine/app.py:600,689` — delete endpoints delegate to coordinator.

## Phase 0 — Correctness

### Task 1: BM25 remove_document

**Files:**
- Modify: `services/rag_engine/retrieval/bm25.py`
- Modify: `services/rag_engine/retrieval/hybrid.py`
- Test: `tests/test_ingestion.py`

**Interfaces:**
- Uses: `Chunk` model only.
- Produces: `def remove_document(self, doc_id: str) -> int` on `BM25Index` and `HybridRetriever`; `def clear(self) -> None` on `BM25Index`.

- [ ] **Step 1: Failing test**
```python
def test_bm25_remove():
    from packages.core.models import Chunk
    from services.rag_engine.retrieval.bm25 import BM25Index
    a = Chunk(id="a", document_id="d1", text="alpha zxq", chunk_index=0)
    b = Chunk(id="b", document_id="d2", text="beta qqp", chunk_index=0)
    i = BM25Index([a, b])
    assert i.remove_document("d1") == 1
    assert i.search("alpha zxq", top_k=2) == [] and len(i.search("beta qqp", top_k=2)) == 1
```
- [ ] **Step 2: Run test (expect FAIL)**
Run: `uv run python -m pytest tests/test_ingestion.py::test_bm25_remove -v`
Expected: FAIL (no `remove_document`)
- [ ] **Step 3: Implement**
```python
def remove_document(self, doc_id: str) -> int:
    k = [c for c in self.chunks if c.document_id != doc_id]
    n = len(self.chunks) - len(k)
    if n: self.chunks, self.chunk_map = k, {c.id: c for c in k}; self._build_index()
    return n
def clear(self) -> None:
    self.chunks = []; self.chunk_map = {}; self._corpus = []
    self._doc_lengths = []; self._df.clear(); self._avgdl = 0.0; self.bm25 = None
```
Hybrid mirrors filter, delegates to `bm25_index.remove_document`.
- [ ] **Step 4: Run test (expect PASS)**
Run: `uv run python -m pytest tests/test_ingestion.py::test_bm25_remove -v`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git commit -am "fix: BM25/Hybrid remove_document"
```

### Task 2: Single-eviction delete path

**Files:**
- Modify: `services/ingestion/pipeline.py:111-137`
- Modify: `services/rag_engine/app.py:600-690`
- Test: `tests/test_ingestion.py`

**Interfaces:**
- Uses: store `delete_*` methods.
- Produces: `def delete_document(self, doc_id: str) -> bool` (storage→vector→graph, raises on zero-eviction).

- [ ] **Step 1: Failing test**
```python
def test_evict_all():
    from packages.core.models import DocumentFormat
    from services.ingestion.pipeline import IngestionPipeline
    p = IngestionPipeline(in_memory=True)
    r = p.ingest_text(text="# T\nUNIQUEZXQ alpha", title="T", doc_format=DocumentFormat.MARKDOWN, source="t.md")
    assert p.delete_document(r["document_id"]) is True
    assert p.vector_store.get_chunks_by_document(r["document_id"]) == []
    assert p.graph_store._doc_entities.get(r["document_id"]) is None
```
- [ ] **Step 2: Run test (expect FAIL)**
Run: `uv run python -m pytest tests/test_ingestion.py::test_evict_all -v`
Expected: FAIL (stale state remains)
- [ ] **Step 3: Implement**
```python
def delete_document(self, doc_id: str) -> bool:
    if not self.storage.delete_document(doc_id): return False
    v = self.vector_store.delete_chunks_by_document(doc_id)
    g = self.graph_store.delete_by_document(doc_id)
    if v == 0 and g == 0: raise RuntimeError(doc_id)
    return True
```
`app.py`: both rebuild lines become `retriever.remove_document(doc_id)`.
- [ ] **Step 4: Run test (expect PASS)**
Run: `uv run python -m pytest tests/test_ingestion.py::test_evict_all -v`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git commit -am "fix: single eviction path"
```

**Phase 0 verification:** `uv run python -m pytest tests/test_ingestion.py tests/test_retrieval.py -q`

## Phase 1 — Restructure

### Task 3: MemoryCoordinator with receipts + health

**Files:**
- Create: `services/ingestion/memory_coordinator.py`
- Modify: `services/ingestion/pipeline.py`
- Modify: `services/rag_engine/app.py:600-690`
- Test: `tests/test_ingestion.py`

**Interfaces:**
- Uses: stores + `HybridRetriever.remove_document`.
- Produces: `def delete_document(self, doc_id: str) -> dict[str, int]`; `def clear_all(self) -> dict[str, int]`; `def health(self) -> dict[str, bool]`.

- [ ] **Step 1: Failing test**
```python
def test_coord_receipt():
    from packages.core.models import DocumentFormat
    from services.ingestion.pipeline import IngestionPipeline
    from services.ingestion.memory_coordinator import MemoryCoordinator
    p = IngestionPipeline(in_memory=True)
    d = p.ingest_text(text="# C\nCOORDZXQ", title="C", doc_format=DocumentFormat.MARKDOWN, source="c.md")
    r = MemoryCoordinator(p.storage, p.vector_store, p.graph_store).delete_document(d["document_id"])
    assert r["disk"] == 1 and r["vector"] >= 1
```
- [ ] **Step 2: Run test (expect FAIL)**
Run: `uv run python -m pytest tests/test_ingestion.py::test_coord_receipt -v`
Expected: FAIL (no module)
- [ ] **Step 3: Implement**
```python
class MemoryCoordinator:
    def __init__(self, storage, vector, graph, retriever=None):
        self.storage, self.vector, self.graph, self.retriever = storage, vector, graph, retriever
    def delete_document(self, doc_id):
        if not self.storage.delete_document(doc_id): return {"disk":0,"vector":0,"graph":0,"lexical":0}
        v = self.vector.delete_chunks_by_document(doc_id); g = self.graph.delete_by_document(doc_id)
        l = self.retriever.remove_document(doc_id) if self.retriever else 0
        if v == 0 and g == 0: raise RuntimeError(doc_id)
        return {"disk":1,"vector":v,"graph":g,"lexical":l}
    def clear_all(self):
        n = self.storage.clear_all(); self.vector.clear(); self.graph.clear_all_graph()
        if self.retriever: self.retriever.bm25_index.clear()
        return {"disk":n,"vector":n,"graph":n,"lexical":n}
    def health(self):
        v, g = self.vector.is_fallback, self.graph.is_fallback
        return {"vector_fallback":v,"graph_fallback":g,"healthy":not(v or g)}
```
Pipeline delegates to `self.coordinator`; fallback logs `error`.
- [ ] **Step 4: Run test (expect PASS)**
Run: `uv run python -m pytest tests/test_ingestion.py::test_coord_receipt -v`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add services/ingestion/memory_coordinator.py && git commit -am "feat: MemoryCoordinator receipts"
```

### Task 4: Parser errors + chunker overlap

**Files:**
- Modify: `services/ingestion/parsers/__init__.py:25-45`
- Modify: `services/ingestion/chunker.py:12-66`
- Test: `tests/test_ingestion.py`

**Interfaces:**
- Uses: `Document`, `pypdf`, `Chunk`.
- Produces: `class ParserError(ValueError)`; `def chunk(self, doc: Document) -> list[Chunk]` (overlap + intact fences).

- [ ] **Step 1: Failing test**
```python
def test_chunk_overlap():
    import pytest
    from packages.core.models import Document, DocumentFormat
    from services.ingestion.chunker import StructuralChunker
    from services.ingestion.parsers import parse_document, ParserError
    with pytest.raises(ParserError):
        parse_document(content=b"%PDF-corrupt", title="X", doc_format=DocumentFormat.PDF, source="x.pdf")
    d = Document(id="d1", title="T", text="word " * 400, source="t", format=DocumentFormat.MARKDOWN)
    ch = StructuralChunker(max_chunk_size=500, chunk_overlap=50).chunk(d)
    assert len(ch) >= 2 and ch[1].text[:50] in ch[0].text
```
- [ ] **Step 2: Run test (expect FAIL)**
Run: `uv run python -m pytest tests/test_ingestion.py::test_chunk_overlap -v`
Expected: FAIL (no `ParserError`)
- [ ] **Step 3: Implement**
```python
class ParserError(ValueError): pass
def parse_pdf(b: bytes) -> str:
    from pypdf import PdfReader
    try:
        r = PdfReader(io.BytesIO(b))
        if not r.pages: raise ParserError("no pages")
    except ParserError: raise
    except Exception as e: raise ParserError(f"PDF failed: {e}") from e
    t = "\n\n".join(f"## Page {i+1}\n{(p.extract_text() or '')}" for i, p in enumerate(r.pages)).strip()
    if not t: raise ParserError("PDF empty")
    return t
```
Chunker: on flush keep `current_lines = [tail[-self.chunk_overlap:]]`; never split inside fences.
- [ ] **Step 4: Run test (expect PASS)**
Run: `uv run python -m pytest tests/test_ingestion.py::test_chunk_overlap -v`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git commit -am "feat: ParserError plus chunk overlap"
```

**Phase 1 verification:** `uv run python -m pytest tests/test_ingestion.py tests/test_retrieval.py -q && uv run ruff check services/ingestion`

## Phase 2 — Modern upgrades

### Task 5: Modern client floors (Qdrant + Neo4j)

**Files:**
- Modify: `services/ingestion/vector_store.py:160-208`
- Modify: `pyproject.toml:15-16`
- Modify: `docker-compose.yml:21`
- Test: `tests/test_ingestion.py`

**Interfaces:**
- Uses: `QdrantClient`, `GraphDatabase`.
- Produces: `def search(self, query: str, top_k: int = 5) -> list[SearchResult]` (no `client.search`); `neo4j>=6.2` floor.

- [ ] **Step 1: Failing tests**
```python
def test_qdrant_only():
    import inspect
    from services.ingestion.vector_store import VectorStoreManager
    src = inspect.getsource(VectorStoreManager.search).replace("def search(", "")
    assert ".query_points(" in src and ".search(" not in src
def test_neo4j_floor():
    import re
    m = re.search(r"neo4j>=([\d.]+)", open("pyproject.toml").read())
    assert m and tuple(map(int, m.group(1).split("."))) >= (6, 2)
```
- [ ] **Step 2: Run tests (expect FAIL)**
Run: `uv run python -m pytest tests/test_ingestion.py::test_qdrant_only tests/test_ingestion.py::test_neo4j_floor -v`
Expected: FAIL (legacy branch; floor 5.18)
- [ ] **Step 3: Implement**
```python
qv: list[float] = list(generate_embedding(query, dim=self.dim))
hits = getattr(self.client.query_points(collection_name=self.collection_name, query=qv, limit=top_k), "points", None) or []
```
Floors `qdrant-client>=1.15.0`, `neo4j>=6.2` + `uv lock`; `PointStruct(vector=list(chunk.embedding))`; keep server pin; fallback logs `error`.
- [ ] **Step 4: Run tests (expect PASS)**
Run: `uv run python -m pytest tests/test_ingestion.py::test_qdrant_only tests/test_ingestion.py::test_neo4j_floor -v`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git commit -am "feat: client floors qdrant plus neo4j"
```

### Task 6: Embedder protocol, stub quarantined

**Files:**
- Create: `services/ingestion/embedder.py`
- Modify: `services/ingestion/vector_store.py:32-51,125-131`
- Test: `tests/test_ingestion.py`

**Interfaces:**
- Uses: `numpy`, `zlib`, `Chunk.embedding`.
- Produces: `DeterministicEmbedder(dim=1024)`; `Embedder.embed(list[str]) -> list[list[float]]`; `VectorStoreManager(..., embedder=None)`.

- [ ] **Step 1: Failing test**
```python
def test_embedder():
    from services.ingestion.embedder import DeterministicEmbedder
    e = DeterministicEmbedder(dim=64)
    v1, v2 = e.embed(["hello world"])[0], e.embed(["hello world"])[0]
    assert len(v1) == 64 and v1 == v2 and abs(sum(x * x for x in v1) ** 0.5 - 1.0) < 1e-5
```
- [ ] **Step 2: Run test (expect FAIL)**
Run: `uv run python -m pytest tests/test_ingestion.py::test_embedder -v`
Expected: FAIL (no module)
- [ ] **Step 3: Implement**
```python
import numpy as np, zlib
from typing import Protocol
class Embedder(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...
class DeterministicEmbedder:
    def __init__(self, dim=1024): self.dim = dim
    def embed(self, texts):
        out = []
        for t in texts:
            v = np.zeros(self.dim, dtype=np.float32)
            for i, tok in enumerate(t.lower().split()): v[zlib.crc32(tok.encode()) % self.dim] += 1.0 / (i + 1.0)
            n = float(np.linalg.norm(v)); out.append((v / n).tolist() if n > 0 else v.tolist())
        return out
```
Store uses `self.embedder.embed(...)`, drops tuple helper, keeps `list[float]`.
- [ ] **Step 4: Run test (expect PASS)**
Run: `uv run python -m pytest tests/test_ingestion.py::test_embedder -v`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add services/ingestion/embedder.py && git commit -am "feat: Embedder protocol"
```

**Phase 2 verification:** `uv lock --check && uv run python -m pytest tests/test_ingestion.py -q`

## Phase 3 — Hardening

### Task 7: Batched upserts + bounded embed cache

**Files:**
- Modify: `services/ingestion/vector_store.py:125-158`
- Modify: `services/ingestion/embedder.py`
- Test: `tests/test_ingestion.py`

**Interfaces:**
- Uses: Task 6 `Embedder`, Qdrant `upsert`.
- Produces: `def index_chunks(self, chunks: list[Chunk], batch_size: int = 128) -> int`; `DeterministicEmbedder(dim, cache_size: int = 1000)`.

- [ ] **Step 1: Failing test**
```python
def test_batch_index():
    from packages.core.models import Chunk
    from services.ingestion.vector_store import VectorStoreManager
    vs = VectorStoreManager(in_memory=True)
    ch = [Chunk(id=f"c{i}", document_id="d-big", text=f"bulk token {i}", chunk_index=i) for i in range(300)]
    assert vs.index_chunks(ch, batch_size=128) == 300 and len(vs.get_chunks_by_document("d-big")) == 300
```
- [ ] **Step 2: Run test (expect FAIL)**
Run: `uv run python -m pytest tests/test_ingestion.py::test_batch_index -v`
Expected: FAIL (no kwarg)
- [ ] **Step 3: Implement**
```python
def index_chunks(self, chunks, batch_size=128):
    for c, v in zip(chunks, self.embedder.embed([c.text for c in chunks])):
        c.embedding = v; self._memory_chunks[c.id] = c; self._memory_vectors[c.id] = np.array(v, dtype=np.float32)
    if self._qdrant_available and self.client is not None:
        for i in range(0, len(chunks), batch_size):
            self.client.upsert(collection_name=self.collection_name, points=[self._to_point(c) for c in chunks[i:i+batch_size]])
    return len(chunks)
```
`DeterministicEmbedder`: `@lru_cache(maxsize=cache_size)` on `_embed_one(text)`.
- [ ] **Step 4: Run test (expect PASS)**
Run: `uv run python -m pytest tests/test_ingestion.py::test_batch_index -v`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git commit -am "perf: batched upserts"
```

### Task 8: Large-doc guard + snapshot boot

**Files:**
- Modify: `services/ingestion/pipeline.py:33-61`
- Modify: `services/ingestion/storage.py`
- Test: `tests/test_ingestion.py`

**Interfaces:**
- Uses: `DocumentStorageManager`, `StructuralChunker`.
- Produces: `def ingest_document(self, doc: Document, persist: bool = True, max_chars: int = 200000) -> dict[str, Any]` (raises `ValueError`); `def load_persisted_knowledge_base(self) -> int` (snapshot, no re-extract loop).

- [ ] **Step 1: Failing test**
```python
def test_large_doc():
    import pytest
    from packages.core.models import Document, DocumentFormat
    from services.ingestion.pipeline import IngestionPipeline
    big = Document(id="d-big", title="B", text="x" * 200001, source="b", format=DocumentFormat.MARKDOWN)
    with pytest.raises(ValueError): IngestionPipeline(in_memory=True).ingest_document(big)
```
- [ ] **Step 2: Run test (expect FAIL)**
Run: `uv run python -m pytest tests/test_ingestion.py::test_large_doc -v`
Expected: FAIL (no ValueError)
- [ ] **Step 3: Implement**
```python
def ingest_document(self, doc, persist=True, max_chars=200000):
    if len(doc.text) > max_chars: raise ValueError(f"Document {doc.id} exceeds {max_chars} chars")
    chunks = self.chunker.chunk(doc)
    ...
def load_persisted_knowledge_base(self) -> int:
    ch = self.storage.load_all_chunks()
    if ch: self.vector_store.index_chunks(ch)
    snap = self.storage.load_graph_snapshot()
    if snap: self.graph_store.restore_snapshot(snap["entities"], snap["relationships"])
    return len(self.storage.list_documents())
```
`storage.py`: persist `graph_snapshot.json`; add `load_graph_snapshot()` + `restore_snapshot()`.
- [ ] **Step 4: Run test (expect PASS)**
Run: `uv run python -m pytest tests/test_ingestion.py::test_large_doc -v`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git commit -am "feat: doc guard plus snapshot boot"
```

**Phase 3 verification:** `uv run python -m pytest tests/test_ingestion.py -q && uv run ruff check services/ingestion && uv run mypy services/ingestion --ignore-missing-imports`

## Self-Review

- Coverage: ghosts/eviction→T1–T3; fallback→T3; parser/chunker→T4; clients→T5; Embedder→T6; batching→T7; snapshot→T8. Graph split deferred.
- Placeholders: none; every step has test, impl, pytest command, commit.
- Types: `remove_document(str) -> int` both; receipt keys `disk/vector/graph/lexical`; `embed(list[str]) -> list[list[float]]`; `index_chunks(..., batch_size=128)`; vectors `list[float]` after T6.
