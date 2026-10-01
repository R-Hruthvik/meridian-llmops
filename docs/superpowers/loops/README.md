# Continuous Improvement Loop

Four files, one job each:

| File | Job |
|---|---|
| `.opencode/loop.md` | The contract: mission, standard of done, the round, working agreement. |
| `docs/superpowers/loops/backlog.md` | Candidate improvements. Hints, never scope. |
| `docs/superpowers/loops/progress.md` | Per-round journal — what changed, evidence, what's next. |
| `docs/superpowers/loops/lessons.md` | Hard-won rules, appended as learned. |

## Run it

```bash
opencode run --dir /home/hruthvik9487/work/llm --title "loop-1" --auto "Read .opencode/loop.md and improve this project. Work on BRANCH=loop/work-$(date +%F), keep committing and pushing, keep going until I stop you."
```

Or attach to a running server to skip MCP cold-boot each time:

```bash
opencode serve --port 4096 &
opencode run --attach http://localhost:4096 --dir /home/hruthvik9487/work/llm "Read .opencode/loop.md and improve this project. Work on BRANCH=loop/work-$(date +%F)."
```

No time limit. It keeps improving, committing, and pushing until you stop it.
