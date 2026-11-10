# Meridian LLMOps — Settings System Architecture

**Status:** Design specification (pre-implementation)
**Owner:** Lead Systems & Full-Stack Architect
**Target file:** `docs/superpowers/plans/01-settings-architecture.md`
**Related code:** `services/rag_engine/routers/settings.py`, `services/rag_engine/routers/ops.py`, `packages/core/settings.py`, `packages/core/models.py`, `packages/core/secrets_store.py`, `web/src/services/api.ts`, `web/src/types/api.ts`, `web/src/components/SettingsModal.tsx`, `web/src/tokens/theme.ts`

---

## 1. Intent and Why

Meridian needs a single Settings surface that lets an operator (a) choose and credential an LLM provider, (b) tune retrieval and generation parameters, (c) configure guardrails, (d) maintain the storage corpus, and (e) pick a display theme. The surface must exist both as a focused modal (inline, workflow-adjacent) and as a full-page view (dedicated route).

Today the platform has a partial backend (`/v1/settings/llm`, `/v1/settings/providers`, `/v1/settings/llm/test`, `/v1/settings/llm/test-and-fetch-models`) and a single-tab `SettingsModal` that only covers Provider & Models. There is no RAG/retrieval settings tab, no Guardrails tab, no Storage tab, no Appearance tab, no tenant-scoped secret isolation, no `/v1/settings/test-connection` alias contract, no slider controls, no theme swatch grid, and no full-page presentation.

This spec defines the complete Settings system end-to-end: REST schemas, TypeScript types, component interfaces, provider abstraction, secret handling, guardrails, storage maintenance, and accessibility.

---

## 2. Goals and Non-Goals

### Goals

| # | Goal |
|---|------|
| G1 | One Settings surface, two presentations: focused modal and full page, sharing all tabs and components. |
| G2 | Six tabs: General & Workspace, Provider & Models, RAG & Retrieval Engine, Guardrails & Safety, Storage & Corpus Management, Appearance & Themes. |
| G3 | Provider abstraction: OpenAI-compatible, Custom endpoints, Anthropic, Ollama, LiteLLM — each with key + base URL + model. |
| G4 | Secret key handling: never in localStorage, masked server-side (`{configured, hint}`), credential isolated per tenant, test ping endpoint. |
| G5 | Dynamic parameters: temperature, top-k, top-p, reranking toggle, BM25 vs Dense fusion weights. |
| G6 | Guardrails & Safety: PII redaction, hallucination threshold, refusal behavior toggles. |
| G7 | Storage maintenance: clear vector collections, clear disk chunks, database reset — each with typed confirmation safeguard. |
| G8 | Accessibility: keyboard trap, Escape dismiss, ARIA dialog + tabs semantics, visible focus. |
| G9 | Four themes: Raw Paper (default), Ceramic Concrete, Cold Titanium, Analog Soot, plus display scale. |
| G10 | Double-bezel cards, password inputs with visibility toggle, sliders with tabular numeric readouts, theme swatch preview grids. |

### Non-Goals

| # | Non-goal | Reason |
|---|----------|--------|
| NG1 | End-user (non-admin) settings pages. | Settings are admin-only (`require_admin`). |
| NG2 | Persisting API keys in the browser. | Violates G4; keys live in memory only for the session. |
| NG3 | Multi-tenant provider routing per end-user. | Tenant isolation is at the secret-storage/auth layer, not per-request provider switching. |
| NG4 | Real-time sync of settings across open tabs. | Settings changes apply on save; other tabs refresh on next load. |
| NG5 | Encryption-at-rest for secrets. | Deferred per existing decision (filesystem mode 0600 only). |

---

## 3. Current State Audit

### Backend (existing)

| Endpoint | Method | Auth | State |
|----------|--------|------|-------|
| `/v1/settings/llm` | GET | `require_admin` | Returns masked view; keys never exposed. |
| `/v1/settings/llm` | POST | `require_admin` | `UpdateLLMSettingsRequest` (extra="forbid"); merges preserving saved; returns `masked_llm_view`. |
| `/v1/settings/providers` | GET | `require_admin` | Static provider registry + configured flags. |
| `/v1/settings/llm/test` | POST | `require_admin` | One-token generation ping against active provider. |
| `/v1/settings/llm/test-and-fetch-models` | POST | `require_admin` | Tests key + lists models per provider. |
| `/health/ready` | GET | none | Readiness: Qdrant + index consistency + embedder. |
| `/v1/metrics` | GET | `require_admin` | Tenant token/cost metrics. |
| `/v1/index/status` | GET | `require_admin` | Live vector/graph/lexical/relational status. |
| `/v1/reindex` | POST | `require_admin` | Rebuild vector index from disk. |

