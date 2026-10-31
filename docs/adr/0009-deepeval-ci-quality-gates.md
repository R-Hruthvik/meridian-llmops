# 0009. Automated DeepEval CI Quality Thresholds

**Status:** Accepted (drifted) · **Date:** 2026-08-17

We established baseline DeepEval threshold assertions in GitHub Actions CI pipelines: Faithfulness >= 0.90 (maximum allowable hallucination rate of 10%), Answer Relevancy >= 0.80, and Context Recall >= 0.75. Pull requests that regress below these thresholds on the Golden Dataset are automatically blocked from merging.

## Current Status

**Current state (verified 2026-10-13):** Pull-request CI runs offline tests and the thresholded 50-case retrieval evaluation; it does not make real-model DeepEval calls. `evals/eval_generation.py` provides optional real-model faithfulness, answer-relevancy, and contextual-recall metrics via a scheduled or opted-in workflow when credentials are configured. See [ADR-0020](0020-hybrid-retrieval-and-optional-reranking.md) for current retrieval design.
