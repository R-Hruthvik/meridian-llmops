# Loop lessons (append-only, one line each)

- Verify artifact, not log: a passing build ≠ rendered page/real API data — screenshot or curl before commit.
- Don't let pipes swallow exit codes (`| head` hides failures); check `${PIPESTATUS}` or avoid pipe in gates.
- Bring the server up and wait before probing; connection-refused means nothing listening, not everything broken.
- One lever per tick; new findings go to levers.md, not mid-tick scope creep.
- A "lazy" DOM mount is not a lazy bundle: check the built chunk list, not just that inactive studios never fetched.
- Rendering a closed lazy component still downloads its chunk — mount on demand, not `isOpen={false}`.
- browser-harness: clicks and screenshots silently no-op on a background tab; `activate_tab(<targetId>)` first, and `Page.captureScreenshot` needs `fromSurface: False` when the window is occluded.
- The AX accessible name of a `label-section` button is its *rendered* text, so it is UPPERCASE — match "METRICS", not "Metrics".
- Test a perf invariant by snapshotting which modules the import graph evaluated before first render (`vi.hoisted` counter); a `beforeEach` reset hides the very thing you are measuring.
- An optional header on the backend becomes a silent data substitution in the UI: a blank tenant field read the default tenant. Validate at the field, keep the last valid value.
- A failed dynamic import with no error boundary unmounts the whole React tree — check the boundary exists before shipping a code split.
- `<header>` inside a dialog still maps to the `banner` landmark; use a div for overlay title bars.
- A control styled like a status chip reads as a readout: "Guardrails Active" was a checkbox that only shapes the next query.
- Check `${PIPESTATUS}`/exit codes on gates — piping `tsc -b` into `tail` hid a real type error behind a green `tsc_exit=0`.
- browser-harness: to clear a controlled input, focus it, Ctrl+A, then `Input.insertText` with an empty string; setting `.value` + an input event does not reach React state.
