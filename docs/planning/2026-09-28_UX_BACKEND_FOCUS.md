# Meridian LLMOps — UX + Backend Focus Review

## 1. Current UX–backend map (4 journeys)

**Ask — `POST /v1/query` + `RagWorkspace.tsx`.**
UI `RagWorkspace.tsx:42-66` → `api.query()` (`api.ts:82-98`) sends `{query, tenant_id, top_k, max_cycles, enforce_guardrails}` with `X-API-Key`/`X-Tenant-Id` (`api.ts:58-64`). Backend `rag_engine/app.py:329-431` runs input-guardrail → LangGraph (`graph.py:22-280`: retrieve → generate → critique → reformulate/refuse) → output-guardrail → `QueryResponse` with `answer, source_chunks, entities, verified, refusal, serving_provider/model, degraded_reason`. UI renders hero answer (`RagWorkspace.tsx:252-353`), chunks (`:381-401`), entities (`:427-439`), status-aware errors (`:189-230`, `ApiError` `api.ts:22-32`).

**Ingest — `POST /v1/ingest`, `/v1/documents*` + `IngestionStudio.tsx`.**
UI `IngestionStudio.tsx:94-123` → `api.ingest()` (`api.ts:100-110`); catalog via `api.getDocuments/getDocument/deleteDocument/clearAll/seedSamples` (`api.ts:178-216`) → backend `app.py:314-326,600-690`. Post-ingest UI refreshes catalog (`IngestionStudio.tsx:114`) and shows dual-memory stats (`:631-658`); chunk inspector via `GET /v1/documents/{id}` (`:138-146`, modal `:675-750`).

**Guardrail — `POST /v1/guardrails/check` + `GuardrailsStudio.tsx`.**
UI `GuardrailsStudio.tsx:45-62` → `api.checkGuardrails()` (`api.ts:112-122`) sends `{text}` body. Backend evaluated by NeMo `InputGuardrails`; verdict panel (`GuardrailsStudio.tsx:168-231`) branches on `action_taken` blocked/redacted/safe. Note: the UI hits the **rag-engine** route while the canonical rail lives in **gateway** `gateway/app.py:39-54`.

**Operate — `GET /v1/metrics`, `/v1/settings/llm*`, `/health` + `MetricsDashboard.tsx`, `SettingsModal.tsx`, `App.tsx`.**
`MetricsDashboard.tsx:64-78` → `api.getMetrics()` (`api.ts:124-133`) keyed by `tenantId`; `SettingsModal.tsx:68-99,207-248` GET/POST settings + `test-and-fetch-models` (`api.ts:135-168`); `App.tsx:16-29` polls `checkHealth()` (`api.ts:78-80`) every 10s for the navbar badge. Infra topology cards are static (`MetricsDashboard.tsx:21-57`).

## 2. Gaps (file:line + 1-line impact)

1. **Settings contract drift → 422 on save.** UI posts `active_provider, default_model, openai_org_id/proj_id, custom_base_url, litellm_base_url` (`SettingsModal.tsx:222-235`, `types/api.ts:75-89`) but `UpdateLLMSettingsRequest` only accepts `provider/api_key/model/base_url/...` with `extra="forbid"` (`packages/core/models.py:89-104`) — user clicks Save & Apply and gets a validation error or a silent no-op.
2. **Blank-preserve vs blank-means-clear ambiguity.** Backend merges with `_merge_preserving_saved` so `""` never wipes (`rag_engine/app.py:172-183,567-597`), yet UI sends `|| undefined` for some keys and `""`-capable strings for URLs (`SettingsModal.tsx:222-235`) with "leave blank to keep existing" on only one field — user cannot rotate a key to empty or tell what is saved.
3. **Secret-masking asymmetry.** `GET /v1/settings/llm` strips all keys, returning only `providers_configured` booleans (`app.py:450-471`), but `POST /v1/settings/llm` returns raw `_runtime_llm_settings` including secrets (`app.py:597`) — save response leaks API keys into browser memory/devtools.
4. **PII-in-URL.** Canonical guardrail check is `GET /v1/guardrails/check?text=` (`gateway/app.py:39-45`); the POST body alias is hidden (`include_in_schema=False`, "deprecated", `gateway/app.py:48-54`) even though the frontend correctly POSTs (`api.ts:112-122`) — anyone following the OpenAPI spec pastes SSNs/keys into URLs, leaking them to logs/proxies.
5. **Unattributable `serving_model`.** Response always stamps `serving_provider/model` from active config (`app.py:390,428-429`) even for greeting bypasses, empty-draft fallbacks, or testing-mode synthesized drafts (`graph.py:119-135,184-203`); UI renders the badge unconditionally (`RagWorkspace.tsx:332-339`) — user trusts an answer "from gpt-4o-mini" that no model generated (the <500 ms tripwire at `app.py:404-417` only adds a tooltip-grade flag).
6. **Stale BM25 after delete.** `HybridRetriever.update_chunks` only `add_chunks` for new IDs (`hybrid.py:26-39`); `BM25Index` has add but no remove (`bm25.py:42-63`), yet delete/clear endpoints call `update_chunks` expecting eviction (`app.py:604,689`) — user deletes a document and its passages keep surfacing in lexical search.
7. **Static ops UX.** Infra cards hardcode Online/Ready (`MetricsDashboard.tsx:21-57`) while `/health` reports real per-service `reachable/degraded` (`app.py:303-311`); `top_k` UI caps at 10 (`RagWorkspace.tsx:146-152`) vs backend `le=50` (`models.py:116-123`) vs graph hardcode `top_k=3` (`graph.py:42`) — user sees green infra during outages and a Top-K knob that changes little.

