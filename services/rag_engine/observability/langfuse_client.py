"""Local request telemetry and optional Langfuse export."""

from __future__ import annotations

import json
import logging
import math
import os
import time
import uuid
from collections import defaultdict, deque
from contextlib import AbstractContextManager, nullcontext
from contextvars import ContextVar, Token
from pathlib import Path
from typing import Any, Literal, Protocol, Self, cast

from services.ingestion.chunker import count_tokens

logger = logging.getLogger(__name__)
_active_trace: ContextVar[_TraceContext | None] = ContextVar("active_trace", default=None)


class Tracer(Protocol):
    """Small tracing interface used by the RAG pipeline."""

    def span(self, name: str, **attrs: Any) -> AbstractContextManager[Any]: ...

    def generation(self, name: str, **attrs: Any) -> AbstractContextManager[Any]: ...


class Span:
    def __init__(self, name: str, attributes: dict[str, Any] | None = None):
        self.name = name
        self.attributes = dict(attributes or {})
        self.start_time = time.perf_counter()
        self.duration_ms = 0.0
        self.error: str | None = None

    def set_attribute(self, key: str, value: Any) -> None:
        self.attributes[key] = value

    def __enter__(self) -> Self:
        return self

    def __exit__(self, exc_type, exc, traceback) -> Literal[False]:
        self.duration_ms = (time.perf_counter() - self.start_time) * 1000
        if exc is not None:
            self.error = type(exc).__name__
        return False

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "attributes": dict(self.attributes),
            "duration_ms": self.duration_ms,
            "error": self.error,
        }


def _pricing() -> dict[str, dict[str, float]]:
    path = Path(__file__).resolve().parents[3] / "config" / "pricing.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def normalize_usage(
    response: dict[str, Any], prompt: str, completion: str, model: str | None
) -> dict[str, Any]:
    """Normalize provider usage and estimate absent counts with the chunk token counter."""
    raw_usage = response.get("usage")
    usage = raw_usage if isinstance(raw_usage, dict) else {}
    raw_prompt_tokens = usage.get("prompt_tokens", usage.get("input_tokens"))
    raw_completion_tokens = usage.get("completion_tokens", usage.get("output_tokens"))
    has_provider_usage = (
        isinstance(raw_prompt_tokens, int)
        and not isinstance(raw_prompt_tokens, bool)
        and isinstance(raw_completion_tokens, int)
        and not isinstance(raw_completion_tokens, bool)
    )
    if has_provider_usage:
        prompt_tokens = cast(int, raw_prompt_tokens)
        completion_tokens = cast(int, raw_completion_tokens)
    else:
        prompt_tokens = count_tokens(prompt)
        completion_tokens = count_tokens(completion)
    estimated = not has_provider_usage
    price = _pricing().get(str(model)) if model else None
    cost = None
    if isinstance(price, dict):
        try:
            cost = (
                prompt_tokens * float(price["input_per_million"])
                + completion_tokens * float(price["output_per_million"])
            ) / 1_000_000
        except (KeyError, TypeError, ValueError):
            cost = None
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
        "estimated": estimated,
        "cost_usd": cost,
    }


class GenerationSpan(Span):
    def __init__(self, name: str, attributes: dict[str, Any] | None = None):
        attrs = {"model": "gpt-4o-mini", **(attributes or {})}
        super().__init__(name, attrs)
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.estimated = False
        self.cost_usd: float | None = None

    def set_tokens(
        self,
        prompt_tokens: int,
        completion_tokens: int,
        *,
        model: str | None = None,
        estimated: bool = False,
        cost_usd: float | None = None,
    ) -> None:
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.estimated = estimated
        model = model or self.attributes.get("model")
        if cost_usd is None and model is not None:
            price = _pricing().get(str(model))
            if isinstance(price, dict):
                cost_usd = (
                    prompt_tokens * float(price["input_per_million"])
                    + completion_tokens * float(price["output_per_million"])
                ) / 1_000_000
        self.cost_usd = cost_usd

    def to_dict(self) -> dict[str, Any]:
        return {
            **super().to_dict(),
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.prompt_tokens + self.completion_tokens,
            "estimated": self.estimated,
            "cost_usd": self.cost_usd,
        }


