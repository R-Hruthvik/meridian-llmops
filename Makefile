.PHONY: help setup up ingest retrieval-check test eval reindex cli-test

DIR ?= sample_docs
PYTHON ?= uv run python

help:
	@printf '%s\n' \
	  'setup           Install Python and frontend dependencies' \
	  'up              Start Qdrant with Docker Compose' \
	  'ingest DIR=...  Ingest files from a directory (default: sample_docs)' \
	  'retrieval-check Run the retrieval smoke check' \
	  'test            Run tests/ and evals/ with pytest' \
	  'eval            Run retrieval evaluation with reranking disabled' \
	  'reindex         Rebuild the configured Qdrant collection'

setup:
	uv sync --dev
	npm --prefix web ci

up:
	docker compose up -d qdrant

ingest:
	$(PYTHON) scripts/ingest_folder.py "$(DIR)" --recursive

retrieval-check:
	$(PYTHON) scripts/retrieval_check.py --questions evals/retrieval_smoke.json --docs sample_docs

test:
	$(PYTHON) -m pytest tests/ evals/ -v

eval:
	$(PYTHON) scripts/eval_retrieval.py --reranker none

reindex:
	$(PYTHON) scripts/reindex.py

cli-test:
	$(PYTHON) -m pytest tests/test_cli_client.py tests/test_cli_commands.py -v
