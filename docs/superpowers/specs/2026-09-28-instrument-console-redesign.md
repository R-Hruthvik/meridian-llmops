# Instrument Console Redesign — Design Spec

**Date:** 2026-09-28
**Status:** awaiting owner review
**Supersedes:** the current purple-gradient SaaS-template look and the three-page area structure

---

## 1. Why this exists

The owner rated the product **2 / 10** on how it feels to use, and identified
three concurrent problems:

- **How it looks** — generic purple gradients, rounded cards everywhere, no identity
- **How it works** — still reads as three separate screens, not one workbench
- **The density** — too much prose, too many numbers competing, no hierarchy

The target feel, chosen by the owner: **powerful and impressive.**

The tension to resolve is explicit: density was named as a problem, but the
desired outcome is *powerful*, not *sparse*. Resolved as **"prose down, data
up"** — numbers get promoted to instrument readouts, prose shrinks and gets out
of the way. Dense, but not cluttered.

## 2. Design read

> Reading this as: an **operator workbench for grounded AI** for engineers and
> technical operators, with a **light, crisp, instrument-panel** language —
> engineering tool energy, not consumer SaaS. Single canvas, overlays for
> secondary surfaces. Prose minimal, data loud.

**Dials:** `DESIGN_VARIANCE: 4` · `MOTION_INTENSITY: 3` · `VISUAL_DENSITY: 7`

Rationale: a cockpit, not a gallery. Restraint on layout decoration, restraint on
motion (this is a tool people stare at for hours), high data density.

## 3. Locked decisions

| Decision | Choice |
|---|---|
| Layout | **Single canvas + overlays.** Ask is the permanent canvas; everything else slides over it. |
| Colour | **Light, crisp, instrument panel.** |
| Accent | **Signal orange** — one accent, locked app-wide. |
| Status colour | Green healthy · amber degraded · red failed — reserved for real state only. |
| Density | **Prose down, data up.** Monospace tabular figures for all numerics. |
| Scope | **Full visual overhaul.** |
| Feel | **Powerful and impressive** (command-centre energy). |

## 4. Palette

Surface and text:

| Token | Value | Use |
|---|---|---|
| `--surface` | `#F7F7F5` warm instrument grey | app background |
| `--surface-raised` | `#FFFFFF` | overlays, the answer surface |
| `--surface-sunken` | `#EFEEEC` | code blocks, chunk tables, inline wells |
| `--border` | `#DEDDD9` | hairlines |
| `--border-strong` | `#C4C3BE` | focused/active borders |
| `--text` | `#16150F` off-black, never pure `#000` | primary text |
| `--text-muted` | `#6B6A63` | labels, secondary |
| `--text-faint` | `#9A9992` | tertiary, units |

Accent and status:

| Token | Value | Meaning |
|---|---|---|
| `--accent` | `#E8590C` signal orange | **the only accent.** focus rings, active nav, primary action, key data |
| `--accent-ink` | `#B34708` | accent text needing AA contrast on light surfaces |
| `--accent-wash` | `#FFF1E8` | selected row / active pill background |
| `--ok` | `#1F7A4D` | healthy, verified, reachable |
| `--warn` | `#B26B00` | degraded, fallback, partial |
| `--fail` | `#B3261E` | failed, blocked, offline |
| `--ok-wash` / `--warn-wash` / `--fail-wash` | 8% tints | status backgrounds only |

**Rules**
- One accent. No second hue for decoration anywhere.
- Status colours appear **only** when a real state warrants them. Never
  decorative.
- No gradients. No gradient text. No glows.
- No pure `#000` and no pure `#fff` for text.

## 5. Typography

**UI sans** — `Geist` (self-hosted, `font-display: swap`), falling back to
system UI stack. `Inter` is explicitly not the default.

**Numerics** — `Geist Mono` with `font-variant-numeric: tabular-nums` and
`font-feature-settings: "tnum" 1, "zero" 1` so columns align and digits don't
jitter as values update.