### Gaps vs. this spec

- No `/v1/settings/test-connection` alias (only `/v1/settings/llm/test`).
- No temperature / top-p / top-k / rerank / fusion-weight settings in the request schema.
- No guardrail toggle endpoints (PII redaction, hallucination threshold, refusal behavior).
- No storage-maintenance endpoints (clear vector, clear disk chunks, DB reset with confirmation).
- No tenant-scoped secret isolation beyond the existing `X-Tenant-Id` header.
- Frontend: SettingsModal is one tab (Provider & Models) only; no full-page settings route; no theme swatch grid; no sliders with numeric readouts; no double-bezel cards.

### Frontend (existing)

- `web/src/components/SettingsModal.tsx` — 892 lines, modal + page presentation, provider select, password inputs (no visibility toggle), connection checks, advanced pipeline settings (timeout, max_cycles, enforce_guardrails), save/apply.
- `web/src/types/api.ts` — `LLMSettingsGet`, `MaskedLLMSettings`, `UpdateLLMSettingsPayload`, `ProvidersResponse`, `LLMPingResponse`, `MaskedKeyStatus`.
- `web/src/services/api.ts` — `MeridianApiClient` with `getLLMSettings`, `updateLLMSettings`, `testLLMConnection`, `testAndFetchModels`, `getProviders`, `getMetrics`, `getIndexStatus`, `checkHealth`.
- `web/src/tokens/theme.ts` — `ThemeName` = `default` | `ceramic-concrete` | `cold-titanium` | `analog-soot`; `ThemeTokens` interface; `PRESETS`.

---

## 4. Backend Architecture

### 4.1 Route inventory

All settings routes require admin (`require_admin`) and tenant context (`X-Tenant-Id`). Secrets are never returned in plaintext.

| Path | Method | Auth | Summary |
|------|--------|------|---------|
| `/v1/settings` | GET | admin | Aggregate settings overview (masked). |
| `/v1/settings/general` | GET | admin | General & Workspace settings (workspace name, tenant id, display scale, default language). |
| `/v1/settings/general` | PATCH | admin | Partial update of general settings. |
| `/v1/settings/llm` | GET | admin | Provider & Models: active provider, model, masked keys, configured flags. |
| `/v1/settings/llm` | PATCH | admin | Partial update of provider/model/key settings (merge-preserving). |
| `/v1/settings/llm/test-connection` | POST | admin | Ping active provider with saved credentials (alias for `/v1/settings/llm/test`). |
| `/v1/settings/llm/test-and-fetch-models` | POST | admin | Test key + list models for a candidate provider. |
| `/v1/settings/providers` | GET | admin | Provider registry status (configured, active, base_url, current_model, type). |
| `/v1/settings/rag` | GET | admin | RAG & Retrieval: top-k, top-p, temperature, rerank toggle, BM25/Dense weights, embedding model, reranker. |
| `/v1/settings/rag` | PATCH | admin | Partial update of retrieval settings. |
| `/v1/settings/guardrails` | GET | admin | Guardrails & Safety: input/output enabled, PII redaction, hallucination threshold, refusal behavior. |
| `/v1/settings/guardrails` | PATCH | admin | Partial update of guardrail settings. |
| `/v1/settings/storage/maintenance` | POST | admin | Storage maintenance actions (clear vector / clear disk chunks / DB reset) with confirmation token. |
| `/v1/settings/storage/maintenance/confirm` | POST | admin | Execute a pending maintenance action after confirmation challenge. |
| `/v1/settings/appearance` | GET | admin | Appearance: theme, display scale. |
| `/v1/settings/appearance` | PATCH | admin | Partial update of appearance. |
| `/v1/metrics` | GET | admin | Tenant metrics (unchanged). |
| `/health/ready` | GET | none | Readiness probe (unchanged). |
| `/v1/index/status` | GET | admin | Index status (unchanged). |

