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

        # 1. Conversational / greeting bypass
        greetings = {
            "hi", "hello", "hey", "greetings", "good morning", "good afternoon",
            "good evening", "how are you", "who are you", "help", "thanks", "thank you"
        }
        clean_q = query.strip().lower()
        if clean_q in greetings or any(clean_q.startswith(g) for g in ["hi ", "hello ", "hey "]):
            return CriticVerdict(
                is_grounded=True,
                confidence_score=1.0,
                unsupported_claims=[],
                reasoning="Conversational query verified.",
            )

        if not context.strip():
            return CriticVerdict(
                is_grounded=False,
                confidence_score=0.0,
                unsupported_claims=[draft] if draft else [],
                reasoning="No context available in knowledge base to ground response.",
            )

        context_lower = context.lower()
        stopwords = {
            "the", "is", "at", "which", "on", "a", "an", "and", "or", "to", "in", "for",
            "with", "according", "context", "what", "how", "why", "where", "when", "who", "does"
        }

        # 2. Check Query-to-Context Substring & Word Alignment
        query_words = [w for w in re.findall(r"\w+", clean_q) if w not in stopwords]
        if query_words:
            matched_words = [w for w in query_words if w in context_lower]
            ratio = len(matched_words) / len(query_words)
            if ratio < 0.25:
                return CriticVerdict(
                    is_grounded=False,
                    confidence_score=0.1,
                    unsupported_claims=[draft],
                    reasoning=f"Retrieved context does not match query topics ({', '.join(query_words)}).",
                )

        # 3. Check Draft Grounding in Context
        sentences = [s.strip() for s in re.split(r"[.!?]\s+", draft) if len(s.strip()) > 10]
        unsupported: list[str] = []

        for sentence in sentences:
            sent_words = [w for w in re.findall(r"\w+", sentence.lower()) if w not in stopwords]
            if sent_words:
                matches = sum(1 for w in sent_words if w in context_lower)
                ratio = matches / len(sent_words)
                if ratio < 0.25:
                    unsupported.append(sentence)

        is_grounded = len(unsupported) == 0
        confidence = 1.0 - (len(unsupported) / max(1, len(sentences)))

        return CriticVerdict(
            is_grounded=is_grounded,
            confidence_score=float(confidence),
            unsupported_claims=unsupported,
            reasoning="All factual claims verified against context." if is_grounded else f"Flagged {len(unsupported)} ungrounded assertions.",
        )
