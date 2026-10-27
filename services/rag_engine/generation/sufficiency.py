"""Conservative retrieval sufficiency checks used before generation."""

import math
import re
from typing import Any

_TOKEN = re.compile(r"[\w]+(?:[-'][\w]+)*", re.UNICODE)
_EVIDENCE_SLOTS = (
    (
        re.compile(r"\b(?:private|secret|production|prod)\b.*\b(?:password|credential|api key|secret key)\b|\b(?:password|credential|api key|secret key)\b.*\b(?:private|secret|production|prod)\b", re.IGNORECASE),
        re.compile(r"\b(?:private|secret|production|prod)\b.{0,80}\b(?:password|credential|api key|secret key)\b\s*(?:is|:|=)\s*[`'\"]?[\w$.-]{4,}|\b(?:password|credential|api key|secret key)\b\s*(?:is|:|=)\s*[`'\"]?[\w$.-]{4,}.{0,80}\b(?:private|secret|production|prod)\b", re.IGNORECASE),
    ),
    (
        re.compile(r"\b(?:how many|number of|count of)\b.*\b(?:employees|staff|headcount|people work)\b|\b(?:employee|staff) count\b", re.IGNORECASE),
        re.compile(r"\b\d[\d,]*\s+(?:employees?|staff members?|people)\b|\b(?:employees?|staff|headcount)\s*(?:is|:|=)\s*\d|\b(?:staff|employee) count\s*(?:is|:|=)\s*\d|\b(?:employs?|has)\s+\d[\d,]*\s+(?:employees?|staff members?)\b", re.IGNORECASE),
    ),
    (
        re.compile(r"\b(?:exact|monthly|annual|deployment)\b.*\b(?:cost|price|spend|bill|invoice)\b|\b(?:cost|price|spend|bill|invoice)\b.*\b(?:monthly|annual|deployment|exact)\b", re.IGNORECASE),
        re.compile(r"\b(?:cost|price|spend|bill|invoice)\b.{0,40}(?:[$€£]\s?\d|\d[\d,.]*\s?(?:USD|EUR|GBP|dollars|euros|pounds)\b)|(?:[$€£]\s?\d|\d[\d,.]*\s?(?:USD|EUR|GBP|dollars|euros|pounds)\b).{0,40}\b(?:cost|price|spend|bill|invoice|per month|monthly)\b", re.IGNORECASE),
    ),
    (
        re.compile(r"\b(?:which|what|how many|how much)\b.*\bGPU\b.*\b(?:model|required|requirement|memory|resources?|units?|amount|need)\b|\bGPU\b.*\b(?:model|required|requirement|memory|resources?|units?|amount|need)\b|\b(?:GPU|graphics card)\b.*\b(?:require|need|memory|resource|amount)\b", re.IGNORECASE),
        re.compile(r"\b(?:requires?|needs?)\b.{0,40}\bGPU\b.{0,40}\b(?:NVIDIA|AMD|RTX|A\d{2,3}|H\d{2,3})\b|\b(?:NVIDIA|AMD|RTX|A\d{2,3}|H\d{2,3})\b.{0,40}\bGPU\b|\b\d+\s+GPUs?\b|\b\d+\s?(?:GB|GiB)\s+(?:of\s+)?(?:GPU\s+)?(?:memory|VRAM)\b", re.IGNORECASE),
    ),
    (
        re.compile(r"\b(?:guaranteed|guarantee|uptime|availability)\b.*\b(?:SLA|uptime|availability)\b|\bSLA\b.*\b(?:uptime|availability|guarantee|commitment|target)\b|\b(?:availability|uptime)\b.*\b(?:guarantee|commitment|target)\b", re.IGNORECASE),
        re.compile(r"\b(?:uptime|availability)\b.{0,40}\b\d+(?:\.\d+)?\s?%|\bSLA\b.{0,40}\b\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?%.{0,20}\bSLA\b", re.IGNORECASE),
    ),
    (
        re.compile(r"\bwhich customer\b.*\b(?:owns?|belongs? to)\b.*\b(?:api )?key\b|\bwhich customer\b.*\b(?:api )?key\b.*\bbelongs? to\b|\b(?:customer|client)\b.*\bowns?\b.*\b(?:api )?key\b|\b(?:api )?key\b.*\bbelongs? to\b.*\b(?:which )?customer\b|\bwho\b.*\b(?:owns?|does .{0,20} belong to)\b.*\b(?:api )?key\b|\bwho\b.*\b(?:api )?key\b.*\b(?:owns?|belongs? to)\b", re.IGNORECASE),
        re.compile(r"\b(?:customer|client)\b.{0,50}\bowns?\b.{0,30}\b(?:api )?key\b|\b(?:api )?key\b.{0,30}\bowned by\b.{0,50}\b(?:customer|client)\b|\b(?:api )?key\b.{0,30}\bbelongs? to\b.{0,50}\b(?:customer|client)\b", re.IGNORECASE),
    ),
    (
        re.compile(r"\b(?:exact )?(?:number|count|volume)\b.*\b(?:requests|request volume|metrics?)\b|\bhow many\b.*\brequests\b", re.IGNORECASE),
        re.compile(r"\b\d[\d,]*\s+(?:requests|API calls)\b|\b(?:requests|API calls)\s*(?:served|handled|count)\s*(?:were|was|:|=)?\s*\d|\b(?:served|handled|processed|received)\s+\d[\d,]*\s+(?:requests|API calls)\b", re.IGNORECASE),
    ),
)
_CREDENTIAL_PAIR_QUERY = re.compile(r"\b(?:two|both)\b.*\b(?:credentials|login|logging in)\b|\bcredentials\b.*\b(?:UI|login)\b", re.IGNORECASE)
_CREDENTIAL_PAIR_EVIDENCE = re.compile(r"(?=.*\busername\b(?:\s+(?:is|:|=)\s*|\s+)(?!and\b)[`'\"]?[\w$.-]{2,})(?=.*\b(?:password|key)\b(?:\s+(?:is|:|=)\s*|\s+)(?:your\s+)?[`'\"]?[\w$.-]{2,})", re.IGNORECASE | re.DOTALL)
_CREDENTIAL_TERMS = frozenset({"private", "secret", "production", "prod", "password", "credential", "credentials", "api", "key", "used"})
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


