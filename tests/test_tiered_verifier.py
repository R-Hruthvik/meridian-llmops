"""Unit tests for 3-Tier Citation Verification Engine."""

import pytest
from packages.verification.tiered_verifier import TieredCitationVerifier


def test_tier1_fast_heuristics_exact_match():
    verifier = TieredCitationVerifier()
    claim = "The policy states that reimbursement is capped at $50 per day."
    quote = "Company policy states that reimbursement is capped at $50 per day for travel."

    score = verifier._tier1_fast_heuristics(claim, quote)
    assert score >= 0.7


def test_tier2_nli_entailment_matching_concepts():
    verifier = TieredCitationVerifier()
    claim = "Travel reimbursement covers daily meals."
    quote = "All employees can claim travel reimbursement for daily meals and lodging."

    score = verifier._tier2_nli_entailment(claim, quote)
    assert score > 0.5


def test_verify_claim_supported():
    verifier = TieredCitationVerifier()
    claim = "Password resets require multi-factor authentication."
    chunks = [
        {"id": "chunk_1", "content": "Security Requirement: Password resets require multi-factor authentication for all users."}
    ]

    claim_schema, status = verifier.verify_claim(claim, chunks)
    assert status == "supported"
    assert len(claim_schema.citations) == 1
    assert claim_schema.citations[0].verification_status == "supported"


def test_verify_claim_unsupported():
    verifier = TieredCitationVerifier()
    claim = "Employees get 100 days of paid vacation per year."
    chunks = [
        {"id": "chunk_1", "content": "Company policy allows 15 days of paid vacation annually."}
    ]

    claim_schema, status = verifier.verify_claim(claim, chunks)
    assert status == "unsupported" or status == "partially_supported"