class _TraceContext:
    def __init__(self, tracer: LocalTracer, name: str, tenant_id: str, query: str | None = None):
        self.tracer = tracer
        self.name = name
        self.tenant_id = tenant_id
        self.query = query
        self.id = f"trace-{uuid.uuid4().hex[:12]}"
        self.start_time = time.perf_counter()
        self.spans: list[Span] = []
        self.generations: list[GenerationSpan] = []
        self._context_token: Token[_TraceContext | None] | None = None

    def span(self, name: str, **attrs: Any) -> AbstractContextManager[Span]:
        span = Span(name, attrs)
        self.spans.append(span)
        return _AttachedContext(self, span, generation=False, attach_on_exit=False)

    def generation(self, name: str, **attrs: Any) -> AbstractContextManager[GenerationSpan]:
        generation = GenerationSpan(name, attrs)
        self.generations.append(generation)
        return cast(
            AbstractContextManager[GenerationSpan],
            _AttachedContext(self, generation, generation=True, attach_on_exit=False),
        )

    def __enter__(self) -> Self:
        self._context_token = _active_trace.set(self)
        self._remote_context = self.tracer._observation_context(
            "span", self.name, {"tenant_id": self.tenant_id}
        )
        self._remote_observation = self._remote_context.__enter__()
        return self

    def __exit__(self, exc_type, exc, traceback) -> Literal[False]:
        latency = (time.perf_counter() - self.start_time) * 1000
        generations = [generation.to_dict() for generation in self.generations]
        data = {
            "id": self.id,
            "name": self.name,
            "tenant_id": self.tenant_id,
            "query": self.query,
            "duration_ms": latency,
            "error": type(exc).__name__ if exc is not None else None,
            "total_tokens": sum(item["total_tokens"] for item in generations),
            "cost_usd": _sum_costs(item["cost_usd"] for item in generations),
            "spans": [span.to_dict() for span in self.spans],
            "generations": generations,
        }
        if self._remote_observation is not None:
            _update_observation(
                self._remote_observation,
                level="ERROR" if exc is not None else "DEFAULT",
                output={"tokens": data["total_tokens"], "cost_usd": data["cost_usd"]},
            )
        if hasattr(self, "_remote_context"):
            _close_observation_context(self._remote_context, exc_type, exc, traceback)
        self.tracer._record_trace(data)
        if self._context_token is not None:
            _active_trace.reset(self._context_token)
        return False

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "tenant_id": self.tenant_id,
            "query": self.query,
            "duration_ms": (time.perf_counter() - self.start_time) * 1000,
            "total_tokens": sum(g.prompt_tokens + g.completion_tokens for g in self.generations),
            "estimated_cost_usd": _sum_costs(g.cost_usd for g in self.generations),
            "spans": [s.to_dict() for s in self.spans],
            "generations": [g.to_dict() for g in self.generations],
        }


def _sum_costs(values) -> float | None:
    known = [value for value in values if value is not None]
    return sum(known) if known else None


