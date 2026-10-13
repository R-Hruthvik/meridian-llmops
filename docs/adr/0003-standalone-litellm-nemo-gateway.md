# 0003. Standalone LiteLLM Proxy and In-Process Guardrails

**Status:** Accepted (drifted) · **Date:** 2026-08-17

The deployment runs LiteLLM Proxy as a standalone service. Guardrail checks run in the FastAPI application as rule-based regular expressions for known injection and prohibited phrase patterns, plus PII masking. They are not an independent service or a complete security perimeter.

**Current state (verified 2026-10-13):** LiteLLM Proxy is available under the optional `gateway`/`app` Compose profiles; default Compose starts only Qdrant. The application also supports direct provider configuration. Guardrails are in-process rule checks; no NeMo Guardrails or Colang runtime is present.
