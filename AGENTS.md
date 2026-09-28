## # AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Owner satisfaction score — ask after every major change

The project owner rates how the product actually **feels to use**, on a 1-10
scale. The score is recorded in `README.md` under "Owner Satisfaction Score".

**Current score: 2 / 10** (recorded 2026-09-28, after the three-area
restructure and the backend contract fixes).

### The rule

**After every major change, stop and ask the owner for their score.** Do not
self-assess, do not infer it from test counts or commit volume, and do not
proceed to the next major change without asking.

A major change means any of:

- a new area, tab, studio, or significant navigation restructure
- a visible redesign, restyle, or layout change
- a new user-facing capability of consequence (a new tool, panel, or workflow)
- a change to what the owner sees on first load

### How to ask

Ask once the change is **verified working** (tests green and, for UI work,
confirmed in a real browser), then ask plainly:

> What's your satisfaction score for this change, out of 10?

Record the number, and update `README.md` with:

- the new score and date
- what was delivered at the time
- the known gaps that remain, in the owner's terms where they gave them

### Why this matters here

Test counts and passing suites are not satisfaction. At the 2/10 mark the
backend was correct, the bugs were fixed, and the test suites were green — the
product still felt unsatisfying, because the work had been mostly *plumbing*
while the *experience* stayed a generic purple-gradient template. A green
suite proved the code did what the code was written to do; it said nothing
about whether the result was any good to use.

Treat a low score as a real signal about **direction**, not a request for more
features. The owner's words after the 2/10: "the UI/UX and the whole app feels
weird and unsatisfied." The next response to that is design work, not another
endpoint.

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Professional status labels mapped without automated/agent mentions (`needs-triage`, `needs-info`, `ready-for-dev`, `needs-review`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repository layout (`CONTEXT.md` and `docs/adr/` at repo root). See `docs/agents/domain.md`.
