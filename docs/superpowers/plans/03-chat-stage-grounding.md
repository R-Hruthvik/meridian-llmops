# 03 — Chat Stage, Streaming Engine & Citation Grounding Drawer

Architectural blueprint for the Meridian conversational UI. Production-grade, written against the existing Vite + React 19 + TypeScript + Tailwind stack in `web/src`.

**Status:** design specification. Nothing in this file is implemented code until a separate build task touches it.

## 1. Intent & scope

The Chat Stage is the primary conversational surface. It must stream LLM output token by token without layout flicker, surface grounding evidence inline and in a split-screen inspector, and degrade gracefully — preserving retrieved chunks and offering a retry — whenever the model refuses or errors.

Three subsystems:

1. **Chat Stream & Conversational Feed** — message bubbles, SSE streaming buffer, kinetic turn entrance, turn footer unfold.
2. **Citation Grounding & Inspector** — inline citation chips, split-screen push-stage drawer, latency waterfall, grounded chunk viewer.
3. **Error Resilience & Recovery Surface** — unified errors, 500/timeout vs guardrail refusal distinction, Evidence Recovery card, Autonomous Grounding Pass retry.

## 2. Research basis & prior art

Consulted before writing this spec:

| Source | What it informed |
|--------|------------------|
| `frontend-learnings.md` (2026-11-08) | Streaming scroll (native + `overflow-anchor` sentinel, no JS virtualization), block-memoized markdown `<0.15ms`, SSE lifecycle (`AbortController` + `reader.cancel()` + `releaseLock()` + monotonic `requestId`), drawer breakpoints (380px ≥1280px / floating overlay 1024–1279px / bottom sheet <1024px), "Autonomous Grounding Pass" retry, Evidence Resilience, Twin-Region ARIA, critically damped spring |
| `distilled/02_anatomy.md` | Hairline single-owner borders, 5-layer ambient occlusion, focus-indicator treatments, bento grid modulus |
| `distilled/04_motion.md` | Critically damped spring $\zeta=1.0$ (`stiffness: 100, damping: 20, mass: 1`) |
| NN/G "Explainable AI in Chat Interfaces" (2025-12-12) | Citations visible and prominent, sentence-level placement, hover preview cards, `See all` source list |
| AI UX Playground (ChatGPT vs Perplexity citations, 2026-07-10) | Publisher-first inline chips, +N multi-source, popover preview, Sources sidebar |
| Shape of AI — Citations / References | Inline markers for sentence-level claims; drawer/sidebar for long-form exploration; keyboard-navigable landmark |
| fabarta / tutorialQ / sitepoint / xyc.ai SSE streaming guides | `fetch` + `ReadableStream` (not `EventSource` — POST + auth headers), rAF-batched token flush (~16ms/60fps), unclosed-code-fence completion, `X-Accel-Buffering: no`, `: ping` keepalive |
| Claude Artifacts / LibreChat Artifacts | Side-panel generative UI beside chat, versioning, copy/download, full-screen toggle |
| Tajaddin/streaming-chat-ui | Incremental SSE parser, deterministic message state machine (`idle → streaming → complete | error | aborted`), streaming-safe markdown, abort/regenerate/edit |

## 3. Conventions this spec must follow

Do not introduce new token names or layout primitives. Reuse what exists:

- **Tokens** (`src/tokens/theme.ts`, `tailwind.config.js`): `surface`, `surface-raised`, `surface-sunken`, `hairline` (DEFAULT/strong), `ink`, `muted`, `faint`, `accent` (DEFAULT/ink/wash), `ok`/`warn`/`fail` (+ wash). Type scale: `micro` 11px, `label` 13px, `id` 12px, `body` 15px, `verdict` 13px, `readout` 15px. Radius: `DEFAULT` 6px, `sm` 4px, `pill`.
- **Spring** (`src/constants/springs.ts`): `MERIDIAN_SPRING` (`stiffness: 100, damping: 20, mass: 1`), `MERIDIAN_REDUCED_TRANSITION` (100ms linear, `prefers-reduced-motion`).
- **Components**: `DoubleBezelCard`, `StatusChip` (variants `ok`/`warn`/`fail`/`faint`/`accent`, dot + mono label, never colour-only meaning), `MarkdownRenderer` (marked engine, `[^N]` citation-badge extension, `sanitizeHtml`, `PROSE_CLASS_NAMES`), `CitationInspectorDrawer` (380px drawer, chunks/waterfall/health tabs, timing monograms `[VEC:CHROMA]`/`[KG:SQLITE]`/`[KV:REDIS]`/`[LLM]`/`[VERIFY]`).
- **Hooks / state**: `useRagChat` (SSE consumer, `ChatTurn` interface, monotonic `requestId` guard, fallback `api.query`), `api.ts` (`ApiError` with `status`/`detail`/`code`).
- **Breakpoints** (from `frontend-learnings.md`): drawer desktop `>= 1280px` (380px push-stage), floating overlay `1024px–1279px`, bottom sheet `< 1024px`.

## 4. Subsystem 1 — Chat Stream & Conversational Feed

### 4.1 Message bubble architecture: double-bezel tactile card

Every assistant turn renders inside `DoubleBezelCard`:

```
outer border (hairline/80) + p-1.5 rounded-2xl
  └─ inner raised surface (bg-surface-raised) p-4 rounded-xl
        └─ specular light highlight rim on top edge
           light: inset 0 1px 0 rgba(255,255,255,0.8)
           dark:  inset 0 1px 0 rgba(255,255,255,0.08)
        └─ content: verdict label + active stage + markdown body
```

Tailwind expression (applied to the inner bezel):

```tsx
className={cn(
  'rounded-xl bg-surface-raised p-4 shadow-sm',
  'border-t border-white/[80] dark:border-white/[8]',   // specular rim, top edge only
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
  innerClassName
)}
```

User messages sit in a single `border border-hairline bg-surface-sunken rounded-lg` bubble (`self-end`, `max-w-[85%]`), matching existing `ChatStreamView`.

**Why double bezel:** the outer hairline defines the card edge; the inner raised surface with the specular rim gives a physical, lit-from-above edge that reads as "tactile" without heavy shadows (consistent with `02_anatomy.md`'s 5-layer ambient occlusion: hairline → panel surface → inner border → contact shadow → ambient glow).

### 4.2 Real-time SSE Streaming Buffer

#### Transport contract

- `POST /v1/query/stream`, `Content-Type: application/json`, body `{ query, tenant_id, top_k, max_cycles, enforce_guardrails }`.
- Response `Content-Type: text/event-stream`, headers `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, `Connection: keep-alive`.
- Client uses `fetch` + `ReadableStreamDefaultReader` — **not** `EventSource` — because the request is `POST` with bearer auth headers (`EventSource` is GET-only and cannot set custom headers).
- Server keeps the connection alive with `: ping` comment lines every 15s (resets idle timers on load balancers/proxies).
- Each event is one JSON object: `{ event: 'stage'|'token'|'retrieval_complete'|'verification_complete'|'done'|'error', data: {...} }`.
- Frames separated by `\n\n`; a single network read may split mid-event or mid-UTF-8-character, so the parser keeps a residual buffer and only drains when the terminator is present.

#### SSE reader lifecycle (typescript)

```ts
import type { SearchResult, QueryResponse } from '@/types/api';

export interface StreamEvent {
  event: 'stage' | 'token' | 'retrieval_complete' | 'verification_complete' | 'done' | 'error';
  data: Record<string, unknown>;
}

export interface SSEReaderOptions {
  onEvent: (event: StreamEvent) => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
  signal?: AbortSignal;
}

export async function consumeEventStream(
  body: ReadableStream<Uint8Array>,
  { onEvent, onEnd, onError, signal }: SSEReaderOptions,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flush = (rawFrame: string) => {
    const lines = rawFrame.split('\n');
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length === 0) return;
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(dataLines.join('\n')) as Record<string, unknown>; }
    catch { data = { message: dataLines.join('\n') }; }
    onEvent({ event: eventName as StreamEvent['event'], data });
  };

  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = `${buffer}${decoder.decode(value, { stream: true })}`.replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawFrame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (rawFrame.trim()) flush(rawFrame);
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer = `${buffer}${decoder.decode()}`.replace(/\r\n/g, '\n');
    if (buffer.trim()) flush(buffer);
    onEnd?.();
  } catch (err) {
    onError?.(err as Error);
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try { await reader.cancel('Stream lifecycle terminated'); } catch {}
    try { reader.releaseLock(); } catch {}
  }
}
```

Lifecycle guarantees:
1. `reader.cancel()` on abort makes a pending `read()` resolve as `done` instead of leaking a suspended promise.
2. `reader.releaseLock()` in `finally` frees the stream.
3. Monotonic `requestId` guard (existing `currentRequestIdRef` in `useRagChat`): events from a superseded request are ignored (`if (reqId !== currentRequestIdRef.current) return`).
4. `AbortError` from a user-initiated abort is **not** treated as an error surface (existing convention in `useRagChat` catch block).

#### Token delivery: rAF-batched buffer

Tokens arrive unevenly (bursts then silence). Per-token `setState` causes re-render jank. The buffer decouples network arrival from paint:

```
network thread          buffer          RAF tick (16ms)        React render
────────                ──────          ────────────           ────────────
"Hel" ─►                "Hel"
"lo w" ─►               "Hello w"
"orld" ─►  [buffered]   "Hello world" ─► flush ─► setContent   render once
                                              "Hello world"
