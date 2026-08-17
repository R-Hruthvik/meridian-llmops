"""Output guardrails evaluating generated responses against safety and compliance policies."""

import re

from packages.core.models import GuardrailResult

PROHIBITED_PHRASES = [
    r"(?i)invest\s+all\s+your\s+money",
    r"(?i)high-yield\s+guarantee",
    r"(?i)guaranteed\s+returns",
    r"(?i)confidential\s+internal\s+secret",
    r"(?i)bypass\s+compliance",
]


class OutputGuardrails:
    """Evaluates and filters model outputs to ensure policy and safety compliance."""

    def __init__(self):
        self.prohibited_regexes = [re.compile(p) for p in PROHIBITED_PHRASES]

    def evaluate(self, text: str) -> GuardrailResult:
        violations: list[str] = []
        sanitized = text

        for regex in self.prohibited_regexes:
            if regex.search(sanitized):
                violations.append(f"Policy violation: Prohibited phrase matching '{regex.pattern}'")

        if violations:
            # Block or redact the prohibited policy content
            return GuardrailResult(
                allowed=False,
                sanitized_text="[CONTENT_REMOVED_DUE_TO_COMPLIANCE_POLICY]",
                policy_violations=violations,
                action_taken="blocked",
            )

        return GuardrailResult(
            allowed=True,
            sanitized_text=sanitized,
            policy_violations=[],
            action_taken="pass",
        )