### 4.2 Provider abstraction

Provider model (shared by GET `/v1/settings/llm`, GET `/v1/settings/providers`, PATCH):

```python
class ProviderSettings(BaseModel):
    id: Literal["openai", "anthropic", "groq", "openrouter", "deepseek", "ollama", "custom", "litellm", "openai_compatible"]
    name: str
    type: Literal["cloud", "local", "custom"]  # cloud = hosted API; local = self-hosted (ollama); custom = user endpoint
    configured: bool            # masked boolean; no key material
    is_active: bool
    base_url: str | None        # resolved endpoint for this provider
    current_model: str | None
    models: list[str]           # fetched or static fallback
    supports_api_key: bool      # ollama = False
    supports_base_url: bool     # all except ollama base is fixed localhost:11434/v1
```

Provider capability matrix:

| Provider | Type | Auth | Base URL | Models source |
|----------|------|------|----------|---------------|
| openai | cloud | Bearer key | `https://api.openai.com/v1` | `/v1/models` |
| anthropic | cloud | `x-api-key` | `https://api.anthropic.com` | `/v1/models` (or static fallback) |
| groq | cloud | Bearer key | `https://api.groq.com/openai/v1` | `/v1/models` |
| openrouter | cloud | Bearer key | `https://openrouter.ai/api/v1` | `/v1/models` |
| deepseek | cloud | Bearer key | `https://api.deepseek.com/v1` | `/v1/models` |
| ollama | local | none | `http://localhost:11434` | `/api/tags` |
| custom | custom | optional Bearer | user-supplied | `/v1/models` |
| litellm | cloud | master key | `http://localhost:4000` | `/v1/models` |
| openai_compatible | custom | optional Bearer | user-supplied | `/v1/models` |

### 4.3 Secret key handling

**Rule S1 (no keys in localStorage):** The frontend never writes any API key to `localStorage`, `sessionStorage`, or IndexedDB. Keys exist only in React component state for the current browser session and are sent over HTTPS in POST/PATCH bodies. On refresh, password inputs are empty; the server's masked view shows only `{configured, hint}`.

**Rule S2 (masked responses):** All GET settings endpoints return keys as `MaskedKeyStatus = { configured: boolean; hint?: string }` where `hint` is the last 4 characters, or `"****"` if <= 4 chars, or absent when not configured. Plaintext key material never leaves the backend.

**Rule S3 (tenant isolation):** Secrets are stored per tenant in `storage/<tenant>/secrets.json` (mode 0600, atomic write via tempfile + `os.replace`). The `X-Tenant-Id` header scopes every settings read/write. Cross-tenant reads are rejected (403).

**Rule S4 (blank preserves saved):** PATCH/PUT with blank or omitted string fields never clobber a saved value. Masked values (`"..."`, `"***"`) are skipped on merge.

**Rule S5 (test-connection contract):** `POST /v1/settings/test-connection` runs a one-token generation against the active provider using saved credentials and returns `{ status, message, latency_ms }`. It never persists and never returns key material. Alias: `POST /v1/settings/llm/test` remains for backward compat.

**Rule S6 (SSRF pinning):** Outbound provider URLs are validated/pinned via `PinnedAsyncHTTPTransport` + `validate_provider_url`; private URLs require `ALLOW_PRIVATE_PROVIDER_URLS=true`. Applies to test-connection and test-and-fetch-models.

### 4.4 REST schemas (concrete)

#### 4.4.1 Common types

```python
class MaskedKeyStatus(BaseModel):
    configured: bool
    hint: str | None = None  # last-4 or "****"

class ProviderStatus(BaseModel):
    id: str
    name: str
    type: Literal["cloud", "local", "custom"]
    configured: bool
    is_active: bool
    base_url: str | None
    current_model: str | None
    models: list[str] = Field(default_factory=list)
```

#### 4.4.2 GET /v1/settings (aggregate)

