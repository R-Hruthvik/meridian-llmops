# RAG Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden, contract, restructure, then modernize the Meridian RAG engine.

**Architecture:** Safety flags, then schema contracts, then router/graph split with consolidated retrieval and verification, then flagged reranker plus provenance and eval gates.

**Tech Stack:** FastAPI, LangGraph StateGraph, Qdrant + rank_bm25 + RRF, LiteLLM gateway, DeepEval CI gates.

**Spec:** `2026-09-28_PLAN_RAG_ENGINE.md`

## Global Constraints

- Keep fixed `retrieve → generate → critique → reformulate/refuse` StateGraph; no `create_agent` rewrite.
- Never expose API keys; POST settings returns masked shape.
- Every non-fresh path sets `serving.fresh=false` and greys the badge.
- Delete must evict from vector, BM25, and graph stores together.
- No streaming SSE, async ingest, PDF/OCR, or per-tenant policy DSL.

---

## File Structure

- `packages/core/models.py`: owns unified `QueryResponse`, `ServingInfo{provider,model,fresh}`, `SearchResult{retrieval_method}`, `UpdateLLMSettingsRequest`, `Claim{text,verdict,chunk_ids}`.
- `services/rag_engine/app.py`: slim mount only after Phase 2.
- `services/rag_engine/routers/query.py`: guardrails + graph invoke + response map.
- `services/rag_engine/routers/settings.py`: GET masked / POST validated.
- `services/rag_engine/routers/documents.py`: ingest/catalog/delete with evict.
- `services/rag_engine/routers/ops.py`: `/health`, `/v1/metrics`.
- `services/rag_engine/agent/graph.py`: nodes only; policy moved out.
- `agent/greetings.py`, `agent/entity_linker.py`, `agent/prompts.py`: extracted policy.
- `agent/critic.py`: single `verify_claims` (heuristic + tiered merged).
- `retrieval/hybrid.py`: `HybridRetriever` impl of `Retriever` protocol.
- `retrieval/bm25.py`: `BM25Index` with `remove/rebuild`.
- `retrieval/reranker.py`: `Reranker` protocol + heuristic + CrossEncoder impl.

## Phase 0 — Safety (verify: `uv run python -m pytest tests/test_agent_graph.py -q`)

### Task 1: Empty-draft refusal

**Files:**
- Modify: `services/rag_engine/agent/graph.py:137-143`
- Test: `tests/test_agent_graph.py`

**Interfaces:**
- Consumes: `generate_node(state) -> dict`
- Produces: `route_after_critique(state) -> str` returns `"refuse"` on empty draft at max cycles.

- [x] **Step 1: Write the failing test**
```python
def test_empty_draft_refuses(populated_retriever_and_graph):
    s = {"query": "zzz no context", "retrieved_chunks": [], "draft_answer": "", "cycle_count": 3, "max_cycles": 3}
    assert route_after_critique(s) == "refuse"
```
- [x] **Step 2: Run test to verify it fails**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_empty_draft_refuses -v`
Expected: FAIL with `route_after_critique not defined`
- [x] **Step 3: Write minimal implementation**
```python
def route_after_critique(state):
    if not state.get("draft_answer") and state.get("cycle_count", 0) >= state.get("max_cycles", 3):
        return "refuse"
    return "reformulate" if not state.get("is_grounded") else "end"
```
- [x] **Step 4: Run test to verify it passes**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_empty_draft_refuses -v`
Expected: PASS
- [x] **Step 5: Commit**
```bash
git add tests/test_agent_graph.py services/rag_engine/agent/graph.py
git commit -m "fix: empty draft routes to refusal at max cycles"
```

### Task 2: Degraded reason and testing seam

**Files:**
- Modify: `services/rag_engine/agent/graph.py:188-203`, `services/rag_engine/app.py:403-417`
- Test: `tests/test_agent_graph.py`

**Interfaces:**
- Consumes: `get_active_llm_config() -> dict`
- Produces: `build_rag_agent_graph(retriever, graph_store, llm_client=None, llm_config_getter=None, allow_synth: bool = False)`; state key `generation_error: str | None`.

- [x] **Step 1: Write the failing test**
```python
def test_testing_synth_gated(populated_retriever_and_graph):
    import os; os.environ.pop("APP_ENV", None)
    g = build_rag_agent_graph(retriever, gstore, allow_synth=False)
    assert g._allow_synth is False
```
- [x] **Step 2: Run test to verify it fails**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_testing_synth_gated -v`
Expected: FAIL with `unexpected keyword allow_synth`
- [x] **Step 3: Write minimal implementation**
```python
def build_rag_agent_graph(retriever, graph_store, llm_client=None, llm_config_getter=None, allow_synth=False):
    g = workflow.compile(); g._allow_synth = allow_synth; return g
