# Frontend Learnings — Project Notes

> Living notes for frontend work in this project. Maintained by agents using the `frontend-learn` skill.
> Archive of truth: `/home/hruthvik9487/Documents/Documents_Restored/frontend/` (read-only reference; do not edit from here).
> Last updated: 2026-11-15

## How to use

- Read this file at the start of any frontend task, before writing code.
- Append a new dated entry whenever you reference the archive, apply a pattern/token, avoid an anti-pattern, or hit an open question.
- Entries are free-form: write whatever helps future work. No required fields, no length limits.
- Cite archive source paths (e.g. `distilled/03_typography.md §3`) so claims stay traceable.
- Do not store secrets, credentials, or personal data here.

## Entries

<!-- Add new entries below. Newest first or oldest first — either is fine; stay consistent. -->

### YYYY-MM-DD — Short title

**Context:** what you were building/fixing.

**Referenced:** archive paths consulted.

**Applied:** patterns/tokens/values used.

**Avoided:** anti-patterns or pitfalls caught.

**Open questions:** things to verify later.

**Notes:** anything else useful.

---

### 2026-11-15 — Meridian motion audit (archive pass, candidates only)

**Context:** Audit the Meridian web UI (`web/src/`) for animation and interaction-craft
improvements after the offline-state / review-queue / hero-mesh fixes. Deliverable is a ranked
candidate list — no code changed in this pass.

**Journey answers**

- **Site type:** tool / dashboard (LLMOps workbench). Dense, keyboard-first, repeated daily use.
- **Level:** L1 (a11y, focus, fluid type, fonts) + L2 (motion & interaction craft). L3 deferred.
- **Limitations:** `framer-motion` 12 already present; no new dependencies; global
  `prefers-reduced-motion` kill must keep working; no backend, so motion must not imply loading.
- **Time / destination:** one pass. Output lands in existing components + this file.

**Referenced (archive paths read)**

- `/home/hruthvik9487/Documents/Documents_Restored/frontend/distilled/04_motion.md` §11
  (Rauno interaction principles) and the "reduced motion is opt-in" cross-reference.
- `/home/hruthvik9487/Documents/Documents_Restored/frontend/distilled/02_constraint_layout.md`
  (container-driven layout, zero media queries).
- `/home/hruthvik9487/Documents/Documents_Restored/frontend/distilled/curriculum/PATTERN_INDEX.md`
  rows R-13, R-19, R-20, R-23, R-24, A35, B23, B24.
- `/home/hruthvik9487/Documents/Documents_Restored/frontend/guides/interaction-craft/rauno-craft/IMPLEMENTATION.md`
  (spring integrator, 5 calibrated k/c/m presets, exclusion-tabs pill, vanish input).
- `/home/hruthvik9487/Documents/Documents_Restored/frontend/sources/linear/DESIGN.md` §1–§2
  (token discipline, 0.8px hairline `::after` overlay, 5-layer ambient occlusion, fluid type
  `clamp(2.5rem, 5vw + 1rem, 4rem)`).
- Local motion inventory: `web/src/core/motion.ts`, `web/src/App.tsx`,
  `web/src/styles/tokens.css`.

**Candidates (ranked, smallest-first)**

