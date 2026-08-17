# 0012. API Key Authentication and Tenant Quotas

We chose header-based API key authentication (`X-API-Key`) validated at the AI Gateway layer. This provides lightweight service-to-service authentication, per-tenant usage tracking, and rate limiting across upstream LLM calls.