```

Implementation sketch (matches existing `useRagChat` + `frontend-learnings.md`):

```ts
const bufferRef = useRef('');
const rafRef = useRef<number | null>(null);
const flush = useCallback(() => {
  const buffered = bufferRef.current;
  if (!buffered) return;
  bufferRef.current = '';
  rafRef.current = null;
  setContent(prev => prev + buffered);
}, []);
const onToken = (token: string) => {
  bufferRef.current += token;
  if (rafRef.current === null) {
    rafRef.current = requestAnimationFrame(flush);
  }
};
useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);
```

- Flush cadence: one render per animation frame (~16ms at 60fps).
- First token must paint immediately (TTFT): flush the first token synchronously on the first frame, then batch. Do not delay the first byte behind a full frame.
- Target: markdown parse + highlight `< 0.15ms` for the active block (per `frontend-learnings.md`).

#### Streaming-safe Markdown: block-memoized incremental parsing

Mid-stream Markdown is syntactically incomplete (unclosed code fences, half tables, open lists). Naïve re-parse per chunk causes DOM reconstruction and flicker.

Strategy (per `frontend-learnings.md` and research):

1. **Close unclosed constructs before render.** A `completeUnclosed(text)` pass temporarily closes odd fenced-code delimiters and odd inline backticks so the parser never emits a runaway `<pre>`. Closing markers are stripped before display.
2. **Block memoization.** Cache parsed output per stable block key. Only the active (still-growing) tail block is re-parsed each frame; completed blocks reuse cached nodes. `< 0.15ms` for the active block.
3. **Async Shiki only for closed code blocks.** Syntax highlighting runs async, only after a fence closes — zero FOUC, zero main-thread lag during streaming.
4. **No partial-HTML surgery.** Transform token stream, never regex on rendered HTML (preserves markdown context for links, citations, lists).
5. **Throttle renders ~60ms** aligned to the RAF tick; do not parse Markdown every rAF frame if the buffer is empty.

```
streaming text                    rendered DOM
─────────                         ────────────
"The quick brown"                 <p>The quick brown</p>
"The quick brown \n```js"         <p>The quick brown</p>   ← fence not closed, plain text
                                  <p>```js</p>             ← temporarily closed for parse
                                  (fence stripped before paint)
"The quick brown \n```js\nconst"  <p>The quick brown</p><pre><code class="lang-js">const</code></pre>
```

#### Scroll behavior

- Native `overflow-y-auto` scroll container; **no JS list virtualization** (per `frontend-learnings.md`).
- `overflow-anchor: auto` on a bottom sentinel node (`height: 1`, `aria-hidden`, `data-testid="chat-bottom-sentinel"`).
- Auto-scroll to bottom **only while the user is near the bottom** (within 8px). Once the user scrolls up, stop chasing (sticky scroll). A "Resume Live Stream" pill appears when loading and scrolled up.
- Mobile: listen to `visualViewport.resize` to adjust bottom padding when the keyboard opens; composer textarea grows internally with a max height.

### 4.3 Kinetic Turn Entrance

Each new assistant turn reveals with a critically damped spring:

- `y: 16px → 0`, `opacity: 0 → 1`.
- Uses `MERIDIAN_SPRING` (`stiffness: 100, damping: 20, mass: 1`, $\zeta=1.0`).
- Under `prefers-reduced-motion: reduce`: 100ms linear opacity-only fallback (no translate).
- Applied once per turn mount; not re-triggered on content growth.

