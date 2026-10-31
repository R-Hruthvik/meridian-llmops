# Web UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix trust-breaking web UX bugs then restructure into Ask/Ingest/Operate with honest health-driven states.

**Architecture:** Keep existing `api.ts` client, add shared `AsyncState` + typed `ApiError` handling first, then migrate studios to journey IA with guardrails folded into Ask and Operate bound to `/health`.

**Tech Stack:** React 19, Vite 8, vitest, TS (`tsc -b`, `verbatimModuleSyntax`).

**Spec:** `2026-09-28_PLAN_WEB_UX.md`

## Global Constraints

- Schema-bound forms: POST only backend-accepted field names, per-field 422, masked secrets never rendered raw.
- Health-driven cards: ops cards map 1:1 to `GET /health` services, never hardcoded green.
- No fabricated badges: grey `serving_model` badge with fallback text when `serving.fresh=false`/refusal/degraded.

---

## File Structure

- Journey IA: `web/src/App.tsx` tabs ask/ingest/operate; `RagWorkspace.tsx` (Ask + guardrail collapsible), `IngestionStudio.tsx` (upload+catalog+inspector), `MetricsDashboard.tsx` + `SettingsModal.tsx` (Operate).
- Shared data/states: `web/src/services/api.ts` (`MeridianApiClient`, `ApiError`), `web/src/hooks/useApiQuery.ts`, `web/src/components/AsyncState.tsx`, `web/src/components/GuardrailVerdict.tsx`.
- Settings binding: `web/src/types/api.ts` (`LLMSettings`, masked shape), `web/src/components/settings/ProviderForm.tsx`, `KeyFields.tsx`, `ModelTestButton.tsx`, `settingsSchema.ts` (zod, settings-only).

## Phase 0 — Safety (independently testable; verify: `npm --prefix web run build`)

### Task 1: Settings masked round-trip + per-field 422

**Files:**
- Modify: `web/src/types/api.ts:75-89`, `web/src/services/api.ts:135-156`, `web/src/components/SettingsModal.tsx:207-248`
- Test: `web/src/components/SettingsModal.test.tsx`

**Interfaces:**
- Consumes: `api.getLLMSettings(): Promise<LLMSettings>`, `api.updateLLMSettings(p: Partial<LLMSettings>)`
- Produces: `LLMSettingsMasked { active_provider: string; openai_key_configured: boolean; openai_key_masked?: string; default_model: string; litellm_base_url: string }`, `fieldErrors: Record<string,string>`

