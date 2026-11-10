# Execution Plan: Chat-Centric Project Rebuild with Fluid Physics

## Overview
Complete greenfield rebuild of the Meridian frontend in the `feat/chat-interface-redesign` worktree. Scraps all legacy sidebars, navs, and multi-page overlays. Centers on a **Project-Centric Architecture** where Projects hold grounding files and host fluid conversational chats. Features a **Center-to-Bottom Fluid Membrane Input Bar**, **Pointer-Reactive Fluid Background Canvas**, and **Raw Paper & Deep Carbon Ink** non-slop design tokens.

---

## Model Strategy
- **Primary Model**: `kilo-router/kc/nvidia/nemotron-3.5-super-vl:free`
- **Fallback Model**: `kilo-router/kc/nvidia/nemotron-3.5-lightning:free`
- **Provider**: KiloRouter only

---

## Phases & Scope

### Phase 1: Tokens, Canvas Physics & Fluid Membrane Input
- **Objectives**:
  - Establish multi-theme tokens in `src/tokens/theme.ts` (Raw Paper & Deep Ink default, Ceramic Concrete, Cold Titanium, Deep Soot).
  - Build `FluidPointerCanvas.tsx`: Interactive HTML5 background canvas tracking mouse velocity with rAF lerp, creating ambient fluid ripples.
  - Build `FluidMembraneInput.tsx`: Center-to-bottom animated input dock. Surrounded by high-DPI canvas sine-wave water membrane that ripples on typing and distorts on cursor proximity.
  - Write unit tests for both canvas components.
  - Verify with browser harness screenshot.

### Phase 2: Project-Centric Workspace & Layout Switcher
- **Objectives**:
  - Strip legacy shell from `App.tsx` and replace with `ProjectWorkspace.tsx`.
  - Support the 3 layout styles (configurable in settings):
    1. Minimalist Breadcrumb & Floating Drawer (Default)
    2. Floating File Capsule in Hero
    3. Collapsible Slim Rail
  - Wire project document APIs (`/v1/documents`, file upload, grounding status).
  - Write unit tests for `ProjectWorkspace` and layout modes.
  - Verify with browser harness screenshot.

### Phase 3: Conversational Stream, Fluid Stage & Citations
- **Objectives**:
  - Wire `useRagChat` into `ProjectWorkspace`.
  - Implement smooth center-to-bottom spatial glide when the first query is submitted.
  - Integrate message turns: user pill, assistant response with `MarkdownRenderer`, interactive citation buttons `[^n]`, and generative UI widgets.
  - Mount side-docked `CitationInspectorDrawer`.
  - Verify with browser harness screenshot.

### Phase 4: Settings Engine, Full Verification & Build
- **Objectives**:
  - Implement `ProjectSettingsModal.tsx` allowing instant switching between themes (Raw Paper, Ceramic Concrete, Cold Titanium, Soot) and layout modes.
  - Full Vitest suite verification (`npm test -- --run`).
  - Production build verification (`npm run build`).
  - Review pass and browser screenshots on desktop and mobile viewports.

---

## OpenCode Dispatch Protocol
Every OpenCode prompt must strictly include:
1. Instruction to use subagents and relevant skills (`design-taste-frontend`, `impeccable`, `browser-harness`).
2. Instruction to use `browser-harness` to take regular screenshots of `http://localhost:5173` to visually verify UI.
3. Instruction to dedicate a subagent to continuously review/monitor all UI/UX components to ensure zero broken elements or regressions.
4. Automatic fallback between the two KiloRouter Nemotron 3.5 models.
