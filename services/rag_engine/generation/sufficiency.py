"""Conservative retrieval sufficiency checks used before generation."""

import math
import re
from typing import Any

_TOKEN = re.compile(r"[\w]+(?:[-'][\w]+)*", re.UNICODE)
_STOP_WORDS = frozenset([
    "a", "an", "and", "are", "as", "at", "be", "because", "between", "by", "can",
    "could", "did", "do", "does", "for", "from", "had", "has", "have", "how", "i",
    "in", "into", "is", "it", "its", "of", "on", "or", "our", "should", "that",
    "the", "their", "them", "there", "these", "this", "those", "to", "use", "used",
    "using", "was", "we", "were", "what", "when", "where", "which", "who", "why",
    "will", "with", "would", "you", "your", "explain", "describe", "tell", "me",
    "about", "please",
])


def _tokens(value: str) -> list[str]:
    return [token.lower() for token in _TOKEN.findall(value)]


def _scores(chunk: dict[str, Any]) -> dict[str, Any]:
    scores = chunk.get("scores")
    if isinstance(scores, dict):
        return scores
    legacy = {key: chunk.get(key) for key in ("dense", "bm25")}
    return legacy


def has_sufficient_context(
    query: str,
    chunks: list[dict[str, Any]],
    min_dense_score: float = 0.70,
) -> bool:
    """Require a calibrated dense hit or useful lexical evidence in one chunk."""
    query_terms = _tokens(query)
    substantive = [term for term in query_terms if term not in _STOP_WORDS and len(term) > 1]
    required_matches = math.ceil(len(substantive) / 2) if substantive else 1

    for chunk in chunks:
        scores = _scores(chunk)
        dense = scores.get("dense")
        if isinstance(dense, (int, float)) and not isinstance(dense, bool) and dense >= min_dense_score:
            return True

        bm25 = scores.get("bm25")
        if not isinstance(bm25, (int, float)) or isinstance(bm25, bool) or bm25 <= 0:
            continue
        text_terms = set(_tokens(str(chunk.get("text", ""))))
        if sum(term in text_terms for term in substantive) >= required_matches:
            return True

        # Structured/code-like identifiers carry enough specificity on their own.
        for term in substantive:
            if ("_" in term or "-" in term) and term in text_terms:
                return True
    return False