### 4.4 Turn Footer unfold (anti-layout-jump)

When the answer completes, the footer (verdict chip, latency, source count, timing badges, copy/follow-up/rerun actions) must not cause a `+45px` layout jump.

Mechanism: CSS grid height expansion on the turn wrapper:

```css
.turn-wrapper {
  display: grid;
  grid-template-rows: 0fr 1fr;        /* body | footer */
  transition: grid-template-rows 0.3s ease;
}
.turn-wrapper .footer { grid-row: 2; visibility: hidden; height: 0; overflow: hidden; }
.turn-wrapper.complete .footer { visibility: visible; }
.turn-wrapper.complete { grid-template-rows: 1fr 1fr; }   /* or auto 1fr */
```

Better: animate `grid-template-rows: 0fr -> 1fr` so the footer's natural height grows smoothly instead of snapping. `grid-template-rows` is animatable in modern browsers; fallback to `max-height: 0 → max-height: large` if needed. Content-visibility: auto on completed turns keeps paint cost low.

### 4.5 TypeScript interfaces (feed)

```ts
export interface ChatTurn {
  id: string;
  query: string;
  createdAt: number;
  status: 'idle' | 'retrieving' | 'generating' | 'verifying' | 'complete' | 'error';
  activeStage?: {
    name: 'retrieving' | 'generating' | 'verifying';
    status: 'started' | 'complete';
    timings_ms?: Record<string, number>;
  };
  answer: string;
  sources: SearchResult[];
  verified: boolean;
  refusal: boolean;
  degraded_reason?: string | null;
  answer_status?: 'answered' | 'insufficient_context' | 'unverified' | 'refused';
  timings_ms: Record<string, number>;
  execution_time_ms: number;
  verification?: VerificationSummary | null;
  error?: { message: string; status?: number };
}
```

`useRagChat` already owns this interface; the spec does not redefine it — components consume it.

### 4.6 Layout diagram — chat stage

```
┌─────────────────────────────────────────────────────────────┐
│ ChatStage (h-full flex-col)                                 │
│  ├─ StreamContainer  overflow-y-auto  overflow-anchor:auto  │
│  │   role="log" aria-busy={isLoading}                        │
│  │   ├─ sr-only status announcer (stage milestones)          │
│  │   ├─ sr-only completion announcer                         │
│  │   └─ ol.turns                                             │
│  │       ├─ li.turn  gap-6                                   │
│  │       │   ├─ user bubble  self-end max-w-[85%]            │
│  │       │   └─ assistant card                               │
│  │       │       ├─ DoubleBezelCard                          │
│  │       │       │   ├─ [Meridian] [ActiveStage chip]        │
│  │       │       │   ├─ AnswerSkeleton / MarkdownRenderer    │
│  │       │       │   │     [text … [^N] citation badges …]   │
│  │       │       │   ├─ EvidenceRecoverySurface (refusal)    │
│  │       │       │   └─ TurnFooter (complete only)           │
│  │       │       │       grid-template-rows 0fr→1fr unfold   │
│  │       │       └─ cursor (blinking, only while streaming)  │
│  │       └─ … older turns (React.memo, content-visibility)   │
│  ├─ resume pill  (absolute bottom, only when scrolled up)   │
│  └─ sentinel  height:1 overflow-anchor:auto aria-hidden     │
└─────────────────────────────────────────────────────────────┘
```

