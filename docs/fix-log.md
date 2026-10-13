# Meridian fix log

## Task 8.1 — Graph provenance and experimental context (2026-10-13)
- Implementation: `e13f5af` adds normalized tenant-scoped entity identity, document/chunk provenance edges, semantic relationship persistence, restart reads, safe shared-entity deletion, and legacy migration; `860ee3b` gates source-chunk-grounded graph facts behind `GRAPH_ENABLED` and `GRAPH_CONTEXT_ENABLED` (both default false); `f4c8b1c` adds `eval_retrieval.py --graph` over a committed two-case multi-hop corpus. Review follow-ups: `6ea1a4d` restores graph chunk lineage on delete rollback; `623c059` caps inserted graph facts at five and preserves the `Graph facts:` heading. Behavior and limitations are in `docs/graph-context.md`.
- Evidence: focused graph provenance, agent, ingestion rollback, and evaluator tests -> **39 passed, 1 skipped** without service credentials; the isolated real Neo4j test then passed, covering persisted write/read after reopening, provenance edges, shared-entity deletion, and legacy migration (**4/4 checks**). Qdrant service integration -> **1/1 passed**. Full suite clean rerun -> **450 passed, 2 skipped, 3 xfailed**.
- A/B result: on two synthetic multi-hop cases, baseline and graph-grounded retrieval each achieved **1.0 hop recall** and **1.0 complete-path rate** (delta **0.0** for both). The evaluator measures source/path evidence coverage, not generated answer quality. The first full-suite run in the shared workspace had **15 failures** while the readiness check saw Qdrant `231` points versus `230` on disk; the clean rerun passed. Graph context remains experimental and off by default because this fixture showed no retrieval gain and provides no generation-quality evidence.
- Deviations and follow-ups: broader multi-hop and answer-quality evidence is still required before enabling graph context by default.

## Task 8.2 — HITL review (experimental documentation, 2026-10-13)
- Verified before change: `ExtractedField`/`ReviewItem` are ORM models and `/v1/review` is mounted, but ingestion has no writes to either model. `confidence_threshold` has no consumers. Query verification results have no integrated query-to-review route or trace link; review corrections update the database field only, not chunks or retrieval indexes.
- Change summary: added `docs/HITL.md` to identify the mounted review routes and disconnected models as experimental, clarify that extraction confidence is distinct from answer verification, and state the definitions required before user-path activation.
- Scoped check: searched ingestion, rag-engine, and core references for queue writes, confidence-threshold consumers, and query/review linkage; none were found. Documentation diff checked for whitespace errors.
- Deviations: documentation only; no route wiring or runtime behavior changed.

## Task 9.1 — App factory and lifespan (2026-10-13)
- Implementation: `08baa0e` moves endpoint registration to an `APIRouter` and keeps `app.py` as a 9-line compatibility entry point; `5350ca5` tests import purity and isolated factory overrides; `10eaf5a`, `9325f19`, `121cf52`, `ce3c6e7`, and `965141a` preserve singleton compatibility while scoping services, readiness, settings, and query gates to app state.
- Review: independent review approved app-state isolation, import purity, and request-time legacy settings resolution. Factory tests cover two independent app instances and service-backed health/retrieval behavior.
- Evidence: `uv run pytest -q` -> **453 passed, 2 skipped, 3 xfailed**; scoped Ruff and mypy passed. `services/rag_engine/app.py` is 9 lines.
- Limitation: the historical `app` singleton remains as a compatibility alias; new integrations should use `create_app(settings, overrides)`.

## Task 9.2 — Compose provider configuration (2026-10-13)
- The optional Compose app service now forwards the generic direct-provider variables and their `LLM_` aliases. The LiteLLM service continues to receive its provider-specific key variables.
- Verification: `docker compose config --quiet` and scoped `git diff --check` passed.

## Task 7.3 Retrieval evaluation (2026-10-13)
- Verified before change: retrieval evaluation only existed as a smoke-set reranker comparison; no golden-set evaluator or threshold file existed. The prior smoke check used a dense-score shortcut for unanswerable cases rather than the generation sufficiency check.
- Tests added first: injected fake retrieval results covering phrase matching across expected-document chunks, hit@1/3/5, phrase recall@5, MRR, percentile latency, category splits, production sufficiency behavior, and threshold failure reporting. Initial collection failed because the evaluator module did not exist.
- Change summary: added `evals/eval_retrieval.py` to evaluate the committed golden dataset, report answerable retrieval metrics and p50/p95/p99 latency by category and overall, and calculate unanswerable accuracy using `has_sufficient_context` on the configured top-k chunks. MRR retains retrieval through rank 10. The CLI defaults to `retrieval_default_top_k` from settings. Added `evals/thresholds.json` with hit@5 0.90, MRR 0.70, and unanswerable accuracy 0.85 gates; it exits non-zero on undefined or below-threshold metrics.
- Evidence after review follow-up: `uv run pytest tests/test_eval_retrieval.py tests/test_validate_golden.py -q` -> **6 passed**; scoped Ruff -> **passed**. Independent Luna review confirmed p50/p95/p99, rank-10 MRR, production-sized sufficiency, and threshold behavior.
- Initial local golden run before the sufficiency follow-up: **50 cases**; hit@5 **1.000**, MRR **0.873**, unanswerable accuracy **0.500** (4/8; required 0.85), p50/p95/p99 **16.4/20.6/80.2 ms**. The dense/lexical check accepted four topical passages that omitted requested facts: production Qdrant password, AWS/LiteLLM monthly cost, GPU requirement for Qdrant Docker, and customer ownership of an example API key. The threshold was kept unchanged.
- Deviations from plan: none.
- Open risks / follow-ups: retrieval p95 remains above the 100 ms objective at 5k chunks; see Task 7.6 measurements. Sufficiency is an explicit heuristic for narrow evidence slots, not a general entailment judge.

## Task 7.3 sufficiency gate follow-up (2026-10-13)
- Change summary: added same-chunk evidence-slot checks for requests that need a specific credential, count, price, GPU requirement, uptime guarantee, customer-key owner, or paired UI credentials. A topical chunk without the requested kind of evidence no longer passes merely because its dense or lexical score is high. The detector is documented in code as heuristic and continues checking later eligible chunks.
- Tests and review: added tests for all eight golden unanswerables, answerable vector dimensions and paired credentials, paraphrased slot queries/value formats, missing values, and evidence in a later chunk. Focused sufficiency suite **10 passed**; full backend/eval suite **449 passed, 1 skipped, 3 xfailed**; Qdrant service integration **1 passed**; Ruff and mypy passed. Independent Luna review approved after regressions for later-chunk evidence and phrasing/value variants were added.
- Full golden run: **50 cases**, hit@5 **1.000**, MRR **0.873**, unanswerable accuracy **1.000** (8/8; required 0.85); 40/42 answerable cases satisfy context, unchanged from baseline. q-002 and q-035 remain the two answerable sufficiency misses. CLI gate **PASS**.
- Limitation: this is a small rule-based evidence-slot veto, not general semantic entailment; new domains and paraphrases may need additional calibration. The threshold remains 0.85.

## Task 7.4 Generation evaluation (2026-10-13)
- Verified before change: the prior evaluation test expected obsolete `type`/`query` fields and failed during setup with HTTP 401; there was no current FakeLLM CI contract test or real DeepEval runner.
- Change summary: replaced the stale test with offline FakeLLM checks for schema, citations, answered/insufficient statuses, and the evaluator's own row/context path, including zero provider calls on insufficient context. The optional runner imports and uses FaithfulnessMetric, AnswerRelevancyMetric, and ContextualRecallMetric, gates average faithfulness at 0.85, and writes dated JSON reports. Generator and OpenAI-compatible judge have separate model/base-URL settings; the same `EVAL_LLM_API_KEY` is used for both. Scoring context matches the prompt-selected chunks.
- Evidence after: `uv run pytest evals/ tests/test_eval_retrieval.py tests/test_validate_golden.py -q` -> **13 passed**; scoped Ruff -> **passed**; evaluator `--help` -> passed. Independent Luna review approved the configuration and offline path. No external generation or judge requests were made.
- Deviations: no test-mode critic patch existed in the current checkout to remove.
- Open risks / follow-ups: the manual DeepEval run remains unexecuted until a compatible judge API key is configured. The retrieval sufficiency gate is resolved; complete final Gate 7 CI checks after follow-up changes.

## Task 7.5 CI quality gates (2026-10-13)
- Change summary: CI now has locked Ruff/mypy, backend/offline eval tests with a Qdrant 1.11.3 service round-trip, cached FastEmbed retrieval evaluation, frontend Vitest/build/secret scan, route-auth enumeration, and informational pip/npm audits. The real-model DeepEval job only runs on schedule or opted-in workflow dispatch and skips without `EVAL_LLM_API_KEY`.
- Evidence after: actionlint and `uv lock --check` passed; Ruff/mypy passed; backend **439 passed, 1 skipped, 3 xfailed** with the live Qdrant service round-trip passing; route-auth enumeration passed; frontend **294 passed** and build/secret scan passed. Informational audits reported 12 Python and 14 npm findings.
- Gate status at Task 7.5 time: retrieval job was red because unanswerable accuracy was **0.500 < 0.850**; hit@5 **1.000** and MRR **0.873** passed. Real DeepEval was not invoked without credentials. Independent Luna review approved the workflow and found no CI configuration blocker.
- Open risks / follow-ups: rerun the locked CI-equivalent checks after the Task 7.3 sufficiency follow-up; real DeepEval remains conditional on credentials.

## Task 7.6 Retrieval latency benchmark (2026-10-13)
- Verified before change: `HybridRetriever.retrieve()` already reports embed, dense, BM25, fusion, rerank, and total stage timings; no 5k-chunk latency harness existed.
- Change summary: added `scripts/bench_retrieval.py`, which creates 500 synthetic documents / 5,000 concrete `Chunk` records, embeds and indexes them in a temporary local Qdrant directory, warms up for 10 queries, then measures 200 queries serially and 200 with eight workers. The FastEmbed cache and index are temporary; the configured storage and server collection are untouched. The report includes nearest-rank p50/p95/p99 by required HybridRetriever stage plus a separately measured JSON response-serialization diagnostic. Added scoped percentile and minimum corpus-shape tests.
- Evidence after: `.venv/bin/python -m pytest tests/test_bench_retrieval.py -q` -> 3 passed; `.venv/bin/ruff check scripts/bench_retrieval.py tests/test_bench_retrieval.py` -> passed; `git diff --check -- scripts/bench_retrieval.py tests/test_bench_retrieval.py docs/fix-log.md` -> passed. Real run: `.venv/bin/python scripts/bench_retrieval.py` -> 500 documents, 5,000 Qdrant points, 10 warmups, 200 queries per mode. Timings are milliseconds:

