# 02 — Home Page & LLMOps Cockpit (Empty State & Initial UX)

**Date:** 2026-11-10  
**Status:** proposed  
**Workspace:** `.worktrees/chat-interface/web`  
**Branch:** `feat/home-hero-cockpit`  
**Supersedes:** none (new page; the existing `ProjectWorkspace`/`RagWorkspace` shell stays intact)

## 1. Goal

Replace the desolate empty-state home page with an inviting, powerful **LLMOps Cockpit**: one screen that (a) states what Meridian is (dual-memory RAG: dense Qdrant + lexical BM25 + RRF + knowledge graph + citation provenance), (b) surfaces live system telemetry, (c) offers one centered input capsule as the primary action, (d) seeds the user with four curated prompt starters, and (e) accepts dragged files for instant grounding.

The hero is **one composition**: **Blueprint** (technical, annotated, grid-explicit, monospace data readout) carrying an **Editorial** display headline. Per `01_heroes.md` heuristic #2, we do not mix editorial headline + bento body + ambient footer. Per KB Tenet 2, depth comes from hairlines + opacity + scale — never blur shadows.

## 2. Design Tenets & Source References (verified)

| Tenet | Source | Application here |
|---|---|---|
| Depth without shadow | KB Tenet 1; `03_typography.md` §3 | Separation via `border border-hairline`, `surface`/`surface-raised`/`surface-sunken` opacity layering. No `box-shadow`, no `backdrop-blur`. |
| Hairline is the real border | KB Tenet 2; `03_typography.md` §3 | One owner per edge; sub-pixel `border-hairline`; collapse seams with negative margin where two panels meet. |
| Type scale is a formula, not a list | KB Tenet 3; `03_typography.md` §1 | Display headline = `clamp(2rem, 3.5vw + 1rem, 3.75rem)`, tracking `-0.035em`, `line-height` ~1.08. |
| Duration is emergent, not chosen | KB Tenet 4 | Capsule glide is a critically-damped spring (reuse `FluidMembraneInput` rAF loop). No `300ms ease`. |
| Dimensionality is a claim | KB Tenet 5 | Quantized radii: exactly 3 — `6px` (panel), `4px` (input/well), `9999px` (pill/chip/capsule). |
| Main thread is a budget | KB Tenet 6 | No WebGL canvas on the home page; the membrane canvas is reused only inside the existing capsule component, paused when idle. |
| Token usage, not presence | KB Tenet 7 | Every new Tailwind token below is actually referenced by a component; unused tokens are deleted. |
| Hierarchy needs a scale | `03_typography.md` §1 | `display` > `body` > `label` > `micro`; mono (`num`) for all telemetry values. |

**References consulted:** `01_heroes.md` (5 compositions, anti-slop list, hero audit checklist), `03_typography.md` (fluid type, OKLCH, shadow physics, subgrid, `:has()` focus), `KB_TENETS.md` (global heuristics), Linear / Godly / Basement Studio / Robert Borghesi / AstroDither distills, NNGroup empty-state guidance, RAG citation-provenance patterns.

## 3. Data Contract

Telemetry is read-only and never throws: a down backend reports `is_fallback: true` + `detail`, never an HTTP error (per `types/api.ts` §IndexStatusResponse). The UI renders **"unavailable"** — never a fake `0` — when a subsystem is null or fallback.

### 3.1 Backend endpoints consumed (existing, no new backend work)

| Endpoint | Field used | Cockpit mapping |
|---|---|---|
| `GET /v1/index/status` | `vector.total_points` | Vector count (Qdrant points / fallback chunk count) |
| `GET /v1/index/status` | `vector.vector_dimension` | Embedding dimension subtitle |
| `GET /v1/metrics` | `latency_ms.p95` | p95 search latency (ms) |
| `GET /v1/index/status` | `graph.node_count` | KG entities count |
| `GET /v1/index/status` | `graph.relationship_count` | KG relations count |
| `GET /v1/index/status` | `lexical.corpus_size` / `document_count` | BM25 in-process index status |
| `GET /v1/index/status` | `*.is_fallback`, `*.detail` | Fallback badge + tooltip |
| `GET /v1/settings/llm` | `default_model` | Active model badge |
| `GET /v1/documents` | `documents[]` + `total_documents` | Ingested file dropzone + quick preview |

