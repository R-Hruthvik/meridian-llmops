# Meridian real frontend implementation plan

**Branch:** `feat/meridian-real-frontend`  
**Design basis:** `docs/superpowers/specs/2026-10-14-meridian-workbench-redesign.md`, the approved `DesignPreview`, and the owner feedback recorded in `FRONTEND_UX_ISSUES.md`.

## Goal

Make the approved four-section workbench the default app experience and connect its visible controls to the existing backend flows. Keep the paper/pine visual direction, clear task hierarchy, visible navigation labels, compact content width, and a sidebar that can collapse and resize. Do not add demo source or answer data.

## Work sequence

1. **Shell and navigation** — replace the split lens/overlay shell with Ask, Sources, Operations, Settings hash routes; provide Operations sub-navigation; preserve Ask state while switching sections; route citations to the exact source/chunk; make sidebar resizing/collapse keyboard accessible; retain labeled mobile navigation. Add route/navigation tests before implementation.
2. **Ask** — use the real `RagWorkspace` and keep query, answer, and citations primary; move tuning/diagnostics behind clear disclosures; remove the textarea resize handle and excess intro/empty-state copy. Extend focused component tests first.
3. **Sources** — use the API-backed `IngestionStudio`; scope search to documents; align search and Add Sources; preserve tenant-aware browse/upload/detail/delete behavior and make empty/loading/error states clear. Preserve the existing explicit Clear All action.
4. **Operations and Settings** — map Safety rules, Review queue, Usage, and index details to the existing lazy studios; present the current provider settings as a real Settings destination, correctly show loaded runtime config and load errors, and retain masked-key handling.
5. **Data reset and verification** — clear the current in-app source collection using the app’s existing Clear All action after confirming the live app/API state; verify the empty Sources state, the four routes, primary actions, settings error/loaded states, desktop/mobile widths, and zoom layouts. Run frontend tests, build, lint, and Impeccable detector.

## Guardrails

- Keep backend contracts and authorization as they are; do not bypass app deletion flows or edit source files in the repository as a proxy for clearing app data.
- Preserve provider keys as secrets: never display key material or save it in browser storage.
- Keep secondary studios lazy-loaded and do not mount inactive surfaces where their current behavior would fetch data.
- Commit each verified slice with a concise one-line message; do not stage unrelated user changes.

## Verification record

- Existing preview test passed before this plan was written.
- Baseline frontend suite: 295 tests passed; Vitest also reported one unhandled timeout from `IngestionStudio` after the test environment tore down. Track and resolve if it remains in the final run.
- Browser Harness confirmed the preview renders at `http://127.0.0.1:5173/?design-preview=1`; normal `/` still renders the old shell and reports the API offline.