- [ ] **Step 1: Write the failing test**
```tsx
it('shows per-field 422 and masks secrets', async () => {
  vi.spyOn(api,'updateLLMSettings').mockRejectedValue({status:422, fields:{openai_api_key:'invalid'}});
  render(<SettingsModal isOpen onClose={()=>{}} platformApiKey="" onSavePlatformApiKey={()=>{}} />);
  fireEvent.click(screen.getByRole('button',{name:/save/i}));
  expect(await screen.findByText('invalid')).toBeInTheDocument();
  expect(screen.queryByText(/sk-/)).toBeNull();
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npm --prefix web run test:run -- SettingsModal`
Expected: FAIL with "Unable to find" / `updateLLMSettings` not rejecting with fields.
- [ ] **Step 3: Minimal implementation**
```ts
// types/api.ts: add masked shape; api.ts requestJSON: attach (e as ApiError).fields = errorData.fields ?? errorData.errors
// SettingsModal handleSave catch: if (err instanceof ApiError && err.status===422) setFieldErrors(err.fields ?? {})
// Render inputs from GET masked shape; value={key_configured ? '••••'+masked.slice(-4) : ''}; Clear-key button sends {openai_api_key: null}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npm --prefix web run test:run -- SettingsModal`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add web/src/types/api.ts web/src/services/api.ts web/src/components/SettingsModal.tsx web/src/components/SettingsModal.test.tsx
git commit -m "fix(web): settings masked round-trip with per-field 422"
```

### Task 2: Shared AsyncState (loading/error/empty)

**Files:**
- Create: `web/src/components/AsyncState.tsx`
- Modify: `web/src/components/IngestionStudio.tsx:56-71`, `web/src/components/MetricsDashboard.tsx:64-82`
- Test: `web/src/components/AsyncState.test.tsx`

**Interfaces:**
- Consumes: `ApiError { status: number; detail?: string }`
- Produces: `<AsyncState state:{status:'loading'|'error'|'empty'|'ready'} error?:ApiError onRetry:()=>void emptyCTA?:{label:string;onClick:()=>void} role="alert">`

- [ ] **Step 1: Write the failing test**
```tsx
it('renders retryable alert on error + CTA on empty', () => {
  const r = render(<AsyncState state="error" error={new ApiError('boom',502,'bad gateway')} onRetry={()=>{}} />);
  expect(r.getByRole('alert')).toHaveTextContent(/502/);
  r.rerender(<AsyncState state="empty" onRetry={()=>{}} emptyCTA={{label:'Ingest a doc',onClick:()=>{}}} />);
  expect(r.getByRole('button',{name:'Ingest a doc'})).toBeInTheDocument();
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npm --prefix web run test:run -- AsyncState`
Expected: FAIL with "AsyncState not defined".
- [ ] **Step 3: Minimal implementation**
```tsx
export function AsyncState({state,error,onRetry,emptyCTA,children}) {
  if (state==='loading') return <div aria-busy="true" className="animate-pulse">Loading…</div>;
  if (state==='error') return <div role="alert">HTTP {error?.status} — {error?.detail}<button onClick={onRetry}>Retry</button></div>;
  if (state==='empty') return <div><p>No results yet.</p>{emptyCTA && <button onClick={emptyCTA.onClick}>{emptyCTA.label}</button>}</div>;
  return <>{children}</>;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npm --prefix web run test:run -- AsyncState`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add web/src/components/AsyncState.tsx web/src/components/AsyncState.test.tsx web/src/components/IngestionStudio.tsx web/src/components/MetricsDashboard.tsx
git commit -m "feat(web): shared AsyncState with retry and empty CTA"
```

## Phase 1 — Contracts (verify: `npm --prefix web run test:run -- ApiError`)

### Task 3: Typed ApiError 400/401/429/502 copy

**Files:**
- Modify: `web/src/services/api.ts:22-32,66-76`, `web/src/components/RagWorkspace.tsx:188-230`
- Test: `web/src/services/api.test.ts`

**Interfaces:**
- Consumes: `ApiError(status, detail, fields?)`
- Produces: `errorCopy(status:number):{title:string;body:string}` with keys 400,401,413,429,502

- [ ] **Step 1: Write the failing test**
```ts
it('maps 429 and 502 distinctly', async () => {
  (global.fetch as any) = vi.fn().mockResolvedValue({ok:false,status:502,statusText:'x',json:async()=>({detail:'gw'})});
  await expect(api.query({query:'hi'})).rejects.toMatchObject({status:502});
  expect(errorCopy(429).title).toMatch(/rate limit/i);
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npm --prefix web run test:run -- services/api`
Expected: FAIL with "errorCopy not defined".
- [ ] **Step 3: Minimal implementation**
```ts
export function errorCopy(s:number){ return s===429?{title:'Rate Limit Exceeded',body:'Wait a moment and retry.'}:s===401?{title:'Authentication Error',body:'Check API key.'}:s===502?{title:'Gateway Unavailable',body:'Backend or gateway down.'}:{title:'Request Failed',body:'Adjust input and retry.'}; }
// RagWorkspace: replace collapsed 4xx branch with errorCopy(error.status) title/body + HTTP chip
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npm --prefix web run test:run -- services/api`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add web/src/services/api.ts web/src/components/RagWorkspace.tsx web/src/services/api.test.ts
git commit -m "fix(web): typed ApiError copy for 400/401/429/502"
```

### Task 4: Honest badges + health-mapped ops cards

**Files:**
- Modify: `web/src/components/RagWorkspace.tsx:294-339`, `web/src/components/MetricsDashboard.tsx:21-57`
- Test: `web/src/components/HonestBadges.test.tsx`

**Interfaces:**
- Consumes: `QueryResponse { serving_provider?, serving_model?, refusal: boolean; degraded_reason?: string|null }`, `HealthStatus { status: string; services: Record<'qdrant'|'neo4j'|'litellm',{reachable:boolean}> }`
- Produces: `isFresh(r:QueryResponse):boolean` (false when `refusal||degraded_reason`), `serviceTone(reachable:boolean):'ok'|'down'`

- [ ] **Step 1: Write the failing test**
```tsx
it('greys badge on refusal and reds card on unreachable', () => {
  render(<ModelBadge serving_model="gpt-4o-mini" refusal degraded_reason="fallback" />);
  expect(screen.getByText(/fallback/i)).toHaveClass('opacity-60');
  render(<OpsCards services={{qdrant:{reachable:false}}} />);
  expect(screen.getByTestId('card-qdrant')).toHaveTextContent(/down|unreachable/i);
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npm --prefix web run test:run -- HonestBadges`
Expected: FAIL with "ModelBadge/OpsCards not defined".
- [ ] **Step 3: Minimal implementation**
```tsx
export const isFresh=(r)=>!r.refusal && !r.degraded_reason;
// Badge: className={isFresh(r)?'bg-meridian-blossom':'bg-gray-100 opacity-60'} title={isFresh(r)?model:'fallback — not model-generated'}
// MetricsDashboard: delete INFRASTRUCTURE_SERVICES; map GET /health services to cards; Top-K helper "effective 1–10, rerank top-3"
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npm --prefix web run test:run -- HonestBadges`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add web/src/components/RagWorkspace.tsx web/src/components/MetricsDashboard.tsx web/src/components/HonestBadges.test.tsx
git commit -m "fix(web): grey stale model badges, bind ops cards to health"
```

## Phase 2 — Restructure (verify: `npm --prefix web run build`)

### Task 5: Guardrails into Ask collapsible

**Files:**
- Create: `web/src/components/GuardrailVerdict.tsx`
- Modify: `web/src/components/RagWorkspace.tsx:32-66`, `web/src/App.tsx:49-60`
- Test: `web/src/components/GuardrailVerdict.test.tsx`

**Interfaces:**
- Consumes: `api.checkGuardrails(req:{text:string},tenantId):Promise<GuardrailResult>`
- Produces: `<GuardrailVerdict result:GuardrailResult>` + `<GuardrailPlayground tenantId:string>` (presets + evaluate, POST only)

- [ ] **Step 1: Write the failing test**
```tsx
it('evaluates preset via POST and shows verdict', async () => {
  vi.spyOn(api,'checkGuardrails').mockResolvedValue({allowed:false,sanitized_text:'',policy_violations:['injection'],action_taken:'block'});
  render(<GuardrailPlayground tenantId="default" />);
  fireEvent.click(screen.getByText('Prompt Injection'));
  expect(await screen.findByText(/injection/i)).toBeInTheDocument();
  expect(api.checkGuardrails).toHaveBeenCalledWith({text:expect.any(String)},'default');
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npm --prefix web run test:run -- GuardrailVerdict`
Expected: FAIL with "GuardrailPlayground not defined".
- [ ] **Step 3: Minimal implementation**
```tsx
export function GuardrailVerdict({result}){ return <div role="status">{result.allowed?'Allowed':'Blocked'}: {result.policy_violations.join(', ')}</div>; }
// Move PRESETS + handleEvaluate from GuardrailsStudio.tsx:20-62 into collapsible <details> in RagWorkspace sharing enforce_guardrails checkbox
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npm --prefix web run test:run -- GuardrailVerdict`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add web/src/components/GuardrailVerdict.tsx web/src/components/RagWorkspace.tsx web/src/components/GuardrailVerdict.test.tsx
git commit -m "feat(web): fold guardrail playground into Ask"
```

### Task 6: Journey IA + deprecate stale routes in UI

**Files:**
- Modify: `web/src/App.tsx:9-60`, `web/src/components/Navbar.tsx`
- Test: `web/src/App.test.tsx`

**Interfaces:**
- Consumes: `activeTab: 'ask'|'ingest'|'operate'`
- Produces: `LEGACY_TABS = ['guardrails','rag']` redirect map (`rag→ask`, `guardrails→ask#guardrails`)

- [ ] **Step 1: Write the failing test**
```tsx
it('renders three tabs and hides legacy guardrails tab', () => {
  render(<App />); expect(screen.getByRole('tab',{name:/operate/i})).toBeInTheDocument();
  expect(screen.queryByRole('tab',{name:/guardrails/i})).toBeNull();
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npm --prefix web run test:run -- App.test`
Expected: FAIL with "found tab guardrails".
- [ ] **Step 3: Minimal implementation**
```tsx
// App.tsx: useState<'ask'|'ingest'|'operate'>('ask'); drop guardrails/metrics mounts, render MetricsDashboard+Settings entry under operate; keep ?tab=rag→ask alias; delete window.confirm deletes → inline confirm in IngestionStudio
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npm --prefix web run test:run -- App.test`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add web/src/App.tsx web/src/components/Navbar.tsx web/src/App.test.tsx
git commit -m "feat(web): journey IA ask/ingest/operate, deprecate stale tabs"
```

## Phase 3 — Modern upgrades (verify: `npm --prefix web run test:run -- --coverage`)

### Task 7: Data-fetching layer (TanStack Query, settings excluded)

**Files:**
- Create: `web/src/hooks/useApiQuery.ts`, `web/src/main.tsx` (provider)
- Modify: `web/src/App.tsx:16-29`, `web/src/components/MetricsDashboard.tsx:64-82`
- Test: `web/src/hooks/useApiQuery.test.tsx`

**Interfaces:**
- Consumes: `api.checkHealth()`, `api.getMetrics(tenantId)`
- Produces: `useHealth():{data:HealthStatus|undefined;status:string}`, `useMetrics(tenantId:string)` with keys `['health']`, `['metrics',tenant]` (`refetchInterval:10000` for health)

- [ ] **Step 1: Write the failing test**
```tsx
it('polls health via useHealth', async () => {
  vi.spyOn(api,'checkHealth').mockResolvedValue({status:'ok',service:'api'});
  const {result} = renderHook(()=>useHealth(),{wrapper});
  await waitFor(()=>expect(result.current.data?.status).toBe('ok'));
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npm --prefix web run test:run -- useApiQuery`
Expected: FAIL with "useHealth not defined".
- [ ] **Step 3: Minimal implementation**
```tsx
import {useQuery} from '@tanstack/react-query';
export const useHealth=()=>useQuery({queryKey:['health'],queryFn:()=>api.checkHealth(),refetchInterval:10000});
export const useMetrics=(t:string)=>useQuery({queryKey:['metrics',t],queryFn:()=>api.getMetrics(t)});
// main.tsx: wrap <App/> in <QueryClientProvider client={new QueryClient()}>
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npm --prefix web run test:run -- useApiQuery`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add web/src/hooks/useApiQuery.ts web/src/main.tsx web/src/App.tsx web/src/hooks/useApiQuery.test.tsx
git commit -m "feat(web): TanStack Query for health and metrics"
```

### Task 8: Settings-only RHF+zod + Vite 8 audit

**Files:**
- Create: `web/src/components/settings/settingsSchema.ts`, `web/src/components/settings/ProviderForm.tsx`, `web/src/components/settings/KeyFields.tsx`, `web/src/components/settings/ModelTestButton.tsx`
- Modify: `web/src/components/SettingsModal.tsx:32-60`
- Test: `web/src/components/settings/settingsSchema.test.ts`

**Interfaces:**
- Consumes: `LLMSettingsMasked`
- Produces: `settingsSchema: z.object({active_provider:z.string(), default_model:z.string(), litellm_base_url:z.string().url().or(z.literal(''))})`, `ProviderForm({control, errors})`, `KeyFields({register, onClear})`

- [ ] **Step 1: Write the failing test**
```ts
it('rejects unknown backend fields', () => {
  expect(()=>settingsSchema.parse({active_provider:'openai',bogus:1} as any)).toThrow();
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npm --prefix web run test:run -- settingsSchema`
Expected: FAIL with "settingsSchema not defined".
- [ ] **Step 3: Minimal implementation**
```ts
import {z} from 'zod';
export const settingsSchema=z.object({active_provider:z.string(),default_model:z.string(),litellm_base_url:z.string().url().or(z.literal(''))}).strict();
// ProviderForm/KeyFields: RHF <Controller> bindings + Clear-key buttons; audit: replace CJS default imports (marked, lucide-react) with ESM-safe named imports; Node 22 pin
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npm --prefix web run test:run -- settingsSchema` + `npm --prefix web run build`
Expected: PASS + build clean
- [ ] **Step 5: Commit**
```bash
git add web/src/components/settings/ web/src/components/SettingsModal.tsx
git commit -m "feat(web): RHF+zod settings split with CJS audit"
```

## Self-Review

- Spec coverage: settings contract (§5.1) → Tasks 1,8; shared async (§5.2) → Task 2; TanStack Ask/Ingest (§5.3) → Task 7; guardrail merge (§5.4) → Task 5; honest badges+ops (§5.5) → Task 4; RHF split+CJS (§5.6) → Task 8; tests+a11y (§5.7) → Tasks 2–4 (`role=alert/status`, focus trap in SettingsModal); Top-K range helper → Task 4; non-goals (SSE, Tailwind v4, RBAC) excluded.
- Placeholder scan: no TBD/TODO/"similar to"; every step has file paths, real test/impl code, exact run commands.
- Type/prop consistency: `ApiError.status/detail/fields` uniform (Tasks 2,3); `LLMSettingsMasked` flows 1→8; `GuardrailResult` shape preserved 5; query keys `['health']`/`['metrics',tenant]` stable 7; `activeTab` union `ask|ingest|operate` consistent 6.
