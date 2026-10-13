# Graph retrieval and prompt context

The graph is an optional retrieval aid. With `GRAPH_ENABLED=false` (the default), a query uses the existing hybrid vector and BM25 retriever and does not read graph entities or relationships. With `GRAPH_ENABLED=true`, the retrieval node loads tenant-scoped entities, matches normalized entity names in the query (with token and substring fallback), then explores up to two relationship hops from the matches. This traversal does not fetch additional text chunks or change the hybrid ranking.

Prompt augmentation has a separate gate: `GRAPH_CONTEXT_ENABLED=false` by default. Graph context is considered only when both flags are true. A relationship is eligible only when its persisted source chunk IDs intersect the chunks returned by hybrid retrieval; before prompt insertion, those IDs are checked again against the selected prompt sources. Each inserted fact includes its directed relationship, source chunk IDs, and matching numbered citation. At most five facts are inserted under the `Graph facts:` heading. If no selected source chunk supports a relationship, no graph facts are added.

Graph context remains experimental and off by default. The local multi-hop A/B fixture can be run with:

```sh
uv run python evals/eval_retrieval.py --graph --top-k 5
```

The fixture contains two multi-hop questions over three short documents. Its baseline metric is the fraction of gold hop source documents represented in the top-k retrieved chunks, plus the fraction of cases with every hop source present. The graph-enabled metric requires the directed gold relationship to exist in the extracted graph with matching chunk provenance, and that provenance to be present in the same top-k results. The comparison measures retrieval evidence coverage and path reconstruction only; it does not call a language model or measure answer quality. The generic hit/MRR fields are also printed, while the generic answer-quality gate is marked `NOT_APPLICABLE` for this fixture.

Current run: both cases had baseline hop recall `1.0` and complete-path rate `1.0`; graph-enabled grounded hop recall was `1.0` and complete-path rate was `1.0`. Both deltas were `0.0`. This small synthetic set shows no multi-hop retrieval gain, so `GRAPH_CONTEXT_ENABLED` stays off pending broader evidence. It does not establish a generation-quality improvement.