| Role | Size | Weight | Family |
|---|---|---|---|
| Verdict state (e.g. `VERIFIED`) | 13px | 700 | mono, letterspaced `0.08em`, uppercase |
| Data readout (scores, counts) | 15–28px | 600 | mono, tabular |
| Section label | 11px | 700 | sans, uppercase, `0.12em` tracking |
| Body / answer prose | 14px / 1.65 | 400 | sans, max `68ch` |
| Identifiers (doc id, chunk id, endpoint) | 12px | 500 | mono |
| Micro / units | 11px | 500 | sans, `--text-faint` |

## 6. Layout architecture

```
┌──────────────────────────────────────────────────────────┐
│ ◉ Meridian   tenant ▾   custom · kilo   ● degraded   ⚙  │  top bar, 56px, hairline bottom
├────┬─────────────────────────────────────────────────────┤
│ ◉  │                                                     │
│ ▤  │                 ASK CANVAS                         │
│ ⚙  │      (permanent — query, answer, forensics)        │
│    │                                                     │
│    │                                                     │
├────┤                                                     │
│ ⌥  │   overlays slide over: Corpus · Operate · Index     │
└────┴─────────────────────────────────────────────────────┘
```

- **Top bar (56px):** brand, tenant switcher, active provider + model, health
  chip, settings. Hairline bottom border. Never wraps.
- **Left icon rail (56px):** three lenses — Ask, Corpus, Operate. Icon + tooltip,
  active state = accent-ink on accent-wash. Index & Storage, Guardrails, Review
  Queue and Metrics are **not** rail items; they are overlay destinations
  reachable from context.
- **Ask canvas (always the base layer):** composer at top, verdict bar, answer
  body, ranked chunk table, entity strip.
- **Overlays:** slide in from the right, 520–680px, scrim behind, Escape and
  scrim-click dismiss. Each overlay header names where it was opened from
  (breadcrumb), preserving the sense of one connected surface.
- **Responsive:** below `md` (768px) the rail collapses to a bottom bar and
  overlays become full-screen sheets.

## 7. The verdict bar (replaces the hero card)

The current `AI Agent Synthesis Output / HERO OUTPUT` card is retired. It is a
decorative container that spent a third of the screen saying one word. It
becomes a single dense strip:

```
┌────────────────────────────────────────────────────────────────────┐
│ ● VERIFIED GROUNDED   │ custom · kilocode/dots-3-note-preview:free   │
│                       │ cycle 1/3 · 19.6s · 3 chunks · 16 entities   │
└────────────────────────────────────────────────────────────────────┘
```

- Left segment: state chip. `VERIFIED GROUNDED` (ok) · `REFUSED` (fail) ·
  `DEGRADED` (warn) · `UNVERIFIED` (faint) · `NO MODEL SERVED` (faint).
  Precedence unchanged: degraded > refusal > verified.
- Right segment: monospace readouts separated by hairlines. The model shown is
  the **actual** serving model from `serving.model`, never a config echo.
- When no LLM served the answer, the model segment reads `— no model served`
  and the whole bar goes quiet. It never names a model that did not answer.

## 8. The chunk table (replaces the chunk card stack)

Currently each chunk is a large rounded card. It becomes a ranked table —
this is the single biggest density win.

```
 #   SOURCE                SCORE   METHOD        ID
───  ────────────────────  ──────  ────────────  ─────────────────
 1   doc-c2bd07cc            36%   HYBRID_RRF   98cd9ff5c7874c6…
 2   doc-e23a17ed            28%   HYBRID_RRF   02ec848c94974f36…
 3   doc-56a9417a            11%   HYBRID_RRF   1def6a959021413f…
```

- Row height ~32px, hairline row dividers, **no card boxes**.
- Whole row is a button → opens the chunk in the Corpus overlay (existing
  drill-through, preserved and re-homed to the overlay model).
