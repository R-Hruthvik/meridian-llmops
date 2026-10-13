# 0022. Explicit Verification Modes and Results

**Status:** Accepted · **Date:** 2026-10-13 · **Plan decision:** D9

## Decision

Represent verification as a structured result with an explicit mode and status. Support `off`, deterministic `citations`, and optional real-judge `llm` modes. Do not expose a boolean `verified` that implies broader factual validation than was performed.

## Rationale

Citation checks and an LLM judge provide different evidence. Making the method and outcome explicit helps clients interpret the response without overstating certainty.

## Consequences and current state

The configured mode is in `packages/core/settings.py`; response schemas and graph handling are in `packages/core/models.py` and `services/rag_engine/agent/graph.py`. The citations mode validates citation structure, not general semantic entailment.

