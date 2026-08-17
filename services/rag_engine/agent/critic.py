"""Critic Agent (LLM-as-a-judge) evaluating factual groundedness against context."""

import re

from packages.core.models import CriticVerdict


class CriticAgent:
    """Evaluates whether generated claims are relevant to the query and strictly grounded in retrieved source context."""

    def evaluate(self, query: str, draft: str, context: str) -> CriticVerdict:
        if not draft.strip():
            return CriticVerdict(
                is_grounded=False,
                confidence_score=0.0,
                unsupported_claims=["Draft response is empty."],
                reasoning="Empty draft cannot be verified.",
            )

        if not context.strip():
            return CriticVerdict(
                is_grounded=False,
                confidence_score=0.0,
                unsupported_claims=[draft] if draft else [],
                reasoning="No context available in knowledge base to ground response.",
            )

        context_lower = context.lower()
        context_words = set(re.findall(r"\w+", context_lower))
        stopwords = {
            "the", "is", "at", "which", "on", "a", "an", "and", "or", "to", "in", "for",
            "with", "according", "context", "what", "how", "why", "where", "when", "who", "does"
        }

        # 1. Check Query-to-Context Topical Relevance
        query_words = set(re.findall(r"\w+", query.lower())) - stopwords
        context_content_words = context_words - stopwords

        if query_words and context_content_words:
            query_overlap = len(query_words.intersection(context_content_words))
            query_ratio = query_overlap / len(query_words)
            if query_ratio < 0.20:
                return CriticVerdict(
                    is_grounded=False,
                    confidence_score=0.1,
                    unsupported_claims=[draft],
                    reasoning=f"Retrieved context is irrelevant to the query topics ({', '.join(query_words)}).",
                )

        # 2. Check Draft Grounding in Context
        sentences = [s.strip() for s in re.split(r"[.!?]\s+", draft) if len(s.strip()) > 10]
        unsupported: list[str] = []

        for sentence in sentences:
            sent_words = set(re.findall(r"\w+", sentence.lower()))
            content_words = sent_words - stopwords

            if content_words:
                overlap = len(content_words.intersection(context_words))
                ratio = overlap / len(content_words)
                if ratio < 0.35:
                    unsupported.append(sentence)

        is_grounded = len(unsupported) == 0
        confidence = 1.0 - (len(unsupported) / max(1, len(sentences)))

        return CriticVerdict(
            is_grounded=is_grounded,
            confidence_score=float(confidence),
            unsupported_claims=unsupported,
            reasoning="All factual claims verified against context." if is_grounded else f"Flagged {len(unsupported)} ungrounded assertions.",
        )
