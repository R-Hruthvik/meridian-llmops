# Meridian operations runbook

This runbook covers the RAG API and the local Qdrant-backed ingestion and retrieval path. Authenticated API calls use `X-API-Key`; the server assigns the tenant from that key. Use the admin key for `/v1/index/status` and other admin-only operations. Do not put API keys in shell history or issue reports.

Set the API URL and keys in your shell or a local secret manager before using the examples below:

```bash
export API_URL=http://localhost:8000
export API_KEY='replace-with-user-api-key'
export ADMIN_API_KEY='replace-with-admin-api-key'
```

## Service and index health

Check process liveness and readiness:

```bash
curl -fsS "$API_URL/health/live"
curl -fsS "$API_URL/health/ready"
```

`/health/ready` returns `{"ready":true}` only when Qdrant is reachable, the startup index consistency check passes, and the embedder is initialized. It does not return the consistency details. For the live subsystem report, use the admin endpoint:

```bash
curl -fsS -H "X-API-Key: $ADMIN_API_KEY" "$API_URL/v1/index/status"
```

The detailed report includes live Qdrant counts, the in-process BM25 index, graph status, and relational database status. It does not report the startup manifest consistency verdict. That verdict is available through readiness and startup logs; after an admin rebuild, the `POST /v1/reindex` response includes `consistent`. The unauthenticated `GET /health` is a minimal service response; sending a valid `X-API-Key` adds that key's tenant-scoped document and vector counts.

## Retrieved chunks are wrong or missing

1. Confirm readiness and inspect `/v1/index/status` as described above. If readiness is false or the index is inconsistent, stop writes and check that the configured collection, embedding model/dimension, Qdrant endpoint, and persisted disk chunks match.
2. Inspect what the serving retriever returns before invoking generation. This endpoint requires a user API key and uses its assigned tenant:

   ```bash
   curl -fsS -X POST "$API_URL/v1/retrieve" \
     -H "X-API-Key: $API_KEY" \
     -H 'Content-Type: application/json' \
     -d '{"query":"<question>","top_k":5,"debug":true}'
   ```

   Read the returned chunk text, ranks, score details, and `timings_ms`. The optional `debug` flag includes per-stage scoring details.
3. Check the source file's parsing and chunk sizes. For a local source file, run:

   ```bash
   uv run python scripts/chunk_report.py path/to/document.pdf
   ```

   The report includes chunk token counts, page coverage, empty pages, sample chunk text, and parser warnings. The parser supports Markdown, text, PDF, DOCX, and HTML; scanned PDFs need OCR preprocessing.
4. Confirm the configured `EMBEDDING_MODEL` matches the model recorded in `index_manifest.json` under the configured storage root. Model or vector-dimension changes require a rebuild.
5. For identifier-heavy questions, compare dense and BM25 scores in debug retrieval output. Verify that the API key belongs to the intended tenant; a caller-supplied `X-Tenant-Id` cannot switch tenants.
6. To run the checked-in retrieval smoke set in an isolated in-memory Qdrant collection (it reads files under `sample_docs`, not the live server collection):

   ```bash
   uv run python scripts/retrieval_check.py \
     --questions evals/retrieval_smoke.json --docs sample_docs --top-k 5
   ```

## The answer says it cannot answer

First call `/v1/retrieve` with the same question. If the right evidence is absent, follow the retrieval checks above. If the evidence is present, inspect the query response's `answer_status`, `verification`, `debug`, `degraded_reason`, and `timings_ms` fields. `answer_status: insufficient_context` indicates the sufficiency gate declined to answer; do not lower `MIN_DENSE_SCORE` until checking calibration with `uv run python scripts/calibrate_threshold.py --help` and the relevant tests/evaluation. If needed, enable `DEBUG_LOG_PROMPTS` only in a controlled development environment because prompts can contain user documents, then inspect server logs and disable it afterward.