Response:
```json
{
  "workspace": {"name": "string", "tenant_id": "string"},
  "appearance": {"theme": "raw-paper | ceramic-concrete | cold-titanium | analog-soot", "display_scale": 1.0},
  "llm": { "active_provider": "string", "default_model": "string", "providers_configured": { "provider_id": true } },
  "rag": { "top_k": 5, "temperature": 0.7, "top_p": 1.0, "rerank": false, "bm25_weight": 0.5, "dense_weight": 0.5 },
  "guardrails": { "input_enabled": true, "output_enabled": true, "pii_redaction": true, "hallucination_threshold": 0.85, "refusal_behavior": "refuse" },
  "storage": { "vector_collections": 1, "disk_chunks": 1234, "db_tables": 4 },
  "providers": [ ProviderStatus, ... ]
}
```

#### 4.4.3 PATCH /v1/settings/llm (provider & models)

Request (subset of `UpdateLLMSettingsRequest`, all optional):
```json
{
  "active_provider": "openai | anthropic | groq | openrouter | deepseek | ollama | custom | litellm",
  "openai_api_key": "string|null",
  "anthropic_api_key": "string|null",
  "groq_api_key": "string|null",
  "openrouter_api_key": "string|null",
  "deepseek_api_key": "string|null",
  "custom_api_key": "string|null",
  "openai_base_url": "string|null",
  "anthropic_base_url": "string|null",
  "groq_base_url": "string|null",
  "openrouter_base_url": "string|null",
  "deepseek_base_url": "string|null",
  "ollama_base_url": "string|null",
  "custom_base_url": "string|null",
  "openai_org_id": "string|null",
  "default_model": "string|null",
  "timeout_seconds": "int|null (1-300)",
  "max_cycles": "int|null (1-10)",
  "enforce_guardrails": "bool|null"
}
```
Response: `MaskedLLMSettings` (masked keys).

#### 4.4.4 POST /v1/settings/test-connection

Request: `{}` (uses active saved provider). Response:
```json
{ "status": "success|error", "message": "string", "latency_ms": number }
```

#### 4.4.5 PATCH /v1/settings/rag (retrieval)

Request:
```json
{
  "top_k": "int|null (1-20)",
  "temperature": "float|null (0.0-2.0)",
  "top_p": "float|null (0.0-1.0)",
  "rerank": "bool|null",
  "reranker_model": "string|null",
  "bm25_weight": "float|null (0.0-1.0)",
  "dense_weight": "float|null (0.0-1.0)",
  "embedding_model": "string|null",
  "min_dense_score": "float|null (0.0-1.0)"
}
```
Validation: `bm25_weight + dense_weight == 1.0` when both present (422 otherwise). Response: masked full RAG settings.

#### 4.4.6 PATCH /v1/settings/guardrails

Request:
```json
{
  "enable_input_guardrails": "bool|null",
  "enable_output_guardrails": "bool|null",
  "pii_redaction": "bool|null",
  "hallucination_threshold": "float|null (0.0-1.0)",
  "refusal_behavior": "refuse | redact | allow|null"
}
```

#### 4.4.7 POST /v1/settings/storage/maintenance

Request:
```json
{
  "action": "clear_vector | clear_disk_chunks | database_reset",
  "confirmation_token": "string",  # must match server-issued challenge
  "tenant_id": "string"
}
```
Response: `{ "action": "string", "status": "accepted|rejected", "message": "string", "expires_at": "ISO timestamp|null" }`.

The server issues a short-lived confirmation token (GET `/v1/settings/storage/maintenance/challenge`) bound to the action and tenant; the client must present it. Receipt of a valid token executes and immediately invalidates it (single-use).

#### 4.4.8 PATCH /v1/settings/appearance

Request:
```json
{
  "theme": "raw-paper | ceramic-concrete | cold-titanium | analog-soot",
  "display_scale": "float|null (0.8-1.5, step 0.1)"
}
```

### 4.5 Storage maintenance safeguards

| Safeguard | Detail |
|-----------|--------|
| Challenge token | Client must GET `/v1/settings/storage/maintenance/challenge?action=<action>` to receive a single-use token bound to tenant + action + expiry (5 min). |
| Single-use | Token invalidated immediately after successful execution. |
| Destructive warning | Each action returns a human-readable "what will be deleted" summary before execution. |
| Audit log | Every maintenance action is logged (action, tenant, actor, timestamp, result) to the review queue / audit trail. |
| DB reset requires reindex | After `database_reset`, `/health/ready` returns `ready: false` until reindex runs. |

