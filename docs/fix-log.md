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
