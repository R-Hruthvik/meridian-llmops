# Continuous Improvement Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship `.opencode/loop.md` + per-part backlogs enabling 2h deadline-aware improvement blocks.

**Architecture:** Single orchestrator file + file-based state (levers/progress/lessons) + unskippable gates + branch/PR delivery.

**Tech Stack:** opencode `run` one-shots, `browser-harness`, `gh` CLI, `pytest`/`ruff`/`mypy`.

**Spec:** `.opencode/loop.md` (this repo).

## Global Constraints

- Branch-only, never push to main; stage only tick-touched files.
- SEED IS NOT SCOPE — every tick adds fresh senior-expert findings.
- Credible websites/docs only for research; no low-star repos as authority.
- After each PR ask owner satisfaction score 1–10 and record in README.md.

---

### Task 1: Setup verification (done)

- [x] Branch `loop/continuous-improvement-setup-2026-10-01`, dirs `docs/superpowers/loops/`.

### Task 2: Run first 2h block (next)

Files: read `.opencode/loop.md`, `docs/superpowers/loops/web-levers.md`.

- [ ] Run: `opencode run --dir /home/hruthvik9487/work/llm --title "loop-web-2h" --auto "Read .opencode/loop.md and execute PART=web DEADLINE=$(( $(date +%s) + 7200 )) BRANCH=loop/web-$(date +%F)."`
- [ ] Verify: ticks committed, branch pushed, PR opened with tests + screenshots, progress/lessons updated.
- [ ] Expected: PR green, resume line present.