---

## 5. Frontend Architecture

### 5.1 Component tree

```
SettingsShell (presentation: 'modal' | 'page')
├── SettingsHeader (title, description, close button [modal only])
├── SettingsTabNav (6 tabs, ARIA tablist, keyboard: ArrowLeft/Right/Home/End)
│   ├── tab: General & Workspace
│   ├── tab: Provider & Models
│   ├── tab: RAG & Retrieval Engine
│   ├── tab: Guardrails & Safety
│   ├── tab: Storage & Corpus Management
│   └── tab: Appearance & Themes
├── TabPanel (aria-labelledby = tab id, role="tabpanel")
│   └── (per-tab content below)
├── SettingsFooter (Cancel, Save & Apply [modal only])
└── Toast / alert banners (save success/error, connection results)
```

Per-tab panels:

**General & Workspace:**
- Workspace name (text input)
- Tenant ID (read-only display, copy button)
- Default language (select)
- Session timeout (number, minutes)

**Provider & Models:**
- Provider select (segmented control or dropdown)
- Per-provider credential card: password input w/ visibility toggle + base URL input + configured badge (`Configured •••ab12` / `Not configured`)
- Organization / Project IDs (OpenAI)
- Model select (datalist + free-text)
- Connection checks: "Test saved provider" (GET test-connection) and "Validate endpoint & load models" (test-and-fetch-models)
- Advanced (collapsible): timeout seconds (slider + numeric readout), max cycles, enforce guardrails checkbox

**RAG & Retrieval Engine:**
- Retrieval mode toggle: Dense / BM25 / Hybrid
- BM25 vs Dense fusion weight sliders (two sliders, sum = 1.0, tabular numeric readouts)
- Top-k (slider + numeric), Temperature (slider + numeric), Top-p (slider + numeric)
- Reranking toggle + reranker model select
- Min dense score slider
- Embedding model display (read-only, requires reindex to change)

**Guardrails & Safety:**
- Input guardrails toggle, Output guardrails toggle
- PII redaction toggle
- Hallucination threshold slider (0.0–1.0, numeric readout)
- Refusal behavior select: Refuse / Redact / Allow

**Storage & Corpus Management:**
- Storage status cards: vector collections count, disk chunks count, DB tables/rows
- Danger zone: Clear vector collection, Clear disk chunks, Database reset — each a double-bezel card with confirmation dialog (typed "DELETE" challenge + single-use token)
- Reindex button

**Appearance & Themes:**
- Theme swatch preview grid: Raw Paper, Ceramic Concrete, Cold Titanium, Analog Soot (each a clickable card with live color preview)
- Display scale slider (0.8–1.5, step 0.1, numeric readout + preview text "Aa")
- Apply preview (instant CSS variable update)

### 5.2 TypeScript types (`web/src/types/api.ts` additions)

```ts
export type ThemeName = 'raw-paper' | 'ceramic-concrete' | 'cold-titanium' | 'analog-soot';

export interface GeneralSettings {
  workspace_name: string;
  tenant_id: string;
  default_language: string;
  session_timeout_minutes: number;
}

export interface LLMProviderSettings {
  active_provider: string;
  default_model: string;
  openai_api_key?: MaskedKeyStatus;
  anthropic_api_key?: MaskedKeyStatus;
  groq_api_key?: MaskedKeyStatus;
  openrouter_api_key?: MaskedKeyStatus;
  deepseek_api_key?: MaskedKeyStatus;
  custom_api_key?: MaskedKeyStatus;
  providers_configured: Record<string, boolean>;
}

export interface RAGSettings {
  top_k: number;
  temperature: number;
  top_p: number;
  rerank: boolean;
  reranker_model: string | null;
  bm25_weight: number;
  dense_weight: number;
  embedding_model: string | null;
  min_dense_score: number;
}

export interface GuardrailSettings {
  enable_input_guardrails: boolean;
  enable_output_guardrails: boolean;
  pii_redaction: boolean;
  hallucination_threshold: number;
  refusal_behavior: 'refuse' | 'redact' | 'allow';
}

export interface AppearanceSettings {
  theme: ThemeName;
  display_scale: number;
}

export interface StorageStatus {
  vector_collections: number;
  disk_chunks: number;
  db_tables: Array<{ name: string; row_count: number }>;
}

export interface MaintenanceChallenge {
  action: 'clear_vector' | 'clear_disk_chunks' | 'database_reset';
  token: string;
  expires_at: string;
  message: string;
}

export interface MaintenanceResult {
  action: string;
  status: 'accepted' | 'rejected';
  message: string;
}

export interface SettingsAggregate {
  workspace: GeneralSettings;
  appearance: AppearanceSettings;
  llm: LLMProviderSettings;
  rag: RAGSettings;
  guardrails: GuardrailSettings;
  storage: StorageStatus;
  providers: ProviderInfo[];
}
```