| Mode / stage | p50 | p95 | p99 |
|---|---:|---:|---:|
| Single embed | 8.963 | 14.763 | 17.292 |
| Single dense | 50.837 | 93.292 | 96.435 |
| Single BM25 | 65.598 | 136.697 | 157.556 |
| Single fusion | 0.160 | 0.200 | 0.291 |
| Single total | 156.878 | 221.225 | 261.130 |
| Single JSON serialization diagnostic | 0.095 | 0.110 | 0.135 |
| Eight-concurrent embed | 54.651 | 173.116 | 290.273 |
| Eight-concurrent dense | 527.147 | 919.736 | 976.345 |
| Eight-concurrent BM25 | 609.854 | 996.048 | 1,225.658 |
| Eight-concurrent fusion | 0.169 | 4.249 | 25.933 |
| Eight-concurrent total | 1,255.190 | 1,765.076 | 1,991.467 |
| Eight-concurrent JSON serialization diagnostic | 0.091 | 0.138 | 10.246 |

- Investigation (plan order): query embedding p95 is 14.8 ms single-thread, below the 100 ms target; under eight-way CPU contention it rises to 173.1 ms. Dense p95 is 93.3 ms single-thread and 919.7 ms concurrent. The isolated benchmark uses the embedded local Qdrant client with default HNSW settings and `with_payload=True` for complete chunk text/metadata. A controlled `hnsw_ef`/payload comparison was not run, so its contribution remains unmeasured. BM25 p95 is 136.7 ms single-thread and 996.0 ms concurrent. `BM25Index.search()` rebuilds a tenant-specific `BM25Okapi` over the matching corpus on each query, making it the first single-thread stage above 100 ms and the clearest per-query cost at this corpus size; sparse-vector alternatives remain a later option from the plan. JSON serialization of the five returned chunk dictionaries is 0.110 ms p95 single-thread, so it does not explain the total latency. No speculative optimization was applied.
- Deviations: the harness constructs production-shaped `Chunk` records directly and indexes them through the production embedder, Qdrant store, BM25 index, and retriever; this isolates retrieval latency from file parsing and disk ingestion overhead. Synthetic chunk bodies are compact (about 35 words), so full-payload dense latency may be lower than for production chunks near the 350-token target.
- Open risks / follow-ups: retrieval p95 misses the 100 ms target at 5k chunks, especially with eight concurrent requests. BM25 corpus filtering and concurrent CPU/backend capacity need evidence-backed follow-up work before optimization.

## Gate 7 final verification (2026-10-13)
- Status: **PASS** for the plan's retrieval-only p95 criterion and offline CI gates. The 50-case retrieval gate passes at hit@5 **1.000**, MRR **0.873**, and unanswerable accuracy **1.000**. A clean Python 3.11 checkout with Qdrant 1.11.3 passed the backend/eval suite (**460 passed, 1 skipped, 3 xfailed**), Ruff, mypy (61 files), route-auth enumeration, and golden-set validation. Frontend tests/build and the bundle secret scan passed in an earlier clean-checkout run (**294 tests**); rerun them at Gate 9 final regression.
- Clean-checkout 5k-point benchmark repeat, 200 measured queries/mode: retrieval-only p95 was **10.085 ms** at one worker, **31.641 ms** at four, and **76.142 ms** at eight. The S2 retrieval-only target of **<=100 ms** is met in all measured modes. Full totals including query embedding were **20.268/51.563/112.984 ms p95** at 1/4/8 workers; the eight-worker full total exceeds 100 ms and is reported separately from S2. Benchmark measurements vary with local resource contention.
- Langfuse export remains optional and disabled by default. The real-model DeepEval path is implemented and documented for scheduled/manual use but was not invoked in this offline run because it requires provider/judge credentials.

## Task 7.6 latency follow-up (2026-10-13)
- Change: `BM25Index` now prebuilds tenant-scoped `BM25Okapi` indexes when its corpus is built or updated. Searches reuse the tenant's same local corpus statistics and scores without filtering/reconstructing the BM25 model per query. Tests compare score/rank output against an independently built tenant-only corpus, verify searches do not rebuild models, and cover `add_chunks()` updates.
- Local 5k-point evidence after the BM25 change, using 500 documents, 200 queries per mode, 10 warmups, FastEmbed `BAAI/bge-small-en-v1.5`, and the production `HybridRetriever`: single-thread BM25 p95 fell from the recorded **136.697 ms** to **23.099 ms**; single-thread total p95 fell from **221.225 ms** to **159.969 ms**. Eight-way BM25 p95 fell from **996.048 ms** to **486.489 ms**; total p95 fell from **1,765.076 ms** to **1,275.927 ms**. The BM25 change preserves retrieval ranking and improves latency, but does not meet the **100 ms** target.
- Dense-search probes against local Qdrant did not improve total p95: `hnsw_ef=32` measured **173.277 ms** single-thread total p95, and `exact=True` measured **168.666 ms**. Both settings were reverted, leaving Qdrant's default search behavior. Default-search measurements varied across runs: dense p95 **119.078–126.348 ms**, total p95 **159.969–168.666 ms** after BM25 caching. Dense search alone exceeds the total target in these 5k local runs.
- Local payload profile on 200 queries at 5k points: raw `query_points` p95 was **74.584 ms** with full payload and **77.703 ms** without payload. Converting the 20 full payload hits into `Chunk` models took **0.156 ms p95**. This sequential, non-counterbalanced diagnostic did not demonstrate a material benefit from omitting payload; its measurements do not establish the dense-stage root cause, and full payload behavior remains unchanged. The production-stage p95 was **129.675 ms dense**, **33.980 ms embed**, **23.526 ms BM25**, and **177.590 ms total**; the eight-way total p95 was **1,154.782 ms**.
- Quality evidence after the change: `evals/eval_retrieval.py` passes 50 cases with hit@5 **1.000**, MRR **0.873**, unanswerable accuracy **1.000**, and evaluator p95 **11.380 ms** on its smaller golden corpus. This confirms golden-set quality remains above the existing thresholds; it does not represent the 5k-point latency benchmark.
- Server benchmark follow-up: `scripts/bench_retrieval.py --qdrant-url http://localhost:6333` created temporary collection `bench_d599c5b50aad4a84a147fc2b9d6f6c6f` and timed out during indexing at **1,200/5,000** points. Qdrant logs showed the process reached its **1,024 open-file limit** and stopped responding. After the benchmark process exited, the task-started Qdrant container was restarted; only that exact temporary collection was deleted, and `/healthz` plus collection listing verified recovery and cleanup. The configured application collection was not touched. Server-mode latency remains unmeasured; the benchmark now prints its UUID collection name and closes its client if cleanup fails.
- Open item at the time: the **100 ms total p95** definition-of-done gate remained unmet. The bottleneck was dense Qdrant search under the tested local client; a deployment-server comparison was pending because the service timed out during the run.

### Task 7.6 sparse BM25 and server latency follow-up
- Change: BM25 now precomputes sparse per-token weighted postings for the global and tenant-local corpora. Search accumulates only matching term postings, selects the top candidates, and keeps stable corpus-order tie handling. `add_chunks()` rebuilds global and tenant postings with their BM25 statistics.
- Correctness evidence: focused retrieval/store/benchmark tests -> **34 passed**; Ruff passed. The new regression compares unscoped and tenant-scoped rankings and scores directly with `rank_bm25.BM25Okapi` for multi-token, empty, unknown-term, tied-score, and post-`add_chunks()` queries. Golden evaluation -> **50 cases**, hit@5 **1.000**, MRR **0.873**, unanswerable accuracy **1.000** (gate PASS).
- Server measurement: `.venv/bin/python scripts/bench_retrieval.py --qdrant-url http://localhost:6336` used an isolated Qdrant 1.11.3 service, a UUID temporary collection, 5,000 points, 10 warmups, 200 measured queries per mode, and 1/4/8 worker modes. The report now includes `retrieval = total - embed` per query, matching plan S2's retrieval-only definition, while retaining full total and stage timings. Percentiles in milliseconds:

| Mode / measure | p50 | p95 | p99 |
|---|---:|---:|---:|
| Single embed | 10.005 | 11.450 | 12.442 |
| Single retrieval-only | 9.192 | 10.317 | 12.579 |
| Single total including embed | 19.116 | 21.369 | 23.055 |
| Four-way embed | 20.041 | 28.716 | 31.105 |
| Four-way retrieval-only | 23.241 | 32.343 | 34.976 |
| Four-way total including embed | 42.803 | 55.030 | 58.962 |
| Eight-way embed | 24.230 | 37.286 | 48.647 |
| Eight-way retrieval-only | 61.574 | 89.418 | 136.847 |
| Eight-way total including embed | 85.376 | 119.820 | 170.740 |
| Eight-way dense | 29.604 | 45.977 | 53.049 |
| Eight-way BM25 | 29.863 | 51.791 | 113.558 |

- Interpretation: the plan's retrieval-only p95 target of **100 ms** is met in all measured modes, including eight concurrent queries at **89.418 ms**. Full request total includes query embedding; its eight-way p95 is **119.820 ms**, while single and four-way full totals are below 100 ms. This separates the deployment retrieval gate from end-to-end embedding contention rather than labeling the eight-way full total as passing.
- Compared with the preceding server BM25-cache run, eight-way BM25 p95 decreased from **115.401 ms** to **51.791 ms**. The eight-way total p95 shifted from **173.488 ms** to **119.820 ms**; the remaining full-total p95 includes embedding p95 **37.286 ms**. The BM25 change does not alter candidate counts or tenant scope.
- Cleanup: the temporary server collection list was empty after the run; only disposable container `p76-bench-bounded-g76` was removed. Existing `meridian-qdrant` and configured application collections were not touched.
- Residual: full end-to-end p95 under eight simultaneous queries remains above 100 ms because the benchmark includes query embedding and CPU contention. The plan's S2 retrieval-only latency threshold is met; the full Gate 7 verdict remains subject to its other CI and quality conditions.