## Empty answer or provider error

Check the HTTP status and response detail, then inspect the API process logs for provider failures. In the workbench Settings, use **Test generation** to check the configured provider, base URL, key, and model. Environment configuration accepts the generic `PROVIDER`, `API_KEY`, `BASE_URL`, and `MODEL` names (also `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL` aliases); keep credentials private. The optional Compose app service forwards both generic names and aliases into the app container. Remote provider URLs must use HTTPS and resolve to public addresses. Local/private endpoints require the explicit `ALLOW_PRIVATE_PROVIDER_URLS=true` setting, except the app's validated private bridge address for the Compose `litellm` service. Verify the selected model is available at the configured endpoint and that the provider accepts its API format. A retrieval-only `/v1/retrieve` success confirms the issue is downstream of retrieval.

## Upload succeeded but search finds nothing

1. Read each row in the `POST /v1/documents` response, especially `status`, `warnings`, `error`, `pages`, and `chunks`. Rejected or duplicate uploads are reported per file.
2. List the tenant's document catalog and inspect the uploaded document's chunks:

   ```bash
   curl -fsS -H "X-API-Key: $API_KEY" "$API_URL/v1/documents"
   curl -fsS -H "X-API-Key: $API_KEY" "$API_URL/v1/documents/<document-id>/chunks"
   ```

3. Compare parsed text with the source using `scripts/chunk_report.py`. For PDF, inspect parser warnings and page coverage; OCR is not performed by this pipeline.
4. Compare the tenant's document and vector counts from authenticated `GET /health`, and review the live index report with an admin key. The app's catalog is disk-backed and Qdrant stores the searchable vectors.

## Slow retrieval or query

Use the response's `timings_ms` breakdown to identify the slow stage. Retrieval `total` includes query embedding; the benchmark also reports embed, dense, BM25, fusion, retrieval, and serialization stages. To benchmark an isolated synthetic corpus locally:

```bash
uv run python scripts/bench_retrieval.py
```

The script defaults to a local temporary Qdrant index and removes its temporary data on exit. Use `--help` for corpus/model options. If the query's retrieval stages are fast but the full request is slow, check provider latency and generation/retry timings.

## Results change after restart

The app rebuilds its in-process BM25 index from stored chunks at startup and checks the persisted index manifest against the configured embedding model, vector dimension, and chunker version. Inspect `/v1/index/status`, the manifest under the configured storage root, and startup logs. Confirm `EMBEDDING_MODEL`, Qdrant collection/endpoint, and storage root did not change. Do not delete or regenerate storage as a first diagnostic step.

## Qdrant errors or inconsistent index

Check that Qdrant is reachable at the configured `QDRANT_HOST` and `QDRANT_PORT`, and that the configured collection has the embedding dimension expected by `EMBEDDING_MODEL`. With Docker Compose, the supported local start is:

```bash
docker compose up -d qdrant
docker compose ps qdrant
```

Check mounted storage and Qdrant client/server versions if the service is reachable but reports collection or protocol errors. If the index is inconsistent, stop ingestion and preserve the disk chunks before rebuilding. The CLI rebuild replaces the configured collection unless `--resume` is used; it prompts for confirmation unless `--yes` is supplied:

```bash
uv run python scripts/reindex.py
```

Do not use `--yes` without confirming the target collection and having a recoverable copy of the document storage. After rebuilding, check `/health/ready` and `/v1/index/status` again. `/v1/reindex` is the admin API equivalent and also replaces the active index.

## Useful local commands

```bash
make help
make up
make ingest DIR=sample_docs
make retrieval-check
make eval
```

`make ingest` adds files from the chosen directory to the configured storage and Qdrant collection. The retrieval smoke check creates its own temporary in-memory collection. `make eval` runs the golden retrieval evaluation; it is separate from live API data. Avoid `make reindex` unless intentionally replacing the configured vector collection from disk-backed chunks.
