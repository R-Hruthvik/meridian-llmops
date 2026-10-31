# Meridian LLMOps — Project Direction (v2)

Date: 2026-09-28
Status: proposed, awaiting approval
Supersedes: the "chat-first" simplification idea, which was wrong for this product.

---

## 1. What Meridian is not

It is not a chat app with documents attached. The correct product statement:

> **An operator workbench for grounded AI.** You ingest a corpus, configure
> retrieval and guardrail policy, ask questions, and then *inspect exactly
> why* each answer was grounded or refused — and prove improvements with
> repeatable experiments.

The user is an **operator/engineer**, not an end-user chatting. Every screen
should help them change or trust the system's behaviour.

## 2. Why the current UI fails

Measured, not guessed:

- `web/src/App.tsx:54-68` mounts **all 5 studios simultaneously** and toggles
  with `block`/`hidden`. 4,443 lines of React are live on every page load.
  `IngestionStudio` alone is 817 lines that a question-asker never opens.
- The five tabs have **no relationship** to each other and **no shared
  object**. Ingestion writes documents; Metrics reads counters; Guardrails
  posts strings. Nothing links a metric back to the query or index that
  produced it, so the operator cannot close the loop.
- The self-healing agentic loop — the actual differentiator — is **invisible**.
  `graph.py` runs retrieve → generate → critique → reformulate across up to
  `max_cycles`, and the UI collapses all of it to a single "Cycle 3/3" label.
- The "Retrieved Chunks" panel shows a fused score with **no breakdown** of
  which retriever (BM25 / vector / graph) contributed what.
- Infrastructure cards are **static config**, not live backend state, so they
  cannot be trusted. Live testing confirmed `/health` also reports
  `storage_documents: 7` while `/v1/documents` says `8` — the counter is stale.

**Conclusion:** the UI is not ugly (Impeccable's 61 deterministic rules found
exactly **1** anti-pattern: gradient text at `RagWorkspace.tsx:265`). The UI is
*disconnected*. This is an architecture problem, not a styling problem.

## 3. Competitive research (2026-09-28)

Read the shipped information architecture of the platforms this project
competes with or complements.

| Product | Top-level structure | What it proves |
|---|---|---|
| **Langfuse v4** | Observability · Prompt Management · Evaluation · Datasets · Metrics · API & Data Platform · Assistant · Administration · **Security & Guardrails** | Guardrails is a *product area*, not a checkbox. Datasets are top-level. |
| **LangSmith** | Monitor (traces) · Debug · Projects & environments · Datasets & experiments · Prompts (playground) · **Annotation queues** · Deployment | Human review is a first-class queue, not a settings page. |
| **Arize Phoenix** | Tracing · Evaluation · LLM-as-judge · Experiments | Experiments/runs are the unit of progress. |
| **Pinecone / Qdrant** | Indexes & namespaces · collections & vector search tuning | Index configuration is a first-class surface. |

Common thread: **nothing leads with chat.** Chat/playground is a *tool inside*
an observability or evaluation area, used to test. The spine is
data → configure → observe → evaluate → fix.

## 4. Proposed direction

### 4.1 Positioning
Operator workbench for grounded AI, differentiated by **inspectable
groundedness**: every answer is traceable to the retrieval decisions and the
critic verdicts that produced it, and every change is provable via experiments.

### 4.2 The two unique capabilities (not in the competitors above)

**A. Groundedness Forensics.** For any answer, expose:
- the **self-healing cycle timeline** (retrieve → generate → critique →
  reformulate, with the critic's verdict per cycle and the reformulated query
  text),
- a **per-chunk fusion breakdown** (BM25 rank + vector rank + graph boost,
  with the weights that produced the final RRF score),
- **citation → source document → chunk** click-through,
- the critic's grounded/refused decision with the reason.

**B. Retrieval Experiment Lab.** Sweep `top_k`, `chunk_size`, `chunk_overlap`,
`max_cycles`, rerank on/off against a versioned golden dataset and see
groundedness, refusal-rate, and latency move. This is the "prove it" half of
the loop and it is where the product earns its keep.

### 4.3 Target IA — six workbench areas

Persistent chrome (not tabs): tenant switcher, health chip, settings sheet.

1. **Workbench** *(default)* — ask a question; forensics rail renders the cycle
   timeline, per-chunk fusion breakdown, critic verdicts, citations.
2. **Corpus** — sources, ingest, structural-chunk inspector, reindex.
3. **Index & Storage** — *live* Qdrant collections, Neo4j node/rel counts,
   BM25 corpus size, SQLite tables, eviction/reindex actions. Replaces the
   static infra cards.
4. **Guardrails** — policy editor, live tester, red-team corpus, block-rate
   over time, and the routing fix so the browser can actually reach this API.
5. **Evaluation** — dataset manager, experiment runner, param sweeps, run
   history and diffs, DeepEval gates, and the existing review queue folded in
   as the **annotation** surface.
6. Settings — providers, keys, model, advanced pipeline params (already built).

### 4.4 New features this unlocks
Retrieval forensics · cycle timeline · param sweep lab · dataset manager ·
live index inspector · guardrail red-team corpus · experiment run history and
diff · block-rate telemetry.

### 4.5 Explicit non-goals
Multi-tenant RBAC, billing, document versioning/diffing, streaming SSE,
custom reranker training, mobile-first layout.

## 5. Bugs this direction must fix first

Found by live browser testing, all reproducible:

| # | Bug | Evidence |
|---|---|---|
| B1 | **Guardrails tab unreachable from the browser.** Route exists only on the gateway (`services/gateway/app.py:45`); rag engine has no such path; `web/vite.config.ts:14` proxies `/v1` only to `:8000`. GET → 404, POST → 405. | curl + openapi probe |
| B2 | `/health.storage_documents` stale after ingest (7 vs 8) | direct API compare |
| B3 | Answer header contradicts body: static "HERO OUTPUT / Self-healing verified response synthesized…" above a refusal with `Degraded Response` badge | screenshot `ui_04_answer_panel.jpg` |
| B4 | Top-K control is inert — `graph.py:42` hardcodes `top_k=3`; the arena-verified fix is `RunnableConfig` `configurable` | `docs/archive/2026-09-28_arena-results/sessions/doubts-20260928-01/OPEN_DOUBTS.md` |
| B5 | All 5 studios mounted at once | `App.tsx:54-68` |

## 6. Delivery sequence

1. Fix B1–B4 (backend contract + routing), add tests.
2. Lazy-mount the app shell; retire the always-mounted studios.
3. Build **Index & Storage** against live backends.
4. Build **Evaluation** (datasets → experiment runner → run history).
5. Build **Groundedness Forensics** into the Workbench.
6. Build the **param sweep** runner.
7. Guardrails red-team corpus + block-rate.
8. Impeccable `typeset` / `colorize` / `layout` / `polish` pass across all of it.

Each step is independently shippable and independently testable.

## 7. Tooling notes

- Impeccable v4 installed to `.opencode/` (already gitignored). Detector engine
  runs locally with no LLM and no API key: `.opencode/skills/impeccable/scripts/impeccable detect web/src`.
- Baseline: **1 anti-pattern** (`RagWorkspace.tsx:265` gradient text). Visual
  debt is low; structural debt is the problem.
- `design-taste-frontend` applies to marketing surfaces; per its own scope note
  it excludes multi-step product UI, so the workbench itself leans on
  Impeccable plus the design system already in `web/`.
