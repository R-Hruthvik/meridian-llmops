# Meridian LLMOps — Documentation Index

Organised 2026-10-06. 759 `.md` files existed in the repo at that point; **51 were real project documents.** The other 708 belong to tools and were left alone: `web/node_modules/` (358 vendored npm package READMEs), `.opencode/` (333 skill and agent definitions), `storage/documents/` (8 files the app generates when ingesting), and `sample_docs/` + `web-articles/` (third-party scrapes used as RAG fixtures).

## Read in this order

1. [`../README.md`](../README.md) — what the product is and its delivery history
2. [`../CONTEXT.md`](../CONTEXT.md) — the enforced vocabulary. Read before writing code
3. [`planning/2026-09-28_DIRECTION.md`](planning/2026-09-28_DIRECTION.md) — where the product is going
4. [`../AGENTS.md`](../AGENTS.md) — how to work in this repo

## What's true today

| Document | What it holds |
|---|---|
| [`adr/`](adr/) | 25 architecture decision records. Each carries a `Status:` header — **check it before trusting the decision**, six have drifted from the code |
| [`agents/`](agents/) | How skills read the repo, GitHub issue conventions, triage labels |
| [`planning/`](planning/) | The active improvement plans. **This is the remaining work** |
| [`research/`](research/) | Investigation reports |
| [`superpowers/`](superpowers/) | The continuous-improvement loop. `loops/` is live — `.opencode/loop.md` reads and writes it every round |
| [`archive/`](archive/) | Finished, superseded, or corrected work. Kept for the record, not for reading |

## planning/ — the active plans

All six plans come in pairs: a **spec** file naming the problems, and a **PHASED** file listing the execution steps. They overlap by only 1–5% and neither replaces the other — each `*_PHASED.md` names its spec on line 11.

Progress below was measured against the code on 2026-10-06, **not** read from the checkboxes. The plans record 256 unticked boxes and zero ticked, but a lot of the work did land.

| Plan | Spec / steps | Landed | Not started |
|---|---|---|---|
| Core Platform | [spec](planning/2026-09-28_PLAN_CORE_PLATFORM.md) / [steps](planning/2026-09-28_PLAN_CORE_PLATFORM_PHASED.md) | Phases 0, 1, 3 | Phase 2 — split `models.py` into `db_models.py`, drop the `config.py` shim |
| Web UX | [spec](planning/2026-09-28_PLAN_WEB_UX.md) / [steps](planning/2026-09-28_PLAN_WEB_UX_PHASED.md) | Phase 1 | Phase 3 — TanStack Query layer, typed settings form |
| Ops + Evals + DX | [spec](planning/2026-09-28_PLAN_OPS_DX.md) / [steps](planning/2026-09-28_PLAN_OPS_DX_PHASED.md) | Phase 2 — the blocking eval gate is real | Phase 3 — Langfuse v4, pin Node 22 |
| Gateway | [spec](planning/2026-09-28_PLAN_GATEWAY.md) / [steps](planning/2026-09-28_PLAN_GATEWAY_PHASED.md) | Phase 0 | Phase 2 — the `api.py` / `routes/` / `proxy/` / `rails/` split |
| RAG Engine | [spec](planning/2026-09-28_PLAN_RAG_ENGINE.md) / [steps](planning/2026-09-28_PLAN_RAG_ENGINE_PHASED.md) | Phase 0 | Phase 2 — `routers/` split, `app.py` is still 1020 inline lines |
| Ingestion + Memory | [spec](planning/2026-09-28_PLAN_INGESTION_MEMORY.md) / [steps](planning/2026-09-28_PLAN_INGESTION_MEMORY_PHASED.md) | — | Phase 0 — BM25 eviction, `MemoryCoordinator` |

Supporting reads: [`2026-09-28_TECH_TRENDS_CATCHUP.md`](planning/2026-09-28_TECH_TRENDS_CATCHUP.md) — every dependency-lag risk it names is still live. [`2026-09-28_UX_BACKEND_FOCUS.md`](planning/2026-09-28_UX_BACKEND_FOCUS.md) — 6 of its 7 gaps are now closed; only gap 6 (BM25 has no eviction) remains.

### Pattern worth knowing

Phases 0 and 1 — safety flags and request/response contracts — were broadly delivered. **Nearly every Phase 2 "restructure" was skipped.** The outstanding bulk is splitting large modules, not adding features.

## adr/ — decision records

| Status | Records | Meaning |
|---|---|---|
| `Accepted` | 0001, 0002, 0008, 0012, 0014, 0015, 0016, 0017, 0018, 0019, 0020, 0021, 0022, 0023, 0024, 0025 | The code still does this |
| `Accepted (drifted)` | 0003, 0004, 0005, 0009, 0010, 0011 | Still the intent; each carries a `Current state` note saying what actually shipped |
| `Superseded` | 0006, 0007, 0013 | A different approach replaced it. Kept because the record shows what was tried and why it was dropped |

## archive/ — not for reading

| Item | Why it's here |
|---|---|
| `2026-08-17_plan-for-project.txt` | Original brief. Structured into `spec.md`, which has since been removed |
| `2026-08-20_production-storage-and-gateway.md` | Approved and fully implemented |
| `2026-08-24_issue-remediation.md` | All four phases done; `ruff check .` passes |
| `2026-08-21_agent-results/` | Two agent run reports from August, citing files since deleted |
| `2026-09-28_arena-results/` | Arena AI session that settled the Top-K design question. `sessions/doubts-20260928-01/OPEN_DOUBTS.md` is cited as evidence by `DIRECTION.md` B4 |

## Removed in this pass

Three documents were deleted rather than archived, having been judged wrong rather than merely old:

- `PROJECT_OVERVIEW_REFINED.md` — described a four-studio UI that has since been replaced, and claimed no rate limiter existed
- `docs/spec.md` — claimed a 100+ case golden dataset (there are 5), a NeMo Guardrails container (never built), and put the web frontend out of scope (14 components ship)
- `docs/superpowers/plans/2026-10-01-continuous-improvement-loop.md` — pointed at `loops/web-levers.md`, which does not exist

The project now has **no specification document**. `planning/` and `adr/` are what govern the work.