### 5.3 API client additions (`web/src/services/api.ts`)

```ts
async getGeneralSettings(): Promise<GeneralSettings>
async patchGeneralSettings(patch: Partial<GeneralSettings>): Promise<GeneralSettings>
async getRAGSettings(): Promise<RAGSettings>
async patchRAGSettings(patch: Partial<RAGSettings>): Promise<RAGSettings>
async getGuardrailSettings(): Promise<GuardrailSettings>
async patchGuardrailSettings(patch: Partial<GuardrailSettings>): Promise<GuardrailSettings>
async getAppearanceSettings(): Promise<AppearanceSettings>
async patchAppearanceSettings(patch: Partial<AppearanceSettings>): Promise<AppearanceSettings>
async getStorageStatus(): Promise<StorageStatus>
async postMaintenanceChallenge(action: string): Promise<MaintenanceChallenge>
async postMaintenanceExecute(action: string, token: string): Promise<MaintenanceResult>
async testConnection(): Promise<LLMPingResponse>  // alias for testLLMConnection
```

All reuse `getHeaders(tenantId)` with `X-Tenant-Id`. All admin-only.

### 5.4 High-craft UI components

| Component | Props (key) | Behavior |
|-----------|-------------|----------|
| `DoubleBezelCard` | `children`, `variant?: 'default' | 'danger'` | Outer border + inner raised surface; subtle drop shadow; `danger` variant uses fail-wash border on hover. |
| `PasswordInput` | `value`, `onChange`, `label`, `status?: MaskedKeyStatus` | Visibility toggle (eye/eye-off), `type="password"` ↔ `text`, id-mono font, placeholder "Leave blank to keep existing", never prefilled from server. |
| `SliderReadout` | `value`, `min`, `max`, `step`, `label`, `unit` | Slider + right-aligned monospaced numeric readout; synced two-way; `aria-valuenow/valuemin/valuemax`. |
| `FusionWeightSliders` | `bm25`, `dense`, `onChange` | Two sliders constrained to sum 1.0; dragging one adjusts the other; tabular readout row showing both values. |
| `ThemeSwatchGrid` | `themes`, `selected`, `onSelect` | 4 swatch cards each showing surface/raised/sunken/border/accent preview; selected has `borderStrong` ring; click applies theme. |
| `ConfiguredBadge` | `status: MaskedKeyStatus` | `Configured •••ab12` / `Not configured`; mono hint; color-coded. |
| `ConfirmationDialog` | `open`, `action`, `onConfirm`, `onCancel` | Typed challenge ("type DELETE to confirm"), single-use token flow, danger-styled confirm button. |

### 5.5 Accessibility contract

| Requirement | Implementation |
|-------------|---------------|
| Keyboard trap (modal) | Focus cycles within tabbables; ArrowLeft/Right navigate tabs; Home/End jump to first/last tab; Escape dismisses. |
| Escape dismiss | Global `keydown` listener on open; calls `onClose`. |
| ARIA dialog | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the title; `tabIndex="-1"` on the dialog container; focus moved into dialog on open, restored on close. |
| ARIA tabs | `role="tablist"` on nav, `role="tab"` on each tab (`aria-selected`, `aria-controls`), `role="tabpanel"` on each panel (`aria-labelledby`). |
| Visible focus | `focus-visible:ring-2 focus-visible:ring-accent` on all interactive elements. |
| Slider semantics | `role="slider"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-orientation="horizontal"`. |
| Live regions | Save banners `role="alert"` `aria-live="polite`; connection results `role="status"` `aria-live="polite"`. |
| No keys in DOM | Password input values never persisted; server never returns plaintext keys. |