| # | Where | Finding | Archive rule | Level |
|---|-------|---------|--------------|-------|
| 1 | `web/src/styles/tokens.css:340-388` | `meridian-drift-a/b` keyframes are declared unconditionally and only neutralised by the blanket `prefers-reduced-motion: reduce` block. Works, but it is the inverted gate. | R-23 / B23 — gate on `no-preference`, transition inside the query | L2 |
| 2 | `web/src/features/ops/ReviewQueuePanel.tsx:955-957` | `<motion.ul key={filter}>` remounts the whole list on every filter change. `ReviewCard` already has `layout` (line 340), but the remount discards it, so switching filter is an instant cut. Dropping `key` keeps the earlier blank-state fix (`initial={false}`) and restores real FLIP reflow. | `04_motion.md` FLIP / velocity transfer | L2 |
| 3 | `web/src/features/ops/ReviewQueuePanel.tsx:849-873` + `web/src/features/vault/VaultView.tsx:470-496` | Filter chips swap border/bg/ink instantly — no shared-element pill. Two copies of the same chip, both flat. | rauno-craft `IMPLEMENTATION.md` exclusion-tabs pill (`layoutId`); `distilled/02_anatomy.md` | L2 |
| 4 | `web/src/components/shell/StudioShell.tsx:763-1005` | Command palette runs `SCRIM_FADE` + `DIALOG_POP` on every open. Palette is a high-frequency surface (Ctrl+K). | `distilled/04_motion.md` §11 — "No entrance animation on high-frequency tools"; budget motion for rare, meaningful events | L2 |
| 5 | `web/src/App.tsx:135-151` | Every view switch runs `FADE_UP` (y-offset + stagger) through `AnimatePresence mode="wait"`. Navigation between Ask/Vault/Ops/Settings is also high-frequency. | same §11 principle; R-24 animate transform/opacity only | L2 |
| 6 | `web/src/features/vault/VaultView.tsx:165` (`DocumentCard`), `web/src/features/ops/IndexTelemetryPanel.tsx:558` | Card hover lifts `-2px` in isolation; siblings do not dim. No group focus. | linear `DESIGN.md` restraint; `distilled/02_anatomy.md` group-hover treatment | L2/L3 |
| 7 | `web/src/styles/tokens.css:224-229` | `:focus-visible` is a static 2px outline. No offset transition. | B24 — focus ring animates `outline-offset` only (layout-free) | L1 |
| 8 | `web/index.html` + `web/src/styles/tokens.css:202` | Stack asks for `'Inter var'`/`'Inter'` but nothing is loaded or preloaded — no `@font-face`, no `@fontsource`, no `<link>`. Renders as system-ui unless Inter is installed locally. | `frontend-learning-levels.md` L1 "performant fonts: font-display, zero-FOUC" | L1 |
| 9 | `web/src/styles/tokens.css` body rule | No `text-wrap: pretty` on body copy, no `balance` on short headings. | `distilled/03_typography.md` | L1 |
| 10 | `web/src/features/vault/VaultView.tsx:872`, `web/src/features/settings/SettingsView.tsx:1082` | Card grids are viewport-breakpoint driven (`sm:`/`xl:`/`lg:`). | `distilled/02_constraint_layout.md` — respond to container width, not viewport | L3 (defer) |

**Considered and rejected (do not build)**

- **Metric count-up** (`IndexTelemetryPanel.tsx:523`, `:592`). Telemetry re-renders on every poll;
  a count-up would jitter and imply precision the number does not have. `.tabular` already keeps
  digits column-aligned. No change.
- **Stagger on the Review Queue list.** Already present (`STAGGER_CONTAINER`/`STAGGER_ITEM`), and it
  is the thing that broke when `AnimatePresence mode="wait"` gated the exit. Leave as-is.
- **New animation primitives.** `core/motion.ts` already covers snappy/gentle/soft springs, fast
  tween, fade-up, drawer, scrim, dialog, stagger. No new tokens without a second use site.

**Avoided (anti-patterns caught)**

- Do not add an entrance animation to the palette or the view switcher — motion budget is spent on
  rare events, not on surfaces touched every minute (§11).
- Do not write `transition: all`; every new transition must name its property (R-23).
- Do not animate layout properties; `transform`/`opacity` only (R-24).
- Do not gate on `prefers-reduced-motion: reduce` alone — the archive rule is `no-preference` (B23).
- Do not promote ➖/🆕 rows from `PATTERN_INDEX.md` into project rules without a second site.

**Open questions**

1. Is `'Inter var'` expected to come from the OS, or was a webfont intended? Decides whether
   candidate 8 is "add font" or "drop the family name".
2. Should the palette keep a 120ms scrim-only fade, or go fully instant?
3. Does the dock `layoutId` pill already cover the "shared-element" need well enough that the filter
   chips can stay flat? Chips are a different interaction (multi-select-ish), so maybe not.

**Notes:** No code changed. Everything above is a proposal; candidates 1–3 are cheap, isolated and
low-risk, 4–5 are taste calls, 10 is a refactor and should not be bundled with the rest.
