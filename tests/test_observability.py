"""TDD Tests for Observability, OpenTelemetry Tracing, and Cost Economics."""

from services.rag_engine.observability.langfuse_client import MeridianTracer


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
