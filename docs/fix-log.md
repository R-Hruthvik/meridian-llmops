# Meridian fix log

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
