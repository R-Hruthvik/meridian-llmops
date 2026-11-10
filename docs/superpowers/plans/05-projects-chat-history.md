# 05 — Projects, Tenant Isolation & Chat History Architecture

> Architectural blueprint for the Meridian chat-interface workspace. Production-grade,
> tenant-isolated project and session system with client-side chat persistence and
> grounded project-file integration.
>
> **Status:** Specification (pre-implementation)
> **Owner:** Lead Workspace & Data Architecture Specialist
> **Target:** `web/src/` — React 19, TypeScript, Vite, Tailwind CSS, Vitest

---

## 1. Evidence & Research Summary

Per the research-ops process skill, this section separates sourced facts, user-provided
context, inference, and recommendation before any implementation claim.

### Sourced facts (external)

| Claim | Source |
|-------|--------|
| A "Project" is a container that holds chats, uploaded files, and custom instructions at once | OpenAI help: "Projects in ChatGPT" (help.openai.com/en/articles/10169521) |
| Claude Projects surface the knowledge corpus; they do not advertise chat history memory across every prior chat in the folder | Wyatt Works: "ChatGPT Projects vs Claude Projects" |
| IndexedDB offers ~50GB+ per-origin storage capacity, far above localStorage (~5MB) | Medium: "Proposing Browser-Based RAG for Session-Level Knowledge" |
| localStorage is synchronous and ~5MB; IndexedDB is asynchronous with much higher limits | Reintech: "localStorage vs sessionStorage vs IndexedDB: Complete Guide" |

### User-provided context (local code)

| Fact | Location |
|------|----------|
| `MeridianApiClient` already sends `X-Tenant-Id` header on every request; `requireTenantId()` rejects blank tenants | `web/src/services/api.ts:91-102, 286-311` |
| `useRagChat` resets turns when `tenantId` changes (tenant-scoped transcript) | `web/src/components/chat/useRagChat.ts:223-231` |
| `ProjectWorkspace` keeps `Project` and `ChatSession` inline, persisted to `localStorage` keys `meridian:projects` / `meridian:sessions` | `web/src/components/project/ProjectWorkspace.tsx:20-90` |
| `window.confirm` / `window.prompt` used for project/session/document deletion | `ProjectWorkspace.tsx:151,158,207` |
| Design tokens: `surface`, `surfaceRaised`, `surfaceSunken`, `border`, `hairline`, `accent`, etc. | `web/src/tokens/theme.ts`, `web/src/tailwind.config.js` |
| Modal pattern: `role="dialog"`, `aria-modal="true"`, Escape-to-close, backdrop click-to-close | `ProjectSettingsModal.tsx:46-58` |

### Inference (this document's conclusions, not external facts)

- Tenant isolation already exists at the API transport layer (`X-Tenant-Id`); the gap is binding UI navigation (project switcher) to that tenant id consistently and never leaking one project's sessions into another.
- `localStorage` is the current persistence mechanism; it is synchronous, ~5MB-capped, and has no schema migration path. Chat history with message counts, pinned flags, and per-session turns warrants an IndexedDB-first store with localStorage fallback.
- `window.confirm`/`window.prompt` violate the requirement to replace native dialogs with safe modal confirmations; a shared confirmation dialog primitive is needed.
- Project settings (name, created-at, file counts, default model override) are not currently stored; they need a `Project` model promotion to shared types.

### Recommendation

Build the specification below as a single implementation target. It promotes existing inline types into `types/api.ts`, adds an `IndexedDBStore` wrapper with localStorage fallback, introduces a `ConfirmationDialog` primitive, and reorganizes `ProjectWorkspace` into a collapsible-left-rail shell. No new npm dependencies are required; IndexedDB is native browser API.

---

## 2. Goals & Success Criteria

