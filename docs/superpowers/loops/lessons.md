# Lessons (append-only, one line each)

Hard-won rules. Write the moment you learn one, so no round repeats a past mistake.

- Verify the artifact, not the log: a green build is not proof the page renders or the API returns real data.
- Don't let pipes swallow the exit code — `cmd | tail` hides failures; check `${PIPESTATUS}` or avoid the pipe in gates.
- Bring a server up and wait for it before probing; connection-refused means nothing is listening, not that everything broke.
- One improvement per round; new findings go to the backlog, not into the current round's scope.
- Reproduce the gap before fixing it — a screenshot or failing test first, edit second.
- Self-review in the same context that wrote the code is not verification; get fresh eyes on the diff.
- Don't let one odd-looking match become a sitewide sweep; check intent first.
- A round that ships correct plumbing but no felt improvement is a miss — the owner scores the product, not the test count.
