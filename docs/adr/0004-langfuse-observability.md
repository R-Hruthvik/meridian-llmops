# 0004. Langfuse for OpenTelemetry-Native Observability and Cost Tracking

**Status:** Accepted (drifted) · **Date:** 2026-08-17

We selected Langfuse (Open-Source / Self-Hosted) as the primary observability, tracing, and token cost tracking platform. It integrates natively with OpenTelemetry, FastAPI, and LangGraph, offering trace visualization, user session tracking, and prompt management without vendor lock-in.

## Current Status

**Current state (verified 2026-10-13):** The optional Langfuse SDK exporter is implemented and disabled by default; export requires `LANGFUSE_ENABLED=true` and both keys. A bounded in-process tracer and per-tenant rolling metrics remain available locally and reset on restart. The optional Langfuse Compose profile is separate from the default Qdrant service.
