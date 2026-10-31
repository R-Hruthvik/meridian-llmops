# PLAN_WEB_UX — Meridian LLMOps Web UX Improvement Plan

## 1. Current state

- **4-tab studio shell with hidden-mount switching:** `App.tsx:49-60` keeps `RagWorkspace` / `IngestionStudio` / `GuardrailsStudio` / `MetricsDashboard` mounted and toggles `block/hidden`; `App.tsx:16-29` polls `api.checkHealth()` every 10s only for a navbar boolean, discarding per-service detail.
- **Hand-rolled fetch client, no cache:** `services/api.ts:58-64 getHeaders` + `66-76 requestJSON` throws `ApiError(status, detail)`; `82-98 query`, `100-122 ingest/guardrails`, `135-216 settings/documents` each do manual `useState loading/error` per component with no dedup, retry, or background refetch.
- **Settings form drifts from backend schema:** `types/api.ts:75-89 LLMSettings` + `SettingsModal.tsx:222-235` POST `active_provider, openai_org_id/proj_id, custom_base_url, litellm_base_url`, which `UpdateLLMSettingsRequest(extra="forbid")` rejects → 422 on Save (2026-09-28_UX_BACKEND_FOCUS.md gap 1); blank semantics unclear (gap 2); POST echoes raw secrets (gap 3).
- **Ask renders unattributable badges:** `RagWorkspace.tsx:332-339` shows `serving_provider/model` unconditionally; `146-152` caps Top-K at 10 while backend allows 50 and graph hardcodes 3; error branches `189-230` distinguish 401/429 but all other 4xx collapse to one style.
- **Operate view is static:** `MetricsDashboard.tsx:21-57 INFRASTRUCTURE_SERVICES` hardcodes Online/Ready with pulsing green dots; `64-78 getMetrics` fetches only tenant totals (no `by_model`), so cost cards are unattributable and infra stays green during outages (gaps 5, 7).

## 2. Confusion audit

Four "studios" suggest four equal jobs, but users have three goals: ask, ingest, operate. Guardrails as a top-level studio implies policy authoring; it is actually a test-what-if playground plus a checkbox (`enforce_guardrails`) inside Ask — so users try text in GuardrailsStudio, then wonder why Ask behaves differently. The drifted settings form compounds this: provider cards, org/proj IDs, custom URLs, and LiteLLM URL all save through one Save & Apply button that 422s with no per-field message, and "leave blank to keep" appears on one field only, so users cannot tell saved vs cleared vs failed. Static ops cards destroy trust earned elsewhere: green Qdrant/Neo4j during a real outage contradicts the navbar health dot, and the ever-present model badge ("gpt-4o-mini") on greetings, refusals, and fallbacks teaches users the badge means nothing. Empty states are dead-ends ("No query context retrieved yet") with no next action, and each studio invents its own loading/error markup, so identical failures look like different bugs.

## 3. Simplified restructure

**Journey IA: Ask / Ingest / Operate.** Merge `GuardrailsStudio` into Ask as an "Evaluate guardrails" collapsible sharing the same `checkGuardrails` call and verdict component; keep `IngestionStudio` (upload + catalog + chunk inspector); fold `MetricsDashboard` + `SettingsModal` + health into Operate. Delete the fourth tab, keep deep-linkable `?tab=` routes later only if needed.