### 4.7 Performance targets (feed)

| Metric | Target |
|--------|--------|
| Time to first token paint | ≤ 200ms after first network byte |
| Render cadence during stream | ≤ 1 frame per 16ms (RAF batched) |
| Markdown parse (active block) | < 0.15ms |
| Layout shift on completion | 0px jump (grid unfold) |
| Memory | completed turns `content-visibility: auto`, `React.memo` |

## 5. Subsystem 2 — Citation Grounding & Inspector

### 5.1 Inline citation chips

Citations render inline at sentence level (NN/G guidance: place sources next to the specific claim; make them visible and prominent, never buried).

- Markdown source uses `[^N]` footnote markers, emitted by the model with numbered sources.
- `MarkdownRenderer` converts `[^N]` to `<button class="citation-badge" data-citation-index="N" aria-label="Citation N">[^N]</button>`.
- Clicking a chip selects the chunk and opens/pins the Inspector Drawer to that chunk (existing `onCitationClick` → `onSelectChunk(chapter)` flow).

Chip styling (reuses `hairline`, `surface-sunken`, `id-mono`, `text-micro`):

```css
.citation-badge {
  inline-flex items-center justify-center rounded-sm border border-hairline
  bg-surface-sunken px-1.5 py-0.5 id-mono text-micro font-semibold text-ink
  cursor-pointer focus-machined
}
.citation-badge:hover { border-accent; text-accent-ink }
```

Multi-source on one claim: `[1/3]` with `+N` navigation inside the hover popover (per ChatGPT/Perplexity pattern). The chip shows the first citation; hover reveals the full set.

### 5.2 Split-Screen Push-Stage Inspector Drawer

Breakpoints (from `frontend-learnings.md`):

| Viewport | Behavior | Width |
|----------|----------|-------|
| ≥ 1280px | Push-stage: drawer pushes chat aside, both visible side by side | 380px |
| 1024–1279px | Floating overlay over the chat (right side), backdrop | ~380px capped |
| < 1024px | Bottom sheet (slide up from bottom), full width | 100vw |

The drawer never owns citation state: it renders the chunk the workspace selected and reports selection/navigation via callbacks (`onSelectChunk`, `onOpenCorpus`). The transcript stays authoritative (`ChatStreamView` → `useRagChat` → drawer).

Tabs:
- **Evidence Chunks** — ranked list (rank, title, score, excerpt), active chunk highlighted.
- **Latency Waterfall** — segmented micro-bar + per-stage bars (see 5.3).
- **Dual-Memory Health** — per-engine status (vector / graph / lexical / relational), fallback vs live.

### 5.3 Visual Waterfall Latency Breakdown

Stages (timing keys from `timings_ms`, monogram mapping from existing `formatTimingBadge`):

| Monogram | Label | Source key hint |
|----------|-------|-----------------|
| `[VEC:CHROMA]` | Embedding / Dense search | `dense`, `vector`, `qdrant`, `chroma` |
| `[KG:SQLITE]` | Graph retrieval | `graph`, `neo4j`, `kg` |
| `[KV:REDIS]` | BM25 / cache | `sparse`, `bm25`, `redis`, `kv` |
| `[RRF]` | Reciprocal Rank Fusion | `rrf`, `fusion`, `rerank` |
| `[LLM]` | LLM time-to-first-token | `llm`, `generat`, `synth`, `ttft` |
| `[VERIFY]` | Guardrail / verification | `verify`, `guard`, `audit` |

Waterfall render:
1. **Segmented micro-bar** — single `h-3` bar, each stage a width-proportional segment, total = sum of stage ms. `role="img"` with `aria-label` listing all stages.
2. **Legend** — monogram + label + ms, `id-mono text-micro`.
3. **Detailed bars** — per-stage `h-2` bar with label and `ms` readout.

TS interface:

```ts
export interface TimingStage {
  monogram: string;   // e.g. '[VEC:CHROMA]'
  label: string;      // e.g. 'Dense search'
  ms: number;
}
export interface WaterfallProps {
  timings: Record<string, number> | null;
  activeChunk?: SearchResult | null;
}
```