## Task 7.1 Tracing and tenant metrics (2026-10-13)
- Verified before change: tracing used an unbounded in-memory list, hard-coded one-model pricing, and request metrics omitted errors and latency. Retrieval stage timings existed but were not named spans.
- Tests added first: bounded local trace storage, span attributes, disabled Langfuse behavior, provider usage/estimation, error accounting, and tenant metric shape. The focused tests initially failed because the planned `LocalTracer`, `LangfuseTracer`, and usage normalizer were absent.
- Change summary: added the `Tracer` protocol, bounded `LocalTracer`, optional best-effort Langfuse export gated by `LANGFUSE_ENABLED` and both keys, normalized provider usage with approximate-token fallback, configurable `config/pricing.json`, and per-tenant rolling request/error/latency/token/cost metrics at admin `/v1/metrics`. Instrumented embed, dense search, BM25, fusion, rerank, generation, and verification with behavior-based span names. Live Langfuse observations retain nested span durations and one generation event per request; failures remain best-effort. Documented that in-memory data resets on process restart.
- Compatibility fix: raised the declared Langfuse minimum from 2.20.0 to 3.3.1, the documented minimum for typed observations and generation usage/cost fields used here. The lock resolves 4.14.4.
- Evidence after final tracing changes: `uv run pytest tests/ -q` -> **426 passed, 3 xfailed**; `npm --prefix web run test:run` -> **294 passed across 18 files**; `npm --prefix web run build` -> passed; `uv run ruff check packages services evals` -> passed; `uv run mypy packages services evals --ignore-missing-imports` -> no issues in 57 source files. Existing React test warnings and expected lazy-surface error logs remain. Langfuse tests are local/mocked and do not call the external service.
- Review: independent Luna reviews approved the final live-observation flow and confirmed SDK method compatibility; the dependency floor was separately checked against the official v3.3.1 API.
- Deviations: none.
- Open risks: remote Langfuse export is optional and requires credentials plus `LANGFUSE_ENABLED=true`; in-memory metrics reset on process restart.

## Task 0.1–0.3 Phase 0 baseline and verification (2026-10-10)
- Verified before change: checkout `f2a32e6`; plan references older `e2bc6fc`. Phase 0 audit classified all F-01..F-30 in `docs/findings-verification.md`.
- Test added (failing first): no tests added in this inventory task. Planned reproductions are being adapted to current findings; stale findings will not be encoded as expected bugs.
- Change summary: added findings verification and recorded current baseline, command outcomes, API/environment inventory, and plan deltas.
- Evidence after: `PYTHONPATH=backend .venv/bin/python -m pytest tests -q` -> 135 passed; `.venv/bin/ruff check .` -> all checks passed; Docker Qdrant started (client 1.19.0 warns against server 1.11.3).
- Evidence after: `.venv/bin/mypy ...` -> blocked by NumPy `.pyi` syntax incompatibility. `npm --prefix web test -- --run` -> 13 files passed, 2 failed; 254 tests passed, 3 failed out of 257. `npm --prefix web run build` -> succeeded. Historical probes -> 5 xfailed strict; all five standalone scripts completed.
- Deviations from plan: F-01/F-03/F-05/F-17/F-22 are fixed or materially changed; corresponding historical repros need assertions aligned to current behavior. Avoid committing obsolete failing bug repros.
- Open risks / follow-ups: app route import cannot run until `NEO4J_PASSWORD` is set; resolve frontend failures and mypy environment as their relevant work is reached.

### Phase 0 gate

- All F-01..F-30 have current classifications and evidence. Five repro scripts and five strict xfail tests are committed (`b71a135`).
- Baseline is recorded, including the three pre-existing frontend failures, mypy stub parser blocker, and Qdrant client/server compatibility warning.
- No target architecture mismatch was found; code changes since the reviewed commit are stale fixes already captured in the verification matrix. Proceeding to Phase 1 while carrying those baseline failures forward.

## Task 1.1 Semantic embedder (2026-10-10)

- Verified before change: production dense vectors were CRC32 token hashes; model setting BAAI/bge-m3 was unused. New embedder tests failed because the module did not exist.
- Change summary: pinned FastEmbed 0.9.0; added normalized float32 passage/query embedding protocol and wrapper; selected D1's BAAI/bge-small-en-v1.5 (384 dimensions); added FASTEMBED_CACHE_PATH configuration defaulting to storage/fastembed. App lifespan initializes and warms the model once before hydrating persisted chunks. Removed production hash embedding and re-embed legacy chunk vectors with the injected model.
- Tests: SHA256 FakeEmbedder exists only in tests; unit stores explicitly inject it. Provenance HTTP fixtures now own their corpus and retrieval pipeline so unrelated persisted documents cannot alter critic outcomes. Real BGE tests cover process determinism, configured dimension, and semantic answer similarity. Added stale-vector replacement and startup initialization checks.
- Evidence after: full Python suite -> 141 passed, 5 strict xfailed; Ruff -> all checks passed. Targeted mypy using --python-version 3.12 -> success for embedder/vector store/app; repository's configured 3.11 parser remains blocked by installed NumPy stub syntax as recorded in Phase 0.
- Self-review: no production pseudo-embedding fallback; passage/query APIs verified in pinned installed release; cache persists on disk; model weights downloaded and real semantic checks passed. Selectively staged only FastEmbed-related lock packages/metadata while retaining pre-existing user lock edits.
- Follow-up: existing Qdrant collection dimensions and index consistency remain Tasks 1.2/1.3; no automatic collection deletion added here.

### Task 1.1 follow-up — provider-failure probe

- Reviewer found the standalone F-11 probe still created a vector store without an embedder. Confirmed it stopped at indexing with `RuntimeError` before provider dispatch.
- Injected a configured FastEmbedEmbedder into the probe; product behavior unchanged.
- Evidence after: `scripts/repro/repro_f11_empty_draft.py` exits successfully, logs `repro provider failure`, and prints `is_refusal: true` plus the expected provider failure `generation_error`. Ruff for the probe passed.

## Task 1.2 Index manifest and disk record cleanup (2026-10-10)

- Verified before change: chunk JSON persisted model vectors and loaded them back into domain chunks; no index manifest or resumable reindex utility existed. New regression tests failed at import before implementation.
- Change summary: added atomic manifest read/write and consistency reporting for configured model/dimension, chunker version, disk/Qdrant/manifest counts, missing collection/manifest, and legacy embeddings. Disk writes omit embeddings, reads ignore legacy embeddings, and physical legacy fields remain until a successful reindex so startup can fail readiness until migration.
- Reindex: `python scripts/reindex.py` prompts before collection replacement (`--yes` skips confirmation); `--storage-root` and `--qdrant-path` support isolated directories. Reads disk strictly before deleting vectors, embeds batches of 64, verifies completed upserts and exact final count, preserves chunk IDs/text/metadata, removes legacy fields, and atomically writes the manifest. `--resume` resumes committed batches from a corpus/model/dimension/chunker/collection checkpoint; source changes or missing previously written points require a fresh rebuild. Repeated fresh rebuilds remain idempotent. Stop ingestion while rebuilding.
- Evidence after: 15 temporary-directory/in-memory Qdrant regression tests passed; combined manifest/embedder/historical probe suite -> 21 passed, 5 strict xfailed. Existing ingestion/index-inspector suite -> 12 passed. Scoped Ruff passed; mypy `--python-version 3.12` passed for manifest/storage/reindex (configured 3.11 parser blocker remains as recorded in Phase 0).
- Self-review: no calls touched the current storage or server collection; no silent vector fallback in reindex, no manifest published after a failed batch, and corrupt disk input stops before collection replacement. The CLI cancellation test proves refusal happens before loading the model or creating a client.
- Dependencies: Task 1.3 must retain/update reindex's deterministic point-ID helper and enforce actual Qdrant schema dimension; Task 1.6 must call `check_consistency(settings, qdrant_count, disk_count, storage_root=storage.root_dir)` at startup and wire `ok/reasons` into readiness/query gating. Current chunker provenance is `structural-v1`; bump it when the chunking algorithm changes.

### Task 1.2 review follow-up — resume and provenance safeguards

- Reviewer reproduced three gaps: a replaced Qdrant point with unchanged total count could pass resume; `--qdrant-path` could overwrite the default backend's manifest; malformed disk records `[{}]` could pass readiness at zero counts. Added regression tests first; the new cases failed before fixes.
- Resume now validates integer checkpoint bounds and batch boundaries, and retrieves every previously committed point ID in batches before continuing. Equal-count replacements fail before publishing a manifest.
- Local backend CLI usage now requires an explicit storage root distinct from default storage (resolved paths, including aliases). Its manifest stays isolated; a temporary local-Qdrant CLI test confirms the default manifest remains byte-for-byte unchanged.
- Consistency strictly reconstructs every disk chunk record and checks the actual count; invalid record fields, non-list JSON, and unreadable records fail readiness.
- Evidence: manifest/reindex + existing ingestion/index-inspector tests -> 39 passed. Scoped Ruff and mypy `--python-version 3.12` passed. All indexes involved were in-memory or under pytest temporary directories; current disk storage and real Qdrant were untouched.

## Task 1.3 Qdrant chunk store (2026-10-10)