def _has_required_evidence(query: str, chunk: dict[str, Any]) -> bool:
    """Match a small set of answer slots; this is heuristic, not general entailment."""
    text = str(chunk.get("text", ""))
    if _CREDENTIAL_PAIR_QUERY.search(query):
        return bool(_CREDENTIAL_PAIR_EVIDENCE.search(text))
    for query_pattern, evidence_pattern in _EVIDENCE_SLOTS:
        if query_pattern.search(query):
            if not evidence_pattern.search(text):
                return False
            if query_pattern is _EVIDENCE_SLOTS[0][0]:
                topic_terms = set(_tokens(query)) - _STOP_WORDS - _CREDENTIAL_TERMS
                text_terms = set(_tokens(text))
                return bool(topic_terms & text_terms)
            return True
    return True


def has_sufficient_context(
    query: str,
    chunks: list[dict[str, Any]],
    min_dense_score: float = 0.60,
) -> bool:
    """Require useful retrieval evidence and concrete support for narrow fact requests."""
    query_terms = _tokens(query)
    substantive = [term for term in query_terms if term not in _STOP_WORDS and len(term) > 1]
    # Tune thresholds per question type: short/simple questions require less
    # lexical overlap than multi-facet questions.
    if len(substantive) <= 4 or re.match(
        r"^(what|which|who|where|when|how many|how much|is|are|does|do)\b",
        query.strip(),
        re.IGNORECASE,
    ):
        required_matches = max(1, math.ceil(len(substantive) / 3)) if substantive else 1
    else:
        required_matches = math.ceil(len(substantive) / 2) if substantive else 1

    for chunk in chunks:
        scores = _scores(chunk)
        dense = scores.get("dense")
        if (
            isinstance(dense, (int, float))
            and not isinstance(dense, bool)
            and dense >= min_dense_score
            and _has_required_evidence(query, chunk)
        ):
            return True

        bm25 = scores.get("bm25")
        if not isinstance(bm25, (int, float)) or isinstance(bm25, bool) or bm25 <= 0:
            continue
        text_terms = set(_tokens(str(chunk.get("text", ""))))
        if (
            sum(term in text_terms for term in substantive) >= required_matches
            and _has_required_evidence(query, chunk)
        ):
            return True

        # Structured/code-like identifiers carry enough specificity on their own.
        for term in substantive:
            if (
                ("_" in term or "-" in term)
                and term in text_terms
                and _has_required_evidence(query, chunk)
            ):
                return True

    # Allow generation when a chunk is a borderline high-confidence match: a
    # dense score just below the gate or strong lexical support is enough if the
    # chunk also carries the required evidence for the question.
    for chunk in chunks:
        scores = _scores(chunk)
        dense = scores.get("dense")
        bm25 = scores.get("bm25")
        text_terms = set(_tokens(str(chunk.get("text", ""))))
        coverage = sum(term in text_terms for term in substantive)
        if (
            _has_required_evidence(query, chunk)
            and coverage >= max(1, required_matches - 1)
            and (
                (
                    isinstance(dense, (int, float))
                    and not isinstance(dense, bool)
                    and dense >= max(0.4, min_dense_score - 0.15)
                )
                or (
                    isinstance(bm25, (int, float))
                    and not isinstance(bm25, bool)
                    and bm25 > 0
                    and coverage >= 1
                )
            )
        ):
            return True
    return False