### 5.4 Grounded Chunk Viewer

For the active chunk:
- Document name / title + chunk index (`chunk_index`) + similarity score (`score`, 2 decimals).
- Retrieval method badge (`dense` / `sparse_bm25` / `hybrid` / `graph` / `HYBRID_RRF`).
- Provenance metadata: `heading_path`, `page_start` (`p. N`), `filename`, `document_id`.
- Verbatim text excerpt in `font-mono text-xs`, `whitespace-pre-wrap break-words`, bordered well.
- Actions: "Copy snippet", "Open in Corpus" (`onOpenCorpus`).

### 5.5 Layout diagram — inspector

```
Desktop ≥1280px  (push-stage)
┌─────────────────────────────┬─────────────────────────────┐
│ Chat stage                  │ Citation Inspector 380px    │
│                             │ ┌─────────────────────────┐ │
│ [turn 1]                    │ │ tabs: chunks ▪ waterfall│ │
│ [turn 2 ▲ active]           │ │ ├─ Evidence Chunks      │ │
│                             │ │ │ [1] doc.pdf 0.87      │ │
│                             │ │ │ [2] notes.md 0.61     │ │
│                             │ │ ├─ active chunk viewer  │ │
│                             │ │ │ verbatim text …       │ │
│                             │ │ └─ Copy / Open in Corpus│ │
│                             │ ├─ Latency Waterfall      │ │
│                             │ │ │███████░░░ 4 stages    │ │
│                             │ │ │[VEC] 45ms [LLM] 820ms │ │
│                             │ └─────────────────────────┘ │
└─────────────────────────────┴─────────────────────────────┘

Laptop 1024–1279px  (floating overlay)
┌─────────────────────────────────────────────────────────┐
│ Chat stage (dimmed behind)                              │
│                                 ┌─────────────────────┐   │
│                                 │ Citation Inspector  │   │
│                                 │  [X]  chunks▪waterfall│   │
│                                 │  active chunk …     │   │
│                                 └─────────────────────┘   │
└─────────────────────────────────────────────────────────┘

Mobile <1024px  (bottom sheet)
┌─────────────────────────────────────────────────────────┐
│ Chat stage                                              │
│ ├─ turn …                                               │
│ └─ [slide up sheet]                                     │
│   Citation Inspector  ────────── [X]                    │
│   chunks ▪ waterfall ▪ health                           │
│   [1] doc.pdf · 0.87                                    │
│   verbatim excerpt …                                    │
└─────────────────────────────────────────────────────────┘
```

## 6. Subsystem 3 — Error Resilience & Recovery Surface

### 6.1 Unified error handling

Eliminate duplicate stacked error boxes. One turn carries exactly one error state:

- `ChatTurn.error` = `{ message: string; status?: number }` — set only when the stream and the JSON fallback both fail.
- `ChatTurn.refusal` = `boolean` — guardrail/policy refusal, **not** a transport error.
- `ChatTurn.degraded_reason` — partial degradation (fallback index, reduced cycles).
- `ChatTurn.answer_status` = `'answered' | 'insufficient_context' | 'unverified' | 'refused'`.

The UI renders a single error block per turn, never a stack:
- `status === 'error'` → one `border border-fail bg-fail-wash` box with message + Retry button.
- `refusal || degraded_reason` → Evidence Recovery Surface (chunks preserved) + Autonomous Grounding Pass.

### 6.2 Differentiating HTTP 500 / timeout vs Guardrail refusal

| Condition | Source | `ChatTurn` fields | UI treatment |
|-----------|--------|-------------------|--------------|
| HTTP 500 / timeout / network | SSE `error` event or `fetch` throw | `status: 'error'`, `error.status` = 500/408/etc., `refusal: false` | Error box: "Query failed" + Retry (re-post to `/v1/query/stream`, then JSON fallback) |
| Guardrail refusal | `answer_status: 'refused'` or `refusal: true` from stream/done | `status: 'complete'`, `refusal: true`, `degraded_reason` may be set, `sources` preserved | No error box. Verdict chip `REFUSED`. Evidence Recovery Surface shown with retrieved chunks. |
| 429 rate limit | `error.status` = 429 | `status: 'error'` | Error box + retry-after hint (surface `Retry-After` header if present) |
| 401/403 auth | `error.status` = 401/403 | `status: 'error'` | Error box: auth required, no silent retry |