- Verified before change: F-03 differed (legacy identifiers already had UUID normalization); F-04 remained confirmed: writes and queries silently used a custom memory cache on failure, and search payloads omitted metadata. New store/error regressions failed at import before implementation; the inspector regression then failed because an unavailable vector backend still advertised a fallback.
- Change summary: replaced `VectorStoreManager` with injected-client `QdrantChunkStore`, explicit cosine/dimension/schema checks, keyword indexes, fixed project UUID5 identifiers, 64-point synchronous batches, completed-operation checks, and exact per-tenant/document count checks. Search uses `query_points` and reconstructs complete chunks from payloads. Read/write failures raise typed exceptions; health reports the underlying failure. Tenant filters cannot be replaced by caller filters; deletion and clear preserve other tenants. Removed every custom dense-memory cache and fallback path, including obsolete inspector claims.
- Integration: pipeline/retriever now receive the embedder separately. App wiring selects explicit `VECTOR_BACKEND=qdrant|qdrant_local` and `QDRANT_LOCAL_PATH` (supports `:memory:`); collection initialization happens in lifespan. Existing catalog callers use paginated Qdrant payload reads until subsequent retrieval/startup tasks replace them with disk corpus reads. Reindex shares the new point IDs and store writes, retaining 64-chunk checkpoints via cumulative document counts. No user collection was dropped or rewritten.
- Evidence: initial focused suite -> 62 passed, 5 strict xfailed; final full Python suite -> 185 passed, 5 strict xfailed; store + inspector tests -> 24 passed. Repository Ruff passed; mypy for packages/services/evals/reindex passed with `--python-version 3.12`. Configured Python 3.11 mypy still stops at the pre-existing NumPy stub syntax error. The UUID repro prints a valid UUID5. Full-worktree whitespace check also reports pre-existing trailing whitespace in user-modified `AGENTS.md`; staged task-file checks are clean.
- Dependency/lock strategy: pinned `qdrant-client==1.11.3` to match server 1.11.3 and provide `query_points`; resolved its `grpcio-tools` addition and `portalocker` downgrade. Staged a task-only lock reconstructed from HEAD plus those package blocks and the Qdrant requirement. Pre-existing lockfile additions remain unstaged and intact.
- Self-review/follow-ups: all test index mutations used Qdrant memory or pytest temporary directories. Existing collection schema mismatches fail without deletion. Task 1.4 must materialize dense candidates from `ChunkHit.chunk`, supply tenant IDs, build BM25 from disk, and remove the existing hybrid local-map dependency. Task 1.6 must replace startup hydration with manifest readiness checks and make inconsistency return 503; the current bridge still hydrates through the pipeline.

## Task 1.4 Hybrid retrieval rewrite (2026-10-11)

- Verified before change: `HybridRetriever.retrieve` fused only the caller's `chunk_map`, dropped candidates absent from that map, materialized nothing from Qdrant payloads, ran the lexical reranker unconditionally, and returned bare `list[SearchResult]` with no timings. New tests for the payload-materialization/timeout contract failed against that implementation first.
- Change summary: rewrote `retrieval/fusion.py` (`FusedCandidate` with per-stage ranks/scores), `retrieval/bm25.py` (index text = `title > heading` + chunk text, `chunk_of` lookup), and `retrieval/hybrid.py` (`HybridRetriever(embedder, vector_store, bm25_index, rrf_k, pool_min)`, `retrieve(query, top_k, tenant_id, debug) -> RetrievalResult(chunks, timings_ms)`; pool = max(pool_min, 4*top_k); dense hits materialized from payloads, BM25-only hits from the disk-record corpus; tenant filter on both stages; optional reranker off by default; per-stage timings). Removed the `score >= 0.08` lexical filter from the graph nodes (pulled forward from Task 3.3 — RRF-scale scores ~0.03 would reject every chunk).
- Environment note: the repo `.venv` targeted Python 3.12 via `/bin/python3`, which the host has since moved to 3.14; rebuilt with `uv venv --python 3.11` and `uv pip install -e ".[dev]"`.
- Tests: `tests/test_retrieval.py` rewritten (RRF math, identifier hit, tenant filter, dense-only and BM25-only materialization, timings, ranking); updated `test_graph_topk`, `test_serving_provenance`, `test_plan_reproductions`, `test_agent_graph`, `scripts/repro/repro_f11_empty_draft.py` to the new constructor/return shape.
- Evidence after: full suite -> 205 passed, 5 strict xfailed; `ruff check .` -> all checks passed; `mypy packages services evals --python-version 3.11` -> success.
- Deviations: pipeline now stamps `tenant_id` on ingested chunk metadata and delete reads the tenant from the stored record (needed so retrieval scoping has truthful data; part of F-20 groundwork).
- Open risks: ingestion is still non-transactional (Phase 2); BM25 rebuild is full-corpus (acceptable per plan, measured in Phase 2 benchmark).

## Task 1.5 Retrieval-only endpoint and CLI (2026-10-11)

- Verified before change: no `/v1/retrieve` route existed; tests for it failed on construction.
- Change summary: added `POST /v1/retrieve` (`RetrieveRequest{query, top_k 1..20, debug}`) returning ranked chunks with stable score keys (`dense`, `bm25`, `dense_rank`, `bm25_rank`, `rrf`, `rerank`, `final`) and `timings_ms`; added `scripts/retrieval_check.py` (isolated `:memory:` Qdrant + temp storage, per-question top-k dump, hit@k, MRR, unanswerable flagging, latency p50/p95, exit code) and `evals/retrieval_smoke.json` (24 questions across the 4 `sample_docs/`: factual, identifier, numeric, paraphrase, near-duplicate, multi-chunk, 2 unanswerable).
- Tests: `tests/test_retrieve_endpoint.py` (shape/scores/timings, top_k, 401 without key, tenant scoping) and `tests/test_retrieval_metrics.py` (hit@k / reciprocal-rank math on synthetic rankings).
- Evidence after: `python scripts/retrieval_check.py --questions evals/retrieval_smoke.json --top-k 5` -> hit@5 = 1.000 (22/22), MRR = 0.852, latency p50 = 14.1 ms / p95 = 19.7 ms, 106 indexed points. Full suite 205 passed; ruff + mypy (3.11) clean.
- Deviations: unanswerable flagging uses a provisional `MIN_DENSITY`-style cut (best dense < 0.35); measured best-dense for off-topic questions was 0.47-0.53, so the threshold needs Task 3.4 calibration before it means anything.
- Open risks: smoke set is small (24); the >= 50-case golden set is Phase 7.

## Task 1.6 Startup readiness and consistency gate (2026-10-11)

- Verified before change: startup hydrated persisted chunks but never compared the index against config or disk; `/health` always reported healthy; no `/health/ready` or `/health/live`. New readiness/restart tests failed (404s, no gate).
- Change summary: lifespan now runs `check_consistency` after hydration and stores the report; `/health/ready` reports live qdrant/embedder/index/llm/neo4j checks (ready = qdrant + embedder + index consistent; a missing LLM key is informational so the provider error surfaces loudly); `_index_gate()` refuses `/v1/query` and `/v1/retrieve` with 503 `index_inconsistent` + reasons; added `GRAPH_ENABLED` setting (default false, D10); pipeline publishes the index manifest after ingest/delete/clear so provenance tracks disk truth; `get_all_chunks(None)` reads every tenant (startup hydration, lexical rebuild) and callers were fixed to match.
- Tests: `tests/test_startup_readiness.py` (real `/health/ready` checks, live route, tampered-manifest -> ready=false + 503 on both endpoints with exact restoration) and `tests/test_restart_persistence.py` (fresh embedder/client/store/pipeline over the same on-disk local Qdrant + storage -> identical chunk IDs, score diff < 1e-5).
- Evidence after: full suite 205 passed, 5 strict xfailed; ruff + mypy (3.11) clean. Docker Compose already gives Qdrant the named volume `qdrant_data`.
- Deviations: `ready` excludes `llm_configured` deliberately (documented in code).
- Open risks: manifest maintenance lives in the pipeline; a manual edit of `storage/chunks/` desynchronizes it until reindex (by design).

## Phase 2 continuation — ingestion and file tools (2026-10-11)

- Resumed from `session-log-handoff.md` at the unfinished Phase 2 integration, using Luna subagents for suite debugging, ingestion fixes, CLI implementation, and review. Existing unrelated documentation, session artifacts, and worktree edits were preserved.
- Task 2.1: introduced a shared block/page parser contract for Markdown, TXT, PDF, DOCX, and HTML. Extension/magic mismatches are rejected; text decoding warnings, per-page PDF quality warnings, encrypted/corrupt PDF errors, and heading/table/code structure are exposed. Empty/scanned PDFs remain visible as catalogued documents with zero garbage chunks.
- Task 2.2: replaced character windows with a documented approximate word/punctuation token counter, structural chunking, deterministic IDs, overlap, heading/page metadata, and content hashes. The counter is an approximation, not a guarantee about a model's BPE tokenizer.
- Task 2.3: added file ingestion, per-tenant hash duplicate detection, same-filename replacement, atomic originals/chunk/catalog writes, and typed ingestion errors. Added failure-injection coverage for Qdrant, graph extraction, partial original writes, manifest publication, and replacement/delete failures.
- Task 2.4: added sequential multipart `POST /v1/documents`, per-file results and rejection messages, chunk metadata reads, and a reindex endpoint. The JSON ingest endpoint uses the same parser/chunker/persistence components. The upload reader stops after the configured `MAX_UPLOAD_MB` limit plus one byte rather than buffering the whole oversized file. API integration tests exercise real PDF/MD/TXT parsers, local Qdrant, scan warnings, and source metadata with an injected test embedder.
- Task 2.5: added `scripts/ingest_folder.py` with per-file progress, warnings, duplicates, totals, indexed chunk count, and nonzero failure exit. Explicit isolated storage uses persistent local Qdrant; reopen/duplicate behavior is tested.
- Task 2.6: added `scripts/chunk_report.py` for file/document inspection (min/median/p95/max tokens, first three/last chunks, pages and empty pages), and `scripts/make_synthetic_corpus.py` for a deterministic 200-file MD/TXT/HTML corpus. The generator refuses to overwrite existing corpus files.
- Integration root cause: the pipeline published `token-aware-v1` while `check_consistency` expected a separate stale `structural-v1` constant. A regression failed for the exact version mismatch before making the manifest import the chunker's constant. The previously failing API/retrieval/provenance group then passed: 22 tests.
- Review limitations: Phase 5.5 closed tenant ownership enforcement for document catalog/detail/chunk/delete and tenant-scoped retrieval/graph evidence. Phase 3 calibrated the provisional unanswerable threshold; expanded golden-set coverage remains Phase 7. UI multipart upload integration remains Phase 6; backend/API support does not imply the browser UI can upload binary files yet.

### Gate 2 evidence