1. **Tenant isolation**: Every API request carries `X-Tenant-Id` bound to the active project/session; no session or document is readable across tenant boundaries from the UI layer.
2. **Project lifecycle**: Create, switch, rename, delete project — each via modal confirmation (no `window.confirm`/`window.prompt`).
3. **Project settings & metadata**: Name, creation timestamp, file counts, default model override, persisted.
4. **Chat history persistence**: Append-only session stream in IndexedDB (localStorage fallback); session model with id, projectId, title, createdAt, updatedAt, turns, pinned.
5. **Collapsible left rail**: Project switcher popover with quick search, "+ New Chat" hero-glide trigger, chat list grouped by Today/Yesterday/Previous 7 Days, active-session blue accent border, message-count pill, keyboard-accessible hover delete.
6. **Search & filter**: Full-text filter over session titles.
7. **Grounded project files**: Drawer panel listing ingested documents, drag-and-drop upload (PDF/MD/TXT), status badges (Indexed / chunk count / entity count / vector points), delete confirmation, instant index refresh via `GET /v1/documents`.
8. **Zero regressions**: Existing `useRagChat`, `RagWorkspace`, `ProjectSettingsModal`, `FluidMembraneInput` behavior preserved; all existing tests still pass.

Non-goals (out of scope): cross-project chat sharing, real-time collaboration, server-side session auth, file preview rendering, vector-index management UI beyond status badges.

---

## 3. System Architecture & Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Browser (single origin)                         │
│                                                                         │
│  ┌──────────────┐      ┌─────────────────────────────────────────┐      │
│  │  React UI    │      │         IndexedDBStore (idb-keyval-like)  │      │
│  │  (Project    │◄────►│  - sessions, projects, settings stores    │      │
│  │   Workspace) │      │  - localStorage fallback adapter          │      │
│  └──────┬───────┘      └─────────────────────────────────────────┘      │
│         │                                                               │
│         │ useProjectStore / useChatSession (React state + sync)        │
│         ▼                                                               │
│  ┌──────────────┐      ┌─────────────────────────────────────────┐      │
│  │ MeridianApi  │─────►│  FastAPI backend :8000 (X-Tenant-Id)    │      │
│  │  Client      │      │  GET /v1/documents, DELETE, POST upload │      │
│  └──────────────┘      └─────────────────────────────────────────┘      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data flow rules

1. **Tenant binding**: The active project's `id` is the tenant id. Every `api.*` call is made with `tenantId = activeProject.id`. The UI never sends a tenant id the user typed directly into an input without validation (non-empty, trimmed).
2. **Session scoping**: `useRagChat` receives `tenantId`; when it changes, turns are cleared (existing behavior preserved). Sessions are stored per-project in IndexedDB.
3. **Write-through**: Mutating UI actions (create/rename/delete project, create/delete session, pin, upload/delete document) write to IndexedDB *and* call the API optimistically where a server record exists (documents). On API failure, roll back the local write and surface an `ApiErrorNotice`.
4. **Read path**: On mount, load projects + active project's sessions from IndexedDB; load documents via `GET /v1/documents`. Sessions never cross project boundaries.

---

## 4. TypeScript Data Schemas

Add to `web/src/types/api.ts` (or a new `web/src/types/workspace.ts` — keep co-located with `api.ts` since it shares the API client conventions). Below are the canonical schemas.

