"""TDD Tests for Observability, OpenTelemetry Tracing, and Cost Economics."""

from contextlib import contextmanager
from datetime import datetime

from services.rag_engine.observability.langfuse_client import (
    LangfuseTracer,
    LocalTracer,
    MeridianTracer,
    Span,
    normalize_usage,
)


class _FakeObservation:
    def update(self, **_kwargs):
        pass

    def end(self):
        pass


class _FakeLangfuseClient:
    def __init__(self):
        self.observations = []
        self._parents = []

    @contextmanager
    def start_as_current_observation(self, *, as_type, name, **_kwargs):
        parent = self._parents[-1] if self._parents else None
        self.observations.append((name, parent, as_type))
        self._parents.append(name)
        try:
            yield _FakeObservation()
        finally:
            self._parents.pop()

    def start_observation(self, *, as_type, name, **_kwargs):
        parent = self._parents[-1] if self._parents else None
        self.observations.append((name, parent, as_type))
        return _FakeObservation()


class _FailingLangfuseClient:
    def start_as_current_observation(self, **_kwargs):
        raise RuntimeError("export unavailable")


def test_tracer_span_creation_and_latency():
    tracer = MeridianTracer()
    with tracer.trace(name="test-rag-pipeline", tenant_id="tenant-123") as trace:
        with trace.span(name="hybrid-retrieval") as span:
            span.set_attribute("retrieved_count", 5)
            span.set_attribute("method", "hybrid_rrf")

        with trace.generation(name="generator-llm", model="gpt-4o-mini") as gen:
            gen.set_tokens(prompt_tokens=40, completion_tokens=20)

    trace_data = trace.to_dict()
    assert trace_data["name"] == "test-rag-pipeline"
    assert trace_data["tenant_id"] == "tenant-123"
    assert len(trace_data["spans"]) == 1
    assert len(trace_data["generations"]) == 1
    assert trace_data["total_tokens"] == 60
    assert trace_data["estimated_cost_usd"] > 0.0


def test_metrics_aggregation():
    tracer = MeridianTracer()
    for i in range(3):
        with tracer.trace(name=f"query-{i}", tenant_id="tenant-abc") as trace:
            gen = trace.generation(name="llm", model="gpt-4o-mini")
            gen.set_tokens(prompt_tokens=100, completion_tokens=50)

    metrics = tracer.get_tenant_metrics("tenant-abc")
    assert metrics["total_requests"] == 3
    assert metrics["total_tokens"] == 450
    assert metrics["total_cost_usd"] > 0.0


def test_local_tracer_is_bounded_and_reports_per_tenant_request_metrics():
    tracer = LocalTracer(max_traces=2)
    for i in range(3):
        with tracer.trace(name=f"query-{i}", tenant_id="tenant-abc"):
            pass
    assert len(tracer.traces) == 2
    metrics = tracer.get_tenant_metrics("tenant-abc")
    assert metrics["request_count"] == 3
    assert metrics["error_count"] == 0
    assert metrics["latency_ms"]["p50"] >= 0


def test_recent_request_metrics_include_timestamp_and_outcome():
    tracer = LocalTracer()
    with tracer.trace(name="query", tenant_id="tenant-abc", query="sample question"):
        pass

    request = tracer.get_tenant_metrics("tenant-abc")["recent_requests"][0]
    assert datetime.fromisoformat(request["recorded_at"])
    assert request["error"] is False


def test_empty_latency_windows_return_null_percentiles():
    metrics = LocalTracer().get_tenant_metrics("tenant-empty")
    assert metrics["latency_ms"] == {"p50": None, "p95": None, "p99": None}
    assert metrics["retrieval_latency_ms"] == {"p50": None, "p95": None}


def test_local_tracer_counts_errors_and_usage_estimates():
    tracer = LocalTracer()
    try:
        with tracer.trace(name="failed-query", tenant_id="tenant-b") as trace:
            gen = trace.generation(name="generate", model="unknown-model")
            gen.set_tokens(3, 2, estimated=True)
            raise RuntimeError("provider failure")
    except RuntimeError:
        pass
    metrics = tracer.get_tenant_metrics("tenant-b")
    assert metrics["request_count"] == 1
    assert metrics["error_count"] == 1
    assert metrics["total_tokens"] == 5
    assert metrics["estimated_tokens"] == 5
    assert metrics["total_cost_usd"] is None