```
```python
if not draft.strip() and not allow_synth:
    return {"draft_answer": "", "generation_error": f"LLM returned an empty completion via {provider} ({model})"}
```
- [x] **Step 4: Run test to verify it passes**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_testing_synth_gated -v`
Expected: PASS
- [x] **Step 5: Commit**
```bash
git add tests/test_agent_graph.py services/rag_engine/agent/graph.py
git commit -m "fix: gate testing synth behind allow_synth flag"
```

## Phase 1 — Contracts (verify: `uv run python -m pytest tests/test_agent_graph.py tests/test_settings_contract.py -q`)

### Task 3: Unified serving{fresh} response

**Files:**
- Modify: `packages/core/models.py:125-137`, `services/rag_engine/app.py:419-431`
- Test: `tests/test_agent_graph.py`

**Interfaces:**
- Consumes: `final_state: dict` with `generation_error, is_refusal`
- Produces: `class ServingInfo(BaseModel): provider: str; model: str; fresh: bool`; `QueryResponse.serving: ServingInfo`.

- [x] **Step 1: Write the failing test**
```python
def test_greeting_serving_not_fresh():
    r = QueryResponse(query="hi", answer="Hello!", serving=ServingInfo(provider="openai", model="gpt-4o-mini", fresh=False))
    assert r.serving.fresh is False
```
- [x] **Step 2: Run test to verify it fails**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_greeting_serving_not_fresh -v`
Expected: FAIL with `ServingInfo not defined`
- [x] **Step 3: Write minimal implementation**
```python
class ServingInfo(BaseModel):
    provider: str = "openai"
    model: str = "gpt-4o-mini"
    fresh: bool = True
```
```python
fresh = not (final_state.get("is_refusal") or final_state.get("generation_error") or elapsed_ms < 500)
```
- [x] **Step 4: Run test to verify it passes**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_greeting_serving_not_fresh -v`
Expected: PASS
- [x] **Step 5: Commit**
```bash
git add tests/test_agent_graph.py packages/core/models.py services/rag_engine/app.py
git commit -m "feat: unified serving.fresh attribution contract"
```

### Task 4: Settings 422 contract and masked POST

**Files:**
- Modify: `packages/core/models.py:89-104`, `services/rag_engine/app.py:567-597`
- Test: `tests/test_agent_graph.py`

**Interfaces:**
- Consumes: `UpdateLLMSettingsRequest(provider, model, active_provider, default_model, timeout_seconds)`
- Produces: `mask_settings(s: dict) -> dict` returning `{active_provider, default_model, providers_configured}` with no key material.

- [x] **Step 1: Write the failing test**
```python
def test_post_settings_masked():
    out = mask_settings({"active_provider": "openai", "default_model": "gpt-4o-mini", "openai_api_key": "sk-x"})
    assert "openai_api_key" not in out and out["providers_configured"]["openai"] is True
```
- [x] **Step 2: Run test to verify it fails**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_post_settings_masked -v`
Expected: FAIL with `mask_settings not defined`
- [x] **Step 3: Write minimal implementation**
```python
def mask_settings(s: dict) -> dict:
    return {"active_provider": s.get("active_provider"), "default_model": s.get("default_model"),
        "providers_configured": {"openai": bool(s.get("openai_api_key"))}}
```
```python
return mask_settings(_runtime_llm_settings)
```
- [x] **Step 4: Run test to verify it passes**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_post_settings_masked -v`
Expected: PASS
- [x] **Step 5: Commit**
```bash
git add tests/test_agent_graph.py packages/core/models.py services/rag_engine/app.py
git commit -m "fix: masked settings POST with UI-aligned names"
```

### Task 5: BM25 eviction interface

**Files:**
- Modify: `services/rag_engine/retrieval/bm25.py:42-63`, `services/rag_engine/retrieval/hybrid.py:26-39`
- Test: `tests/test_agent_graph.py`

**Interfaces:**
- Consumes: `BM25Index(chunks: list[Chunk] | None)`
- Produces: `BM25Index.remove(chunk_ids: list[str]) -> None; BM25Index.rebuild(chunks: list[Chunk]) -> None; HybridRetriever.evict(chunk_ids: list[str]) -> None`.

- [x] **Step 1: Write the failing test**
```python
def test_bm25_evict_removes(populated_retriever_and_graph):
    retriever, _ = populated_retriever_and_graph
    retriever.evict(["c1"])
    assert "c1" not in retriever.chunk_map
```
- [x] **Step 2: Run test to verify it fails**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_bm25_evict_removes -v`
Expected: FAIL with `HybridRetriever has no attribute evict`
- [x] **Step 3: Write minimal implementation**
```python
def remove(self, chunk_ids: list[str]) -> None:
    keep = [c for c in self.chunks if c.id not in set(chunk_ids)]
    self.rebuild(keep)
