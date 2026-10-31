# Meridian RAG Engine + Agentic Graph — Improvement Plan

## 1. Current state

- Query path is guardrail → graph → guardrail in one handler: `services/rag_engine/app.py:329-431` builds `initial_state`, calls `agent_graph.ainvoke`, then maps `retrieved_chunks` to `SearchResult` with hardcoded `retrieval_method="hybrid_rrf"` (`app.py:392-400`) and stamps `serving_provider/model` from active config (`app.py:428-429`).
- Graph is fixed `retrieve → generate → critique → reformulate/refuse` via raw `StateGraph` (`agent/graph.py:255-280`); `retrieve_node` hardcodes `top_k=3` (`graph.py:42`) ignoring `QueryRequest.top_k` (`packages/core/models.py:116-123`), and entity matching is hand-rolled stopword + fuzzy scan with unrelated fallback (`graph.py:62-111`).
- Generation carries cache-busting nonce (`graph.py:146-158`) plus `<500 ms` latency tripwire (`app.py:404-417`) and `APP_ENV=="testing"` synthesized drafts (`graph.py:188-198`); greetings bypass retrieval yet still receive model attribution (`graph.py:124-135`).
- Retrieval is dense + BM25 + RRF + rerank (`retrieval/hybrid.py:41-64`, `retrieval/fusion.py:6-18`), but `CrossEncoderReranker` is Jaccard/coverage arithmetic, not a model (`retrieval/reranker.py:16-30`), and `BM25Index` supports add with no remove (`retrieval/bm25.py:42-63`) while `HybridRetriever.update_chunks` only adds (`retrieval/hybrid.py:26-39`), so deletes in `app.py:683-690` leak into lexical results.
- Settings and review are co-housed: `GET /v1/settings/llm` returns masked booleans (`app.py:450-471`) while `POST /v1/settings/llm` accepts a narrower `UpdateLLMSettingsRequest` with `extra="forbid"` (`models.py:89-104`) yet returns raw settings including secrets (`app.py:597`); review queue (`routers/review.py:17-102`) is mounted in the same app but shares no schema with query provenance.

## 2. Confusion audit

Query, generation policy, critique policy, reformulation, runtime settings, document catalog, and HITL review live in one FastAPI app, so one edit risks all journeys. A reader cannot tell where retrieval ends and judgment begins: `retrieve_node` does lexical matching, graph expansion, and fallback surfacing; `generate_node` does greeting policy, thresholding (`score >= 0.08`), prompting, and error mapping; `critic_node` runs both a heuristic judge (`agent/critic.py:48-81`) and `TieredCitationVerifier` without recording which decided. Settings drift is the sharpest edge: UI field names do not match the `forbid` schema, so Save fails with 422 (see `2026-09-28_UX_BACKEND_FOCUS.md` §2.1). Attribution is the second: every path claims a fresh model call, including paths that made none. Eviction is the third: delete promises removal the index cannot honor. Review queue is the fourth: it tracks `ExtractedField` corrections while queries expose `claims`/`verification_result` nowhere in `QueryResponse`, so human feedback never improves answers.

## 3. Simplified restructure

Split `app.py` (~913 lines) into routers with one job each: `routers/query.py` (guardrail in/out + graph invoke + response map), `routers/settings.py` (GET masked / POST validated / test-models), `routers/documents.py` (ingest/catalog/chunks/delete + alias with `Sunset`), `routers/ops.py` (`/health`, `/v1/metrics`). Move policy out of nodes: `agent/greetings.py`, `agent/entity_linker.py` (exact-index lookup only, no fallback dump), `agent/prompts.py` (single system template, nonce kept in one helper).

Unified `QueryResponse`:

```text
{ answer, chunks[{chunk_id, document_id, text, score, retrieval_method}],
  entities, verified, refusal, serving{provider, model, fresh},
  degraded_reason, execution_time_ms, cycle_count }
```

`serving.fresh=false` on greeting, refusal, empty-draft, testing-synth, or tripwire paths; badge greys out. `retrieval_method` records the true stage (`dense`, `sparse_bm25`, `cross_encoder_rerank`) instead of constant `hybrid_rrf`.

Merge: heuristic critic + tiered verifier into one `verify_claims` returning per-claim `{text, verdict, chunk_ids}`; `GET /v1/documents` + `/catalog` alias documented once. Split: retrieval interface (`Retriever` protocol: `retrieve`, `upsert`, `evict`, `rebuild`) from `HybridRetriever` impl so BM25/vector/graph evict together. Delete: testing-mode synth drafts from non-test code paths (gate behind explicit `allow_synth` flag), raw-settings echo on POST (return masked shape), unrelated-entity fallback dump.

Non-goals: streaming SSE, async ingest jobs, PDF/OCR parsing, per-tenant policy DSL, reranker-tuning UI, multi-tenant billing.

## 4. Modern-tool upgrades