### 3.2 TypeScript contract (`web/src/types/api.ts` additions)

No new backend types needed; consume existing ones. Add a local aggregate:

```ts
// web/src/types/cockpit.ts
export interface CockpitTelemetry {
  vectorCount: number | null;        // vector.total_points
  vectorDimension: number | null;    // vector.vector_dimension
  p95LatencyMs: number | null;       // latency_ms.p95
  kgEntities: number | null;         // graph.node_count
  kgRelations: number | null;        // graph.relationship_count
  bm25Documents: number | null;      // lexical.document_count
  bm25Corpus: number | null;         // lexical.corpus_size
  activeModel: string | null;        // llm default_model
  vectorFallback: boolean;           // vector.is_fallback
  graphFallback: boolean;            // graph.is_fallback
  bm25Fallback: boolean;             // lexical.is_fallback
  ready: boolean;                    // /health/ready
}
```

### 3.3 Hook (`web/src/hooks/useCockpitTelemetry.ts`)

Single hook, serial fetch of all three endpoints on mount + every 30s poll (poll disabled when tab hidden via `visibilitychange`). Returns `CockpitTelemetry` + `error`. Falls back to `null` values + `"unavailable"` UI on any failure — never crashes the page.

## 4. Token Architecture (Tailwind bindings)

All colors are the existing RGB-channel-triplet tokens (`rgb(var(--x) / <alpha-value>)`). **No new CSS variables.** Extend `tailwind.config.js` `theme.extend`:

```ts
fontSize: {
  // existing kept: micro, label, id, body, verdict, readout
  // CHANGE display to the spec'd fluid formula with optical tracking
  display: [
    'clamp(2rem, 3.5vw + 1rem, 3.75rem)',
    { lineHeight: '1.08', letterSpacing: '-0.035em', fontWeight: '600' },
  ],
  'display-sm': ['1.5rem', { lineHeight: '1.12', letterSpacing: '-0.025em', fontWeight: '600' }],
  hud: ['12px', { lineHeight: '1.4', fontWeight: '500', letterSpacing: '0.04em', textTransform: 'uppercase' }],
},
```

Keep the three existing radii (`DEFAULT 6px`, `sm 4px`, `pill 9999px`) — do not add a fourth (KB Tenet: >3 radii = lack of decisions).

Reuse existing color keys: `surface`, `surface-raised`, `surface-sunken`, `hairline`, `hairline-strong`, `ink`, `muted`, `faint`, `accent`, `accent-ink`, `accent-wash`, `ok/warn/fail` (+wash).

Add component-scoped utility classes in `index.css` `@layer components` (no new design tokens):

```css
.cockpit-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));   /* md+ */
  gap: 1.5rem;
}
@media (max-width: 767px) {
  .cockpit-strip { grid-template-columns: 1fr; }     /* stack on sm */
}
.cockpit-stat {
  border: 1px solid rgb(var(--border));
  background: rgb(var(--surface-raised));
  /* hairline owns the edge; no shadow */
}
```

## 5. Layout Blueprint

TopBar (existing shell, `h-14`, sticky) stays above the hero. The hero is a full-bleef viewport container below it.