Transport errors (`ApiError` with `status`) are distinguishable from policy refusals (`refusal`/`answer_status: 'refused'`) because they set disjoint fields. The UI branches on `refusal` first, then `status === 'error'`.

### 6.3 Evidence Recovery card

Even on `REFUSED` or `DEGRADED`, retrieved chunks are preserved and displayed (existing `EvidenceRecoverySurface` in `ChatStreamView`):

- Header: "Meridian could not verify a grounded answer, but recovered N relevant chunks from your index" (`text-warn`, `border-warn`, `bg-warn-wash`).
- Grid of chunk cards (2 cols on sm+): title, score, verbatim excerpt, "Inspect" button → `onSelectChunk`.
- Never hidden behind the error box; renders alongside the refusal verdict in the same turn.

### 6.4 Autonomous Grounding Pass retry

Multi-stage retry reframed as an explicit user-visible grounding pass:

- Label: **"Autonomous Grounding Pass"** (ice-blue / amber treatment, per `frontend-learnings.md`).
- Timer: `tabular-nums` `0.1s` readout counting elapsed pass time.
- Trigger: button inside the Evidence Recovery Surface / error box. Re-submits the same query with `enforce_guardrails` toggled or `max_cycles` increased, creating a new turn (append-only transcript, never mutating the failed turn).
- States: `idle → pass-running (timer) → pass-complete (new turn) | pass-failed`.
- The failed turn is left intact for audit; the new turn references it via follow-up context (`[ ↳ Ask Follow-up ]` injection into stateless `/v1/query`, per `frontend-learnings.md`).

TS interface:

```ts
export interface GroundingPass {
  id: string;
  originTurnId: string;
  status: 'idle' | 'running' | 'complete' | 'failed';
  startedAt?: number;
  elapsedMs?: number;   // tabular-nums 0.1s timer
  resultTurnId?: string;
  error?: { message: string; status?: number };
}

export interface ErrorPolicy {
  kind: 'transport' | 'guardrail' | 'degraded';
  httpStatus?: number;
  retryable: boolean;
  label: string;          // e.g. 'Query failed' / 'REFUSED' / 'DEGRADED'
  action: 'retry-stream' | 'retry-fallback' | 'grounding-pass' | 'none';
}

export function classifyError(err: unknown, turn: ChatTurn): ErrorPolicy {
  // transport: err instanceof ApiError || status === 'error' && !refusal
  // guardrail: turn.refusal || turn.answer_status === 'refused'
  // degraded: Boolean(turn.degraded_reason)
}
```

### 6.5 Layout diagram — error & recovery

```
assistant card (turn complete, refused)
├─ [Meridian] [REFUSED fail-chip]
├─ MarkdownRenderer  (answer may be empty or partial)
├─ EvidenceRecoverySurface  border-warn bg-warn-wash
│   ├─ "could not verify … recovered 3 chunks"
│   ├─ grid: [doc.pdf 0.87] [notes.md 0.61] [log.txt 0.41]
│   │     verbatim excerpt …  [Inspect]
│   └─ [Autonomous Grounding Pass] [timer 0.0s tabular-nums]
└─ TurnFooter  [REFUSED] [3 sources] [timing badges]

assistant card (transport error)
└─ error box  border-fail bg-fail-wash
    ├─ "Query failed"  text-fail
    ├─ "HTTP 500 — upstream unavailable"
    └─ [Retry]  → new stream attempt → JSON fallback
```

## 7. Data flow

