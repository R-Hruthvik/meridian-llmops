FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync --frozen --no-dev

COPY packages/ ./packages/
COPY services/ ./services/
COPY evals/ ./evals/
COPY scripts/ ./scripts/

COPY web/ ./web/
RUN npm --prefix web ci && npm --prefix web run build

ENV API_KEY_SECRET=meridian-test-secret-key-2026
ENV LITELLM_MASTER_KEY=sk-litellm-master-key

EXPOSE 8000 8001

CMD ["uvicorn", "services.rag_engine.app:app", "--host", "0.0.0.0", "--port", "8000"]