```typescript
// web/src/types/workspace.ts

/**
 * A tenant is a workspace/billing isolation boundary. In this frontend the
 * active project's id doubles as the X-Tenant-Id sent to the API.
 */
export interface Tenant {
  id: string;                    // stable, URL-safe
  name: string;                  // human-readable, editable
  createdAt: number;             // epoch ms
  updatedAt: number;             // epoch ms
  /** Model override for this tenant; absent means "use account default". */
  defaultModel?: string | null;
  /** Cached file count, refreshed after GET /v1/documents. */
  fileCount: number;
}

/**
 * A project is the UI-visible container a tenant is bound to.
 * One project = one tenant scope in this release.
 */
export interface Project {
  id: string;
  name: string;
  tenantId: string;              // equals id in 1:1 mapping; kept for clarity
  createdAt: number;
  updatedAt: number;
  defaultModel?: string | null;
  fileCount: number;
}

/**
 * A chat session belongs to exactly one project/tenant.
 */
export interface ChatSession {
  id: string;                    // crypto.randomUUID()
  projectId: string;
  title: string;                 // 'New chat' placeholder until first turn
  turns: ChatTurn[];             // full transcript (stored append-only)
  createdAt: number;             // epoch ms
  updatedAt: number;             // epoch ms, touched on every turn
  pinned: boolean;               // pinned sessions sort to top of their group
  /** Last turn preview for list rendering (derived, not stored separately). */
  lastTurnAt?: number | null;
}

/**
 * A message turn. Mirrors useRagChat.ChatTurn but stored lean in IndexedDB.
 */
export interface ChatTurn {
  id: string;
  query: string;
  answer: string;
  createdAt: number;
  status: 'idle' | 'retrieving' | 'generating' | 'verifying' | 'complete' | 'error';
  sources: SearchResult[];       // imported from types/api
  verified: boolean;
  refusal: boolean;
  answer_status?: 'answered' | 'insufficient_context' | 'unverified' | 'refused';
  timings_ms: Record<string, number>;
  execution_time_ms: number;
  error?: { message: string; status?: number } | null;
}

/**
 * Document status as surfaced in the project files panel.
 */
export interface DocumentStatus {
  id: string;
  title: string;
  format: string;
  status: 'indexed' | 'indexing' | 'indexed_with_warnings' | 'rejected' | 'error';
  chunkCount: number;
  entityCount: number;
  vectorPoints: number;
  updatedAt: number;
  error?: string | null;
}

/**
 * Grouped session list for the left rail (Today / Yesterday / Previous 7 Days).
 */
export interface SessionGroup {
  label: 'Today' | 'Yesterday' | 'Previous 7 Days' | 'Older';
  sessions: ChatSession[];
}

/**
 * Outcome of a confirmation dialog.
 */
export type ConfirmAction = 'proceed' | 'cancel';

/**
 * Input to create a project.
 */
export interface CreateProjectInput {
  name: string;
  defaultModel?: string | null;
}

/**
 * Input to rename a project.
 */
export interface RenameProjectInput {
  projectId: string;
  name: string;
}
```

### Schema migration strategy

IndexedDB stores are versioned by store name + a `meta` key `schemaVersion: 1`. On upgrade:
- Read old `meridian:sessions` / `meridian:projects` localStorage JSON (the legacy format in `ProjectWorkspace`).
- Map `localStorage` `Project` → `Project` + `Tenant`, `ChatSession` → `ChatSession` (add `pinned: false`, `tenantId: projectId`).
- Write to IndexedDB, clear localStorage keys, set `schemaVersion`.
- If IndexedDB is unavailable, fall back to localStorage with the same shape (no `pinned`, no grouping beyond project filter).

---

## 5. Tenant Isolation Architecture

### Binding rule

```
tenantId := activeProject.id
```

Every outbound API call sets `X-Tenant-Id: <tenantId>`. The `MeridianApiClient.getHeaders(tenantId)` already does this; call sites must pass the active project id explicitly, never default to `'default'` silently.

### Enforcement layers

| Layer | Mechanism |
|-------|-----------|
| Transport | `api.getHeaders(tenantId)` sets `X-Tenant-Id` on every request |
| Hook | `useRagChat({ tenantId })` clears turns on tenant change (existing) |
| Store | `IndexedDBStore` keys sessions by `projectId`; queries filter `projectId === active` |
| UI | Project switcher populates `activeProject`; no session list renders without an active project |
| Validation | `requireTenantId()` rejects blank/whitespace tenant ids before any request |

### What is NOT handled (out of scope, documented)

- Server-side tenant enforcement (assumed by backend; frontend cannot enforce it).
- Cross-tenant session transfer or sharing.
- Tenant creation/deletion (projects are created via UI; tenant ids are project ids).

---

## 6. Project Lifecycle

### Operations

