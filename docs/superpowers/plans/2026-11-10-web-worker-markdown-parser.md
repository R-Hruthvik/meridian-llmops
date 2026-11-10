# Implementation Plan: Web Worker & Block-Memoized Markdown Pipeline

## Overview
Implement a hybrid, zero-frame-drop Markdown streaming pipeline for the Meridian chat interface. Combines **Main-Thread Block-Memoized Parsing** for the active streaming tail with an **Asynchronous Web Worker Pipeline** for closed code blocks and heavy documents, guaranteeing 60fps streaming under arbitrary document size while eliminating FOUC.

---

## Architecture & System Design

```
Stream Ingestion (turn.answer updates)
               │
               ▼
   [ splitMarkdownBlocks ]
    ├── Block 0..N-1 (Closed Blocks) ──► Checked against Block LRU Cache
    │                                    ├── Cache Hit: Render cached VNode (< 0.01ms)
    │                                    └── Cache Miss (e.g. Code Block):
    │                                        Offload to Web Worker (`markdown.worker.ts`)
    │                                        Async return -> populate cache + update block
    │
    └── Block N (Active Streaming Tail)
         │
         ▼
     [ autoCloseMarkdownTokens ] (Heuristic: close open fences/emphasis)
         │
         ▼
     [ markedEngine.parse ] on Main Thread (< 300 chars, < 0.1ms)
         │
         ▼
     Immediate DOM Render (<div style="contain: content">)
     * Zero FOUC, zero input latency, preserved selection *
```

### Key Invariants
1. **Zero FOUC**: Active text never displays raw markdown formatting or unclosed backticks.
2. **Preserved Selection & DOM Stability**: Completed blocks maintain DOM node identity across stream ticks.
3. **Environment Agnostic**: JSDOM / SSR / Worker-unsupported environments seamlessly fall back to synchronous inline parsing.
4. **Interactive Citations**: Inline `[^n]` buttons remain clickable immediately during streaming.

---

## Proposed File Changes

### New Files
1. `web/src/components/chat/markdownWorkerTypes.ts`:
   - Message protocol types between Main Thread and Web Worker (`ParseRequest`, `ParseResponse`).
2. `web/src/components/chat/markdown.worker.ts`:
   - Web Worker thread running Marked + code block tokenization + sanitization off main thread.
3. `web/src/components/chat/markdownBlockParser.ts`:
   - Pure functions: `splitMarkdownBlocks`, `autoCloseMarkdownTokens`, and block hashing.
4. `web/src/components/chat/markdownBlockParser.test.ts`:
   - Unit tests for block splitting, auto-closing unclosed code fences, emphasis, and math tags.
5. `web/src/components/chat/useMarkdownWorker.ts`:
   - React hook managing Web Worker lifecycle, worker pool/singleton, request correlation IDs, and LRU cache.
6. `web/src/components/chat/useMarkdownWorker.test.ts`:
   - Hook tests with Worker mocking and fallback verification.

### Modified Files
1. `web/src/components/MarkdownRenderer.tsx`:
   - Refactor into composite renderer: `MarkdownBlock` list with `React.memo` and worker-assisted closed block rendering.
2. `web/src/components/MarkdownRenderer.test.tsx`:
   - Add tests for heavy content parsing, block memoization, and citation click preservation.

---

## Detailed Task Breakdown

### Task 1: Markdown Block Decomposer & Auto-Close Heuristics
- **Files**:
  - `web/src/components/chat/markdownBlockParser.ts`
  - `web/src/components/chat/markdownBlockParser.test.ts`
- **Steps**:
  1. Write failing tests in `markdownBlockParser.test.ts`:
     - Test `splitMarkdownBlocks(content)` correctly separates paragraphs, fenced code blocks (even with nested backticks), and lists.
     - Test `autoCloseMarkdownTokens(partial)` closes unclosed ` ``` `, `**`, `*`, `_`, `` ` ``.
  2. Implement `markdownBlockParser.ts`:
     - Fast regex/scanner state machine for top-level block boundaries (`\n\n` outside code fences).
     - Lightweight closing token stack for active blocks.
  3. Verify with `npm test -- markdownBlockParser.test.ts`.

### Task 2: Worker Protocol & Web Worker Implementation
- **Files**:
  - `web/src/components/chat/markdownWorkerTypes.ts`
  - `web/src/components/chat/markdown.worker.ts`
- **Steps**:
  1. Define `ParseRequest` (`{ id: string, content: string, blockIndex: number }`) and `ParseResponse` (`{ id: string, html: string, blockIndex: number }`).
  2. Implement `markdown.worker.ts`:
     - Instantiate dedicated `Marked` instance with citation badge extension.
     - Handle `self.onmessage`: parse content, sanitize, and `postMessage` result.
  3. Configure Vite worker bundling options if required.

### Task 3: Worker Client Hook with JSDOM Fallback
- **Files**:
  - `web/src/components/chat/useMarkdownWorker.ts`
  - `web/src/components/chat/useMarkdownWorker.test.ts`
- **Steps**:
  1. Write failing tests in `useMarkdownWorker.test.ts`:
     - Mock `window.Worker`.
     - Test request tracking with monotonic IDs (drop stale responses).
     - Test synchronous fallback when `Worker` is undefined or throws.
  2. Implement `useMarkdownWorker.ts`:
     - Singleton worker instance with ref-counted subscriber model.
     - In-memory `Map<string, string>` block cache.
     - `parseBlockAsync(id, content)` helper.
  3. Verify with `npm test -- useMarkdownWorker.test.ts`.

### Task 4: Composite `MarkdownRenderer` Integration
- **Files**:
  - `web/src/components/MarkdownRenderer.tsx`
  - `web/src/components/MarkdownRenderer.test.tsx`
- **Steps**:
  1. Update `MarkdownRenderer.tsx`:
     - Break content into blocks using `splitMarkdownBlocks`.
     - For closed blocks ($0 \dots N-1$): fetch from cache or schedule worker parse; render memoized block container with `contain: content`.
     - For active tail block ($N$): run `autoCloseMarkdownTokens` -> synchronous main thread `markedEngine.parse` (< 0.1ms).
     - Retain delegated citation click handler (`data-citation-index`).
  2. Update `MarkdownRenderer.test.tsx`:
     - Verify citation badges inside closed and active blocks fire `onCitationClick`.
     - Verify rogue button removal and XSS sanitization intact.
     - Verify multi-block document renders cleanly without layout shift.
  3. Run full Vitest suite: `npm test -- --run`.

### Task 5: Performance Verification & Final Production Build
- **Steps**:
  1. Benchmark test: render a 10,000-word response with 20 code fences; assert frame budget remains < 16ms.
  2. Verify production build: `npm run build` (`tsc -b && vite build` clean).
  3. Commit and push.

---

## Verification & Acceptance Criteria
- **Unit & Integration Tests**: 100% passing across Vitest.
- **Framerate Budget**: Main-thread parse duration during active token streaming < 1.0ms.
- **No FOUC**: Active code fences and formatting characters do not flash as unrendered text.
- **Accessibility**: Preserves `focus-machined` double-sandwich outline on interactive citation badges.
