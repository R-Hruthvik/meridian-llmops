# 0005. Modular Monorepo Architecture

We structured the codebase as a modular monorepo containing distinct services (`services/gateway`, `services/rag_engine`, `services/ingestion`, `services/critic_eval`), shared core schemas (`packages/core`), and CI/CD evaluation testbeds (`evals/`). This enables independent testing and deployment while maintaining single-source-of-truth domain models.