- Monospace for score, id, and rank. Sans for source title.
- Selected/hovered row: `--accent-wash` background, 2px accent left border.
- Clicking a row opens the **chunk overlay**, which additionally shows the
  retrieval breakdown when forensics is available (Phase 2).

## 9. Density rules

- **Every number, ID, score, timestamp, count, port and endpoint is monospace
  with tabular figures.** No exceptions.
- Prose is capped at `68ch` and set at 14px. Longer content scrolls, it does
  not shrink.
- Prefer hairlines (`--border`) over card boxes. A card is used only when
  elevation genuinely communicates hierarchy — currently almost nowhere.
- **Corner radius: 6px flat, 4px for inputs/wells, full-pill only for status
  chips.** The current `rounded-3xl` everywhere is retired.
- Shadows: removed except overlays (`0 12px 32px rgba(22,21,15,.10)`).
- No section eyebrow above every header. At most one per screen.

## 10. What is removed

| Removed | Reason |
|---|---|
| Purple / lavender gradient surfaces | Named as the core problem |
| Gradient text (`RagWorkspace.tsx:301`) | Impeccable anti-pattern, decorative |
| `rounded-3xl` card stacking | Reads as generic template |
| `shadow-card` / `shadow-cardHover` on every surface | Elevation without hierarchy |
| "AI Agent Synthesis Output" hero framing | Decorative container, one word of content |
| Static "Multi-Container Topology" config cards | Replaced by live data in Index & Storage overlay |
| Mixed violet/indigo/rose icon tints | Collapses to one accent + status |

## 11. Files in scope

| File | Change |
|---|---|
| `web/src/index.css` | token layer: palette, type scale, radius, borders |
| `web/src/App.tsx` | shell: top bar + rail + canvas + overlay host; shared context |
| `web/src/components/Navbar.tsx` | becomes the icon rail + top bar; overlay openers |
| `web/src/components/RagWorkspace.tsx` | verdict bar, chunk table, entity strip |
| `web/src/components/IngestionStudio.tsx` | becomes the Corpus overlay surface |
| `web/src/components/IndexStorageStudio.tsx` | overlay surface |
| `web/src/components/GuardrailsStudio.tsx` | overlay surface |
| `web/src/components/ReviewQueue.tsx` | overlay surface |
| `web/src/components/MetricsDashboard.tsx` | overlay surface (no longer a rail item) |
| `web/src/components/StatusChip.tsx` | **new** — shared health/verdict chip |
| `web/src/components/Overlay.tsx` | **new** — shared overlay shell with scrim + Escape + breadcrumb |

## 12. Verification

1. `npm --prefix web run test:run` — green (baseline **119**).
2. `npm --prefix web run build` — green.
3. `.opencode/skills/impeccable/scripts/impeccable detect web/src` — **0
   anti-patterns** (baseline 1).
4. Real browser via `browser-harness` at desktop and a narrow viewport:
   - Ask canvas renders; composer, verdict bar, chunk table all correct
   - Clicking a chunk row opens the Corpus overlay with the chunk focused
   - All three lenses reachable; all five capabilities reachable as overlays
   - Degraded / refused / no-model-served states render honestly
5. Ask the owner: **"What's your satisfaction score for this change, out of 10?"**
   and record it in `README.md`.

## 13. Out of scope

Backend behaviour changes; new features; the Phase 2 forensics work (cycle
timeline, fusion breakdown) beyond the hook the chunk table exposes; dark mode
(light is the decided theme — if dark is wanted later it is a token-layer
addition, not a restructure); mobile app.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Light theme + existing lavender Tailwind classes → half-migrated look | Migrate the whole token layer first, then components; grep for `lavender\|indigo\|purple` and eliminate |
| Big visual diff across 9 components | Ship in two passes: shell + Ask first (owner sees the new language), then overlay surfaces |
| Overlay model breaks existing tab tests | Update tests deliberately; keep every capability reachable and assert it in tests |
| Geist unavailable offline | Self-host with `font-display: swap` and a system stack fallback; must not block first paint |
