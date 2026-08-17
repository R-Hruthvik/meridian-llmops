"""Langfuse and OpenTelemetry Tracer wrapper for LLMOps Telemetry."""

import time
import uuid
from collections import defaultdict
from typing import Any, Optional

from packages.core.config import get_settings


class GenerationSpan:
    """Represents an LLM generation call with token counts and pricing."""

    def __init__(self, name: str, model: str = "gpt-4o-mini"):
        self.name = name
        self.model = model
        self.start_time = time.time()
        self.end_time: float | None = None
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.cost_usd = 0.0

    def set_tokens(self, prompt_tokens: int, completion_tokens: int):
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        # Pricing estimation (e.g. gpt-4o-mini: $0.15 / 1M input, $0.60 / 1M output)
        self.cost_usd = (prompt_tokens * 0.00000015) + (completion_tokens * 0.00000060)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.end_time = time.time()

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "model": self.model,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.prompt_tokens + self.completion_tokens,
            "cost_usd": self.cost_usd,
            "duration_ms": ((self.end_time or time.time()) - self.start_time) * 1000,
        }


class Span:
    """Represents a discrete pipeline step (retrieval, guardrail, rerank, etc.)."""

    def __init__(self, name: str):
        self.name = name
        self.start_time = time.time()
        self.end_time: float | None = None
        self.attributes: dict[str, Any] = {}

    def set_attribute(self, key: str, value: Any):
        self.attributes[key] = value

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.end_time = time.time()

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "attributes": self.attributes,
            "duration_ms": ((self.end_time or time.time()) - self.start_time) * 1000,
        }


class TraceContext:
    """Encapsulates a single end-to-end execution trace."""

    def __init__(self, name: str, tenant_id: str, tracer: Optional["MeridianTracer"] = None):
        self.id = f"trace-{uuid.uuid4().hex[:12]}"
        self.name = name
        self.tenant_id = tenant_id
        self.start_time = time.time()
        self.end_time: float | None = None
        self.spans: list[Span] = []
        self.generations: list[GenerationSpan] = []
        self.tracer = tracer

    def span(self, name: str) -> Span:
        s = Span(name)
        self.spans.append(s)
        return s

    def generation(self, name: str, model: str = "gpt-4o-mini") -> GenerationSpan:
        g = GenerationSpan(name, model=model)
        self.generations.append(g)
        return g

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.end_time = time.time()
        if self.tracer:
            self.tracer.record_trace(self)

    def to_dict(self) -> dict[str, Any]:
        total_tokens = sum(g.prompt_tokens + g.completion_tokens for g in self.generations)
        total_cost = sum(g.cost_usd for g in self.generations)
        return {
            "id": self.id,
            "name": self.name,
            "tenant_id": self.tenant_id,
            "duration_ms": ((self.end_time or time.time()) - self.start_time) * 1000,
            "total_tokens": total_tokens,
            "estimated_cost_usd": total_cost,
            "spans": [s.to_dict() for s in self.spans],
            "generations": [g.to_dict() for g in self.generations],
        }


class MeridianTracer:
    """Singleton-ready OpenTelemetry and Langfuse tracer manager."""

    def __init__(self):
        self.settings = get_settings()
        self._traces: list[dict[str, Any]] = []
        self._tenant_usage: dict[str, dict[str, Any]] = defaultdict(
            lambda: {"requests": 0, "tokens": 0, "cost_usd": 0.0}
        )

    def trace(self, name: str, tenant_id: str = "default") -> TraceContext:
        ctx = TraceContext(name=name, tenant_id=tenant_id, tracer=self)
        return ctx

    def record_trace(self, trace_context: TraceContext):
        data = trace_context.to_dict()
        self._traces.append(data)
        tenant = trace_context.tenant_id
        self._tenant_usage[tenant]["requests"] += 1
        self._tenant_usage[tenant]["tokens"] += data["total_tokens"]
        self._tenant_usage[tenant]["cost_usd"] += data["estimated_cost_usd"]

    def get_tenant_metrics(self, tenant_id: str) -> dict[str, Any]:
        data = self._tenant_usage[tenant_id]
        return {
            "tenant_id": tenant_id,
            "total_requests": data["requests"],
            "total_tokens": data["tokens"],
            "total_cost_usd": data["cost_usd"],
        }