**Shared data + UI states.** One `ApiClient` (existing `api.ts`, fixed baseUrl default from `vite.config.ts:12-23` proxy) wrapped by TanStack Query (`useQuery`/`useMutation` per https://tanstack.com/query/latest ): query keys `['query']`, `['documents']`, `['metrics', tenant]`, `['health']`, `['settings']`. Shared `<AsyncState loading|error|empty>` with retry button, `role=alert`, HTTP-code copy (reuse `RagWorkspace:188-230` pattern, extend to 400/413/502), plus skeleton loaders and empty states with CTA ("Ingest a doc", "Adjust Top-K").

**Settings bound to backend schema.** Generate form fields from `GET /v1/settings/llm` masked shape (`*_configured`, `*_masked`); POST only backend field names; inline 422 per-field errors; explicit Clear-key buttons (no blank ambiguity); never render raw keys from POST response.

**Health-driven ops cards.** Replace `INFRASTRUCTURE_SERVICES` constant with `GET /health → {status, services{qdrant,neo4j,litellm}}` mapped 1:1 to card color/label; `top_k` control fixed to effective range (default 3, max 10) with helper "rerank top-3"; model badge greys out with "fallback — not model-generated" when `serving.fresh=false`; cost card gains `by_model` breakdown when backend ships it, else hide breakdown.

**Merge / split / delete.** Merge guardrail playground into Ask; split `SettingsModal.tsx` (666 lines) into `ProviderForm + KeyFields + ModelTestButton`; delete static infra constant, duplicate error markups, `window.confirm` deletes (replace with inline confirm). **Non-goals:** no SSE streaming UI, no PDF/rich-text editor, no custom rule DSL, no RBAC/cost-forecast/history, no Tailwind v4 migration, no React Compiler opt-in.

## 4. Modern-tool upgrades

| Tool | Current | 2026 latest (fetched) | Adopt / skip + why |
|---|---|---|---|
| Data fetching | hand `fetch` + `useState` | TanStack Query v5 (`@tanstack/react-query@5.101`, https://tanstack.com/query/latest ) | **Adopt** — kills duplicated loading/error logic, gives cache/retry/polling for health+metrics; small bundle, fits REST without router rewrite |
| Forms | uncontrolled `useState`, `‖ undefined` blanks | TanStack Form / React Hook Form + zod | **Adopt lightweight** (RHF+zod for SettingsModal only) — schema-driven validation mirrors backend `extra=forbid`, per-field 422; skip global store |
| Vite / plugin-react | 8.2 / 6.0 (Rolldown, Oxc) | Vite 8 stable, Node ≥20.19/22.12 (https://vite.dev/blog/announcing-vite8 ) | **Keep; audit only** — already current; audit CJS default imports (`marked`, `lucide-react`) for `{default:…}` interop; pin Node 22 in Dockerfile per TECH_TRENDS_CATCHUP |
| Vitest + Testing Library | 3.1.7, jsdom, `test:run` | v5.0.2, needs Vite ≥6.4/Node ≥22.12 (https://vitest.dev/guide/ ) | **Adopt v5 + browser-mode spot tests** — jsdom for logic, browser mode for Ask skeleton/badge; skip full visual regression |
| Tailwind | 3.4 + `tailwind.config.js` | v4 CSS-first `@theme`, Oxide 10× builds (https://tailwindcss.com/docs/upgrade-guide ) | **Skip migration** — v4 changes border/ring/shadow defaults + drops `tailwind.config.js`; cost exceeds gain while settings/health bugs dominate; revisit post-stabilization |
| TypeScript | ~6.0, `tsc -b` | TS 6 line current | **Keep** — enable `verbatimModuleSyntax` + `noUncheckedIndexedAccess` for stricter API-type safety; no major churn |

## 5. Sequenced improvement plan

1. **Fix settings contract + masked round-trip.** Touch `types/api.ts`, `services/api.ts:135-168`, `SettingsModal.tsx:68-99,207-248`. Verify `npm --prefix web run build` + manual save shows masked keys, 422 renders per-field.
2. **Shared async primitives.** Add `hooks/useApiQuery.ts`, `components/AsyncState.tsx`; migrate `MetricsDashboard:64-78`, `App:16-29` health poll to `useQuery(refetchInterval:10000)`. Verify `npm --prefix web run test:run`.
3. **Adopt TanStack Query for Ask/Ingest/Guardrail.** Touch `RagWorkspace:42-66`, `IngestionStudio:94-123`, `GuardrailsStudio:45-62`; add `QueryClientProvider` in `main.tsx`. Verify `npm --prefix web run test:run` + `npm --prefix web run build`.
4. **Merge Guardrails into Ask.** Move preset/verdict UI as collapsible in `RagWorkspace.tsx`; remove `guardrails` tab from `App.tsx:55-57`, `Navbar`. Verify `npm --prefix web run build` and route smoke.
5. **Health-driven ops cards + honest badges.** Bind `MetricsDashboard:21-57` to `/health` services; grey `serving_model` badge on `refusal/degraded_reason`; align Top-K helper text. Verify `npm --prefix web run test:run`.
6. **RHF+zod settings form split.** Split `SettingsModal.tsx` into `ProviderForm/KeyFields`; Clear-key buttons; CJS-import audit (`marked`, `lucide-react`). Verify `npm --prefix web run build` with Node 22.
7. **Component tests + a11y pass.** Add `RagWorkspace.test.tsx` (skeleton, 401/429 branches), `SettingsModal.test.tsx` (drift regression), `MetricsDashboard.test.tsx` (degraded mapping); `role=alert`, focus trap in modal. Verify `npm --prefix web run test:run -- --coverage`.

## Cross-part note

- Backend must return masked settings shape and accept UI field names or publish canonical names.
- `POST /v1/query` must include `serving{fresh}` + `degraded_reason|null` with stable error codes.
- Guardrail canonical must be `POST /v1/guardrails/check`; deprecate GET `?text=` to stop PII in URLs.
- `/health` must expose per-service `reachable/degraded`; metrics needs `by_model` for cost attribution.
- Delete must guarantee vector+BM25+graph eviction so the catalog never shows ghost chunks.
