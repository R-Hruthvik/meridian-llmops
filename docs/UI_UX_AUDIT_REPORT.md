# Meridian LLMOps: Comprehensive UI/UX & Motion Audit Report
**Date:** 2026-11-10  
**Branch:** `feat/chat-interface-redesign` (`.worktrees/chat-interface`)  
**Overall System Craft Score:** **3.1 / 10** (*Deficient / Pre-alpha Prototype*)

---

## 1. Executive Summary & Multi-Agent Scorecard

Three independent specialized subagents audited the interface across Visual Craft, Motion Physics, and Interactivity/Accessibility against the knowledge base (`/home/hruthvik9487/Documents/Documents_Restored/frontend/distilled/` and `FRONTEND_UX_ISSUES.md`):

| Auditor Domain | Agent Conversation ID | Score | Status | Primary Finding |
|---|---|---|---|---|
| **Visual Design & Taste** | `23533fc5-91f3-4674-972a-9d2dbe8fd38f` | **3.2 / 10** | Critical Gaps | Sterile wireframe. Empty hero vacuum. Flat cards. Missing display typography and atmospheric texture. |
| **Motion Physics & Animation** | `78a3b4cb-d61a-4a6a-8085-bde3ee10c67d` | **2.0 / 10** | Critical Gaps | Near-static. rAF loop self-terminates at resting point. Typing ripples never awake. Background canvas invisible and over-gated. |
| **UX & Accessibility** | `392b3b7f-d481-4eba-a6c2-abd1f8513d24` | **4.2 / 10** | Defective | Critical a11y failures (`aria-hidden` on modal). Broken template string on error banner. Nested buttons. Blocking browser dialogs. |

**Combined Average Score:** **3.1 / 10**

---

## 2. Root Cause Analysis: Why the UI Looked Plain & Animations Were Missing

The user asked: *"where are the animations, transitions, bg animations, this is just a plain ui"*. The audit uncovered concrete code bugs that completely disabled or muted the animations:

### 2.1 The Membrane Freeze Engine Bug (`FluidMembraneInput.tsx:188-192`)
- **Code Defect:**
  ```ts
  const arrived = Math.abs(dy) < 0.2;
  if (!arrived) {
    rafRef.current = requestAnimationFrame(loop);
  } else {
    rafActive.current = false; // Kills rAF permanently!
  }
  ```
- **Consequence:** Approximately 300ms after the page loads, the capsule arrives at its center Y coordinate ($42\text{vh}$). The rAF loop shuts off permanently.
- **Visual Result:** The harmonic wave around the pill boundary immediately freezes into a dead static line.

### 2.2 Dead Keystroke Ripples (`FluidMembraneInput.tsx:238-254`)
- **Code Defect:**
  ```ts
  const onChangeWrap = useCallback((e) => {
    onChange?.(e.currentTarget.value);
    ripples.current.push({ x: rect.width / 2, y: rect.height / 2, r: 2, life: 1 });
    // MISSING: startLoop(); -> loop is dead, ripples are never drawn!
  }, [onChange]);
  ```
- **Consequence:** Keystroke ripples are pushed into an in-memory array but never painted because the animation frame loop is halted.

### 2.3 Canvas Occlusion & Boundary Clipping
- **Code Defect:**
  1. The `<canvas>` is rendered inside the capsule container underneath `bg-surface-raised` (`rgba(255, 254, 250, 1)`), which completely covers the canvas graphics.
  2. The canvas dimensions match the capsule bounding box with zero padding. Wave oscillations of $\pm 4\text{px}$ are hard-clipped at the container boundary.

### 2.4 Invisible Pointer Background (`FluidPointerCanvas.tsx:39-43`)
- **Code Defect:**
  ```ts
  const PEAK_ALPHA = 0.06;
  const VELOCITY_THRESHOLD = 80; // px/s
  const DISTANCE_THRESHOLD = 20; // px
  ```