class LocalTracer:
    """In-process tracer with bounded trace and rolling latency storage."""

    def __init__(self, max_traces: int = 1000):
        self.traces: deque[dict[str, Any]] = deque(maxlen=max_traces)
        self._metrics: dict[str, dict[str, Any]] = defaultdict(
            lambda: {
                "request_count": 0,
                "error_count": 0,
                "latencies": deque(maxlen=max_traces),
                "total_tokens": 0,
                "estimated_tokens": 0,
                "total_cost_usd": 0.0,
                "unknown_cost_generations": 0,
            }
        )

    def trace(self, name: str, tenant_id: str = "default", query: str | None = None) -> _TraceContext:
        return _TraceContext(self, name, tenant_id, query)

    def _observation_context(self, as_type: str, name: str, attributes: dict[str, Any]):
        return nullcontext(None)

    def span(self, name: str, **attrs: Any) -> AbstractContextManager[Span]:
        return self._standalone_span(name, attrs, generation=False)

    def generation(self, name: str, **attrs: Any) -> AbstractContextManager[GenerationSpan]:
        return cast(
            AbstractContextManager[GenerationSpan],
            self._standalone_span(name, attrs, generation=True),
        )

    def _standalone_span(
        self, name: str, attrs: dict[str, Any], generation: bool
    ) -> AbstractContextManager[Span]:
        span = GenerationSpan(name, attrs) if generation else Span(name, attrs)
        trace = _active_trace.get()
        if trace is not None and trace.tracer is self:
            return _AttachedContext(trace, span, generation)
        return _RecordingContext(self, span, attrs.get("tenant_id", "default"))

    def _record_trace(self, data: dict[str, Any]) -> None:
        self.traces.append(data)
        metric = self._metrics[data["tenant_id"]]
        metric["request_count"] += 1
        metric["error_count"] += int(data["error"] is not None)
        metric["latencies"].append(data["duration_ms"])
        metric["total_tokens"] += data["total_tokens"]
        metric["estimated_tokens"] += sum(
            item["total_tokens"] for item in data["generations"] if item["estimated"]
        )
        metric["unknown_cost_generations"] += sum(
            item["cost_usd"] is None for item in data["generations"]
        )
        if data["cost_usd"] is not None:
            metric["total_cost_usd"] += data["cost_usd"]

    def _record_standalone(self, span: Span, tenant_id: str) -> None:
        self.traces.append({**span.to_dict(), "tenant_id": tenant_id})

    def get_tenant_metrics(self, tenant_id: str) -> dict[str, Any]:
        metric = self._metrics[tenant_id]
        latencies = sorted(metric["latencies"])
        request_traces = [
            trace for trace in self.traces
            if trace.get("tenant_id") == tenant_id and trace.get("query") is not None
        ]
        retrieval_latencies = sorted(
            sum(
                span["duration_ms"] for span in trace["spans"]
                if span["name"] in {"embed_query", "dense_search", "bm25_search", "fusion", "rerank"}
            )
            for trace in request_traces
            if any(
                span["name"] in {"embed_query", "dense_search", "bm25_search", "fusion", "rerank"}
                for span in trace["spans"]
            )
        )
        recent_requests = []
        for trace in reversed(request_traces[-20:]):
            timings: dict[str, float] = defaultdict(float)
            for span in [*trace["spans"], *trace["generations"]]:
                timings[span["name"]] += span["duration_ms"]
            recent_requests.append(
                {
                    "query": trace["query"],
                    "duration_ms": trace["duration_ms"],
                    "timings_ms": dict(timings),
                }
            )
        return {
            "tenant_id": tenant_id,
            "request_count": metric["request_count"],
            "total_requests": metric["request_count"],
            "error_count": metric["error_count"],
            "latency_ms": {
                "p50": _percentile(latencies, 0.50),
                "p95": _percentile(latencies, 0.95),
                "p99": _percentile(latencies, 0.99),
            },
            "retrieval_latency_ms": {
                "p50": _percentile(retrieval_latencies, 0.50),
                "p95": _percentile(retrieval_latencies, 0.95),
            },
            "recent_requests": recent_requests,
            "total_tokens": metric["total_tokens"],
            "estimated_tokens": metric["estimated_tokens"],
            "total_cost_usd": (
                None if metric["unknown_cost_generations"] else metric["total_cost_usd"]
            ),
            "total_cost": (
                None if metric["unknown_cost_generations"] else metric["total_cost_usd"]
            ),
        }


class _RecordingContext(AbstractContextManager[Span]):
    def __init__(self, tracer: LocalTracer, span: Span, tenant_id: str):
        self.tracer = tracer
        self.span = span
        self.tenant_id = tenant_id

    def __enter__(self) -> Span:
        self._remote_context = self.tracer._observation_context(
            "generation" if isinstance(self.span, GenerationSpan) else "span",
            self.span.name,
            self.span.attributes,
        )
        self._remote_observation = self._remote_context.__enter__()
        return self.span.__enter__()

    def __exit__(self, exc_type, exc, traceback) -> Literal[False]:
        result = self.span.__exit__(exc_type, exc, traceback)
        _finish_observation(
            self._remote_context, self._remote_observation, self.span, exc_type, exc, traceback
        )
        self.tracer._record_standalone(self.span, self.tenant_id)
        return result


class _AttachedContext(AbstractContextManager[Span]):
    def __init__(
        self, trace: _TraceContext, span: Span, generation: bool, attach_on_exit: bool = True
    ):
        self.trace = trace
        self.span = span
        self.generation = generation
        self.attach_on_exit = attach_on_exit

    def __getattr__(self, name: str) -> Any:
        return getattr(self.span, name)

    def __enter__(self) -> Span:
        self._remote_context = self.trace.tracer._observation_context(
            "generation" if self.generation else "span",
            self.span.name,
            {**self.span.attributes, "tenant_id": self.trace.tenant_id},
        )
        self._remote_observation = self._remote_context.__enter__()
        return self.span.__enter__()

    def __exit__(self, exc_type, exc, traceback) -> Literal[False]:
        result = self.span.__exit__(exc_type, exc, traceback)
        _finish_observation(
            self._remote_context, self._remote_observation, self.span, exc_type, exc, traceback
        )
        if self.attach_on_exit:
            target = self.trace.generations if self.generation else self.trace.spans
            target.append(self.span)  # type: ignore[arg-type]
        return result