## 3. Restructured proposal: backend-for-UX contracts

**Ask (`POST /v1/query`)** — `{query, tenant_id, top_k(1-10), max_cycles(1-5), enforce_guardrails}` → `{answer, source_chunks[{chunk_id, document_id, text, score, retrieval_method}], entities, cycle_count, verified, refusal, execution_time_ms, serving{provider, model, fresh:boolean}, degraded_reason|null}`. Errors: `400 guardrail_block{violations}`, `401`, `429 retry_after_ms`, `502 provider_error{provider,model}`. Latency budget: p50 <8 s, stream or skeleton past 2 s (already in UI); `serving.fresh=false` whenever greeting/refusal/fallback path taken so the badge can grey out. **Consolidate** retrieval+critic into this one call; **split out** a `GET /v1/query/{id}/trace` later only if users ask — do not build tracing UI now.

**Ingest (`POST /v1/ingest`, `/v1/documents*`)** — ingest returns `{document_id, title, chunks_indexed, entities_extracted, relationships_extracted, job:"sync"}` with synchronous <5 s for <50 KB else `202 {job_id}` + poll; delete returns `{status, document_id}` **and guarantees eviction** from vector + BM25 + graph (fix §2.6). Errors: `400 empty_text`, `404 doc_not_found`, `413 too_large`. **Consolidate** `/v1/documents` and deprecated `/v1/documents/catalog` (already aliased at `app.py:646-656` — sunset it); keep separate `GET /{id}/chunks` for the inspector. **Do NOT build** async job queues, versioning, or rich-text/PDF parsing beyond current text intake (YAGNI).

**Guardrail (`POST /v1/guardrails/check`)** — `{text}` → `{allowed, sanitized_text, policy_violations[], action_taken}`; promote POST to canonical, mark GET deprecated with sunset header (mirror the documents pattern). Errors: `400 empty`, `413 too_long (cap 20 KB)`. Latency budget <500 ms. **Consolidate** rag-engine and gateway rails behind one Pydantic schema; **split** nothing. **Do NOT build** custom rule editors or per-tenant policy DSLs.

**Operate (`GET /v1/metrics`, settings, `/health`)** — metrics returns `{tenant_id, total_requests, total_tokens, total_cost_usd, by_model[]}` (add `by_model` — cost tab currently unattributable); settings GET returns masked shape `{active_provider, default_model, *_configured:boolean, *_key_masked:"sk-…ab12"|null}` and POST accepts the same field names the UI sends, returning the masked shape (never raw keys); health returns `{status, services{qdrant,neo4j,litellm}}` and the dashboard maps it 1:1 instead of static strings. Errors: settings `422 {field, reason}` rendered inline per-field. **Do NOT build** multi-tenant admin RBAC, cost forecasting, or settings history.

**Explicitly NOT building:** streaming SSE, offline export, custom reranker tuning UI, per-user API-key scoping, document version diffing.

## 4. Top 5 UX-backend moves (by user pain)

1. Fix settings schema parity (accept UI field names, return masked shape) — unbreaks provider switching.
2. Guarantee delete-eviction across vector/BM25/graph — restores trust in "Delete".
3. Make `serving.fresh` explicit and grey the model badge on fallback — stops false attribution.
4. Promote guardrail POST to canonical, deprecate GET `?text=` — stops PII in URLs/logs.
5. Wire `/health` services into infra cards + align Top-K end-to-end — stops false-green ops view.

## Integration note (for parent)

Settings drift is the critical seam: UI field names vs `extra="forbid"` model guarantees save failures. Delete-eviction and serving-attribution are the two trust bugs. Guardrail GET-vs-POST is a privacy fix with a docs-only cost. Ops cards need live health binding, not redesign. Proposed contracts above are shaped for sibling backend/frontend agents to adopt verbatim.
