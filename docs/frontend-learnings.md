# Frontend Learnings — Project Notes

> Living notes for frontend work in this project. Maintained by agents using the `frontend-learn` skill.  
> Archive of truth: `/home/hruthvik9487/Documents/Documents_Restored/frontend/` (read-only reference; do not edit from here).  
> Last updated: 2026-11-08

## How to use

- Read this file at the start of any frontend task, before writing code.
- Append a new dated entry whenever you reference the archive, apply a pattern/token, avoid an anti-pattern, or hit an open question.
- Entries are free-form: write whatever helps future work. No required fields, no length limits.
- Cite archive source paths (e.g. `distilled/03_typography.md §3`) so claims stay traceable.
- Do not store secrets, credentials, or personal data here.

## Entries

### 2026-11-08 — Expert Advisory Resolutions & Architecture Directives

**Context:** Complete advisory synthesis resolving all 11 technical, design, and accessibility queries for the new Meridian Chat Interface (`docs/expert-consultation-and-advisory-response.md`).

**Referenced:**
- `/home/hruthvik9487/Documents/Documents_Restored/frontend/distilled/KB_TENETS.md` (Tenets 1–7)
- `/home/hruthvik9487/Documents/Documents_Restored/frontend/distilled/02_focus_indicators.md` (Double-sandwich focus rings)
- `/home/hruthvik9487/Documents/Documents_Restored/frontend/distilled/04_motion.md` (Critically damped spring $\zeta = 1.0$)
- Google Drive Advisory Response (`19NuDWmVWkMSN8-mzUyujjcmj2L-lq-B4`)

**Decisions & Applied Patterns:**
- **Streaming Scrolling:** Native scroll + CSS `overflow-anchor: auto` bottom sentinel + `content-visibility: auto` on completed turns + RAF-batched token buffer. JS list virtualization avoided.
- **Markdown Streaming:** Block-memoized incremental parsing on main thread (`< 0.15ms` for active block) with async Shiki tokenization only for closed code blocks (zero FOUC, zero lag).
- **Stream Lifecycle:** `AbortController` linked to `ReadableStreamDefaultReader` with `await reader.cancel()` and `reader.releaseLock()` in `try/finally` block + monotonic `requestId` guard.
- **Citation UX:** Split-Screen Push-Stage Inspector Drawer (`380px` width) for `>= 1280px`, anchored floating over-drawer on `1024px–1279px`, bottom sheet on `< 1024px`.
- **Telemetry Hierarchy:** 3-tier progressive disclosure (`Tier 1` Ambient footer bar $\rightarrow$ `Tier 2` Popover $\rightarrow$ `Tier 3` Inspector Drawer).
- **Conversational Model:** Append-only Analytical Notebook session stream in `IndexedDB` with `[ ↳ Ask Follow-up ]` context injection into stateless `/v1/query`.
- **Multi-Stage Retries:** Reframe retries as `"Autonomous Grounding Pass"` in ice-blue/amber with `tabular-nums` `0.1s` timer.
- **Evidence Resilience:** Always preserve and display retrieved chunks in an Evidence Recovery Surface even on `REFUSED` or `DEGRADED` states.
- **Accessibility:** Decoupled Twin-Region ARIA pattern (`aria-busy="true"` on stream with no `aria-live`; separate status announcer for stage milestones) + Double-Sandwich concentric focus rings (`18:1` contrast).
- **Motion:** Critically damped spring (`stiffness: 100, damping: 20, mass: 1`, $\zeta = 1.0$) with `100ms` opacity fallback under `prefers-reduced-motion`.
