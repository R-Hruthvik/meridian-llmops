"""Input guardrails for prompt injection, jailbreaks, and PII protection."""

import re

from packages.core.models import GuardrailResult

INJECTION_PATTERNS = [
    r"(?i)ignore\s+(all\s+)?(previous|prior|above)\s+instructions",
    r"(?i)reveal\s+(your\s+)?(system\s+prompt|hidden\s+instructions|secret)",
    r"(?i)disregard\s+(all\s+)?rules",
    r"(?i)you\s+are\s+now\s+in\s+developer\s+mode",
    r"(?i)dan\s+mode\s+enabled",
    r"(?i)bypass\s+safety\s+filters",
]

EMAIL_PATTERN = r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+"
SSN_PATTERN = r"\b\d{3}-\d{2}-\d{4}\b"
CREDIT_CARD_PATTERN = r"\b(?:\d{4}[-\s]?){3}\d{4}\b"
API_KEY_PATTERN = r"\b(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,})\b"


class InputGuardrails:
    """Evaluates user input for injection attempts and applies PII masking."""

    def __init__(self):
        self.injection_regexes = [re.compile(p) for p in INJECTION_PATTERNS]

    def detect_prompt_injection(self, text: str) -> tuple[bool, list[str]]:
        violations = []
        for regex in self.injection_regexes:
            if regex.search(text):
                violations.append(f"Prompt injection pattern match: {regex.pattern}")
        return (len(violations) > 0, violations)

    def mask_pii(self, text: str) -> tuple[str, list[str]]:
        violations = []
        sanitized = text

        if re.search(EMAIL_PATTERN, sanitized):
            sanitized = re.sub(EMAIL_PATTERN, "[EMAIL_REDACTED]", sanitized)
            violations.append("PII: Email detected and redacted")

        if re.search(SSN_PATTERN, sanitized):
            sanitized = re.sub(SSN_PATTERN, "[SSN_REDACTED]", sanitized)
            violations.append("PII: SSN detected and redacted")

        if re.search(CREDIT_CARD_PATTERN, sanitized):
            sanitized = re.sub(CREDIT_CARD_PATTERN, "[CREDIT_CARD_REDACTED]", sanitized)
            violations.append("PII: Credit Card detected and redacted")

        if re.search(API_KEY_PATTERN, sanitized):
            sanitized = re.sub(API_KEY_PATTERN, "[SECRET_KEY_REDACTED]", sanitized)
            violations.append("Security: API Key detected and redacted")

        return sanitized, violations

    def evaluate(self, text: str) -> GuardrailResult:
        is_injection, injection_violations = self.detect_prompt_injection(text)
        if is_injection:
            return GuardrailResult(
                allowed=False,
                sanitized_text="",
                policy_violations=injection_violations,
                action_taken="blocked",
            )

        sanitized, pii_violations = self.mask_pii(text)
        return GuardrailResult(
            allowed=True,
            sanitized_text=sanitized,
            policy_violations=pii_violations,
            action_taken="redacted" if pii_violations else "pass",
        )