- **Consequence:** 
  1. Peak alpha of 6% with 1px stroke yields a contrast delta $\Delta E^* < 0.8$, far below the human eye Just-Noticeable Difference (JND) threshold of 2.3. On `#F7F5F0` (Raw Paper) or `#18181B` (Analog Soot), it is mathematically invisible.
  2. The velocity gate requiring $>20\text{px}$ per 16ms frame ($>1200\text{px/s}$) rejects $90\%$ of normal mouse movements. When the cursor stops, it paints zero ambient motion.

### 2.5 Instant Drawer & Modal Snaps
- **Code Defect:**
  1. Left rail, right file drawer, and citation inspector unmount instantly (`if (!open) return null`) or mount already at `translate-x-0`.
  2. The settings modal uses a fixed horizontal cubic bezier slide-in (+24px) for a centered dialog, and unmounts instantly on close without an exit spring.
  3. Theme switching flashes instantly without CSS variable transition smoothing on `:root`.

---

## 3. Detailed Forensic Issue Inventory

### 3.1 Visual Design & Taste Issues (Agent 1)
1. **Hero Vacuum (`01_heroes.md §1.1 & §1.4`):** When empty, the app renders a 520px pill stranded in a blank beige desert. Zero display typography, zero product identity, zero sparklines, zero prompt chips. Communicates paralysis rather than capability.
2. **Zero Dynamic Range in Typography (`03_typography.md §1`):** Tailwind defines `text-display` (32px), but it is never used. The entire UI lives in a narrow, flat 11px–15px range. No fluid clamp formula (`clamp(...)`).
3. **Card Flatness & False Elevation (`KB_TENETS.md §1`):** Cards use raw nested divs (`bg-surface` wrapped in `bg-surface-raised`) with contrast $\Delta E < 3$. No specular hairline (`inset 0 1px 0 rgba(255,255,255,0.12)`), no double-bezel depth, no tactile shadow separation.
4. **Missing Atmospheric Texture:** Zero subtle coordinate grid, no procedural SVG noise grain overlay, no ambient vignette.

### 3.2 Motion Physics & Dynamics Issues (Agent 2)
1. **Capsule Glide Physics:** Uses ad-hoc lerp `dy * 0.16` instead of second-order spring physics with initial velocity transfer ($k=380, c=38, \zeta=0.975$).
2. **Turn Completion Layout Jump:** When an answer finishes streaming, `TurnFooter` snaps into the DOM, causing a jarring $+45\text{px}$ layout reflow. Needs smooth height unfold (`grid-template-rows: 0fr -> 1fr`).
3. **Chat Turn Reveals:** Message bubbles pop into the DOM instantly. Missing kinetic reveal ($y: 16\text{px} \to 0, \text{opacity}: 0 \to 1$).
4. **Token Mirage (KB Tenet 7):** `src/constants/springs.ts` defines `MERIDIAN_SPRING` and `useMeridianPhysics()`, but production code never imports or uses them.

### 3.3 UX & Accessibility Defects (Agent 3)
1. **Critical Syntax Error in Error Banner (`RagWorkspace.tsx:120`):**
   ```tsx
   className="mb-4 flex items-start gap-2.5 rounded border p-3 ${
     error.status === 429 ? '...' : '...'
   }"
   ```
   Plain double quotes used instead of JSX expression backticks. Renders literal broken string to DOM.
2. **Modal Screen Reader Lockout (`ProjectSettingsModal.tsx:46`):**
   Parent container has `aria-hidden="true"` while containing `role="dialog"`. Screen readers ignore the entire settings dialog.
3. **Invalid HTML Nested Buttons (`ProjectWorkspace.tsx:338, 360`):**
   Delete session button is nested inside the session item button.
4. **Duplicate Error Callouts:**
   Both `RagWorkspace.tsx` and `ChatStreamView.tsx` render an error banner on failure, stacking two redundant red boxes.
5. **Misleading Error Copy:**
   HTTP 500 internal server error displays as *"Query Intercepted / Failed"*, confusing server crashes with guardrail interceptions.
6. **Native Blocking Dialogs:**
   Uses native `window.prompt()` and `window.confirm()` for project creation and deletion.
7. **Missing Focus Sandwich (`02_focus_indicators.md`):**
   `.focus-machined` double-sandwich ring exists in CSS but is only applied to 1 button in the entire app.

