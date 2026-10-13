# 0003. Standalone LiteLLM Proxy and In-Process Guardrails

The deployment runs LiteLLM Proxy as a standalone service. Guardrail checks run in the FastAPI application as rule-based regular expressions for known injection and prohibited phrase patterns, plus PII masking. They are not an independent service or a complete security perimeter.
