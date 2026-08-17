# 0007. BGE-Reranker-Large for Contextual Reranking

We selected `BAAI/bge-reranker-large` as the cross-encoder reranker for candidate chunks prior to generation. Cross-encoding candidate chunks against the original user query provides superior relevance scoring compared to bi-encoder vector similarity alone, dramatically reducing hallucination rates.
