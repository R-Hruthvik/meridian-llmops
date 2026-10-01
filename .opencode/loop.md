# Continuous Improvement Loop — Meridian LLMOps

> Start: `opencode run --dir /home/hruthvik9487/work/llm --title "loop-<n>" --auto "Read .opencode/loop.md and improve this project. Work on BRANCH=loop/<name>-<date>, keep committing and pushing, keep going until I stop you."`
> No time limit. No deadline. One round is one improvement: audited, fixed, verified, committed, pushed. Then the next round.

## 0. Mission

Improve this project. Not a specific file, not a specific feature — find the highest-value thing wrong, fix it properly, then find the next. The frontend is the surface the owner judges the product by, so weight it heavily, but take any real improvement anywhere: backend correctness, performance, types, tests, docs, observability, dead code, confusing copy, a11y, flaky gates.

**Use every capability you have.** The point of this loop is to spend your full toolset on the work:

- **Skills — invoke them, don't just list them.** `impeccable` (audit / typeset / colorize / layout / polish / distill / harden / adapt), `hallmark`, `ui-ux-pro-max` + `design-system` + `ui-styling` + `design` + `brand`, `frontend-design`, `theme-factory`, `redesign-existing-projects`, `design-taste-frontend`, `high-end-visual-design`, `minimalist-ui`, `image-to-code`, `imagegen-frontend-web`, plus superpowers (`brainstorming`, `writing-plans`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `finishing-a-development-branch`). If a change touches UI, a skill that governs UI quality is mandatory before that commit — not optional.
- **Browser-harness — use it extensively and treat it as evidence.** Research patterns and real design references, study competitor products, audit every surface you touch, screenshot before and after, `start_recording` / `stop_recording` for flows, verify the artifact actually renders. Research credible articles, docs, and product sites — never low-star repos as design authority.
- **Codebase-memory graph** — `search_graph`, `trace_path`, `detect_changes`, `check_index_coverage` for callers, blast radius, dead code, and hot paths before you edit.
- **Subagents** — parallel exploration, review, and verification (`task`) for genuinely independent work only.
- **websearch / webfetch** — current docs, techniques, prior art.

## 1. Seed lists are not scope

`DIRECTION.md`, `README.md` gaps, and `docs/superpowers/loops/backlog.md` are **hints only**. Fix them when you hit them; they never define or limit your work. Keep finding improvements yourself — from the graph, from the browser, from reading the code with fresh eyes, from what the owner has said about how the product feels.

Closing a list item while moving nothing measurable is a failure. Fixing something that was on no list and making the product clearly better is a success.

## 2. Standard of done (every round, all of it, before commit)

1. **Reproduced first** — a failing test, a defect measurement, or a screenshot proving the gap existed before your edit.
2. **Tests green** for the touched slice; `ruff check` clean; `mypy` clean where the project runs it; no new ignores or `any` escapes.
3. **Artifact verified, not the log** — the page renders (screenshot), the API returns real data, the CLI prints the right thing. A green build is not proof.
4. **Design gate (mandatory for anything visual)** — defect scan (`.opencode/skills/impeccable/scripts/impeccable detect web/src`) plus before/after screenshots at desktop and mobile widths, plus a contrast check on any color or typography token you touch. Fix findings in the area you changed before committing.
5. **Surgical diff** — minimal, matches existing style, touches only what the change needs, removes only orphans the change created. No drive-by refactors, no `git add -A`.
6. **Fresh-eyes review** — a subagent or checklist review of your own diff. Self-review in the context that wrote the code does not count as verification.

Failing the gate sends you back with the error and the original contract, bounded to 2 retries, then you pick a different improvement. Never `commit anyway`.

## 3. The round

One round, then the next:

**Orient → Audit → Choose → Reproduce → Improve → Verify → Review → Commit → Push → Record → Repeat**

- **Orient** — read `AGENTS.md`, `docs/superpowers/loops/lessons.md`, `git log --oneline -10`, `git status --short`. Resume from records, not memory.
- **Audit** — look before you leap. Graph blast radius, grep for duplication and dead code, read the surface in the browser, run the defect scanner. Gather several candidates, not one. Add the ones you didn't pick to the backlog with a one-line reason.
- **Choose** — highest-value candidate that fits the next chunk of time. Prefer real, measurable improvements that unblock other work.
- **Repeat** — close the todo list, re-read state, start the next round with fresh eyes. Memory lives in files and git history, never in the conversation.

Size a round to its work: small fix ~15 minutes, a real redesign spread across several rounds with each one shippable. The round is the unit of value; how many you do is up to the work.

## 4. Working agreement

- Work on `BRANCH` (`loop/<name>-<date>`). Never push to `main`. Stage only files you touched.
- One coherent commit per round, conventional message (`feat|fix|docs|test|refactor|perf(<scope>): …`), then `git push` immediately. Nothing valuable sits uncommitted.
- Open a PR once the branch is worth a human look; update it as you go. A round that lands and pushes is complete whether or not the PR is merged.
- Append to `docs/superpowers/loops/lessons.md` the moment you learn something hard (one line, factual). Append to `docs/superpowers/loops/progress.md` what you did, what it measured, what's next.
- Never leave the tree half-edited. If you must stop mid-change, `git stash` or `git checkout --` back to green, and note the resume point in the progress file.
- After a substantial change, ask the owner: **"What's your satisfaction score for this change, out of 10?"** Record it in `README.md` with the date, what shipped, and what gaps remain. Their answer decides what the next round prioritizes.
- If reality contradicts the task's premise, say so instead of forcing it.
