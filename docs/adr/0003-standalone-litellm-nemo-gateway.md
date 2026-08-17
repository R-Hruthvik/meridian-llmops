# 0003. Standalone Proxy Containers for AI Gateway and Guardrails

We chose to run LiteLLM Proxy and NeMo Guardrails as standalone service containers in front of the application rather than embedding them directly in the FastAPI runtime. This isolates LLM credential management, rate-limiting, and security policy enforcement into an independent security perimeter that can scale and update without redeploying application code.
