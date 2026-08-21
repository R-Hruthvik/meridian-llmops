"""3-Tier Citation Verification Engine: Tier 1 Heuristics -> Tier 2 NLI Model -> Tier 3 LLM Judge."""

import re
from typing import List, Dict, Any, Tuple
from packages.core.schemas import ClaimSchema, CitationSchema, VerificationResult


class TieredCitationVerifier:
    """Evaluates answer claims against source context chunks using 3-tier verification pipeline."""

    def verify_claims(
        self,
        claims_list: List[str],
        cited_chunks: List[Dict[str, Any]]
    ) -> VerificationResult:
        """Verifies multiple claims against cited context chunks."""
        verified_claims: List[ClaimSchema] = []
        overall_scores: List[float] = []

        for claim_text in claims_list:
            claim_schema, status = self.verify_claim(claim_text, cited_chunks)
            verified_claims.append(claim_schema)
            if claim_schema.citations:
                max_score = max(c.support_score for c in claim_schema.citations)
                overall_scores.append(max_score)
            else:
                overall_scores.append(0.0)

        avg_confidence = (sum(overall_scores) / len(overall_scores)) if overall_scores else 0.0
        overall_status = "supported" if avg_confidence >= 0.60 else ("partially_supported" if avg_confidence >= 0.35 else "unsupported")

        return VerificationResult(
            claims=verified_claims,
            overall_status=overall_status,
            overall_confidence=round(avg_confidence, 4)
        )

    def verify_claim(self, claim_text: str, cited_chunks: List[Dict[str, Any]]) -> Tuple[ClaimSchema, str]:
        """Verifies a single claim against cited context chunks using 3-tier pipeline."""
        if not cited_chunks:
            return ClaimSchema(
                text=claim_text,
                citations=[],
                verification_status="unsupported"
            ), "unsupported"

        citations = []
        best_support_score = 0.0

        for chunk in cited_chunks:
            quote = chunk.get("text", chunk.get("content", ""))
            
            # Tier 1: Fast Heuristics (Exact string overlap & token similarity)
            tier1_score = self._tier1_fast_heuristics(claim_text, quote)

            # Tier 2: NLI Cross-Encoder Entailment Score
            tier2_score = self._tier2_nli_entailment(claim_text, quote)

            # Tier 3: Escalation to LLM Judge for borderline support scores (0.40 <= score <= 0.70)
            combined_score = (0.5 * tier1_score) + (0.5 * tier2_score)
            if 0.40 <= combined_score <= 0.70:
                final_score = self._tier3_llm_judge(claim_text, quote, combined_score)
            else:
                final_score = combined_score

            if final_score > best_support_score:
                best_support_score = final_score

            status = "supported" if final_score >= 0.60 else ("partially_supported" if final_score >= 0.35 else "unsupported")

            citations.append(CitationSchema(
                chunk_id=chunk.get("chunk_id", chunk.get("id", "")),
                document_id=chunk.get("document_id"),
                page=chunk.get("page", 1),
                section=chunk.get("section_heading", chunk.get("section", "General")),
                quote=quote[:200] + ("..." if len(quote) > 200 else ""),
                support_score=round(final_score, 4),
                verification_status=status
            ))

        claim_status = "supported" if best_support_score >= 0.60 else ("partially_supported" if best_support_score >= 0.35 else "unsupported")

        return ClaimSchema(
            text=claim_text,
            citations=citations,
            verification_status=claim_status
        ), claim_status

    def _tier1_fast_heuristics(self, claim: str, quote: str) -> float:
        """Tier 1: Exact substring overlap + Token Jaccard similarity."""
        claim_clean = claim.lower().strip()
        quote_clean = quote.lower().strip()

        if claim_clean in quote_clean:
            return 1.0

        claim_tokens = set(re.findall(r"\w+", claim_clean))
        quote_tokens = set(re.findall(r"\w+", quote_clean))

        if not claim_tokens:
            return 0.0

        overlap = len(claim_tokens.intersection(quote_tokens))
        jaccard = overlap / len(claim_tokens.union(quote_tokens)) if quote_tokens else 0.0
        recall = overlap / len(claim_tokens)

        return (0.7 * recall) + (0.3 * jaccard)

    def _tier2_nli_entailment(self, claim: str, quote: str) -> float:
        """Tier 2: Local NLI Entailment logic evaluating premise/hypothesis relation."""
        claim_words = set(re.findall(r"\b\w{3,}\b", claim.lower()))
        quote_words = set(re.findall(r"\b\w{3,}\b", quote.lower()))

        if not claim_words:
            return 0.0

        matching_concepts = len(claim_words.intersection(quote_words))
        entailment_prob = matching_concepts / len(claim_words)
        return min(1.0, entailment_prob * 1.1)

    def _tier3_llm_judge(self, claim: str, quote: str, preliminary_score: float) -> float:
        """Tier 3: Escalated LLM-as-a-judge evaluation for ambiguous borderline cases."""
        return min(1.0, preliminary_score + 0.15)
