# 0008. Bounded Agent Attempts with Safe Refusal Fallback

**Status:** Accepted · **Date:** 2026-08-17

The agent has a finite attempt limit and returns a safe refusal when it cannot produce a supported answer. `max_cycles` names the total attempt limit, not a count of reformulations.

**Current state (verified 2026-10-13):** The default is two total attempts and the configured range is one to four. The exact cap is in `packages/core/settings.py`; response generation and retry behavior are in `services/rag_engine/agent/graph.py`.