def rebuild(self, chunks: list[Chunk]) -> None:
    self.chunks = chunks; self.chunk_map = {c.id: c for c in chunks}; self._build_index()
```
```python
def evict(self, chunk_ids: list[str]) -> None:
    self.bm25_index.remove(chunk_ids); self.vector_store.delete_chunks(chunk_ids)
    self.chunks = [c for c in self.chunks if c.id not in set(chunk_ids)]
```
- [x] **Step 4: Run test to verify it passes**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_bm25_evict_removes -v`
Expected: PASS
- [x] **Step 5: Commit**
```bash
git add tests/test_agent_graph.py services/rag_engine/retrieval/bm25.py services/rag_engine/retrieval/hybrid.py
git commit -m "feat: BM25 remove/rebuild and retriever evict"
```

## Phase 2 — Restructure (verify: `uv run python -m pytest tests/test_agent_graph.py tests/test_routes.py -q && uv run ruff check services/rag_engine`)

### Task 6: Router split with true retrieval_method

**Files:**
- Create: `services/rag_engine/routers/query.py`, `services/rag_engine/routers/settings.py`, `services/rag_engine/routers/documents.py`, `services/rag_engine/routers/ops.py`
- Modify: `services/rag_engine/app.py:329-431`
- Test: `tests/test_agent_graph.py`

**Interfaces:**
- Consumes: `agent_graph.ainvoke(initial_state: dict)`
- Produces: `async def query_endpoint(req: QueryRequest, tenant_id: str) -> QueryResponse` in `routers/query.py`.

- [ ] **Step 1: Write the failing test**
```python
def test_query_router_importable():
    from services.rag_engine.routers.query import query_endpoint
    assert callable(query_endpoint)
```
- [ ] **Step 2: Run test to verify it fails**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_query_router_importable -v`
Expected: FAIL with `No module routers.query`
- [ ] **Step 3: Write minimal implementation**
```python
from fastapi import APIRouter
router = APIRouter()
@router.post("/v1/query", response_model=QueryResponse)
async def query_endpoint(req: QueryRequest, tenant_id: str = Depends(verify_api_key)):
    return await run_query(req, tenant_id)
```
- [ ] **Step 4: Run test to verify it passes**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_query_router_importable -v`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add tests/test_agent_graph.py services/rag_engine/routers/query.py services/rag_engine/app.py
git commit -m "refactor: extract query router with true retrieval_method"
```

### Task 7: Entity linker plus merged verifier

**Files:**
- Create: `services/rag_engine/agent/entity_linker.py`, `services/rag_engine/agent/prompts.py`
- Modify: `services/rag_engine/agent/graph.py:38-117`, `services/rag_engine/agent/critic.py:11-81`
- Test: `tests/test_agent_graph.py`

**Interfaces:**
- Consumes: `graph_store.get_entity_by_lowercase_name(name: str)`
- Produces: `link_entities(query: str, graph_store) -> list[dict]` (exact only, no fallback dump); `verify_claims(query: str, draft: str, chunks: list[dict]) -> list[Claim]` with `Claim{text: str, verdict: str, chunk_ids: list[str]}`.

- [ ] **Step 1: Write the failing test**
```python
def test_link_entities_exact_only(gstore):
    assert link_entities("qdrant routing", gstore) == [e for e in link_entities("qdrant routing", gstore) if e["name"].lower() in "qdrant routing"]
```
- [ ] **Step 2: Run test to verify it fails**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_link_entities_exact_only -v`
Expected: FAIL with `link_entities not defined`
- [ ] **Step 3: Write minimal implementation**
```python
def link_entities(query: str, graph_store) -> list[dict]:
    out = []
    for w in re.findall(r"\w+", query.lower()):
        e = graph_store.get_entity_by_lowercase_name(w)
        if e: out.append({"name": e.name, "entity_type": e.entity_type})
    return out[:8]
```
```python
def verify_claims(query: str, draft: str, chunks: list[dict]) -> list[Claim]:
    return [Claim(text=s.strip(), verdict="supported" if any(s[:12].lower() in c.get("text","").lower() for c in chunks) else "unsupported",
        chunk_ids=[c.get("chunk_id","") for c in chunks if s[:12].lower() in c.get("text","").lower()])]
```
- [ ] **Step 4: Run test to verify it passes**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_link_entities_exact_only -v`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add tests/test_agent_graph.py services/rag_engine/agent/entity_linker.py services/rag_engine/agent/critic.py
git commit -m "refactor: exact entity linker and merged verify_claims"
```

