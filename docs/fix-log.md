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
