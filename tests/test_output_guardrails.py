"""TDD Tests for Output Guardrails, Schema Compliance, and Policy Enforcement."""

from pydantic import BaseModel, Field

from services.gateway.guardrails.output_rails import OutputGuardrails
from services.gateway.guardrails.schema_validator import SchemaValidator


class TargetSchema(BaseModel):
    summary: str = Field(...)
    confidence: float = Field(...)
    recommendation: str = Field(...)


def test_output_guardrails_clean_response():
    rails = OutputGuardrails()
    response_text = "The system uses Qdrant for vector embeddings and Neo4j for graphs."
    result = rails.evaluate(response_text)

    assert result.allowed is True
    assert result.action_taken == "pass"
    assert len(result.policy_violations) == 0


def test_output_guardrails_prohibited_terms_and_toxicity():
    rails = OutputGuardrails()
    # Response containing prohibited policy terms or unverified external advice
    response_text = "You should invest all your money immediately in crypto high-yield guarantee."
    result = rails.evaluate(response_text)

    assert result.allowed is False or result.action_taken == "redacted"
    assert len(result.policy_violations) > 0


def test_schema_validator_valid_json():
    validator = SchemaValidator()
    valid_json_str = '{"summary": "Arch overview", "confidence": 0.95, "recommendation": "Deploy Qdrant"}'
    parsed, valid = validator.validate_and_repair(valid_json_str, TargetSchema)

    assert valid is True
    assert parsed["summary"] == "Arch overview"
    assert parsed["confidence"] == 0.95


def test_schema_validator_markdown_fence_repair():
    validator = SchemaValidator()
    markdown_wrapped_json = """```json
    {
        "summary": "Repaired JSON",
        "confidence": 0.88,
        "recommendation": "Use LangGraph"
    }
    ```"""
    parsed, valid = validator.validate_and_repair(markdown_wrapped_json, TargetSchema)

    assert valid is True
    assert parsed["summary"] == "Repaired JSON"