def _finish_observation(remote_context, observation, span: Span, exc_type, exc, traceback) -> None:
    if observation is not None:
        metadata = {**span.attributes, "duration_ms": span.duration_ms}
        if isinstance(span, GenerationSpan):
            metadata.update(
                estimated=span.estimated,
                cost_usd=span.cost_usd,
            )
            _update_observation(
                observation,
                level="ERROR" if exc is not None else "DEFAULT",
                model=span.attributes.get("model"),
                usage_details={
                    "input": span.prompt_tokens,
                    "output": span.completion_tokens,
                },
                cost_details=(
                    {"total": span.cost_usd} if span.cost_usd is not None else None
                ),
                metadata=metadata,
            )
        else:
            _update_observation(
                observation,
                level="ERROR" if exc is not None else "DEFAULT",
                metadata=metadata,
            )
    _close_observation_context(remote_context, exc_type, exc, traceback)


def _update_observation(observation, **attributes: Any) -> None:
    try:
        observation.update(**attributes)
    except Exception as error:  # noqa: BLE001 - SDK failures must never affect requests
        logger.warning("Langfuse observation update failed (%s)", type(error).__name__)


def _close_observation_context(remote_context, exc_type, exc, traceback) -> None:
    try:
        remote_context.__exit__(exc_type, exc, traceback)
    except Exception as error:  # noqa: BLE001 - SDK failures must never affect requests
        logger.warning("Langfuse observation close failed (%s)", type(error).__name__)


class _BestEffortObservationContext(AbstractContextManager):
    def __init__(self, client, as_type: str, name: str, attributes: dict[str, Any]):
        self.client = client
        self.as_type = as_type
        self.name = name
        self.attributes = attributes
        self._manager = None

    def __enter__(self):
        kwargs = {
            "as_type": self.as_type,
            "name": self.name,
            "metadata": self.attributes,
        }
        if self.as_type == "generation" and self.attributes.get("model"):
            kwargs["model"] = self.attributes["model"]
        try:
            self._manager = self.client.start_as_current_observation(**kwargs)
            return self._manager.__enter__()
        except Exception as error:  # noqa: BLE001 - SDK failures must never affect requests
            self._manager = None
            logger.warning("Langfuse observation start failed (%s)", type(error).__name__)
            return None

    def __exit__(self, exc_type, exc, traceback) -> Literal[False]:
        if self._manager is not None:
            try:
                self._manager.__exit__(exc_type, exc, traceback)
            except Exception as error:  # noqa: BLE001 - SDK failures must never affect requests
                logger.warning("Langfuse observation close failed (%s)", type(error).__name__)
        return False


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    index = max(0, min(len(values) - 1, math.ceil(len(values) * percentile) - 1))
    return values[index]


class LangfuseTracer(LocalTracer):
    """Local-first tracing with best-effort Langfuse export when configured."""

    def __init__(self, enabled: bool | None = None):
        super().__init__()
        setting_enabled = os.getenv("LANGFUSE_ENABLED", "").lower() == "true"
        public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
        secret_key = os.getenv("LANGFUSE_SECRET_KEY")
        self.enabled = (setting_enabled if enabled is None else enabled) and bool(public_key and secret_key)
        self._client = None
        if self.enabled:
            try:
                from langfuse import Langfuse

                self._client = Langfuse(
                    public_key=public_key,
                    secret_key=secret_key,
                    host=os.getenv("LANGFUSE_HOST", "http://localhost:3000"),
                )
            except Exception as error:  # noqa: BLE001 - remote tracing must never prevent startup
                logger.warning("Langfuse initialization failed; continuing with local tracing (%s)", type(error).__name__)
                self.enabled = False

    def _observation_context(self, as_type: str, name: str, attributes: dict[str, Any]):
        if not self.enabled or self._client is None:
            return nullcontext(None)
        return _BestEffortObservationContext(self._client, as_type, name, attributes)

    def _record_trace(self, data: dict[str, Any]) -> None:
        super()._record_trace(data)


class MeridianTracer(LocalTracer):
    """Compatibility name retained for existing application imports."""