def test_tracer_span_accepts_attributes_as_context_manager():
    tracer = LocalTracer()
    with tracer.span("dense_search", tenant_id="tenant-a", result_count=2):
        pass
    assert tracer.traces[-1]["name"] == "dense_search"
    assert tracer.traces[-1]["attributes"]["result_count"] == 2


def test_standalone_spans_and_generations_join_active_request_trace():
    tracer = LangfuseTracer(enabled=False)
    tracer.enabled = True
    tracer._client = _FakeLangfuseClient()
    with tracer.trace("rag-query-pipeline", tenant_id="tenant-a", query="Where is the office?"):
        with tracer.span("dense_search", tenant_id="tenant-a") as span:
            span.set_attribute("result_count", 2)
        with tracer.generation("generate", model="test-model") as generation:
            generation.set_tokens(4, 2)

    assert len(tracer.traces) == 1
    trace = tracer.traces[0]
    assert trace["query"] == "Where is the office?"
    assert [item["name"] for item in trace["spans"]] == ["dense_search"]
    assert [item["name"] for item in trace["generations"]] == ["generate"]
    assert trace["total_tokens"] == 6
    assert tracer._client.observations == [
        ("rag-query-pipeline", None, "span"),
        ("dense_search", "rag-query-pipeline", "span"),
        ("generate", "rag-query-pipeline", "generation"),
    ]
    assert all("Where is the office?" not in repr(item) for item in tracer._client.observations)


def test_langfuse_export_failure_keeps_local_metrics():
    tracer = LangfuseTracer(enabled=False)
    tracer.enabled = True
    tracer._client = _FailingLangfuseClient()
    with tracer.trace("rag-query-pipeline", tenant_id="tenant-a", query="private query"):
        pass

    metrics = tracer.get_tenant_metrics("tenant-a")
    assert metrics["request_count"] == 1
    assert metrics["recent_requests"][0]["query"] == "private query"


def test_metrics_include_bounded_recent_queries_and_retrieval_span_percentiles(monkeypatch):
    def finish_with_test_duration(span, exc_type, exc, traceback):
        span.duration_ms = span.attributes["test_duration"]
        return False

    monkeypatch.setattr(Span, "__exit__", finish_with_test_duration)
    tracer = LocalTracer(max_traces=60)
    for index in range(25):
        with tracer.trace("rag-query-pipeline", tenant_id="tenant-a", query=f"query-{index}"):  # noqa: SIM117
            with tracer.span("dense_search", test_duration=index + 1):
                pass
        with tracer.trace("rag-query-pipeline", tenant_id="tenant-b", query="other tenant"):  # noqa: SIM117
            with tracer.span("dense_search", test_duration=100):
                pass

    metrics = tracer.get_tenant_metrics("tenant-a")
    assert metrics["retrieval_latency_ms"] == {"p50": 13, "p95": 24}
    assert len(metrics["recent_requests"]) == 20
    assert metrics["recent_requests"][0]["query"] == "query-24"
    assert metrics["recent_requests"][-1]["query"] == "query-5"
    assert metrics["recent_requests"][0]["timings_ms"] == {"dense_search": 25}


def test_langfuse_tracer_disabled_is_noop(monkeypatch):
    monkeypatch.setenv("LANGFUSE_ENABLED", "false")
    tracer = LangfuseTracer(enabled=False)
    with tracer.span("generate") as span:
        span.set_attribute("model", "local-model")
    assert len(tracer.traces) == 1


def test_provider_usage_is_used_and_missing_usage_is_estimated():
    usage = normalize_usage(
        {"usage": {"prompt_tokens": 10, "completion_tokens": 4}},
        prompt="hello there",
        completion="good morning",
        model="gpt-4o-mini",
    )
    assert usage["prompt_tokens"] == 10
    assert usage["completion_tokens"] == 4
    assert usage["estimated"] is False

    estimated = normalize_usage(
        {"usage": None},
        prompt="hello there",
        completion="good morning",
        model="unknown-model",
    )
    assert estimated["estimated"] is True
    assert estimated["prompt_tokens"] > 0
    assert estimated["completion_tokens"] > 0
    assert estimated["cost_usd"] is None