### 5.6 Presentation duality

`SettingsShell` accepts `presentation: 'modal' | 'page'`.

- **Modal:** portal to `document.body`, overlay scrim, `role="dialog"`, close button, Cancel + Save & Apply footer, `document.body.style.overflow = 'hidden'` while open.
- **Page:** inline in the route, no scrim, `role` absent (page is its own context), no footer (Cancel/Save handled per-tab inline or via a global save bar), full width.

All tabs, components, validation, and API calls are identical between presentations; only the shell wrapper differs.

---

## 6. Security Rules

| ID | Rule | Enforcement |
|----|------|-------------|
| SEC-1 | No API keys in `localStorage`/`sessionStorage`/IndexedDB. | Frontend code review; keys only in component state. |
| SEC-2 | Keys never returned plaintext; masked `{configured, hint}` only. | Backend `masked_llm_view` on all GET settings routes. |
| SEC-3 | Tenant isolation via `X-Tenant-Id`; cross-tenant reads rejected 403. | Middleware / dependency on every settings route. |
| SEC-4 | Secrets stored per-tenant in mode 0600 files, atomic write. | `secrets_store.save_secrets` (tempfile + fsync + replace + chmod 0600). |
| SEC-5 | Blank/omitted PATCH fields preserve saved values. | `_merge_preserving_saved` on backend. |
| SEC-6 | SSRF pinning on outbound provider URLs; private URLs opt-in. | `PinnedAsyncHTTPTransport` + `validate_provider_url`. |
| SEC-7 | Maintenance actions require single-use challenge token, bound to tenant + action + 5-min expiry. | `/v1/settings/storage/maintenance/challenge` + `/confirm`. |
| SEC-8 | All settings mutations require admin (`require_admin`). | FastAPI dependency on every settings route. |
| SEC-9 | Test-connection never persists credentials. | Stateless ping; no write to settings store. |
| SEC-10 | `extra="forbid"` on settings request bodies; unknown fields rejected 422. | Pydantic `model_config = {"extra": "forbid"}`. |

---

## 7. Data Flow

### 7.1 Open Settings (modal/page)
1. Shell mounts; `useEffect` on `isOpen` loads all settings in parallel: `getGeneralSettings`, `getLLMSettings`, `getProviders`, `getRAGSettings`, `getGuardrailSettings`, `getAppearanceSettings`, `getStorageStatus`.
2. Password inputs start empty; configured badges populated from `providers_configured` + masked hints.
3. Tab nav defaults to "Provider & Models" (or last-visited tab, held in component state only, not persisted).

### 7.2 Save provider credentials
1. User edits password input (state only), clicks "Save & Apply".
2. `updateLLMSettings` POST /v1/settings/llm with only non-blank fields.
3. Backend merge-preserving, saves to `.meridian_settings.json` (prefs, mode 0600) + `secrets.json` (keys, mode 0600), rebuilds `LiteLLMClient` + agent graph.
4. Returns `MaskedLLMSettings`; frontend updates badges; shows save-success banner; closes (modal) or stays (page).

### 7.3 Test saved connection
1. `testConnection()` POST /v1/settings/test-connection (no body).
2. Backend resolves active provider + saved credentials, one-token generation, returns `{status, message, latency_ms}`.
3. Frontend shows success/fail chip; never touches password inputs.

### 7.4 Storage maintenance (destructive)
1. User clicks "Clear vector collection" in Storage tab.
2. ConfirmationDialog opens; user types `DELETE`.
3. Frontend POST `/v1/settings/storage/maintenance/challenge?action=clear_vector` → receives single-use token + expiry.
4. Frontend POST `/v1/settings/storage/maintenance/confirm` with `{action, token}`.
5. Backend validates token (tenant-bound, unexpired, single-use), executes, invalidates token, returns result.
6. Frontend refreshes storage status; audit log entry written.

---

## 8. Theme system (extend existing)

`web/src/tokens/theme.ts` already defines `ThemeName` = `default` | `ceramic-concrete` | `cold-titanium` | `analog-soot`. Map to spec names:

| Spec name | ThemeName value |
|-----------|-----------------|
| Raw Paper | `default` |
| Ceramic Concrete | `ceramic-concrete` |
| Cold Titanium | `cold-titanium` |
| Analog Soot | `analog-soot` |

Add `display_scale` to appearance settings (CSS `--display-scale` applied via `transform: scale()` on root or per-component rem multipliers). Theme swatch grid renders each preset's token palette as a live preview card.

---

## 9. Integration with existing code

- Reuse `services/rag_engine/routers/settings.py` (add new routes alongside existing).
- Reuse `packages/core/secrets_store.py` for per-tenant secret files.
- Reuse `web/src/services/api.ts` `MeridianApiClient` pattern (same `requestJSON`, `ApiError`, `normalizeDetail`).
- Reuse `web/src/components/SettingsModal.tsx` keyboard-trap logic (extract into `useSettingsKeyboardTrap` hook shared by modal and page).
- Reuse `web/src/tokens/theme.ts` presets; add `raw-paper` alias to `default`.
- Backend `UpdateLLMSettingsRequest` stays `extra="forbid"`; new RAG/guardrails/storage/appearance get their own models with `extra="forbid"`.
- Auth dependency `require_admin` already exists in `services/rag_engine/deps.py`.

---

## 10. Testing strategy

| Layer | Target |
|-------|--------|
| Unit | `masked_llm_view`, `_merge_preserving_saved`, fusion-weight sum validation, challenge-token generation/validation. |
| API contract | Every settings route returns correct schema; 422 on unknown fields; 403 on cross-tenant; masked keys never plaintext. |
| Security | No key material in GET responses; private URL rejected without `ALLOW_PRIVATE_PROVIDER_URLS`; maintenance token single-use. |
| Frontend | `PasswordInput` visibility toggle; `SliderReadout` sync; `FusionWeightSliders` sum = 1.0; keyboard trap (Escape, Tab cycle); ARIA attributes present; theme swatch applies CSS variables. |
| E2E | Open settings → change provider + key → save → verify badge shows `Configured •••ab12` → open again, inputs empty (not persisted) → test connection → maintenance clear with typed `DELETE` challenge. |

---

## 11. Acceptance criteria (definition of done)

1. Settings accessible as modal (inline trigger) and full page (route `/settings`).
2. Six tabs render with ARIA tablist/tabs/tabpanels; keyboard navigation works (Arrow keys, Home/End, Escape).
3. Provider & Models tab: select provider, enter key (visibility toggle works), base URL, model; save persists masked-only; badge shows configured state.
4. `POST /v1/settings/test-connection` returns success/fail/latency without persisting.
5. RAG tab: temperature/top-k/top-p sliders with numeric readouts; BM25+Dense weights sum to 1.0; rerank toggle.
6. Guardrails tab: input/output toggles, PII redaction, hallucination threshold slider, refusal behavior select.
7. Storage tab: status cards; clear-vector/clear-disk-chunks/database-reset each require typed `DELETE` challenge + single-use token; audit logged.
8. Appearance tab: 4 theme swatches (Raw Paper, Ceramic Concrete, Cold Titanium, Analog Soot) apply live; display scale slider updates preview.
9. No API key appears in localStorage, GET responses, or network plaintext.
10. All settings mutations require admin + tenant header; cross-tenant rejected 403.
11. Existing `/v1/settings/llm`, `/v1/settings/providers`, `/v1/settings/llm/test`, `/v1/metrics`, `/health/ready` remain functional (backward compat).

---

## 12. Open questions (to resolve before implementation)

1. Should the full-page Settings live at route `/settings` under `ProjectWorkspace`, or as a standalone route? (Affects shell integration.)
2. Is `display_scale` applied via CSS `transform: scale()` on `#root` or via rem-multiplier tokens? (Affects theme.ts and component styling.)
3. Should maintenance challenge tokens be server-side stored (Redis/DB) or JWT-signed stateless tokens? (Current stack uses filesystem + SQLite; JWT stateless is simplest.)
4. Are RAG parameter changes applied immediately (rebuild retriever) or on next query? (Affects whether PATCH /v1/settings/rag triggers a reindex-like rebuild.)

---

*End of specification.*