- `scripts/make_synthetic_corpus.py /tmp/meridian-phase2-corpus-20261011`: 200 generated files (67 MD, 67 TXT, 66 HTML), plus the four sample documents copied into the same isolated corpus.
- `scripts/ingest_folder.py <corpus> --storage-root /tmp/meridian-phase2-benchmark-20261011 --tenant eval`: 204 indexed, 0 duplicates, 0 failures, 235 chunks, 38.47 seconds, 5.30 files/second. Persistent local Qdrant resides under that explicit temporary storage root; user storage was not cleared or replaced.
- Repeating the bulk command after closing/reopening the local client: 204 duplicates, 0 newly indexed, 0 failures; 0.77 seconds. Disk has 204 catalog records and 235 chunks; maximum recorded approximate chunk-body token count is 350 (limit 450).
- `scripts/chunk_report.py sample_docs/01_fastapi_guide.md`: 10 chunks, min 124 / median 337.5 / p95 350 / max 350 approximate tokens. Multipart tests separately verify a real text PDF's page 1 metadata, Markdown heading paths, rejected/oversized rows, and scanned-PDF warnings with zero indexed garbage.
- Final `scripts/retrieval_check.py --questions evals/retrieval_smoke.json --docs <corpus> --top-k 5`: **hit@5 1.000 (22/22), MRR 0.909, p50 14.2 ms, p95 15.5 ms, 235 indexed points; GATE PASS**. These are local Qdrant measurements on 204 small files, not evidence for the separate 5k-chunk target. The timings include query embedding.
- Unanswerable threshold diagnostic: **0/2 flagged** at the provisional dense-score cut. This is an explicitly unresolved Phase 3 calibration result, not included in the answerable-retrieval gate.
- Update/delete failure recovery now restores original/catalog/chunk bytes and in-memory graph state, then reindexes the saved old chunks. Regression coverage includes disk failure after successful Qdrant deletion and graph failure after removing graph state. If the recovery operation itself cannot access the embedder/Qdrant/disk, it logs that failure and preserves the typed caller error; this is compensation, not a distributed database transaction.
- Legacy originals under `documents/` are deleted and restored using their stored basenames, including filenames with spaces. The existing JSON ingest response retains `title` and `chunks_indexed` for the current UI alongside the new per-file fields; the multipart response remains the new contract.
- Final integration verification: `.venv/bin/python -m pytest tests -q` with the normal plugin set and local socket access -> **263 passed, 5 expected failures, 38 warnings, 15.09 seconds**. `.venv/bin/ruff check .` -> all checks passed. `.venv/bin/mypy packages services evals --ignore-missing-imports --explicit-package-bases --python-version 3.11` -> no issues in 53 source files. Changed-code `git diff --check` passed; pre-existing whitespace in the owner's `AGENTS.md` was left untouched.
- Phase 2 gate passed. Phase 3 has not started.

## Task 3.1 — Grounded prompt builder (2026-10-12)

- Confirmed: generation previously used a permissive context prompt without an outside-knowledge prohibition or mandatory citation rule, and added a random request nonce to the system prompt.
- Added `generation/prompt.py` with the plan's exact grounding rules, numbered filename/page/heading sources, a default 6000 approximate-token source budget, selected-source tracking, and dropped-source logging. API source dictionaries remain unchanged.
- Source delimiter sequences are escaped case-insensitively so a document cannot close its own wrapper. Ordinary source text, code operators, ampersands, and literal entities are preserved for exact quotation; header line breaks cannot forge source entries.
- Tests first reproduced budget/source containment behavior and both review issues. Final scoped verification: 7 prompt tests passed, Ruff and owned-file whitespace checks passed; independent spec/quality review is clean. Provider tests were being implemented concurrently and their interim failures were not treated as prompt failures.
- Integration into graph/API is Task 3.3; the existing lexical critic remains a Phase 4 concern.

## Task 3.2 — Providers and environment configuration (2026-10-12)

- Confirmed: direct-provider calls could borrow the LiteLLM master key; multiple providers shared `custom_base_url`; the Anthropic URL could contain `/v1/v1/messages`; malformed upstream JSON became plain answer text; missing usage was invented; generation errors were not typed.
- Added explicit provider adapters for OpenAI, Anthropic, OpenRouter, DeepSeek, Groq, Ollama, and custom OpenAI-compatible endpoints. Direct routes use only their own keys and URLs; LiteLLM proxy routes retain proxy-only master-key support. Anthropic uses native headers and exactly one `/v1/messages` suffix.
- Network/HTTP/malformed/empty responses now raise `ProviderError` or `ProviderConfigError`. Connect/read timeouts are 5/60 seconds; 429/5xx responses receive one retry. JSON and SSE responses are validated. Configured keys are redacted from response/error string values at every length. Upstream usage is returned as supplied, or null; per-response provider/model metadata supports the later query integration.
- The user's `.env` parsed successfully with `API_KEY`, `BASE_URL`, and `MODEL`. Generic values override stale saved UI configuration and select custom OpenAI-compatible routing when `PROVIDER` is omitted. Standard `LLM_*` aliases also work, with generic names taking priority. `.env.example` contains general placeholders, not the user's values; the real `.env` is unchanged and ignored by Git.
- The local endpoint's model-list request returned 200 and included the requested `kilo-auto/free`. A real one-token generation returned 200 with content, usage, and served model `nvidia/nemotron-3-ultra-550b-a55b:free`. Listing is explicitly labelled listing-only; `/v1/settings/test` and its legacy alias now perform an actual one-token generation.
- Test-first fixes cover exact provider URL/header/body contracts, direct/proxy key separation, usage, retries, malformed JSON/SSE, environment precedence/aliases, and secret redaction. Final implementation evidence: 94 focused tests passed, one query/graph test intentionally deferred to Task 3.3; scoped Ruff and whitespace checks passed. Independent task review closed the substantive findings.
- This review note's limitations were subsequently closed: Phase 5 added API-key-derived tenant and user/admin roles; Task 3.5 sanitized serialized debug output; Task 3.3 added RAG HTTP error handling and per-request provenance.

## Task 3.4 — Dense-score calibration (2026-10-12)

- Added `scripts/calibrate_threshold.py`: isolated real FastEmbed/Qdrant ingestion, per-question top dense scores, answerable/unanswerable distributions, deterministic accuracy/Youden threshold sweep, and a JSON summary option. It refuses missing/empty/unusable corpora and invalid evaluation data rather than publishing a misleading zero-score recommendation; known ingestion/index errors produce concise nonzero exits.
- Real command: `.venv/bin/python scripts/calibrate_threshold.py --docs sample_docs --questions evals/retrieval_smoke.json --output .superpowers/sdd/meridian-phase3-plan/calibration-result.json` (temporary index/storage; no user corpus mutation).

| Group | Cases | Minimum | Median | Maximum |
|---|---:|---:|---:|---:|
| Answerable | 22 | 0.708430 | 0.781553 | 0.885611 |
| Unanswerable | 2 | 0.390372 | 0.451279 | 0.512185 |

- Measured Youden optimum: **0.7084295241**, sensitivity/specificity/accuracy 1.000 on these 24 cases. Chosen configuration default: **MIN_DENSE_SCORE=0.70**, rounded slightly below the positive minimum to keep a margin. The setting and range validation were committed with shared provider configuration in `2833754`; query consumption is part of the in-progress Task 3.3 integration.
- Both unanswerable queries also had five positive BM25 candidates, from incidental overlaps such as "recommended" and "world". Raw BM25 positivity therefore cannot by itself prove sufficiency. Task 3.3 applies substantive-query coverage or structured-identifier evidence while retaining dense-score sufficiency as an alternative.
- Tests first covered hand-calculated threshold math, CLI behavior, missing/empty directories, a real supported-but-empty text file, and typed ingestion/Qdrant failures. Final scoped verification: **12 tests passed**, Ruff passed; independent CLI/math review is clean after the failure cases were added.
- Limitation: the evaluation set has only two negatives; this is corpus-specific calibration, not evidence of general hallucination rejection. The expanded golden dataset and wider evaluation remain Phase 7.

### Task 3.2 typing follow-up

- Repository mypy identified two optional-provider-spec index errors. A separate validated direct-provider lookup removes the ambiguity while preserving proxy behavior; scoped review confirmed unchanged URL/key/body handling. Provider-client tests: 29 passed; Ruff and `mypy services/gateway/client.py` passed.

## Gate 3 — Real-provider validation (2026-10-12)

- Configuration: new ignored `.env` parsed without duplicate keys or malformed entries. Explicit `API_KEY`, `BASE_URL=http://localhost:3010/v1`, and `MODEL=kilo-auto/free` override saved UI settings; `.env.example` now documents generic placeholders and optional `PROVIDER`. No key was printed or committed.
- Validation used real FastEmbed and an isolated temporary corpus/index containing the four sample Markdown documents; normal API authentication and actual provider calls were used. Existing user storage and `.env` were unchanged.
- Ten of ten requests returned HTTP 200 with `answer_status=answered`, five sources, valid in-range numbered citations, source filenames/headings/scores, and upstream usage. Nine responses reported `nvidia/nemotron-3-ultra-550b-a55b:free`; one reported `dots-studio/dots-3-note-preview:free`. This router selects the serving model dynamically. Answers were inspected against returned source text; this small smoke run does not replace Phase 4 semantic verification.

| Case | Total ms | Retrieval ms | Generation ms | Verify ms | Prompt/completion tokens |
|---|---:|---:|---:|---:|---:|
| q-001 | 6728.1 | 15.6 | 6697.7 | 2.7 | 2011/482 |
| q-002 | 7829.1 | 22.6 | 7793.0 | 5.1 | 2486/352 |
| q-005 | 3739.5 | 27.4 | 3698.4 | 3.8 | 2233/292 |
| q-006 | 2637.1 | 21.1 | 2602.3 | 4.3 | 2000/186 |
| q-007 | 2230.5 | 21.7 | 2199.3 | 1.8 | 2049/119 |
| q-008 | 6790.4 | 23.9 | 6753.7 | 4.5 | 2019/504 |
| q-010 | 11435.7 | 27.8 | 11383.0 | 10.1 | 2095/538 |
| q-012 | 8359.9 | 18.8 | 8327.8 | 1.8 | 1960/143 |
| q-016 | 6452.9 | 27.1 | 6413.6 | 2.9 | 1953/219 |
| q-018 | 6047.9 | 28.0 | 6006.1 | 1.9 | 1871/209 |

### Recorded answers and source references

**q-001: What command starts the FastAPI development server?**

The FastAPI development server is started with the command `fastapi dev` (commonly run via `uv run fastapi dev`) [1][2][3][4].

Cited files: [1] 01_fastapi_guide.md, [2] 01_fastapi_guide.md, [3] 01_fastapi_guide.md, [4] 01_fastapi_guide.md.

**q-002: What URL serves the interactive API docs?**

The interactive API documentation (Swagger UI) is served at **http://127.0.0.1:8000/docs** [3][5].

Cited files: [3] 01_fastapi_guide.md, [5] 01_fastapi_guide.md.

**q-005: Which decorator registers a path operation for GET requests?**