---

## 4. Remediation Specifications

### 4.1 Living Fluid Membrane Specification
$$\delta(\theta, t) = A_1 \sin(m_1 \theta - \omega_1 t) + A_2 \cos(m_2 \theta + \omega_2 t)$$
- Primary: $m_1 = 3, \omega_1 = 2.4\text{ rad/s}, A_1 = 2.5\text{px}$.
- Secondary: $m_2 = 5, \omega_2 = 1.8\text{ rad/s}, A_2 = 1.2\text{px}$.
- Bilateral acoustic keystroke ripples: $v_{\text{phase}} = 340\text{px/s}, \gamma = 4.2\text{s}^{-1}, A_k = 4.5\text{px}, \lambda = 48\text{px}$.
- Magnetic cursor pull: $R_{\text{influence}} = 64\text{px}, F_{\max} = 6.0\text{px}$.
- Add $32\text{px}$ canvas padding; do not terminate rAF when spring arrives.

### 4.2 Ambient Coordinate Grid & Fluid Field
- 24px grid pitch with 1px hairlines at `rgba(var(--border) / 0.35)`.
- Interactive pointer field with $N=100$ curl-drift particles and peak alpha $0.20$.
- Lightweight SVG noise grain filter overlay (`opacity: 0.035, mix-blend-mode: overlay`).

### 4.3 Second-Order Spring Reference Table
$$m\ddot{x} + c\dot{x} + k(x - x_{\text{target}}) = 0, \quad \zeta = \frac{c}{2\sqrt{km}}$$

| Component | Target Property | $k$ | $c$ | $m$ | $\zeta$ | Character |
|---|---|---|---|---|---|---|
| **Capsule Glide** | $Y$ ($42\text{vh} \leftrightarrow \text{dock}$) | 380 | 38 | 1.0 | 0.975 | Fast, near-critical glide |
| **Left Rail Drawer** | $X$ ($-100\% \to 0$) | 480 | 42 | 1.0 | 0.958 | Snappy slide with tiny overshoot |
| **Files & Inspector Drawers** | $X$ ($+100\% \to 0$) | 520 | 44 | 1.0 | 0.965 | Crisp slide-in |
| **Settings Modal** | Scale $0.94 \to 1.0$, $Y$ $12\text{px} \to 0$ | 600 | 46 | 0.9 | 0.991 | Isotropic expansion |
| **Chat Turn Reveal** | Opacity $0 \to 1$, $Y$ $16\text{px} \to 0$ | 420 | 38 | 1.0 | 0.927 | Kinetic reveal |

---

## 5. Architectural Modules for Parallel Planning

1. **Settings Architecture (Frontend & Backend Contract)**:
   - Dynamic provider switching (custom, OpenAI, Anthropic, LiteLLM).
   - Secret key masking & backend validation via `/v1/settings`.
   - Temperature, top-k, guardrail threshold sliders.
   - Storage purging (cache, vector collections, document corpus).
2. **Hero & Home LLMOps Cockpit**:
   - Display typography clamp formula: `clamp(2rem, 3.5vw + 1rem, 3.75rem)`.
   - Blueprint telemetry HUD: Chroma vector counts, SQLite entity counts, Redis cache hit rate, p95 latency.
   - 4 clickable prompt starter chips with click-to-fill.
3. **Chat Stage, Streaming & Citations**:
   - Kinetic turn reveals with double-bezel card elevation and specular highlights.
   - Token streaming buffer with RAF batching.
   - Citation Inspector Push-Stage Drawer with waterfall latency bars.
   - Unified Error Resilience surface with diagnostic trace copy.
4. **Motion & Physics Engine**:
   - Living boundary fluid membrane with persistent rAF loop and bilateral ripples.
   - Fluid pointer lattice grid with curl noise and particle dispersion.
   - Global CSS theme transitions.
5. **Projects, Tenant Isolation & Chat History**:
   - Project CRUD and switcher modal.
   - Multi-chat sessions persisted in IndexedDB with title generation.
   - Grounded files manager drawer with drag-and-drop ingestion.