```
┌─────────────────────────────────────────────────────────────┐
│ TopBar (existing) ───────────────────────────────────────── │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Meridian LLMOps Cockpit        ← editorial display type   │
│  Dual-memory RAG: dense + lexical + graph + citations     │  hero masthead
│                                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────┐  │
│  │ 12,842  │ │  p95 240│ │  3,410  │ │  8,920  │ │ bge │  │ ← telemetry HUD
│  │ vectors │ │ latency │ │ entities│ │ relations│ │model│  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────┘  │
│                                                             │
│                              [search]  Ask anything…  [↵]  │ ← capsule @ 42vh, fixed, membrane
│                              Cmd+Enter                                      │
│                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────┐   │
│  │ Audit Vector│ │ Verify       │ │ Trace KG    │ │ Compare│ │ ← prompt bento (4 chips)
│  │ Recall…     │ │ Hallucination│ │ Lineage…    │ │ Dense  │ │
│  │ Latency…    │ │ Guardrails…  │ │ for Entities│ │ vs BM25│ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  📁 Drop files here to ground your answers          │   │ ← dropzone
│  │     (PDF, MD, TXT)  ·  0 files ·  quick preview …   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.1 Grid math

- Hero container: `w-full max-w-[1200px] mx-auto px-6` (clamped so the capsule never bleeds edges).
- Telemetry strip: `grid grid-cols-4 gap-4` on `md+`; `grid-cols-1` (stacked) below `md`; badge cell collapses into last stat cell on `sm`.
- Prompt bento: `grid grid-cols-2 gap-3` on `md+`; `grid-cols-1` below `md`. Cells are unequal spans? Per `01_heroes.md` bento rule, no two adjacent rows align on the same vertical rhythm — we use **equal 2×2 cells with varied internal composition** (icon+title on some, title+caption on others) to satisfy the "no table" rule without fragile subgrid spans. On `lg`, bento becomes a single 4-cell row `grid-cols-4` above the dropzone if width permits; otherwise stays 2×2.
- Capsule: fixed, `left-1/2 -translate-x-1/2`, `w-[520px] max-w-[calc(100vw-32px)]`, vertical target `42vh` (reuse `FluidMembraneInput.isCenter`).
- Dropzone: full width below hero flow, `max-w-[1200px] mx-auto`.

### 5.2 Responsive breakpoints (Tailwind defaults: sm 640 / md 768 / lg 1024)

| Element | `< 640` (sm) | `640–1023` (md) | `≥ 1024` (lg) |
|---|---|---|---|
| HUD strip | stacked 1 col, badge inline with last stat | 4 cols + badge as 5th chip-like cell | 4 cols + badge |
| Bento | 1 col chips, full width | 2×2 grid | 2×2 (or 1×4 when wide) |
| Capsule width | `calc(100vw-32px)` | `calc(100vw-48px)` | `520px` |
| Dropzone | full width, stacked preview | full width | full width, preview inline right |
| Display type | `clamp` floor 2rem | fluid | `clamp` ceiling 3.75rem |

## 6. React Component Architecture

```
HomePage (page composer)
├── EditorialMasthead          (display headline + subhead + one-liner)
├── TelemetryHud               (5 cells: 4 stats + model badge)
│   └── StatCell ×4            (label, mono value, fallback dot, tooltip)
│   └── ModelBadge             (active model chip)
├── FluidMembraneInput         (REUSE existing, isCenter=true, 42vh)
│   └── (search icon, input, Cmd+Enter/↵ badge, send button)
├── PromptStarterBento         (4 chips, click-to-fill + auto-focus)
│   └── PromptChip ×4
└── IngestDropzone             (drag-and-drop + quick preview list)
    └── FilePreviewItem ×N
