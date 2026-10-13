# 0019. Approximate Token-Aware Chunking

**Status:** Accepted · **Date:** 2026-10-13 · **Plan decision:** D6

## Decision

Chunk documents with a dependency-free approximate tokenizer, a 350-token target, a 450-token maximum, approximately 15% overlap, and page/heading metadata.

## Rationale

The embedding model has a finite context window. Bounded chunks preserve source structure while overlap reduces evidence loss at boundaries without adding a tokenizer dependency.

## Consequences and current state

Counts are approximate rather than model-tokenizer exact. The implementation and tests are in `services/ingestion/chunker.py` and `tests/test_chunker.py`.

