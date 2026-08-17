# 0010. Unified Docker Compose Environment for Local Dev and CI

We chose Docker Compose as the standard orchestration definition for local development and CI test runners. A single `docker-compose.yml` launches and health-checks Qdrant, Neo4j, LiteLLM Proxy, Langfuse, and the FastAPI application services.