```
User sends query
    │
    ▼
useRagChat.submitQuery
    │  create turn {status:'retrieving', answer:'', sources:[]}
    │  requestId++ ; AbortController
    ▼
POST /v1/query/stream  (fetch + ReadableStreamDefaultReader)
    │
    ├─ SSE event 'stage' ──► turn.status = retrieving|generating|verifying
    │                              activeStage.started|complete
    │
    ├─ SSE event 'token' ──► bufferRef += delta ; RAF flush
    │                              setContent(prev => prev + buffer)
    │                              MarkdownRenderer re-parses active block
    │
    ├─ SSE event 'retrieval_complete' ──► timings_ms merged
    │
    ├─ SSE event 'verification_complete' ──► verified + VerificationSummary
    │
    ├─ SSE event 'done' ──► sources, answer_status, refusal, verified
    │                              status → 'complete'
    │                              (if still active → complete)
    │
    └─ SSE event 'error' / fetch throw ──►
              classifyError():
              ├─ guardrail (refusal) ──► complete, Evidence Recovery Surface,
              │                         Autonomous Grounding Pass offered
              ├─ transport (500/timeout) ──► status:'error', error box,
              │                         Retry → stream → JSON fallback
              └─ 429/401 ──► error box, no silent retry
    │
    ▼
ChatStreamView renders turn:
  kinetic entrance (spring y:16→0) ──► streaming body ──► grid footer unfold
       ▲                                              │
       │                                              ▼
       └─ citation chip [^N] clicked ──► onSelectChunk ──►
          CitationInspectorDrawer (push-stage 380px / overlay / bottom sheet)
                tabs: chunks | waterfall | health
                active chunk viewer: verbatim + provenance + score
                waterfall: embedding | dense | BM25 | RRF | LLM TTFT | verify
```

## 8. State management

- **Source of truth:** `useRagChat` holds `turns[]`, `activeTurnId`, `isLoading`. Append-only transcript; turns are never mutated in place except via `updateTurn` functional updates.
- **Drawer state:** local to the drawer component (`activeTab`, `copied`); `activeChunk` passed in from `ChatStreamView` via `onSelectChunk`.
- **Grounding Pass:** new hook or state slice owning `GroundingPass[]` keyed by `originTurnId`; does not alter existing turns.
- **Scroll:** `isUserScrolledUp` local to `ChatStreamView`; native scroll + sentinel.
- **No global store, no IndexedDB writes in this phase** (conversational persistence is a separate subsystem per `frontend-learnings.md`).

## 9. Accessibility

- Twin-Region ARIA (per `frontend-learnings.md`): `aria-busy="true"` on the stream container with **no** `aria-live` on streaming text; a separate `role="status" aria-live="polite"` announcer for stage milestones and completion.
- Citation buttons are real `<button>` elements (`type="button"`), keyboard-focusable, `aria-label="Citation N"`.
- Focus rings: double-sandwich concentric focus rings (18:1 contrast) per `02_focus_indicators.md`.
- Drawer: `role="dialog" aria-modal="true"`, Escape closes, focus trapped, `aria-label="Citation Inspector"`.
- `overflow-anchor` sentinel `aria-hidden="true"`.
- `prefers-reduced-motion`: 100ms opacity fallback, no translate springs.
- Colour never carries meaning alone: StatusChip dot is decorative; label carries state; verdict chip has text label.

## 10. Non-goals

- IndexedDB persistence / Analytical Notebook session stream (separate subsystem).
- JS list virtualization (explicitly avoided; native scroll is sufficient).
- Per-token DOM node allocation (block memoization + RAF batching instead).
- New design tokens (reuse `theme.ts` / Tailwind map).
- Backend changes (SSE contract assumed to exist; this spec is frontend-only).

## 11. Open questions (to resolve before implementation)

1. Does `/v1/query/stream` currently emit `[^N]` citation markers and `timings_ms` with RRF/stage keys, or only `sources` + `execution_time_ms`? If not, the waterfall and citation chips lack data.
2. Is there a backend guardrail endpoint that returns `refusal` + `degraded_reason`, or is refusal inferred from `answer_status`?
3. Should the grounding pass retry reuse the same `requestId` (replacing the turn) or create a new turn (append-only audit)? Spec assumes new turn.
4. Confirm Tailwind `shadow-sm` exists or whether to use the existing `shadow-[inset_…]` arbitrary value for the specular rim.
