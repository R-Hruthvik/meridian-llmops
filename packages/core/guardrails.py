"""Shared rule-based guardrail patterns used by query and ingestion paths."""

import re

INJECTION_PATTERNS = (
    r"(?i)ignore\s+(all\s+)?(previous|prior|above)\s+instructions",
    r"(?i)reveal\s+(your\s+)?(system\s+prompt|hidden\s+instructions|secret)",
    r"(?i)disregard\s+(all\s+)?rules",
    r"(?i)you\s+are\s+now\s+in\s+developer\s+mode",
    r"(?i)dan\s+mode\s+enabled",
    r"(?i)bypass\s+safety\s+filters",
)
_INJECTION_REGEXES = tuple(re.compile(pattern) for pattern in INJECTION_PATTERNS)


def has_possible_prompt_injection(text: str) -> bool:
    """Return whether text matches one of the known injection phrases."""
    return any(pattern.search(text) for pattern in _INJECTION_REGEXES)
