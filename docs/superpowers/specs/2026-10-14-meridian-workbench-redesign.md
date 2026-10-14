# Meridian Workbench Redesign — Design Spec

**Date:** 2026-10-14  
**Status:** awaiting owner review  
**Supersedes:** `docs/superpowers/specs/2026-09-28-instrument-console-redesign.md` for the web UI structure and visual system.

## 1. Goal

Make Meridian easier and more comfortable to use by making its primary destinations obvious, giving the question-and-answer flow clear priority, and moving technical configuration behind simple, task-named sections.

## 2. Audience and assumptions

The current repository documents a technical document-Q&A workbench. The primary audience is assumed to be developers and operators who ingest documents, ask grounded questions, and inspect retrieval behavior. The visual hierarchy should still let a person who only needs an answer start immediately. This audience assumption is recorded in `PRODUCT.md` and remains open to correction.

## 3. Information architecture

Replace the icon rail and separate capability strip with one four-item, visible-label primary navigation:

1. **Ask** — question composer, answer, verdict, citations, and optional diagnostics.
2. **Sources** — add/import documents, browse/search sources, inspect chunks, and view index/storage status.
3. **Operations** — safety rules, review queue, and usage/health views with a small in-section navigation.
4. **Settings** — provider/model, connection checks, and API-key configuration using the existing settings behavior.

The four destinations use stable hash routes: `/#/ask`, `/#/sources`, `/#/operations/rules`, `/#/operations/review`, `/#/operations/usage`, and `/#/settings`. Hash routing avoids requiring changes to the FastAPI static-file fallback or a new routing dependency. The root `/#` opens Ask; invalid app hashes recover to Ask. Browser back and forward follow primary and sub-section navigation.

Source inspection from an answer remains contextual. A citation opens the matching document/chunk in the Sources context and clearly highlights the selected passage. Switching away and returning to Ask must preserve the current in-memory question and result; do not persist answer content or provider credentials to browser storage as part of this work.

## 4. Visual direction

Use the “annotated reference library” direction documented in `DESIGN.md`: warm paper surfaces, dark ink, pine as the primary interface accent, copper for source references, and semantic colors only for genuine statuses. Geist remains the workhorse UI face; a restrained system serif adds contrast to page titles and the question prompt; Geist Mono stays limited to technical values and IDs.

Use a labeled desktop side navigation and a labeled mobile bottom navigation. The top bar carries only brand, tenant context, and a concise service-health state. Keep provider/model details in Settings. Replace small all-caps section headings and repeated outlined cards with readable sentence-case headings, spacing, and a clear type scale. The answer and its source evidence should lead the Ask page. Advanced retrieval options and graph diagnostics remain available but secondary.

The signature move is a numbered citation marker that carries the same identity into the focused source passage. It must remain understandable as a normal link and retain visible focus/selected states.

## 5. Behavior and scope

- Preserve existing API calls, tenant boundaries, masked credential handling, retrieval semantics, guardrail semantics, and service status accuracy.
- Keep each non-Ask studio lazy-loaded; only the selected sub-section should fetch its data. Preserve the Ask result in memory while navigating.
- Present Settings as a primary page, not a hidden gear-only dialog. Reuse the current settings form/business logic rather than duplicating it.
- Keep an offline/connection error state visible with a relevant retry/configuration action. A dismissed transient notice must not be the only indicator of system health.
- Do not change backend behavior, add a UI/routing dependency, add sample claims, or introduce unrequested capabilities.

## 6. Success criteria

- A new user can identify the four primary sections and the active section without relying on hover or technical vocabulary.
- Every primary and Operations sub-section is reachable by click, keyboard, direct hash link, and browser back/forward.
- A citation focuses the correct document/chunk, and returning to Ask retains the current question and result in memory.
- The Ask page has one clear primary action; advanced controls and diagnostics are visually secondary.
- Desktop and mobile layouts keep navigation labels visible, provide touch targets of at least 44 × 44 px, and avoid page-level horizontal overflow.
- Existing API/security behavior and first-paint lazy loading remain covered by tests.

## 7. Verification

- Add or update tests before implementation for route mapping, navigation state, citation focus, Ask state retention, Operations sub-navigation, and Settings page behavior.
- Run focused tests after each small change, then `npm run test:run`, `npm run build`, and `npm run lint` from `web`.
- Use browser-harness for desktop and mobile rendered checks, including route changes, a citation drill-through, offline/retry presentation, keyboard focus, and console errors.

## 8. Risks

- Changing from modal settings to a page may affect focus management and existing SettingsModal tests. Keep the settings form logic shared and retain security assertions.
- Routing should not require server fallback changes. Hash paths must be parsed consistently on refresh and `popstate`.
- Preserving Ask state must not introduce local-storage persistence of answers or credentials.
- Existing tests encode the current three-lens and overlay model; update only assertions that describe the replaced shell, preserving API, security, and studio behavior coverage.
