# Levers — web (PART=web)

> SEED ONLY — see `.opencode/loop.md` §1. Fix seeds when hit, but every tick MUST add fresh senior-expert findings.

- [x] DONE 61b7c57 — Seed: B5 lazy-mount. DOM was gated, the import graph was not; React.lazy for all 5 studios + SettingsModal. Entry 382.61→298.40 kB.
- [x] DONE 70780e7 — Seed: B3 refusal contradiction (verdict precedence). Refusal state proven live.
- [ ] OPEN — Seed: B3 remainder: VERIFIED GROUNDED success-state screenshot — BLOCKED, the LLM endpoint (kilo :20128) is down so no non-refusal answer can be produced honestly. Re-run when a provider is reachable.
- [ ] OPEN — Seed: forensics rail — cycle timeline + per-chunk fusion breakdown + critic verdict + citation→chunk click-through (DIRECTION 4.2A). BLOCKED ON A CONTRACT, checked in t5: `QueryResponse` (packages/core/models.py) carries only `cycle_count: int` — there is no per-cycle trace, no per-chunk fusion score (chunks have just `score` + `retrieval_method`) and no critic verdict. Every part of the rail except citation→chunk click-through needs new rag_engine fields first, so do not start this in PART=web. Citation→chunk click-through already exists (App.test.tsx "citation drill-through to the Corpus overlay").
- [ ] OPEN — Fresh (from t1 screenshot): the lens rail is 3 bare icons — no visible label for Ask/Corpus/Operate. Owner has to guess what the app is.
- [ ] OPEN — Fresh (from t1 screenshot): the Ask canvas wastes ~600px of horizontal space at 1536w; one narrow column in a wide frame.
- [ ] OPEN — Fresh (from t1 screenshot): "Guardrails Active" chip sits inside the Ask panel but describes the gateway, not the query.
- [x] DONE 1b957ea — Fresh: health chip read Online on an empty `services` map. Added an `unknown` (faint) state; no evidence is no longer good news.
- [x] DONE 08d8a7a — Fresh: `marked` was in the entry chunk via MarkdownRenderer. Now its own 44.56 kB chunk, fetched on answer. Entry 298.40->245.64 kB.
- [x] NOT A BUG (t3) — /health is 2.6 ms (probes run once at boot, not per request), so the 10 s interval cannot overlap. Measured, not guessed.
- [ ] OPEN — OWNER DECISION: the lens rail is 3 unlabelled glyphs, but spec §6 says "icon + tooltip" on purpose. Adding visible labels contradicts the written spec — ask the owner before changing it.
- [ ] OPEN — NOT A BUG (t3): the Ask canvas caps its column on wide viewports; that is a reading-width cap, not dead space. Verified against the 1536w screenshot.
- [ ] OPEN — Fresh slot: audit one surface for identity/typography/layout language (owner 2/10) + propose minimal token change.
- [x] DONE 3854bcc — Fresh: the tenant field was a bare form field; a blank value silently read the default tenant. Now validated with aria-invalid + inline alert, last valid tenant retained.
- [x] DONE 5ef1d90 — Fresh: a failed dynamic chunk unmounted the whole app (no error boundary). Added LazySurface + SurfaceErrorBoundary.
- [x] DONE 5ef1d90 — Fresh a11y: `Overlay`'s `<header>` mapped to a second `banner` landmark on every open overlay. Now a div.
- [x] DONE 1cd6773 — Fresh: "Guardrails Active" checkbox read as a status readout. Now "Enforce guardrails on this query", with a test on the payload it sends.
- [x] DONE 4b77112 — Fresh a11y/audit: the Metrics KPI strip rendered 0/0/$0.0000 for unmeasured telemetry. Now em-dash.
- [x] DONE d15cbad — AUDIT (a) ReviewQueue focus fell to `<body>` after every approve/reject, and (b) the Correct disclosure had no `aria-expanded`/`aria-controls` while unmounting focused inputs.
- [x] DONE a0d9787 — AUDIT (d) the IndexStorageStudio fallback banner mounted pre-filled inside `role="alert"`, so the most consequential warning in the app was silent. One always-mounted status region now carries the whole load.
- [x] DONE 9828c33 — AUDIT (c) ReviewQueue's toast/error regions mounted pre-filled and contradicted their own role. Now standing regions written into on change.
- [ ] OPEN — AUDITED, not yet fixed: (e) contrast: `--text-faint` 2.86:1 on white FAILS 1.4.3 at 11-13px, and `--warn` on `--warn-wash` is 3.78:1 — both are token-level so a fix touches every surface, which is a visible change and needs the owner's call; (f) `animate-spin` has no `prefers-reduced-motion` guard (AAA, cheap); (g) no `h1` anywhere in the shell, so each overlay starts at h2/h3 (1.3.1/2.4.6).
