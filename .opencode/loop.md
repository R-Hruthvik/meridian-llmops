# Continuous Improvement Loop — Meridian LLMOps

> Invoke: `opencode run --dir <repo> --title "loop-<part>-2h" --auto "Read .opencode/loop.md and execute PART=<part> DEADLINE=<epoch> BRANCH=loop/<part>-<YYYY-MM-DD>."`
> One PART per 2h block. Valid PARTs: `gateway | ingestion | rag_engine | web | evals | ops-dx | core`.
> Cold-boot fast path: `opencode serve --port 4096 &` then `opencode run --attach http://localhost:4096 --dir <repo> "...same prompt..."`.

## 0. Inputs (set at launch, never invent)

- `PART` — the single part under improvement this block. Do not drift to other parts except to read interfaces.
- `DEADLINE` — epoch seconds (`date +%s` + 7200 at launch). Check every tick: `NOW=$(date +%s); REMAIN=$((DEADLINE-NOW))`.
- `BRANCH` — `loop/<part>-<date>`. All work goes here. Never push to `main`. Never `git add -A`; stage only files this tick touched.

## 1. Scope rule — SEED IS NOT SCOPE (strict)

`DIRECTION.md §5 (B1–B5)`, `README.md` known gaps, and `docs/superpowers/loops/<part>-levers.md` are **SEED issues only — fix them when you hit them, but they NEVER limit you.**

As a senior expert you MUST also improve like normal every tick: dead code, duplication, over-large files, N+1/over-fetch, stale counters, weak types, missing/weak tests, slow suites, confusing copy, a11y, docs drift, flaky gates, perf, observability gaps.

Each tick MUST contain: (a) at most one seed item if open, PLUS (b) 1–2 fresh senior-expert findings from your own `search_graph` / `trace_path` / browser probe. A tick that only closes a seed without fresh improvement — or ships no measurable gain — is a failed (worthless) tick: do not commit it, pick a deeper lever.

## 2. State files (memory lives here, not in chat)

- Backlog: `docs/superpowers/loops/<part>-levers.md` — ranked, `- [ ] OPEN` / `- [x] DONE + SHA`. Top-open wins. Add newly found work here instead of chasing it mid-tick.
- Journal: `docs/superpowers/loops/<part>-progress.txt` — append per tick: date, lever, SHA, tests, screenshots, `next: <file:line + intent>`.
- Learnings: `docs/superpowers/loops/lessons.md` + repo `AGENTS.md` — read both at tick start; append hard-won rules immediately when learned (keep entries one line, factual).
- Next run resumes from these files + `git log --oneline -5` + `git status --short`. Never assume chat memory survived.

## 3. 2h clock + graceful shutdown (deadline-aware)

- `T+0:00` setup: `git fetch origin`, `git checkout -B $BRANCH`, `browser-harness --doctor`, read levers + progress + lessons + `AGENTS.md`, `todowrite` fresh list.
- Ticks 20–30 min each until `REMAIN < 900`.
- Shutdown mode (`REMAIN < 900`, last ~15 min): stop pulling new levers. Finish the CURRENT atom only to its next shippable boundary (smallest test-green, `ruff` clean, artifact renders). If boundary is unreachable in buffer: revert to last green (`git stash` / `git checkout -- <files>`) — **never commit a broken/half-edited state.** Then push branch, create/update PR with evidence, update levers/progress/lessons with exact resume line, exit. Time-over never equals incomplete commit; it equals last complete subtask + handoff.

## 4. Tick procedure (every tick, in order)

1. **Check clock.** Compute REMAIN. If < 900 → shutdown (§3).
2. **Pick lever.** Top `- [ ] OPEN` from `<part>-levers.md`. Mark in-progress in `todowrite`.
3. **Impact.** `search_graph` the symbols, `trace_path` callers/callees (depth 2+), `check_index_coverage` on every cited path. Subdivide lever to a ≤25-min atom: exact `file:line`, exact test command, exact done-criteria.
4. **Reproduce first.** Failing test or browser screenshot proving the gap before editing (TDD / `systematic-debugging`).
5. **Implement surgically.** Minimal diff, match existing style, touch only what the atom needs. Clean up only orphans YOUR change created.
6. **Use all powers as needed:** codebase-memory graph, `grep`/`glob`, `skill` invocation (`systematic-debugging`, `test-driven-development`), `websearch`/`webfetch` for docs, `browser-harness` extensively (§5), `task` subagents for parallel exploration only (never duplicate work).
7. **Verify (unskippable checker).** Relevant `pytest` slice green, `ruff check <touched>`, `mypy` where applicable, artifact proof (API returns real data / page renders + screenshot, not log text). Fresh-context self-review (`requesting-code-review` checklist) before commit.
8. **Commit.** Conventional message (`feat|fix|docs|test(scope): ...`). One commit per tick.
9. **Record.** Mark lever DONE + SHA or requeue with error + contract, append `progress.txt`, append `lessons.md` if anything hard-won.
10. **Restart.** Close todos, `git log --oneline -3` + `git status --short` re-read, next tick reads files fresh.

Fail verification → feed error + original contract back, bounded 2 retries, then requeue lever + pick next. Never `commit anyway`.

## 5. Browser-harness — extensive, wherever needed

Default to the browser when: researching a pattern, red-teaming guardrails, proving a UI claim, or checking routing. Credible websites/docs/articles only — never low-star repos as authority.

- First nav is `new_tab(url)`, then `wait_for_load()`, then `page_info()`; find elements via AX tree (`Accessibility.getFullAXTree`), click via box-center + verify with `js()`; `start_recording(name)` before UI proof, `stop_recording()` after.
- Per-part minimums: `web` → screenshot every tick + recording for flows; `gateway` → live curl/openapi + browser route proof (B1 class); `Index/Storage` → live counts vs `/health`; `guardrails` → red-team strings live; `evals` → run-history/diff screenshots.
- `BH_RECORD=1` for flows the owner must see. Ask before leaving cloud browsers running; `stop_remote_daemon(name)` when done.

## 6. Safety + delivery

- Branch-only. Push: `git push -u origin $BRANCH`. PR per cycle: `gh pr create --title "loop(<part>): <what>" --body "tests: ... | screenshots: ... | resume: ..."`. Human merges.
- After each PR (major change per `AGENTS.md`): ask owner `What's your satisfaction score for this change, out of 10?` and record in `README.md` with date + what shipped + remaining gaps. Do not skip.
- Metrics per block (append to progress): ticks shipped, checker catch rate (fails caught pre-commit), rework (reverts), wall-clock per tick.
