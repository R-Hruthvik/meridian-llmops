from services.rag_engine.verification import (
    VerificationSource,
    verify_answer,
)


def source(index: int, text: str) -> VerificationSource:
    return VerificationSource(index=index, text=text)


async def test_citations_mode_accepts_cited_sentence_and_normalizes_commas():
    result = await verify_answer(
        question="How much funding was approved?",
        answer="Funding of $1,000 was approved. [1]",
        sources=[source(1, "The board approved funding of $1000.")],
        mode="citations",
    )

    assert result.status == "citations_ok"
    assert result.scope == "format_and_numeric_consistency"
    assert result.numeric_mismatches == []


async def test_citations_mode_normalizes_spaces_in_numbers():
    result = await verify_answer(
        question="How much funding was approved?",
        answer="Funding of $1,000 was approved. [1]",
        sources=[source(1, "The board approved funding of $1 000.")],
        mode="citations",
    )

    assert result.status == "citations_ok"
    assert result.numeric_mismatches == []


async def test_bananas_rejected_without_citation():
    result = await verify_answer(
        question="What is Qdrant?",
        answer="Bananas",
        sources=[source(1, "Qdrant is a vector database.")],
        mode="citations",
    )

    assert result.status == "citations_failed"
    assert result.uncited_claims == ["Bananas"]


async def test_citations_mode_rejects_missing_source_indices():
    result = await verify_answer(
        question="What is Qdrant?",
        answer="Qdrant is a vector database. [2]",
        sources=[source(1, "Qdrant is a vector database.")],
        mode="citations",
    )

    assert result.status == "citations_failed"
    assert result.invalid_citations == [2]


async def test_citations_mode_requires_a_citation_for_each_line_claim():
    result = await verify_answer(
        question="What is Qdrant?",
        answer="Qdrant is a vector database. [1]\nIt stores vectors.",
        sources=[source(1, "Qdrant is a vector database. It stores vectors.")],
        mode="citations",
    )

    assert result.status == "citations_failed"
    assert result.uncited_claims == ["It stores vectors."]


async def test_number_mismatch_is_reported_for_cited_source():
    result = await verify_answer(
        question="How long is the retention period?",
        answer="The retention period is 30 days. [1]",
        sources=[source(1, "The retention period is 20 days.")],
        mode="citations",
    )

    assert result.status == "citations_failed"
    assert result.numeric_mismatches == ["30"]


async def test_negative_percentage_does_not_match_positive_source_value():
    result = await verify_answer(
        question="What was the change?",
        answer="The change was -30%. [1]",
        sources=[source(1, "The change was 30%.")],
        mode="citations",
    )

    assert result.status == "citations_failed"
    assert result.numeric_mismatches == ["-30%"]


async def test_negative_number_does_not_match_positive_source_value():
    result = await verify_answer(
        question="What was the balance?",
        answer="The balance was -30 dollars. [1]",
        sources=[source(1, "The balance was 30 dollars.")],
        mode="citations",
    )

    assert result.status == "citations_failed"
    assert result.numeric_mismatches == ["-30"]


async def test_currency_amount_does_not_match_percentage_with_same_number():
    result = await verify_answer(
        question="What was the recorded amount?",
        answer="The recorded amount was $30. [1]",
        sources=[source(1, "The recorded amount was 30%.")],
        mode="citations",
    )

    assert result.status == "citations_failed"
    assert result.numeric_mismatches == ["$30"]


async def test_changed_full_date_is_reported():
    result = await verify_answer(
        question="When does the period begin?",
        answer="The period begins on 2025-02-01. [1]",
        sources=[source(1, "The period begins on 2025-01-02.")],
        mode="citations",
    )

    assert result.status == "citations_failed"
    assert result.numeric_mismatches == ["2025-02-01"]


async def test_full_date_normalizes_iso_and_slash_forms():
    result = await verify_answer(
        question="When does the period begin?",
        answer="The period begins on 2025-01-02. [1]",
        sources=[source(1, "The period begins on 2025/01/02.")],
        mode="citations",
    )

    assert result.status == "citations_ok"
    assert result.numeric_mismatches == []


async def test_reordered_full_dates_are_reported():
    result = await verify_answer(
        question="When does the period run?",
        answer="The period runs from 2025-02-01 through 2025-01-02. [1]",
        sources=[source(1, "The period runs from 2025-01-02 through 2025-02-01.")],
        mode="citations",
    )

    assert result.status == "citations_failed"
    assert result.numeric_mismatches == ["2025-01-02", "2025-02-01"]


async def test_contradiction_is_only_labeled_citations_ok_in_citations_mode():
    result = await verify_answer(
        question="What is Qdrant?",
        answer="Qdrant is not a vector database. [1]",
        sources=[source(1, "Qdrant is a vector database.")],
        mode="citations",
    )

    assert result.status == "citations_ok"
    assert result.status != "supported"
    assert "does not assess factual truth" in (result.details or "")