| Operation | UI trigger | Confirmation | Persistence | API |
|-----------|-----------|--------------|-------------|-----|
| Create Project | "+ New project" in switcher popover | `ConfirmationDialog` (name input, required) | IndexedDB `projects` store | none (client-side only in this release) |
| Switch Project | Project switcher popover / rail "Active project" row | none | set active project; reload sessions | `GET /v1/documents` for new tenant |
| Rename Project | Settings modal / project row edit | `ConfirmationDialog` | IndexedDB `projects` store | none |
| Delete Project | Delete action in switcher / settings | `ConfirmationDialog` (destructive, lists session count) | remove from `projects` + cascade sessions | none |

### Safe modal confirmation (replaces `window.confirm`/`window.prompt`)

A single reusable `ConfirmationDialog` component:

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby`
- Esc key closes; backdrop click cancels
- Focus traps: focus moves to first interactive element on open; returns to trigger on close
- Destructive actions use `fail`-toned primary button; primary action labelled verb-first ("Delete project", not "Yes")
- No native `prompt` — the dialog renders its own `<input>` with validation (non-empty, trimmed, max length)
- Return value: `Promise<ConfirmAction>` resolved via confirm/cancel buttons

### Create flow

1. User opens project switcher, clicks "+ New project".
2. `ConfirmationDialog` opens with a text input ("Project name") and a "default model" optional select (future-proof; stored but not yet wired to model routing).
3. On submit: validate name (1–60 chars, trimmed), generate `id = crypto.randomUUID()`, `createdAt = updatedAt = Date.now()`, `fileCount = 0`.
4. Write to IndexedDB `projects` store; set as active project; close switcher; reload sessions for new project (empty → auto-create one "New chat" session).
5. On failure: toast via `ApiErrorNotice` (existing pattern), leave active project unchanged.

### Delete flow (safe)

1. User clicks delete on a project.
2. `ConfirmationDialog` shows: "Delete project '<name>'? This removes <N> chat sessions and cannot be undone."
3. On confirm: remove project and all its sessions from IndexedDB; if it was active, fall back to the next project or create the default project.
4. No API call (projects are client-side in this release; document deletion is separate via `DELETE /v1/documents/:id`).

---

## 7. Chat History & Session Management

### Storage: IndexedDB-first with localStorage fallback

`web/src/storage/IndexedDBStore.ts` — a thin, typed wrapper around native `indexedDB` (no dependencies).

Stores (object stores):
- `projects` — key `id`
- `sessions` — key `id`, index `projectId`, index `updatedAt`
- `settings` — key `id` (theme, layout mode, etc.)

API surface:

```typescript
export interface IndexedDBStore {
  // Projects
  getProjects(): Promise<Project[]>
  putProject(project: Project): Promise<void>
  deleteProject(id: string): Promise<void>

  // Sessions
  getSessions(projectId: string): Promise<ChatSession[]>
  getSession(id: string): Promise<ChatSession | undefined>
  putSession(session: ChatSession): Promise<void>
  deleteSession(id: string): Promise<void>