| Tool | Current | 2026 latest (fetched) | Adopt/skip + why |
|---|---|---|---|
| Agent orchestration | Raw `StateGraph`, manual nodes/edges | `langgraph 1.2.11` (https://pypi.org/project/langgraph/1.0.8); `create_agent` for tool-calling, `StateGraph` for custom flows (https://github.com/jackawatts/agentic-framework-comparison/blob/main/docs/frameworks/langgraph.md, https://reference.langchain.com/python/langchain/agents/factory/create_agent) | Adopt pattern, skip rewrite: keep `StateGraph` for fixed retrieve→generate→critique loop (correct use per docs at http://docs.langchain.com/oss/python/langgraph/overview); adopt `START`, checkpointer, `interrupt_before` for review escalations |
| Reranker | Jaccard heuristic misnamed cross-encoder | `BAAI/bge-reranker-v2-m3` 568M, 8k ctx (https://www.azion.com/en/documentation/products/ai/ai-inference/models/baai-bge-reranker-v2-m3); SOTA over MiniLM/Granite in SemEval-2026 (https://arxiv.org/html/2605.12028v1) | Adopt behind interface with CPU fallback to current heuristic; RRF-only otherwise leaves precision on the table |
| Sparse index | `rank_bm25 BM25Okapi`, add-only | Same lib current; `BAAI/bge-m3` unifies dense/sparse/colbert to 8192 tokens (https://huggingface.co/BAAI/bge-m3) | Adopt evict/rebuild fix now, skip BGE-M3 migration (heavy index change, no recall evidence in-repo) |
| Provenance | Sentence split on `.`, claim-anywhere match | `CitationFaithfulnessMetric`: every `[N]` must point at supporting passage (https://deepeval.com/docs/metrics-citation-faithfulness) | Adopt for eval gate; keep runtime verifier sentence-level but emit `chunk_ids` per claim for cite-every-claim UI |
| Quality gates | `evals/` + CI only, invisible in app | `FaithfulnessMetric` + `ContextualPrecision/Recall/Relevancy` for retriever/generator split (https://deepeval.com/guides/guides-rag-evaluation, http://deepeval.com/docs/metrics-faithfulness) | Adopt thresholds in CI (`faithfulness>=0.7`, precision/recall tracked), skip in-request LLM-judge (latency/cost) |

## 5. Sequenced improvement plan

1. Contract repair — align `UpdateLLMSettingsRequest` with UI names, return masked shape on POST. Files: `packages/core/models.py`, `services/rag_engine/app.py` (soon `routers/settings.py`). Verify: `uv run python -m pytest tests/test_settings_contract.py -q`.
2. Attribution fix — add `serving.fresh`, set false on greeting/refusal/synth/tripwire, pass through real `provider/model`. Files: `models.py`, `app.py`, `agent/graph.py`. Verify: `uv run python -m pytest tests/test_query_attribution.py -q`.
3. Eviction guarantee — add `BM25Index.remove/rebuild`, `HybridRetriever.evict`, wire delete/clear to all stores. Files: `retrieval/bm25.py`, `retrieval/hybrid.py`, `routers/documents.py`. Verify: `uv run python -m pytest tests/test_retrieval_eviction.py -q`.
4. Router split — extract `routers/query.py`, `routers/settings.py`, `routers/documents.py`, `routers/ops.py`; slim `app.py` to mounts. Verify: `uv run python -m pytest tests/test_routes.py -q && uv run ruff check services/rag_engine`.
5. Graph cleanup — honor `top_k`/`max_cycles` from request, extract entity linker + prompts, remove fallback dump, keep nonce helper. Files: `agent/graph.py`, `agent/entity_linker.py`, `agent/prompts.py`. Verify: `uv run python -m pytest tests/test_agent_graph.py -q`.
6. Verifier merge — single `verify_claims` emitting per-claim `chunk_ids`; `QueryResponse.chunks` carries true stage + citations. Files: `agent/critic.py`, `packages/verification/tiered_verifier.py`, `models.py`. Verify: `uv run python -m pytest tests/test_critic_verifier.py -q`.
7. Real reranker behind flag — `SentenceTransformer CrossEncoder(bge-reranker-v2-m3)` impl of `Reranker` protocol, fallback heuristic, `k=50` candidates per SemEval setting. Files: `retrieval/reranker.py`, `retrieval/hybrid.py`. Verify: `uv run python -m pytest tests/test_reranker.py -q`.
8. Review linkage — include `trace_id`, route low-`verified` answers to `POST /v1/review/items`; link `field` corrections back to chunk eviction/flagging. Files: `routers/review.py`, `routers/query.py`. Verify: `uv run python -m pytest tests/test_review_queue.py -q`.
9. DeepEval gates — add `faithfulness`, `contextual-precision/recall`, `citation-faithfulness` thresholds in `evals/` CI. Files: `evals/*.py`, `.github/workflows/*.yml`. Verify: `uv run python -m pytest evals/ -q -m "not slow"`.

Cross-part note:
Response schema change needs frontend badge + chunks panel update.
Retrieval interface change needs ingestion delete/clear callers updated.
Settings masked shape needs gateway sibling to match field names.
Review-trace linkage needs HITL owner to define queue SLA.
Eval thresholds need platform owner to wire CI blocking flag.
