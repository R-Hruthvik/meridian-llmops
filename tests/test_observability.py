"""TDD Tests for Observability, OpenTelemetry Tracing, and Cost Economics."""

from services.rag_engine.observability.langfuse_client import (
    LangfuseTracer,
    LocalTracer,
    MeridianTracer,
    normalize_usage,
)


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


def test_langfuse_tracer_disabled_is_noop(monkeypatch):
    monkeypatch.setenv("LANGFUSE_ENABLED", "false")
    tracer = LangfuseTracer(enabled=False)
    with tracer.span("generate") as span:
        span.set_attribute("model", "local-model")
    assert tracer.exported == []


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