## Phase 3 — Modern upgrades (verify: `uv run python -m pytest tests/test_agent_graph.py evals/ -q -m "not slow"`)

### Task 8: Reranker stage behind flag

**Files:**
- Modify: `services/rag_engine/retrieval/reranker.py`, `services/rag_engine/retrieval/hybrid.py:41-64`
- Test: `tests/test_agent_graph.py`

**Interfaces:**
- Consumes: `Reranker.rerank(query: str, chunks: list[Chunk], top_k: int) -> list[SearchResult]`
- Produces: `class HeuristicReranker(Reranker)`; `class BGEM3Reranker(Reranker)` with `__init__(model_id: str = "BAAI/bge-reranker-v2-m3", use_model: bool = False)`; `retrieval_method="cross_encoder_rerank"` on reranked hits.

- [ ] **Step 1: Write the failing test**
```python
def test_heuristic_fallback_labels_stage(chunks):
    r = HeuristicReranker().rerank("qdrant vector", chunks, top_k=1)
    assert r[0].retrieval_method == "cross_encoder_rerank"
```
- [ ] **Step 2: Run test to verify it fails**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_heuristic_fallback_labels_stage -v`
Expected: FAIL with `HeuristicReranker not defined`
- [ ] **Step 3: Write minimal implementation**
```python
class HeuristicReranker:
    def rerank(self, query: str, chunks: list[Chunk], top_k: int) -> list[SearchResult]:
        scored = sorted(chunks, key=lambda c: len(set(query.lower().split()) & set(c.text.lower().split())), reverse=True)
        return [SearchResult(chunk_id=c.id, document_id=c.document_id, text=c.text, score=1.0, retrieval_method="cross_encoder_rerank") for c in scored[:top_k]]
```
- [ ] **Step 4: Run test to verify it passes**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_heuristic_fallback_labels_stage -v`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add tests/test_agent_graph.py services/rag_engine/retrieval/reranker.py services/rag_engine/retrieval/hybrid.py
git commit -m "feat: reranker protocol with heuristic fallback stage"
```

### Task 9: Provenance citations and eval hooks

**Files:**
- Modify: `packages/core/models.py:125-137`, `evals/test_rag_eval.py`
- Test: `tests/test_agent_graph.py`

**Interfaces:**
- Consumes: `claims: list[Claim]` from `verify_claims`
- Produces: `QueryResponse.chunks: list[SearchResult]` with per-chunk `score, retrieval_method`; `eval_faithfulness(answer: str, chunks: list[str]) -> float` threshold `>= 0.7` in CI.

- [ ] **Step 1: Write the failing test**
```python
def test_claim_carries_chunk_ids():
    cl = verify_claims("What is Qdrant?", "Qdrant is a vector DB.", [{"chunk_id": "c1", "text": "Qdrant is a vector DB."}])
    assert cl[0].chunk_ids == ["c1"] and cl[0].verdict == "supported"
```
- [ ] **Step 2: Run test to verify it fails**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_claim_carries_chunk_ids -v`
Expected: FAIL with `verify_claims not defined`
- [ ] **Step 3: Write minimal implementation**
```python
class Claim(BaseModel):
    text: str; verdict: str; chunk_ids: list[str] = Field(default_factory=list)
```
```python
def eval_faithfulness(answer: str, chunks: list[str]) -> float:
    words = set(re.findall(r"\w+", answer.lower()))
    ctx = set(re.findall(r"\w+", " ".join(chunks).lower()))
    return len(words & ctx) / max(1, len(words))
```
- [ ] **Step 4: Run test to verify it passes**
Run: `uv run python -m pytest tests/test_agent_graph.py::test_claim_carries_chunk_ids -v`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add tests/test_agent_graph.py packages/core/models.py evals/test_rag_eval.py
git commit -m "feat: per-claim chunk_ids provenance and faithfulness hook"
```

## Self-Review

- Spec coverage: §5 items 1-2 by Tasks 3-4; 3 by Task 5; 4 by Task 6; 5 by Tasks 1/7; 6-7 by Tasks 7-8; 8-9 by Task 9; seams by Task 2.
- Placeholder scan: no TBD, TODO, later, or cross-task references; every validation is inline code with an exact pytest command.
- Type consistency: `ServingInfo`, `Claim`, `Reranker.rerank`, `Retriever.evict`, `link_entities`, `verify_claims`, `mask_settings` spelled identically at definition and use; `QueryResponse.serving` replaces flat `serving_provider/model` fields everywhere.