async def test_insufficient_context_does_not_require_citations():
    result = await verify_answer(
        question="What is Qdrant?",
        answer="I do not have enough context to answer.",
        sources=[],
        mode="citations",
        answer_status="insufficient_context",
    )

    assert result.status == "citations_ok"
    assert result.uncited_claims == []


class FakeJudge:
    def __init__(self, response: str | Exception):
        self.response = response
        self.calls = 0
        self.messages = None
        self.request = None

    async def chat_completion(self, messages, **kwargs):
        self.calls += 1
        self.messages = messages
        self.request = kwargs
        if isinstance(self.response, Exception):
            raise self.response
        return {"choices": [{"message": {"content": self.response}}]}


async def test_contradiction_not_supported():
    judge = FakeJudge(
        '{"supported": false, '
        '"unsupported_claims": ["Qdrant is not a vector database."], '
        '"contradictions": ["Qdrant is not a vector database."]}'
    )

    result = await verify_answer(
        question="What is Qdrant?",
        answer="Qdrant is not a vector database. [1]",
        sources=[source(1, "Qdrant is a vector database.")],
        mode="llm",
        llm_client=judge,
    )

    assert result.status == "unsupported"
    assert result.contradictions == ["Qdrant is not a vector database."]
    assert judge.calls == 1


async def test_llm_mode_parses_judge_json_and_sends_question_sources_and_answer():
    judge = FakeJudge(
        '```json\n{"supported": true, "unsupported_claims": [], "contradictions": [],}\n```'
    )

    result = await verify_answer(
        question="What is Qdrant?",
        answer="Qdrant is a vector database. [1]",
        sources=[source(1, "Qdrant is a vector database.")],
        mode="llm",
        llm_client=judge,
    )

    assert result.status == "supported"
    assert result.scope == "llm_judgment"
    assert judge.calls == 1
    assert judge.messages[0]["role"] == "system"
    assert judge.messages[1]["role"] == "user"
    assert "What is Qdrant?" in judge.messages[1]["content"]
    assert "[1] Qdrant is a vector database." in judge.messages[1]["content"]
    assert "Qdrant is a vector database. [1]" in judge.messages[1]["content"]


async def test_llm_mode_returns_unchecked_for_invalid_json_without_retrying_provider():
    judge = FakeJudge("not JSON")

    result = await verify_answer(
        question="What is Qdrant?",
        answer="Qdrant is a vector database. [1]",
        sources=[source(1, "Qdrant is a vector database.")],
        mode="llm",
        llm_client=judge,
    )

    assert result.status == "unchecked"
    assert result.scope == "unchecked"
    assert "Invalid judge response" in (result.details or "")
    assert judge.calls == 1


async def test_llm_mode_returns_unchecked_with_provider_error_details():
    judge = FakeJudge(RuntimeError("provider unavailable with secret-key and private source text"))

    result = await verify_answer(
        question="What is Qdrant?",
        answer="Qdrant is a vector database. [1]",
        sources=[source(1, "Qdrant is a vector database.")],
        mode="llm",
        llm_client=judge,
        llm_config={"api_key": "secret-key"},
    )

    assert result.status == "unchecked"
    assert "provider request failed" in (result.details or "")
    assert "RuntimeError" in (result.details or "")
    assert "secret-key" not in (result.details or "")
    assert "private source text" not in (result.details or "")
    assert judge.calls == 1


async def test_llm_mode_uses_active_provider_configuration():
    judge = FakeJudge('{"supported": false, "unsupported_claims": ["claim"], "contradictions": []}')

    result = await verify_answer(
        question="What is Qdrant?",
        answer="Qdrant is a relational database. [1]",
        sources=[source(1, "Qdrant is a vector database.")],
        mode="llm",
        llm_client=judge,
        llm_config={
            "provider": "openai",
            "api_key": "secret-key",
            "base_url": "https://provider.example/v1",
            "model": "judge-model",
        },
    )

    assert result.status == "unsupported"
    assert result.unsupported_claims == ["claim"]
    assert judge.calls == 1
    assert judge.request == {
        "model": "judge-model",
        "temperature": 0.0,
        "max_tokens": 1000,
        "provider": "openai",
        "api_key": "secret-key",
        "base_url": "https://provider.example/v1",
    }


async def test_off_mode_returns_unchecked_without_calling_judge():
    judge = FakeJudge('{"supported": true}')

    result = await verify_answer(
        question="What is Qdrant?",
        answer="Qdrant is a vector database.",
        sources=[],
        mode="off",
        llm_client=judge,
    )

    assert result.status == "unchecked"
    assert result.scope == "unchecked"
    assert judge.calls == 0