  // Settings
  getSetting<T>(key: string): Promise<T | undefined>
  putSetting(key: string, value: unknown): Promise<void>
}
```

**Fallback adapter**: If `indexedDB` is unavailable (private mode, Safari legacy, quota error), the same interface is backed by `localStorage` keys `meridian:db:projects`, `meridian:db:sessions`, `meridian:db:settings`. JSON serialize/deserialize. No `pinned` index in fallback; grouping computed in memory.

**Why IndexedDB first**: localStorage is synchronous (~5MB cap) and blocks the main thread on every session write. Chat turns can grow large (sources, timings). IndexedDB is asynchronous, ~50GB+, and supports indexed queries by `projectId` and `updatedAt`.

### Session data model (stored)

`ChatSession` (from §4) with `turns` stored inline (append-only analytical stream). A session row is rewritten on each turn update (turns array replaced wholesale) — acceptable because sessions are small (tens of turns) and writes are debounced by the React state batch.

### Title auto-generation

When the first user query is submitted and `session.title === 'New chat'`, derive `title = query.slice(0, 40)` (with ellipsis if truncated). This matches existing `handleTurnsUpdate` behavior in `ProjectWorkspace`.

### Grouping (left rail)

Sessions sorted by `updatedAt` desc, then grouped:
- `Today` — `createdAt`/`updatedAt` on current local date
- `Yesterday` — previous local date
- `Previous 7 Days` — 2–7 days ago
- `Older` — everything else

Pinned sessions sort to the top of their group (pinned first, then by `updatedAt`).

### Search & filter

A client-side filter over session titles (case-insensitive substring). Applied to the grouped list; empty groups hidden when filtering. Debounced at 150ms on input.

---

## 8. Collapsible Left Rail UI

### Layout contract

- **Closed state**: rail hidden; project switcher accessible from header.
- **Open state**: rail slides in from left (`translate-x-0`, `duration-300 ease-out`), fixed `inset-y-0 left-0`, width 280px, `z-40`, with a backdrop (`z-30`, `bg-[rgba(15,15,12,0.40)]`, `backdrop-blur-sm`).
- Matches existing rail animation in `ProjectWorkspace.tsx` (`animate-[overlay-slide-in_180ms...]`).

### Rail sections (top to bottom)

1. **Header**: "Project & Chats" title + close button.
2. **Active project**: project name + chevron, opens the project switcher popover.
3. **Project Switcher popover** (triggered from header button or rail row):
   - Quick search input (filter projects by name).
   - Project list (active highlighted with `border-accent bg-accent-wash`).
   - "+ New project" dashed button → `ConfirmationDialog` create flow.
   - Delete per project → `ConfirmationDialog` destructive flow.
4. **"+ New Chat" primary button**: triggers `createNewSession` → smooth state reset → the input capsule glides from bottom dock back up to hero center (`42vh`). See §10 motion note.
5. **Chat Sessions List**: grouped Today/Yesterday/Previous 7 Days/Older.
   - Each row: title, active dot, updated time, message-count pill.
   - Active session: blue accent border (`border-accent`), `bg-surface-raised`, `text-accent-ink`.
   - Hover delete button (`Trash2`), `opacity-0` → `opacity-100` on `group-hover`, keyboard-focusable (`aria-label`, reachable via Tab).
   - Click row → `selectSession(id)`, close rail.
6. **Search & filter chat history**: input at top of sessions section; filters titles.

### Motion note ("glide")

The `42vh` hero-center → bottom-dock glide of the input capsule is an existing `FluidMembraneInput` concern. The left rail's "+ New Chat" button only resets state (`createNewSession`, empty turns, hero-center input position); the capsule animation itself is owned by `FluidMembraneInput` / `RagWorkspace` and is referenced here only as the boundary contract: clicking "+ New Chat" must result in an empty active session with the input centered at `42vh`.

---

## 9. Grounded Project Files Integration

### Project Files Drawer / Panel

Right-side overlay (`fixed inset-y-0 right-0 z-50 w-[420px] max-w-full`), slide-in animation, matching existing `ProjectFilesDrawer` geometry. Contains:

1. **Drag-and-drop upload zone**: accepts `.pdf, .md, .txt, .html`; drag-over highlight; `onUpload(files)` → `api.uploadDocuments(files, tenantId)`.
2. **Document list**: each row shows title, format, `chunk_count` passages, status badge.
3. **Status badges**: `Indexed` (ok), `Indexing` (warn/wait), `Indexed with warnings` (warn), `Rejected` / `Error` (fail). Chip variant mapped to `StatusChip` variant (`ok`/`warn`/`fail`/`faint`).
4. **Document metadata row**: chunk count, entity count, vector points (small muted text).
5. **Document delete**: hover/focus trash button → `ConfirmationDialog` → `api.deleteDocument(docId, tenantId)` → instant index refresh (remove from local list; re-fetch `GET /v1/documents` to reconcile server state).
6. **Refresh**: after any upload/delete, re-call `GET /v1/documents` and replace the local list (instant index refresh).

### Document status model

Mapped from `DocumentSummary` (existing `types/api.ts`) + `IndexStatusResponse` vector points. The `DocumentStatus` interface in §4 adds `chunkCount`, `entityCount`, `vectorPoints`, `status`. `vectorPoints` is read from `GET /v1/index/status` (vector.total_points) when available; otherwise omitted (null → "unavailable", never a fake 0, per existing index-status contract).

---

## 10. Component Hierarchy

```
ProjectWorkspace (shell)
├── FluidPointerCanvas (ambient background, z-0)
├── Header (fixed top, z-20)
│   ├── Brand (MERIDIAN wordmark)
│   ├── ProjectSwitcherButton (opens popover)
│   │   └── ProjectSwitcherPopover
│   │       ├── QuickSearch input
│   │       ├── ProjectListItem[] (active highlight)
│   │       ├── "+ New project" → ConfirmationDialog (create)
│   │       └── Delete per project → ConfirmationDialog (destructive)
│   ├── SessionTitle (active session title, center)
│   ├── NewChatButton ("+ New Chat" → hero-glide reset)
│   ├── ProjectFilesButton ("Files (N)", opens drawer)
│   └── SettingsButton (opens ProjectSettingsModal)
├── LeftRail (collapsible slide-over, z-40)
│   ├── RailHeader ("Project & Chats")
│   ├── ActiveProjectRow (opens switcher)
│   ├── NewChatButton (duplicate of header primary)
│   ├── ChatHistorySearch (debounced filter)
│   ├── SessionGroup[] (Today / Yesterday / Previous 7 Days / Older)
│   │   └── SessionRow[]
│   │       ├── title + active dot + time + message-count pill
│   │       └── DeleteButton (Trash2, keyboard-focusable) → ConfirmationDialog
│   └── Backdrop (click-to-close)
├── RagWorkspace (main chat)
│   ├── ChatStreamView (turns: user pill + assistant + citations)
│   └── FluidMembraneInput (hero-center ⇄ bottom dock glide)
├── ProjectFilesDrawer (right overlay)
│   ├── DragDropUploadZone (.pdf/.md/.txt)
│   ├── DocumentList[]
│   │   ├── DocumentStatusBadge (Indexed/Indexing/Rejected/Error)
│   │   └── DeleteButton → ConfirmationDialog
│   └── Refresh via GET /v1/documents
├── ProjectSettingsModal (theme, layout, default model)
├── ConfirmationDialog (shared primitive: create/rename/delete project,
│                                       delete session, delete document)
├── ProjectPickerDropdown (legacy inline, to be migrated to popover)
└── ApiErrorNotice (global error banner)
```

### New / modified components

| Component | File | Status |
|-----------|------|--------|
| `ConfirmationDialog` | `web/src/components/ConfirmationDialog.tsx` | NEW |
| `ProjectSwitcherPopover` | `web/src/components/project/ProjectSwitcherPopover.tsx` | NEW (replaces inline picker) |
| `LeftRail` | `web/src/components/project/LeftRail.tsx` | NEW (extracts rail from ProjectWorkspace) |
| `SessionRow` | `web/src/components/project/SessionRow.tsx` | NEW |
| `SessionGroup` | `web/src/components/project/SessionGroup.tsx` | NEW |
| `ChatHistorySearch` | `web/src/components/project/ChatHistorySearch.tsx` | NEW |
| `DocumentStatusBadge` | `web/src/components/project/DocumentStatusBadge.tsx` | NEW |
| `IndexedDBStore` | `web/src/storage/IndexedDBStore.ts` | NEW |
| `useProjectStore` | `web/src/hooks/useProjectStore.ts` | NEW (React + IndexedDB sync) |
| `useChatSessions` | `web/src/hooks/useChatSessions.ts` | NEW (React + IndexedDB sync) |
| `ProjectWorkspace` | `web/src/components/project/ProjectWorkspace.tsx` | MODIFIED (shell composition; remove inline storage) |
| `ProjectFilesDrawer` | `web/src/components/project/ProjectFilesDrawer.tsx` | MODIFIED (status badges, refresh, ConfirmationDialog) |
| types: `Project`, `ChatSession`, `ChatTurn`, `Tenant`, `DocumentStatus` | `web/src/types/workspace.ts` | NEW |

---

## 11. API Contract (endpoints used)

All calls carry `X-Tenant-Id: <activeProject.id>` and `X-API-Key`.

| Endpoint | Method | Use |
|----------|--------|-----|
| `GET /v1/documents` | GET | List project documents; refresh after upload/delete |
| `POST /v1/documents` | POST | Drag-and-drop upload (FormData) |
| `DELETE /v1/documents/:id` | DELETE | Document deletion |
| `GET /v1/index/status` | GET | Vector points / index health for status badges |
| `POST /v1/query/stream` | POST | Chat stream (useRagChat, existing) |
| `POST /v1/query` | POST | Query fallback (useRagChat, existing) |

Projects/sessions are client-side only in this release (no `/v1/projects` or `/v1/sessions` endpoints assumed). If the backend later exposes them, the `useProjectStore` / `useChatSessions` hooks are the single seam to change.

---

## 12. Accessibility & Keyboard Navigation

- All dialogs: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, Esc-to-close, backdrop-click cancels, focus returns to trigger on close.
- Delete buttons: `aria-label="Delete <title>"`, reachable via Tab, visible focus ring (`focus-visible:ring-2 focus-visible:ring-accent` per existing focus-indicator treatments).
- Session rows: `<button role="button">`, aria-current="page" on active session.
- Message-count pill: `aria-hidden="true"` (decorative alongside title); title announced by the row button.
- Quick search input: `aria-label="Search projects"` / `aria-label="Search chats"`.
- Drag-and-drop zone: also a standard `<input type="file">` label button (keyboard fallback).
- `prefers-reduced-motion`: slide-in reduced to opacity fade / 100ms transition (existing motion bounds).

---

## 13. Migration from localStorage

Existing keys `meridian:projects` / `meridian:sessions` hold the legacy inline shapes. On first mount of `IndexedDBStore`:

1. Attempt IndexedDB open; if `schemaVersion` missing, run migration.
2. Read `localStorage.getItem('meridian:projects')` → map to `Project[]` + `Tenant[]`.
3. Read `localStorage.getItem('meridian:sessions')` → filter per project, add `pinned: false`, `tenantId: projectId`, `lastTurnAt`.
4. Write to IndexedDB, set `schemaVersion: 1`, remove legacy localStorage keys.
5. If IndexedDB unavailable, keep using localStorage with legacy keys (graceful degradation; no pinned/grouping beyond project filter).

---

## 14. Testing & Verification

- Unit tests for `IndexedDBStore` (happy path + fallback to localStorage when IDB throws).
- Unit tests for `useProjectStore` / `useChatSessions` (create, switch, rename, delete, session grouping).
- Component tests for `ConfirmationDialog` (Esc, backdrop click, focus return, destructive tone).
- Component tests for `SessionRow` (active border, delete aria-label, keyboard focus).
- Existing test suite (`npm test -- --run`) must remain green; no existing tests modified.
- Lint: `npm run lint` (oxlint) clean.
- Build: `npm run build` (tsc -b + vite build) clean.

---

## 15. Open Questions / Risks

| Question | Recommendation |
|----------|---------------|
| Should projects be server-backed eventually? | Keep `useProjectStore` as the seam; add `/v1/projects` later without UI changes. |
| `vectorPoints` source of truth? | Read from `GET /v1/index/status` total_points; fall back to document.chunk_count. |
| Turns stored inline in session row — rewrite cost? | Sessions are small; acceptable. Revisit if turns exceed hundreds. |
| Multiple browser tabs, same tenant? | IndexedDB has no cross-tab change event (unlike localStorage `storage` event). Accept stale-until-refresh; document as known limit. |

---

## 16. Shortcut & Boundaries

`shortcut: sessions and projects are client-side only (no `/v1/projects`/`/v1/sessions` endpoints); if backend exposes them later, only `useProjectStore`/`useChatSessions` hooks change.`

This spec is the single source of truth for implementation. Components below the shell (`RagWorkspace`, `FluidMembraneInput`, `ChatStreamView`, `FluidPointerCanvas`) are intentionally untouched — every changed line traces to the project/session/tenant requirements above.
