# Loop lessons (append-only, one line each)

- Verify artifact, not log: a passing build ≠ rendered page/real API data — screenshot or curl before commit.
- Don't let pipes swallow exit codes (`| head` hides failures); check `${PIPESTATUS}` or avoid pipe in gates.
- Bring the server up and wait before probing; connection-refused means nothing listening, not everything broken.
- One lever per tick; new findings go to levers.md, not mid-tick scope creep.