The `@app.get()` decorator registers a path operation for GET requests [1][4].

Cited files: [1] 01_fastapi_guide.md, [4] 01_fastapi_guide.md.

**q-006: Which port serves the Qdrant web dashboard?**

The Qdrant web dashboard is served on port **6333** (the same port as the REST API). According to the documentation, the Web UI is accessible at `localhost:6333/dashboard` [1].

Cited files: [1] 02_qdrant_vector_db.md.

**q-007: What distance metric does the quickstart collection use to compare vectors?**

The quickstart collection uses a **dot product distance metric** to compare vectors [1].

Cited files: [1] 02_qdrant_vector_db.md.

**q-008: What vector size does the quickstart collection configure?**

The quickstart collection configures a vector size of **4** [1]. This is shown in the collection creation code across all language examples (Python, TypeScript, Rust, Java, C#, Go) where `size=4` or `Size = 4` is specified in the `VectorParams`. The example vectors in the quickstart also contain 4 elements each [2][3], and the query vector has 4 dimensions [4].

Cited files: [1] 02_qdrant_vector_db.md, [2] 02_qdrant_vector_db.md, [3] 02_qdrant_vector_db.md, [4] 02_qdrant_vector_db.md.

**q-010: How do you initialize a Qdrant client pointing at the local server?**

To initialize a Qdrant client pointing at the local server in Python:

```python
from qdrant_client import QdrantClient

client = QdrantClient(url="http://localhost:6333")
```

This uses the REST API on port 6333. Other languages use the gRPC interface on port 6334 (e.g., Rust, Java, C#, Go) [1].

Cited files: [1] 02_qdrant_vector_db.md.

**q-012: Which port does the LiteLLM gateway listen on?**

The LiteLLM gateway listens on port **4000** [1][3].

Cited files: [1] 03_litellm_proxy_quickstart.md, [3] 03_litellm_proxy_quickstart.md.

**q-016: Which endpoint do you post to for chat completions through the gateway?**

You post to `/v1/chat/completions` on the gateway (e.g., `http://localhost:4000/v1/chat/completions`) [1].

Cited files: [1] 03_litellm_proxy_quickstart.md.

**q-018: Which environment variable sets the Anthropic API key?**

The environment variable that sets the Anthropic API key is `ANTHROPIC_API_KEY` [1][2].

Cited files: [1] 04_litellm_provider_keys.md, [2] 04_litellm_provider_keys.md.

### Failure and prompt evidence

- Both unanswerable cases (`q-023`, `q-024`) returned `insufficient_context` with exactly zero provider calls. The actual invalid-key request returned HTTP 502, code `provider_error`, message `Provider custom returned HTTP 401`, and upstream message `Invalid or missing router API key`.
- `DEBUG_LOG_PROMPTS` was enabled only for the first real question. The captured prompt contained all five numbered source blocks and the exact grounded system message; serialized logging removes the active key. A shortened source excerpt follows (the actual log contains the complete prompt and raw response):

```text
Question: What command starts the FastAPI development server?
Sources:
[1] (file: 01_fastapi_guide.md, page: None, section: First Steps > Check it)
<source_text>
fast →uv run fastapi dev   FastAPI   Starting development server 🚀
...
</source_text>
```

- Calibration is consumed by the graph at `MIN_DENSE_SCORE=0.70`; lexical evidence also requires substantive term coverage or a structured identifier. The heuristic may reject sparse lexical-only matches; the expanded golden dataset remains Phase 7. Phase 5 now derives tenant and role from API-key configuration.

### Tasks 3.3 / 3.5 final integration verification

- Query generation now uses the exact requested bounded top-k, calibrated sufficiency on the prompt-selected sources, typed provider errors, total-attempt cycle limits, actual usage, source metadata including chunk index, per-request serving provenance, and opt-in sanitized prompt/raw-response logging. Graph memory and expansion follow `GRAPH_ENABLED`.
- Independent review identified three regressions: qualifying evidence dropped by the prompt budget, empty/runtime generation failures becoming refusals, and missing source chunk index. Regression tests failed first, then fixes passed; scoped re-review closed all three findings.
- Final parent verification: `.venv/bin/pytest tests -q` -> **333 passed, 4 xfailed**; `.venv/bin/ruff check .` -> clean; `.venv/bin/mypy packages services evals scripts --ignore-missing-imports --explicit-package-bases --python-version 3.11` -> **69 files clean**. Four expected failures remain in later planned phases.

### Phase 3 final review and decisions

- Independent final Luna review found no actionable correctness findings. Phase 3 is complete; the branch remains `fix/rag-core` with unrelated user edits preserved. Phase 4 remains next.

- Continue in the existing fix/rag-core workspace — this is a requested continuation with unfinished user edits; moving the work would lose that context. Cost if wrong: less branch isolation, mitigated by selective commits.
- Build isolated prompt/provider modules independently, then integrate graph/API after their reviews — no shared mutations and no phase boundary crossed. Cost if wrong: interface reconciliation before integration.
- Treat absent PROVIDER with explicit generic.env variables as custom/OpenAI-compatible, and prefer these explicit environment values over stale saved UI settings — user specifically requests the new.env config. Cost if wrong: UI changes appear overridden until env is changed.
- Escape source markup in the prompt while preserving original API source text — the data-wrapper requirement takes precedence over literal inclusion of raw closing tags. Cost if wrong: code snippets appear as entities in the model input.
- Set MIN_DENSE_SCORE default0.70 (rounded below the measured positive minimum0.7084295241) — preserves a small margin while negatives top out0.5121848747. Cost if wrong: corpus/model-specific false positives; onlytwo negatives measured.
- A BM25 hit for sufficiency must be positive and cover at least half of substantive query terms, or match a structured identifier — raw positivity incorrectly admits both realnegativequeries through incidental words. Dense evidence remains an alternative. Cost if wrong: false refusals for sparse lexical-only matches; covered by identifier and paraphrase regressions, revisit with Phase7golden set.
- The Phase 3 settings-generation test initially retained single-key authentication because the auth configuration could not express roles; Phase 5 subsequently introduced API-key tenant and user/admin roles. Cost if wrong: a current valid shared key could call generation tests; no public endpoint was introduced.

## Task 4.1 Honest reranker evaluation (2026-10-12)

- Replaced the mislabeled lexical `CrossEncoderReranker` with `LexicalReranker` (word-overlap heuristic) and a real FastEmbed `TextCrossEncoder` implementation. FastEmbed 0.9.0 exposes `TextCrossEncoder(model_name, ...)` and `rerank(query, documents, batch_size=64)`; its supported model list does not include the former `BAAI/bge-reranker-large` default, so the configured default is the supported `Xenova/ms-marco-MiniLM-L-6-v2` (80 MB).
- `RERANKER` defaults to `none`; lexical and learned modes are opt-in. Both rerank only the first `max(20, 2*top_k)` fused candidates and return at most `top_k`. `scores.rerank` remains null when no reranker runs.
- Evaluation command: `uv run python -u scripts/eval_retrieval.py --reranker all` (CPU; 22 answerable questions in `evals/retrieval_smoke.json`, top-k 5). Measured table:

  | Reranker | hit@5 | MRR | retrieval p95 |
  |---|---:|---:|---:|
  | none | 1.000 | 0.924 | 54.4 ms |
  | lexical | 0.955 | 0.886 | 57.6 ms |
  | cross_encoder | 1.000 | 0.955 | 11323.8 ms |

- The cross-encoder model files were fetched and evaluated, not skipped. Its MRR gain over `none` is 0.031, but CPU p95 exceeds the 150 ms gate by 11173.8 ms; lexical lowers both quality metrics. Keep `RERANKER=none` as the default.
- Evidence: `uv run python -u scripts/eval_retrieval.py --reranker all` -> table above; focused reranker/retrieval/endpoint tests -> 18 passed; scoped Ruff and mypy -> clean. Small smoke set and CPU-only latency limit generalization.

## Task 4.2 Verification modes and real-provider checkpoint (2026-10-12)

- Verification semantics: `citations` checks sentence/line citation presence, source indices, and cited numeric values; it reports citation validity without judging factual truth. `llm` uses a temperature-zero judge and returns `supported`, `unsupported`, or `unchecked`; `off` returns `unchecked` without a provider call. Insufficient-context answers skip the citation-presence requirement.
- Real-provider contradiction check already run with `mode="llm"`: for “What is Qdrant?”, source `[1] Qdrant is a vector database.`, and answer `Qdrant is not a vector database. [1]`, the result was `unsupported`; the judge identified the claim and said source [1] directly contradicted it. No credential or private environment value was recorded.

## Task 4.4 Contradiction verification regression (2026-10-12)

- Added `test_contradiction_not_supported` for the documented Qdrant contradiction. A fake judge returning `supported=false` yields `unsupported`, and the contradiction remains in the verification result. The existing citations-mode regression for the same answer continues to assert `citations_ok`.
- Verification: both contradiction tests passed with `.venv/bin/pytest`; `ruff check tests/test_rag_verification.py` passed. System `pytest` could not load project conftest because its environment lacks `qdrant_client`.

## Phase 4 gate (2026-10-12)

- Updated the stale greeting provenance test for Phase 4's removal of the greeting bypass. It now exercises the normal RAG path with a stubbed upstream response, avoiding an unmocked provider call in the suite; the existing insufficient-context test covers the no-model provenance path.
- Final verification: `uv run pytest -q` -> **357 passed, 3 xfailed**; `uv run ruff check .` -> clean; `uv run mypy packages services evals scripts --ignore-missing-imports --explicit-package-bases --python-version 3.11` -> **67 source files clean**. Pytest emitted the existing missing `/run/secrets` and FastAPI `on_event` deprecation warnings.
- Phase 4 decisions: keep `RERANKER=none` because the CPU cross-encoder exceeded the 150 ms p95 gate; citation mode claims only citation/numeric consistency, while factual support requires LLM mode; final unsupported judge verdicts return a safe refusal with sources and unsupported verification retained.

## Phase 4 independent re-review follow-up (2026-10-12)

- Re-review found numeric comparison discarded leading signs, allowing a negative value to match a positive cited value. Normalization now retains `+`/`-` around numeric values and currency prefixes.
- Added negative percentage and plain-number regressions. Both failed before the fix and pass afterward; `uv run pytest -q tests/test_rag_verification.py` -> **20 passed**; scoped Ruff and mypy checks passed.

## Task 5.4 Provider settings and outbound URL boundary (2026-10-13)
- Added `ALLOW_PRIVATE_PROVIDER_URLS` (default false) to server settings and Compose app configuration. Public HTTPS provider targets are resolved and pinned at the shared generation client; model-list requests use the same policy. Redirects and ambient proxy configuration are disabled for generation requests.
- Local loopback LiteLLM remains available without enabling private URLs. Other local/private provider endpoints require the explicit setting. A reviewed bypass that implicitly trusted all LiteLLM proxy addresses was removed; private/link-local targets are rejected by default before any POST.
- Evidence: `uv run pytest tests/test_provider_ssrf.py tests/test_provider_client.py tests/test_settings_security.py tests/test_serving_provenance.py -q` -> **80 passed**; scoped Ruff and `git diff --check` -> clean.
- Limitation: enabling the private URL option is an operator trust decision for private endpoints; it is intended for controlled local/private model services.

## Task 5.6 Guardrails and prompt-injection hygiene (2026-10-13)
- Verified before change: a client `enforce_guardrails=false` skipped input checks; uploaded chunks had no injection flags or warning; output checks left email/SSN/card patterns intact; the UI and ADRs claimed NeMo/Colang while the runtime used regexes; `policy.yaml` was unused.
- Test added (failing first): client-disable default, output PII redaction, ingestion chunk metadata, and upload warning regressions. Against the old behavior, the client-disable test returned 200 instead of 400; output returned the raw email; ingestion had status `indexed` without warning. These failed before their fixes.
- Change summary: default `ALLOW_CLIENT_DISABLE_GUARDRAILS=false` now ignores a client opt-out, with an explicit server opt-in. Shared rule patterns flag chunk metadata and add upload warnings. Output guardrails redact PII. UI/API/docs describe rule-based guardrails; removed unused `policy.yaml`. Existing query prompts continue to wrap sources in `<source_text>` and label them data.
- Evidence after: `.venv/bin/python -m pytest tests/test_api_seam.py tests/test_ingestion.py tests/test_generation_prompt.py tests/test_gateway.py -q` -> **31 passed**; scoped Ruff -> clean; scoped mypy -> **7 source files clean**; Guardrails UI tests -> **35 passed**; `npm --prefix web run build` -> succeeded. The test runs show existing missing `/run/secrets` and FastAPI `on_event` warnings.
- Deviations from plan: chose the plan's unused-YAML deletion option; regex rules remain in code as the single runtime source.
- Open risks / follow-ups: rules detect known phrases and patterns only; they do not provide general prompt-injection or PII detection.

## Task 5.6 review R1 — honor configured input/output guardrail switches (2026-10-13)
- Verified before change: query processing ignored `enable_input_guardrails` and `enable_output_guardrails`, even though both settings default to true.
- Test added (failing first): disabling output guardrails still redacted the response email; disabling input guardrails still rejected a known injection query. Both regressions failed before the fix.
- Change summary: input and output enforcement now each honor their server setting, in addition to the existing client opt-out rule and its default-deny setting.
- Evidence after: `.venv/bin/python -m pytest tests/test_api_seam.py tests/test_gateway.py -q` -> **20 passed**; scoped Ruff -> clean; scoped mypy -> no issues in `services/rag_engine/app.py`.
- Deviations from plan: none.
- Open risks / follow-ups: rules detect known phrases and patterns only; disabling either server-side switch intentionally disables that class of check.

## Gate 5 evidence (2026-10-13)
- `uv run pytest -q` -> **412 passed, 3 xfailed**; includes route-auth enumeration, production default-key rejection, secrets, guardrail behavior, and tenant isolation.
- `npm --prefix web run test:run` -> **262 passed**; `npm --prefix web run build` -> succeeded.
- Rebuilt with the same synthetic configured-key values used by CI; exact key and configured-key pattern scans over `web/dist` found no matches.
- `uv run ruff check .` -> clean; `uv run mypy packages services evals scripts --ignore-missing-imports --explicit-package-bases --python-version 3.11` -> **69 source files clean**.
- Gate 5 passed. Existing warnings: missing `/run/secrets` directory, FastAPI `on_event` deprecations, and React test `act()` warnings.

## Task 6.1 Typed API errors and v2 response types (2026-10-13)
- Verified before change: API failures were rejected as `ApiError` but kept raw 401/429 text, omitted the `index_inconsistent` response envelope, and had no app-level notice for requests caught by loaders. Query response types omitted `answer_status`, verification details, debug data, ranked sources, timings, and usage fields present in `packages/core/models.py`.
- Test added (failing first): status mapping, index inconsistency action, and app-level failure event tests -> **4 expected failures** before implementation (401/429 copy, index error code/action, and event dispatch); existing 22 API tests passed.
- Change summary: `api.ts` now maps 401 to “Enter API key”, 429 to “Rate limited”, and 503 `index_inconsistent` to a reindex instruction, dispatches failures globally, and still throws typed errors for inline surfaces. Added an accessible app-level error notice; updated query/search/ingest/error payload types to match the backend v2 contracts. Readiness polling retains its existing health-chip state instead of creating a repeated global notice.
- Evidence after: `npm run test:run` -> **266 passed**; `npm run build` -> **TypeScript and Vite build succeeded**. A first full-suite run caught two new opacity color tokens outside the token registry; the notice now uses existing `fail-wash`/surface tokens and the full suite passes. Existing React `act()` and deliberate lazy-import failure logs remain.
- Deviations from plan: added the app-shell notice component and its test so errors remain visible even when existing surface loaders catch the rejected promise. No Task 6.2+ changes.
- Open risks / follow-ups: errors from HTTP calls are now visible globally and remain rejected for inline handling; UI callers that intentionally catch errors may still need individual inline treatment as Phase 6 continues.

## Task 6.2 Multipart document upload (2026-10-13) — fixes: F-08
- Verified before change: `IngestionStudio` used `FileReader.readAsText`, accepted only one file, and submitted text through `/v1/ingest`; the existing `/v1/documents` endpoint accepts repeatable multipart `files` and returns per-file status, page/chunk counts, warnings, duplicate references, or rejection reasons.
- Test added (failing first): multipart API auth/tenant/header test and upload UI selection/result/drop tests -> **3 expected failures** before implementation (missing upload API, single-file picker, and no per-file result UI).
- Change summary: added typed upload results and `api.uploadDocuments`, which posts repeated `files` in `FormData` with API-key and tenant headers and lets the browser set the multipart content type. The ingestion UI now supports selecting or dropping multiple `.md`, `.txt`, `.pdf`, `.docx`, and `.html` files and displays each API result, including status, pages, chunks, warnings, duplicates, and rejection errors. Manual text ingestion remains available.
- Evidence after: focused upload tests -> **45 passed**; `npm run test:run` -> **266 passed**; `npm run build` -> TypeScript and Vite build succeeded.
- Deviations from plan: none.
- Open risks / follow-ups: none for this task; file parsing and duplicate decisions remain backend responsibilities.

## Task 6.2 review follow-up — duplicate upload status (2026-10-13)
- Verified before change: backend `IngestResult` returns `status: "duplicate"` with `duplicate_of`; the frontend upload union omitted that status and counted every non-rejected result as newly indexed.
- Test added (failing first): updated the upload-results regression with the actual duplicate response and asserted the toast reports only one newly indexed file; it failed because the old toast reported two.
- Change summary: added `duplicate` to `DocumentUploadResult.status` and limited the success count to `indexed` and `indexed_with_warnings` results.
- Evidence after: focused component suite -> **18 passed**; full `npm run test:run` -> **266 passed**; `npm run build` -> TypeScript and Vite build succeeded.
- Deviations from plan: none.
- Open risks / follow-ups: none.

## Task 6.3 Honest readiness and generation status (2026-10-13)
- Verified before change: `/health/ready` already existed and drove the shell health chip, but the app shell polled every 10 seconds, Diagnostics refreshed readiness only on manual refresh, and the provider/model header fabricated OpenAI defaults before settings loaded. The actual saved-config generation test existed only inside the Settings modal.
- Test added (failing first): shell and Diagnostics regressions for a 15-second readiness poll, and an app-shell regression for status from the saved-config generation check. Before implementation the poll test observed a second request by 10 seconds, and the shell lacked generation status.
- Change summary: the shell and mounted Diagnostics view now poll `/health/ready` every 15 seconds and clear their intervals on unmount. The shell reports the last saved-config generation check result; provider/model details render only when returned by settings instead of using hard-coded defaults.
- Evidence after: `npm run test:run` -> **269 passed**; `npm run build` -> TypeScript and Vite build succeeded. Existing React `act()` and deliberate lazy-import failure logs remain.
- Deviations from plan: none.
- Open risks / follow-ups: the generation indicator reflects the latest saved-config test performed in the current app session; it does not imply continuous provider reachability.

### Task 6.3 review follow-up — invalidate test status after save
- Verified before change: the shell retained a successful generation-test indicator after Settings saved and applied the provider configuration.
- Test added (failing first): extended the app-shell regression to pass the saved-config generation test, save settings, and assert the status returns to “Generation not tested”; it failed while the shell still showed “Generation test passed.”
- Change summary: a successful Save & Apply now invalidates the shell's generation-test status, including when the saved values are unchanged.
- Evidence after: focused tests -> **50 passed**; full `npm run test:run` -> **269 passed**; `npm run build` -> TypeScript and Vite build succeeded. Existing React `act()` and deliberate lazy-import failure logs remain.
- Deviations from plan: none.
- Open risks / follow-ups: none beyond the Task 6.3 session-scoped status limitation recorded above.

## Task 6.4 Main-app guardrail check route (2026-10-13) — fixes: F-07
- Verified before change: the RAG app had a POST guardrail handler protected by Phase 5 `require_user`, but hid it from the API schema as a deprecated alias; the UI sent guardrail text in a GET query string.
- Test added (failing first): main-app route visibility and frontend POST-body regressions failed as expected (`include_in_schema` was false; frontend still sent `?text=...`). Added a POST missing-key check to protect the Phase 5 auth contract.
- Change summary: made the authenticated POST handler the documented contract and marked the retained GET route deprecated. The UI now posts `{text}` as JSON to the main app with the existing API-key and tenant headers, keeping submitted text out of URLs.
- Evidence after: `.venv/bin/python -m pytest tests/test_rag_engine_api_fixes.py -q` -> **10 passed**; frontend API and GuardrailsStudio tests -> **36 passed**; `npm run build` -> TypeScript and Vite build succeeded; scoped Ruff -> clean.
- Deviations from plan: none.
- Open risks / follow-ups: none for Task 6.4.

## Task 6.5 Catalog authentication and tenant context (2026-10-13)
- Verified before change: the document list/detail/delete UI already passed its active tenant ID and the shared API client supplied its current API key. The catalog client methods still defaulted an omitted tenant to `default`, allowing a caller to silently query or mutate another tenant's catalog. Backend routes authenticate through `require_user` and scope records by the authenticated tenant.
- Test added (failing first): catalog API key/tenant header regression and missing-tenant regression. The latter failed before implementation because the request proceeded with the default tenant and surfaced a network `fetch failed` instead of rejecting the missing tenant.
- Change summary: made the tenant argument required for catalog list, detail, and delete calls; the client rejects missing or blank tenant IDs before issuing a request. Existing callers pass their active tenant explicitly, while the shared API client supplies the current session API key.
- Evidence after: focused API and catalog UI tests -> **46 passed**; `npm run build` -> TypeScript and Vite build succeeded.
- Deviations from plan: none.
- Open risks / follow-ups: none for Task 6.5.

## Task 6.6 View states, keyboard access and mobile layout (2026-10-13)
- Verified before change: Corpus briefly rendered its empty state before the initial catalog request settled; Review Queue showed a blank table during its first request; Metrics had no initial loading announcement and kept three KPI columns at phone widths. Ask source rows handled clicks on a non-focusable table row, so keyboard activation did not open a citation. Follow-up Ask requests also removed the previous answer while pending. Settings opened with provider defaults while saved data loaded, without a visible load state or local retry message; the Settings provider picker also used multiple columns below 640px. Corpus and Ask tables could overflow their viewports.
- Test added (failing first): initial catalog, review, metrics, Ask keyboard/pending, and Settings loading/error regressions. Before implementation, the UI tests observed no catalog/review/metrics/settings loading announcement and the Ask citation button had no activation handler; the Settings loading assertion failed on “Loading saved provider settings…” being absent.
- Change summary: added announced pending/empty states where the first request otherwise looked empty, plus a retry message for failed Settings loads. Ask now keeps a reserved answer area and preserves the previous answer during follow-up requests; citation buttons open their chunks from the keyboard. Metrics and Settings use one column below 640px, and long tables scroll within focusable, named wrappers. Added visible focus styling to the shared overlay close button.
- Evidence after: `npm run test:run` -> **276 passed across 17 files**; `npm run build` -> TypeScript and Vite production build succeeded.
- Deviations from plan: none.
- Browser follow-up (2026-10-13): used browser-harness against the running Vite app at 390 × 844 and an effective 614 px viewport. Ask was visually inspected at 390 px; Corpus, Index & Storage, Guardrails, Review Queue, and Metrics were opened at both widths. `document.documentElement.scrollWidth` matched `innerWidth` on every checked screen. Corpus and Review Queue displayed their loading states while the local backend had no corresponding data. This confirms viewport fit and loading feedback; it does not verify populated data layouts.
- Deviations from plan: none.
- Open risks / follow-ups: populated Corpus/Review tables were not available for visual inspection; their horizontal scrolling behavior remains covered by UI tests.

### Task 6.6 review follow-up — stable loading geometry
- Verified before change: “Refreshing answer…” was inserted into normal document flow above the current answer, and Metrics mounted its loading banner only while the request was pending, changing downstream positions when each state toggled.
- Test added (failing first): Ask follow-up request status-slot geometry and Metrics loading-slot reservation regressions -> **4 expected failures** before implementation (missing stable test hooks/height reservations).
- Change summary: the Ask answer card now keeps a one-line live status slot in its layout at all times, so the follow-up status does not move answer content. Metrics keeps a 3rem loading status slot after the banner clears.
- Evidence after: focused `npm run test:run -- src/components/RagWorkspace.test.tsx src/components/MetricsDashboard.test.tsx` -> **67 passed**; `npm run build` -> TypeScript and Vite production build succeeded.
- Deviations from plan: none.
- Open risks / follow-ups: none.

## Task 6.7 UI behavior regressions (2026-10-13)
- Verified before change: upload results, 401/429/503 error mapping, and the health status banner already had direct coverage. `top_k` was wired into the query call but lacked an assertion; source rows omitted available page/heading metadata; the Ask surface had no retrieval-only toggle despite the existing authenticated `/v1/retrieve` endpoint.
- Test added (failing first): `RagWorkspace` source page/heading and retrieval-only regressions failed before implementation; the selected `top_k` regression passed against the existing query wiring. Added API client coverage for the retrieval-only request contract.
- Change summary: added typed `api.retrieve` for `/v1/retrieve`; Ask now switches between answer generation and retrieval-only calls, showing returned chunks without an answer card. Source rows display filename/title with page and heading metadata when present. Added direct checks that selected `top_k` reaches the API and retrieval-only mode does not call `/v1/query`.
- Evidence after: `npm run test:run` -> **282 passed across 17 files**; `npm run build` -> TypeScript and Vite production build succeeded.
- Deviations from plan: the missing retrieval-only and source-metadata behaviors required minimal UI/API implementation so the requested tests could exercise real behavior.
- Open risks / follow-ups: none for Task 6.7.

### Task 6.7 review follow-up — retrieval chunk contract
- Verified before change: `/v1/retrieve` returns `rank`, `scores.final`, and source metadata; it does not return the `score` or `retrieval_method` fields used by query responses. This rendered retrieval-only score/method as invalid values.
- Test added (failing first): retrieval-only UI regression now uses the backend payload and asserts `80%`, `HYBRID_RRF`, and the accessible chunk label; it failed because the table could not find `80%`.
- Change summary: added a retrieval-specific response type matching `RankedChunk.to_dict()`. Retrieval-only rows derive a finite score from `scores.final` (falling back to `rrf`, then zero) and use the defined `HYBRID_RRF` method label.
- Evidence after: focused API and Ask tests -> **79 passed**; full `npm run test:run` -> **282 passed across 17 files**; `npm run build` -> TypeScript and Vite production build succeeded.
- Deviations from plan: none.
- Open risks / follow-ups: none.

## Task 6.8 Vite development proxy target (2026-10-13)
- Verified before change: `/v1` and `/health` both targeted hard-coded `http://localhost:8000` in `web/vite.config.ts`.
- Test added: `src/viteProxyConfig.test.ts` checks that `VITE_API_PROXY_TARGET` sets both proxy routes; no pre-change failure run was recorded.
- Change summary: Vite reads the `VITE_` environment from the repository root and uses `VITE_API_PROXY_TARGET` for both routes, with `http://localhost:8000` as the fallback. Added the optional setting to `.env.example`.
- Evidence after: focused proxy config test -> **1 passed**; `npm run build` -> TypeScript and Vite production build succeeded.
- Deviations from plan: none.
- Open risks / follow-ups: none.

### Gate 6 follow-up — Diagnostics Retrieval Playground (2026-10-13)
- Verified before change: the Phase 6 plan requires Diagnostics to provide a Retrieval Playground, but `MetricsDashboard` had only telemetry, infrastructure, and health readouts. The typed `/v1/retrieve` client already returned ranked chunks with dense, BM25, and RRF scores.
- Test added (failing first): `runs retrieval in Diagnostics and displays ranked chunks with backend scores` failed because the Diagnostics query input was absent.
- Change summary: `MetricsDashboard` now has a tenant-scoped query form backed by `api.retrieve`, with pending and error states and ranked chunk cards showing source metadata and the returned dense, BM25, and RRF scores. Existing telemetry and infrastructure readouts are unchanged.
- Evidence after: focused `npm run test:run -- src/components/MetricsDashboard.test.tsx` -> **21 passed**; `npm run build` -> TypeScript and Vite production build succeeded; full `npm run test:run` -> **285 passed**, with one teardown-time `ReferenceError: window is not defined` from the existing SettingsModal test's delayed callback after its test environment closed.
- Deviations from plan: no live Gate 6 browser checklist was run in this follow-up; the playground component contract and production build were verified.
- Open risks / follow-ups: full frontend suite still reports the SettingsModal delayed-callback teardown error described above. The remainder of Gate 6's manual checklist remains to be recorded.

### Task 6.3 follow-up — live index status in Diagnostics (2026-10-13)
- Verified before change: `MetricsDashboard` fetched `/v1/index/status` only during its initial/explicit metrics refresh, while only `/health/ready` had a 15-second poll. `IndexStorageStudio` derived its chip from `is_fallback` alone and rendered an unreachable non-fallback backend as Live.
- Test added (failing first): index polling regression failed after advancing 15 seconds because the status endpoint had only been called once; unreachable-vector regression failed because the Studio displayed Live.
- Change summary: Diagnostics now polls index status immediately and every 15 seconds, scoped to the active tenant. Index & Storage reads each backend's `reachable` value and renders an unreachable non-fallback as red Offline while retaining the existing fallback label and warning state.
- Evidence after: focused tests -> **46 passed**; full `npm run test:run` -> **288 passed across 18 files**; `npm run build` -> TypeScript and Vite production build succeeded.
- Deviations from plan: none.
- Open risks / follow-ups: none for this task.

### Gate 6 — frontend and live workflow closeout (2026-10-13)
- Verification: full frontend suite **288 passed across 18 files**; production build passed. Browser workflow on an isolated local API/test collection uploaded `meridian-gate6-test-v2.pdf` (2 pages, 1 indexed chunk), showed the document in Corpus, and Ask retrieval-only returned it with source page 1.
- Diagnostics Retrieval Playground queried `Gate6Marker ALPHA` and showed the same source chunk/page with dense `0.6558607`, BM25 `—`, and RRF `0.01639344262295082`.
- Qdrant was stopped during the live session. Within the 15-second poll, Diagnostics changed to Core App `DEGRADED` and Qdrant `OFFLINE` (red). Ask returned HTTP 503 with `Qdrant search failed: [Errno 111] Connection refused`; no empty answer was shown.
- Provider configuration was unchanged. The UI's first saved-config check ran before the memory-only platform key was re-entered and returned `Enter API key`; after auth was set, the admin generation check returned `success` for `kilo-auto/free` via `custom` (1.60 s). The provider path is therefore reachable and generated a test token.
- Gate verdict: **passed**. Temporary test services and collection are local-only; the existing repository storage and configured Qdrant collection were not modified.
