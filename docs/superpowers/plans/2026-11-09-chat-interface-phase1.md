# Phase 1: Chat Interface Foundation & Hardware Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the foundational Double-Bezel (Doppelrand) hardware components, machined design tokens, critically damped spring motion physics, and unit tests for the new chat interface in `.worktrees/chat-interface`.

**Architecture:** Modular React components styled via Tailwind CSS utilities with Motion springs. Double-Bezel nesting (outer protective shell + inner tactical core) provides tactile depth without muddy blur shadows. High-contrast double-sandwich focus rings guarantee WCAG 2.4.13 AAA accessibility.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, Motion (`motion/react`), Lucide / Phosphor icons, Vitest, Testing Library.

**Spec:** [`docs/expert-consultation-and-advisory-response.md`](file:///home/hruthvik9487/work/llm/docs/expert-consultation-and-advisory-response.md) & [`docs/chat-interface-research-and-queries.md`](file:///home/hruthvik9487/work/llm/docs/chat-interface-research-and-queries.md)

## Global Constraints

- **Workspace Path:** Work strictly in `.worktrees/chat-interface` on branch `feat/chat-interface-redesign`.
- **Model Standard:** Primary free model: `opencode/deepseek-v4.1-flash-free` (Fallback: `opencode/glm-5.3-flash-free`).
- **OpenCode Invocation:** Execute non-interactive one-shot commands via bash: `cd /home/hruthvik9487/work/llm/.worktrees/chat-interface && opencode run --auto --model opencode/deepseek-v4.1-flash-free "<prompt>"`.
- **Hairline Border Rule (Tenet 2):** Single edge ownership with sub-pixel borders (`border border-white/10` or `0.8px`). Zero double-border seams.
- **Depth Without Blur (Tenet 1 & 6):** Separation achieved through opacity layering (`bg-white/[0.03]`, `bg-black/40`) and inner highlights (`shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)]`). Banned `backdrop-blur` on scrollable feeds.
- **Motion Bounds (Domain 4.3):** Critically damped spring ($\zeta = 1.0$, `stiffness: 100, damping: 20, mass: 1`) with `100ms` opacity fallback under `prefers-reduced-motion`.
- **Focus Indicator (Domain 4.2):** Machined double-sandwich ring (`2px` inner trench + `2px` outer halo, >11:1 contrast).

---

## Model Selection & Evaluation

| Candidate Model | Evaluation & Fit | Verdict |
|---|---|---|
| **`opencode/deepseek-v4.1-flash-free`** | Top-tier code generation, excellent TypeScript AST reasoning, rapid tool call resolution (inspected codebase and generated types in `< 4s` during test). | **PRIMARY (Best Free Model)** |
| **`opencode/glm-5.3-flash-free`** | High execution speed, strong markdown formatting, reliable syntax output. | **SECONDARY (Fallback)** |
| **`cline/cline-free/step-5-preview`** | Strong reasoning, slightly slower tool latency. | **TERTIARY (Reserve)** |

---

## Tasks

### Task 1: Motion Physics & Machined Focus Tokens

**Files:**
- Create: `web/src/constants/springs.ts`
- Modify: `web/src/WorkbenchShell.css`
- Test: `web/src/constants/springs.test.ts`

**Interfaces:**
- Consumes: `motion/react` (`useReducedMotion`, `Transition`)
- Produces: `MERIDIAN_SPRING`, `MERIDIAN_REDUCED_TRANSITION`, `useMeridianPhysics`

- [ ] **Step 1: Write the failing test for springs and physics helper**

```typescript
// web/src/constants/springs.test.ts
import { describe, expect, it } from 'vitest';
import { MERIDIAN_SPRING, MERIDIAN_REDUCED_TRANSITION } from './springs';

describe('Meridian Physics & Motion Tokens', () => {
  it('defines a critically damped spring configuration (zeta = 1.0)', () => {
    expect(MERIDIAN_SPRING.type).toBe('spring');
    expect(MERIDIAN_SPRING.stiffness).toBe(100);
    expect(MERIDIAN_SPRING.damping).toBe(20);
    expect(MERIDIAN_SPRING.mass).toBe(1);
  });

  it('defines a zero-spatial-movement fallback for reduced motion', () => {
    expect(MERIDIAN_REDUCED_TRANSITION.type).toBe('tween');
    expect(MERIDIAN_REDUCED_TRANSITION.duration).toBe(0.1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/chat-interface/web && npx vitest run src/constants/springs.test.ts`  
Expected: FAIL with "Cannot find module './springs'"

- [ ] **Step 3: Implement `springs.ts` and add focus utilities to `WorkbenchShell.css` via OpenCode**

Execute via OpenCode:
```bash
cd /home/hruthvik9487/work/llm/.worktrees/chat-interface && \
opencode run --auto --model opencode/deepseek-v4.1-flash-free \
  "Create web/src/constants/springs.ts exporting MERIDIAN_SPRING ({ type: 'spring', stiffness: 100, damping: 20, mass: 1 }), MERIDIAN_REDUCED_TRANSITION ({ type: 'tween', duration: 0.1, ease: 'linear' }), and useMeridianPhysics hook. Add .focus-machined and .focus-machined-accent classes to web/src/WorkbenchShell.css with 2px inner trench and 2px outer halo."
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd .worktrees/chat-interface/web && npx vitest run src/constants/springs.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/hruthvik9487/work/llm/.worktrees/chat-interface && \
git add web/src/constants/springs.ts web/src/constants/springs.test.ts web/src/WorkbenchShell.css && \
git commit -m "feat(ui): add critically damped springs and machined focus utilities"
```

---

### Task 2: Base Double-Bezel Component (`DoubleBezelCard`)

**Files:**
- Create: `web/src/components/chat/DoubleBezelCard.tsx`
- Test: `web/src/components/chat/DoubleBezelCard.test.tsx`

**Interfaces:**
- Consumes: `React.FC<{ children: React.ReactNode; className?: string; innerClassName?: string; active?: boolean }>`
- Produces: `<DoubleBezelCard />` with outer machined chassis (`rounded-2xl`, `p-1.5`, `border border-white/10`) and inner tactical core (`rounded-xl`, inner edge highlight).

- [ ] **Step 1: Write the failing test for `DoubleBezelCard`**

```typescript
// web/src/components/chat/DoubleBezelCard.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DoubleBezelCard } from './DoubleBezelCard';

describe('DoubleBezelCard (Doppelrand Architecture)', () => {
  it('renders nested outer chassis and inner core containers', () => {
    render(
      <DoubleBezelCard data-testid="card">
        <div>Content Inside Core</div>
      </DoubleBezelCard>
    );

    const card = screen.getByTestId('card');
    expect(card).toBeDefined();
    expect(screen.getByText('Content Inside Core')).toBeDefined();
    // Verify outer shell has rounded-2xl styling
    expect(card.className).toContain('rounded-2xl');
  });

  it('applies active border state when active prop is true', () => {
    render(
      <DoubleBezelCard data-testid="active-card" active>
        <div>Active Core</div>
      </DoubleBezelCard>
    );

    const card = screen.getByTestId('active-card');
    expect(card.className).toContain('border-sky-400');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/chat-interface/web && npx vitest run src/components/chat/DoubleBezelCard.test.tsx`  
Expected: FAIL with "Cannot find module './DoubleBezelCard'"

- [ ] **Step 3: Implement `DoubleBezelCard.tsx` via OpenCode**

Execute via OpenCode:
```bash
cd /home/hruthvik9487/work/llm/.worktrees/chat-interface && \
opencode run --auto --model opencode/deepseek-v4.1-flash-free \
  "Create web/src/components/chat/DoubleBezelCard.tsx implementing the Double-Bezel nested hardware pattern. Outer frame: p-1.5 rounded-2xl border border-white/10 bg-white/[0.03] dark:bg-zinc-950/40 transition-colors. Inner core: rounded-xl bg-zinc-900/90 dark:bg-zinc-900/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]. When active=true, outer border uses border-sky-400/50. Accept children, className, innerClassName, active, and standard HTMLDivProps."
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd .worktrees/chat-interface/web && npx vitest run src/components/chat/DoubleBezelCard.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/hruthvik9487/work/llm/.worktrees/chat-interface && \
git add web/src/components/chat/DoubleBezelCard.tsx web/src/components/chat/DoubleBezelCard.test.tsx && \
git commit -m "feat(ui): add DoubleBezelCard component with nested chassis architecture"
```

---

### Task 3: Island Button Component (`IslandButton`)

**Files:**
- Create: `web/src/components/chat/IslandButton.tsx`
- Test: `web/src/components/chat/IslandButton.test.tsx`

**Interfaces:**
- Consumes: `React.ButtonHTMLAttributes<HTMLButtonElement>`, `icon?: React.ReactNode`, `variant?: 'primary' | 'secondary' | 'ghost'`
- Produces: `<IslandButton />` with nested circular trailing icon wrapper and diagonal hover kinetics (`group-hover:translate-x-0.5 group-hover:-translate-y-0.5`).

- [ ] **Step 1: Write the failing test for `IslandButton`**

```typescript
// web/src/components/chat/IslandButton.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ArrowUpRight } from 'lucide-react';
import { IslandButton } from './IslandButton';

describe('IslandButton (Button-in-Button CTA)', () => {
  it('renders label and nested icon container', () => {
    render(
      <IslandButton icon={<ArrowUpRight data-testid="icon" />}>
        Send Query
      </IslandButton>
    );

    expect(screen.getByText('Send Query')).toBeDefined();
    expect(screen.getByTestId('icon')).toBeDefined();
  });

  it('is disabled when disabled prop is provided', () => {
    render(
      <IslandButton disabled>
        Disabled
      </IslandButton>
    );

    const button = screen.getByRole('button');
    expect(button.getAttribute('disabled')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/chat-interface/web && npx vitest run src/components/chat/IslandButton.test.tsx`  
Expected: FAIL with "Cannot find module './IslandButton'"

- [ ] **Step 3: Implement `IslandButton.tsx` via OpenCode**

Execute via OpenCode:
```bash
cd /home/hruthvik9487/work/llm/.worktrees/chat-interface && \
opencode run --auto --model opencode/deepseek-v4.1-flash-free \
  "Create web/src/components/chat/IslandButton.tsx. The component is a rounded-full pill button with generous padding (px-4 py-2), focus-machined-accent class, and a nested circular icon wrapper (w-6 h-6 rounded-full bg-white/10 flex items-center justify-center) with motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5 diagonal hover kinetics. Support primary, secondary, and ghost variants. Forward refs and button props."
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd .worktrees/chat-interface/web && npx vitest run src/components/chat/IslandButton.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/hruthvik9487/work/llm/.worktrees/chat-interface && \
git add web/src/components/chat/IslandButton.tsx web/src/components/chat/IslandButton.test.tsx && \
git commit -m "feat(ui): add IslandButton component with button-in-button CTA pattern"
```

---

### Task 4: Floating Island Command Dock (`CommandDock`)

**Files:**
- Create: `web/src/components/chat/CommandDock.tsx`
- Test: `web/src/components/chat/CommandDock.test.tsx`

**Interfaces:**
- Consumes:
  - `query: string`, `onQueryChange: (q: string) => void`
  - `onSubmit: () => void`
  - `isStreaming?: boolean`, `onCancel?: () => void`
  - `topK: number`, `onTopKChange: (k: number) => void`
  - `guardrails: boolean`, `onGuardrailsChange: (g: boolean) => void`
- Produces: Detached floating hardware dock with Double-Bezel chassis, auto-expanding textarea, parameter controls, and Island CTA.

- [ ] **Step 1: Write the failing test for `CommandDock`**

```typescript
// web/src/components/chat/CommandDock.test.tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandDock } from './CommandDock';

describe('CommandDock (Floating Island Input)', () => {
  it('renders textarea, parameter controls, and submit button', () => {
    const onSubmit = vi.fn();
    const onQueryChange = vi.fn();

    render(
      <CommandDock
        query="Test query"
        onQueryChange={onQueryChange}
        onSubmit={onSubmit}
        topK={3}
        onTopKChange={vi.fn()}
        guardrails={true}
        onGuardrailsChange={vi.fn()}
      />
    );

    const textarea = screen.getByPlaceholderText(/Ask Meridian RAG/i);
    expect((textarea as HTMLTextAreaElement).value).toBe('Test query');

    const submitBtn = screen.getByRole('button', { name: /Send|Submit/i });
    fireEvent.click(submitBtn);
    expect(onSubmit).toHaveBeenCalled();
  });

  it('triggers submit on Cmd+Enter / Ctrl+Enter', () => {
    const onSubmit = vi.fn();
    render(
      <CommandDock
        query="Quick command"
        onQueryChange={vi.fn()}
        onSubmit={onSubmit}
        topK={3}
        onTopKChange={vi.fn()}
        guardrails={true}
        onGuardrailsChange={vi.fn()}
      />
    );

    const textarea = screen.getByPlaceholderText(/Ask Meridian RAG/i);
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(onSubmit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/chat-interface/web && npx vitest run src/components/chat/CommandDock.test.tsx`  
Expected: FAIL with "Cannot find module './CommandDock'"

- [ ] **Step 3: Implement `CommandDock.tsx` via OpenCode**

Execute via OpenCode:
```bash
cd /home/hruthvik9487/work/llm/.worktrees/chat-interface && \
opencode run --auto --model opencode/deepseek-v4.1-flash-free \
  "Create web/src/components/chat/CommandDock.tsx. It is a floating island dock using DoubleBezelCard styling. It features an auto-resizing textarea with placeholder 'Ask Meridian RAG (Cmd+Enter to send)...', keyboard listener for Cmd+Enter/Ctrl+Enter, a parameter strip with top_k selector (chips 3, 5, 8), a guardrails toggle switch with Shield icon, and an IslandButton for submit (or Stop button when isStreaming=true). Support focus delegation so focusing textarea lights up outer chassis with focus-machined-accent."
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd .worktrees/chat-interface/web && npx vitest run src/components/chat/CommandDock.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/hruthvik9487/work/llm/.worktrees/chat-interface && \
git add web/src/components/chat/CommandDock.tsx web/src/components/chat/CommandDock.test.tsx && \
git commit -m "feat(ui): add CommandDock floating island with Double-Bezel and parameter controls"
```

---

### Task 5: Full Test Suite Baseline & OpenCode Verification Gate

**Files:**
- Test all: `web/src/**/*.test.ts*`

- [ ] **Step 1: Run complete test suite in worktree**

Run: `cd .worktrees/chat-interface/web && npm test -- --run`  
Expected: PASS (All 18 original test suites + 4 new test suites, 0 failures)

- [ ] **Step 2: Run OpenCode code health & audit pass**

Execute via OpenCode:
```bash
cd /home/hruthvik9487/work/llm/.worktrees/chat-interface && \
opencode run --auto --model opencode/deepseek-v4.1-flash-free \
  "Run 'npm test -- --run' in web/ directory. Verify that all tests pass, check that there are no unused imports in web/src/components/chat/*, and verify that Tailwind classes follow Tenet 1 (depth without blur shadow) and Tenet 2 (sub-pixel hairlines)."
```

- [ ] **Step 3: Final Phase 1 Tag & Commit**

```bash
cd /home/hruthvik9487/work/llm/.worktrees/chat-interface && \
git status -s && \
git log -n 5 --oneline
```
