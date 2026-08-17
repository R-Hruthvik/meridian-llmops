"""JSON Schema validator and automatic markdown/repair tool for structured outputs."""

import json
import re
from typing import Any

from pydantic import BaseModel, ValidationError


class SchemaValidator:
    """Validates and repairs LLM generated JSON strings against Pydantic models."""

    def clean_json_string(self, raw_text: str) -> str:
        # Strip markdown ```json ... ``` blocks
        text = raw_text.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        return text.strip()

    def validate_and_repair(
        self,
        raw_text: str,
        target_schema: type[BaseModel],
    ) -> tuple[dict[str, Any] | None, bool]:
        cleaned = self.clean_json_string(raw_text)

        try:
            parsed = json.loads(cleaned)
            # Validate with Pydantic schema
            validated = target_schema.model_validate(parsed)
            return validated.model_dump(), True
        except (json.JSONDecodeError, ValidationError):
            pass

        # Try heuristics: trailing commas removal
        try:
            repaired = re.sub(r",\s*([\]}])", r"\1", cleaned)
            parsed = json.loads(repaired)
            validated = target_schema.model_validate(parsed)
            return validated.model_dump(), True
        except (json.JSONDecodeError, ValidationError, TypeError, ValueError):
            return None, False
