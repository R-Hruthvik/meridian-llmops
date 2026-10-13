# 0013. Rule-Based Guardrails

The application uses a small set of rule-based regular expressions for known prompt-injection phrases, prohibited output phrases, and PII patterns. These checks provide limited pattern matching; they do not implement a general security or moderation policy engine.

**Current state (verified 2026-10-13):** No NeMo Guardrails or Colang runtime is used. The unused `policy.yaml` has been removed so the repository has one source of truth: the rule-based implementation in `services/gateway/guardrails/` and shared injection patterns in `packages/core/guardrails.py`.
