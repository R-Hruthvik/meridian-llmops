# Continuous Improvement Loop — Meridian LLMOps

> Run: `opencode run --dir <repo> --title "loop-<n>-2h" --auto "Read .opencode/loop.md and execute DEADLINE=<epoch> BRANCH=loop/<name>-<YYYY-MM-DD>."`
> Cold-boot fast path: `opencode serve --port 4096 &` then `opencode run --attach http://localhost:4096 --dir <repo> "Read .opencode/loop.md and execute DEADLINE=<epoch> BRANCH=..."`

## 0. Mission

Improve this project. Not a specific file, not a specific feature — find the highest-value thing wrong and fix it, then find the next. The frontend is the surface the owner judges the product by, so weight it heavily, but take any improvement you find anywhere in the codebase: backend correctness, performance, types, tests, docs, observability, dead code, confusing copy, a11y, flaky gates.

**Use every capability you have.** This loop exists to spend your full toolset on the work:

- **Skills — invoke them, don't just list them.** `impeccable` (audit / typeset / colorize / layout / polish / distill / harden / adapt), `hallmark`, `ui-ux-pro-max` + `design-system` + `ui-styling` + `design` + `brand`, `frontend-design`, `theme-factory`, `redesign-existing-projects`, `design-taste-frontend`, `high-end-visual-design`, `minimalist-ui`, `image-to-code`, `imagegen-frontend-web`, and the superpowers set (`brainstorming`, `writing-plans`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `finishing-a-development-branch`). If a change touches UI, a skill that governs UI quality is mandatory before the commit — not optional.
- **Browser-harness — use it extensively and treat it as evidence.** Research patterns, study competitor products and real design references, audit every surface you touch, screenshot before and after, `start_recording` / `stop_recording` for flows, verify the artifact actually renders. Research credible articles, docs, and product sites — never low-star repos as design authority.
- **Codebase-memory graph** — `search_graph`, `trace_path`, `detect_changes`, `check_index_coverage` to find callers, blast radius, dead code, and hot paths before you edit.
- **Subagents** — parallel exploration, review, and verification (`task`) for genuinely independent work only.
- **websearch / webfetch** — current docs, techniques, and prior art.

## 1. Seed lists are not scope

`DIRECTION.md`, `README.md` gaps, and `docs/superpowers/loops/*-levers.md` are **hints only**. Fix them when you hit them; they never define or limit your work. You are expected to keep finding improvements on your own — from the graph, from the browser, from reading the code with fresh eyes, from what the owner has said about how the product feels.

A change that closes nothing on a list but makes the product measurably better is a success. A change that closes a list item and moves nothing is a failure.

## 2. Standard of done (every round)

Non-negotiable, all of it, before a commit:

1. **Reproduced first** — a failing test, a defect measurement, or a screenshot that proves the gap existed before your edit.
2. **Tests green** for the touched slice; `ruff check` clean; `mypy` clean where the project runs it; no new ignores or `any` escapes.
3. **Artifact verified, not the log** — the page renders (screenshot), the API returns real data, the CLI prints the right thing. A green build is not proof.
4. **Design gate (mandatory for anything visual)** — an anti-pattern/defect scan (e.g. `.opencode/skills/impeccable/scripts/impeccable detect web/src`) plus before/after screenshots at desktop and mobile widths, plus a contrast check on any color/typography token you touch. If a scan reports findings in the area you changed, fix them before committing.
5. **Surgical diff** — minimal, matches existing style, touches only what the change needs, removes only orphans the change created. No drive-by refactors, no `git add -A`.
6. **Fresh-eyes review** — a subagent or checklist review of your own diff before commit. Self-review in the same context that wrote the code does not count as verification.

Failing the gate sends you back with the error and the original contract, bounded retries (2), then you pick a different improvement. Never `commit anyway`.

## 3. Round cycle — this is the loop

Each round is one complete pass, and then the loop restarts:

**Orient → Audit → Choose → Reproduce → Improve → Verify (gates) → Review → Commit → Push → Record → Restart**

- **Orient** — read repo `AGENTS.md`, `docs/superpowers/loops/lessons.md`, `git log --oneline -10`, `git status --short`. Resume from records, not from memory.
- **Audit** — look before you leap. Graph blast radius, `grep` for duplication and dead code, read the surface in the browser, run the defect scanner. Gather several candidates, not one.
- **Choose** — pick the highest-value candidate that fits the remaining time. Prefer improvements that are real, measurable, and unblock other work.
- **Restart** — close your todo list, re-read state, and begin the next round with a fresh look. Memory lives in the files and the git history, never in the conversation.

The loop is the cycle, not the duration. One round can be 15 minutes or 60; how many rounds fit in the block is up to the work. Stopping is always allowed — a finished round is a stopping point.

## 4. Time, deadline, and clean landing

- At launch record `DEADLINE` (epoch seconds, launch + 7200). Every round: `NOW=$(date +%s); REMAIN=$((DEADLINE-NOW))`.
- Rounds are sized to fit: an audit + improvement + full gate should fit in ~20–30 minutes. Larger ambitions get split into rounds that each end shippable.
- **Final 15 minutes (`REMAIN < 900`) is landing time, not new work.** Stop starting anything large. Finish the current change to a shippable boundary (all gates green). If that boundary can't be reached in the remaining time, revert cleanly to the last good state — `git checkout --` the files you were editing, or `git stash` — so the repository is never left half-edited.
- Land it: `git push -u origin $BRANCH`, `gh pr create` (or update the open PR) with what changed, the evidence (test counts, scans, screenshots), and a resume line so the next run picks up exactly where this one stopped.

## 5. Working agreement

- Work on `BRANCH` (`loop/<name>-<date>`). Never push to `main`. Stage only files you touched.
- One coherent commit per round, conventional message (`feat|fix|docs|test|refactor|perf(<scope>): …`). Small, revertable, readable history.
- Append to `docs/superpowers/loops/lessons.md` the moment you learn something hard (one line, factual), and to the progress journal what you did, what it measured, and what's next.
- When you finish a substantial change, ask the owner: **"What's your satisfaction score for this change, out of 10?"** Record the answer in `README.md` with the date, what shipped, and what gaps remain. Their answer decides what the next round prioritizes — take it seriously in either direction.
- If reality contradicts the task's premise, say so instead of forcing it.