```

### 6.1 `HomePage` (`web/src/pages/HomePage.tsx` — new)

Owns data fetching via `useCockpitTelemetry` + `api.getDocuments`, mounts all children, holds `query` state shared with the capsule (controlled input) and `ingesting` flag. Lazy-loads nothing on first paint (all telemetry is fast; documents list is non-blocking, rendered with skeleton).

```tsx
export function HomePage() {
  const telemetry = useCockpitTelemetry();
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  // fetch documents non-blocking, no await
  useEffect(() => { api.getDocuments('default').then(r => setDocuments(r.documents)); }, []);
  const handleChipFill = useCallback((q: string) => { setQuery(q); }, []);
  return (<>…</>);
}
```

### 6.2 `EditorialMasthead` (`web/src/components/cockpit/EditorialMasthead.tsx` — new)

```tsx
export const EditorialMasthead = () => (
  <section className="mx-auto max-w-[1200px] px-6 py-10 md:py-16">
    <h1 className="text-display text-ink tracking-[-0.035em] text-wrap-balance">
      Meridian LLMOps Cockpit
    </h1>
    <p className="mt-4 text-body text-muted leading-[1.65] max-w-60ch">
      Dual-memory RAG: dense vector search (Qdrant) + exact lexical search (BM25) +
      Reciprocal Rank Fusion, knowledge-graph entities, and verifiable citation provenance.
    </p>
  </section>
);
```

### 6.3 `TelemetryHud` + `StatCell` (`web/src/components/cockpit/TelemetryHud.tsx` — new)

One row of micro-stats. Every number renders in `.num` (mono, tabular nums). Fallback state renders `— unavailable` + faint dot + tooltip `detail`.

```tsx
interface StatCellProps {
  label: string;          // e.g. "Vectors"
  value: number | null;   // null → "—"
  sub?: string;           // e.g. "768 dim" / "240 ms p95"
  fallback?: boolean;     // is_fallback
  detail?: string;        // fallback explanation
  variant?: 'ok' | 'faint' | 'fail';
}
```

Cells:
1. **Vectors** — `vectorCount` + `vectorDimension` sub, fallback dot
2. **p95 latency** — `p95LatencyMs` ms
3. **KG entities** — `kgEntities`
4. **KG relations** — `kgRelations`
5. **Model badge** — `activeModel` chip (accent-wash), not a stat cell

BM25 status is folded into cell 4's subtext or a dedicated faint chip: `BM25: indexed` / `BM25: fallback` / `BM25: unavailable`. Spec: BM25 gets its own trailing chip in the HUD row (5th position) showing `Indexed` / `Fallback` / `—` with ok/faint/fail dot.

### 6.4 `FluidMembraneInput` (REUSE — no new file)

Mount with `isCenter`, `placeholder="Ask anything about your corpus"`, `ariaLabel="Ask Meridian"`. The existing component already provides: capsule at 42vh, parametric membrane canvas, search icon, `Cmd+Enter` / `↵` badge, send button, critically-damped glide. **Do not duplicate.** HomePage passes `value`/`onChange`/`onSubmit` and an `inputRef` to programmatically focus after chip clicks.

### 6.5 `PromptStarterBento` + `PromptChip` (`web/src/components/cockpit/PromptStarterBento.tsx` — new)

4 chips, click → `setQuery(chipText)` + focus input (`inputRef.current?.focus()`) + visually mark selected (border-accent, bg-accent-wash) for 1.2s then clear.

Chips (exact labels from the task):
1. "Audit Vector Recall Latency across Hybrid Storage"
2. "Verify Hallucination Guardrail Enforcement on Refusals"
3. "Trace Knowledge Graph Lineage for Extracted Entities"
4. "Compare Dense vs BM25 Precision over Current Ingested Files"

Chip markup: `rounded-sm border border-hairline bg-surface-raised p-3 text-left hover:border-accent focus-machined`, mono `id` size for any leading number, `body` for title. Clickable via `<button role="option">` with `aria-keyshortcuts`.

### 6.6 `IngestDropzone` (`web/src/components/cockpit/IngestDropzone.tsx` — new)

Drag-and-drop well below the hero (or floating corner on `lg`: bottom-right fixed `w-80`). Native drag events + file input. On drop: `api.uploadDocuments(files, tenantId)`, then refresh documents list. Quick preview: list of `FilePreviewItem` (filename, chunks, status chip ok/warn/fail). Empty: illustrative instruction text, no illustration assets (keep it text + hairlines).

## 7. Motion & Micro-interactions

- Capsule glide: existing `FluidMembraneInput` rAF spring (0.16 lerp, EPSILON 0.1px), pauses at rest. Respects `prefers-reduced-motion` (skip loop, instant snap).
- Chip click: instant text fill (no animation), `focus()` on input, brief `border-accent` ring on the chip (CSS transition `duration-200`).
- HUD values: instant render; no number-counting animation (main thread budget).
- Dropzone drag-over: `border-accent` + `bg-accent-wash` via `dragenter`/`dragleave`/`drop`; leaves restore on `dragend`.
- Nothing animates on scroll (hero has no scroll-driven motion — tenet #5).

## 8. Accessibility

- Skip link at page top (`skip-to-main`, existing CSS).
- H1 is the only `h1`; section hierarchy `h1 > p` (no competing headings).
- Every stat value has an `aria-label` combining label + value + unit (e.g. "Vectors, 12,842").
- Fallback states use text + dot, never color only (StatusChip pattern).
- Capsule: `focus-machined-accent` ring on the input; `↵` badge announces "Enter" / "Cmd+Enter" textually.
- Chips: `role="option"`, `tabIndex={0}`, `onKeyDown` handles Enter/Space, `aria-keyshortcuts="Enter"`.
- Dropzone: `aria-label="Drop files to ground your answers"`, visible file-input fallback.
- `prefers-reduced-motion: reduce` disables the membrane rAF loop and chip flash.

## 9. Empty States & Fallbacks

| Condition | Rendering |
|---|---|
| All subsystems healthy | Real numbers everywhere |
| `vector.is_fallback` | `— unavailable` + faint dot, tooltip: `vector.detail` |
| `graph.node_count === null` | `— unavailable` (never `0`) |
| `lexical` fallback | BM25 chip shows `Fallback` (faint) |
| `activeModel === null` | Model badge shows `Not configured` (faint), links to Settings mentally |
| `GET /v1/documents` fails | Dropzone still works; preview list hidden, inline error text |
| `/health/ready` false | HUD shows `System not ready` banner (hairline border, fail wash) at top of strip |

## 10. Implementation Plan

Files to **create** (all under `web/src/`):
1. `types/cockpit.ts` — `CockpitTelemetry` interface
2. `hooks/useCockpitTelemetry.ts` — telemetry hook (3 fetches + 30s poll + visibility pause)
3. `pages/HomePage.tsx` — page composer
4. `components/cockpit/EditorialMasthead.tsx`
5. `components/cockpit/TelemetryHud.tsx` (+ `StatCell`, `ModelBadge`)
6. `components/cockpit/PromptStarterBento.tsx` (+ `PromptChip`)
7. `components/cockpit/IngestDropzone.tsx` (+ `FilePreviewItem`)
8. `components/cockpit/index.ts` — barrel export

Files to **modify**:
9. `tailwind.config.js` — `fontSize.display` → clamp formula + tracking; add `fontSize.hud`
10. `index.css` — `@layer components` `.cockpit-strip`, `.cockpit-stat`, `.cockpit-chip` utilities
11. `App.tsx` or router — mount `HomePage` at root route (verify existing routing; hash-route per `2026-10-14-meridian-workbench-redesign.md` if a router exists, else render `HomePage` directly)

Verification commands (from `web/`): `npx vitest run`, `npx tsc --noEmit`, `npx tailwindcss` build, `npm run lint`.

## 11. Success Criteria

- [ ] Page loads with H1 display type using `clamp(2rem, 3.5vw + 1rem, 3.75rem)` and `-0.035em` tracking.
- [ ] HUD shows vector count, p95 latency, KG entities/relations, BM25 status, active model — real values or `— unavailable`, never fake `0`.
- [ ] Input capsule floats at 42vh with membrane, search icon, Enter badge, send button.
- [ ] Clicking any of 4 chips fills the input and auto-focuses it.
- [ ] Drag-and-drop accepts files and lists them in the preview with status chips.
- [ ] No `backdrop-blur`/`box-shadow` on the home page; exactly 3 radii used.
- [ ] Works keyboard-only and on `sm`/`md`/`lg` breakpoints; `prefers-reduced-motion` respected.
- [ ] `npx vitest run` and `npx tsc --noEmit` pass; no new runtime dependencies.

## 12. Risks & Open Questions

- **Capsule vs. content overlap:** the fixed capsule at 42vh floats over the hero flow. The page reserves a `min-h-[52vh]` band above the bento so nothing collides; verify visually on `sm` where viewports are short.
- **Embedding model vs. LLM model:** `/v1/settings/llm` exposes `default_model` (LLM), not a dedicated embedding-model field. Badge shows `default_model`; if a distinct embedding model is required, add a telemetry field to `/v1/index/status` later (not blocked).
- **Routing:** confirm whether `App.tsx`/`ProjectWorkspace` owns the root route before wiring `HomePage` in; if hash routing exists, add `#/home` → `HomePage`.
- **Polling cost:** 30s telemetry poll across 3 endpoints; disable when tab hidden, increase interval if endpoints prove expensive.
