"""Standalone response verification for RAG answers."""

import re
from collections.abc import Mapping, Sequence
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool

from services.gateway.client import LiteLLMClient
from services.gateway.guardrails.schema_validator import SchemaValidator

VerificationMode = Literal["citations", "llm", "off"]
VerificationStatus = Literal[
    "citations_ok", "citations_failed", "supported", "unsupported", "unchecked"
]
VerificationScope = Literal[
    "format_and_numeric_consistency", "llm_judgment", "unchecked"
]


class VerificationSource(BaseModel):
    """A numbered source passage supplied to answer verification."""

    index: int = Field(ge=1)
    text: str
    chunk_id: str | None = None


class VerificationResult(BaseModel):
    """Typed result; citations status describes formatting and numeric consistency only."""

    status: VerificationStatus
    scope: VerificationScope
    invalid_citations: list[int] = Field(default_factory=list)
    uncited_claims: list[str] = Field(default_factory=list)
    numeric_mismatches: list[str] = Field(default_factory=list)
    unsupported_claims: list[str] = Field(default_factory=list)
    contradictions: list[str] = Field(default_factory=list)
    details: str | None = None


class _JudgeVerdict(BaseModel):
    model_config = ConfigDict(extra="forbid")

    supported: StrictBool
    unsupported_claims: list[str]
    contradictions: list[str]


_CITATION_RE = re.compile(r"\[(\d+)\]")
_DATE_RE = re.compile(r"(?<!\d)\d{4}[-/]\d{1,2}[-/]\d{1,2}(?!\d)")
_NUMBER_RE = re.compile(
    r"(?<![\w])(?P<sign>[+-])?\s*(?P<prefix>[$€£¥₹]|USD|EUR|GBP|INR)?\s*(?P<currency_sign>[+-])?\s*"
    r"(?P<number>\d(?:[\d, ]*\d)?(?:\.\d+)?)"
    r"\s*(?P<suffix>USD|EUR|GBP|INR)?\s*(?P<percent>%)?(?![\w])",
    re.IGNORECASE,
)
_SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[.!?])\s+|\n+")
_CITATION_AFTER_PUNCTUATION_RE = re.compile(r"([.!?])\s*(\[\d+\](?:\s*\[\d+\])*)")


def _sentences(answer: str) -> list[str]:
    answer = _CITATION_AFTER_PUNCTUATION_RE.sub(r" \2\1 ", answer.strip())
    return [sentence.strip() for sentence in _SENTENCE_BOUNDARY_RE.split(answer) if sentence.strip()]


def _normalized_values(text: str) -> tuple[set[str], list[tuple[str, str]], dict[str, str]]:
    text_without_citations = _CITATION_RE.sub("", text)
    displays: dict[str, str] = {}
    dates: list[tuple[str, str]] = []

    for match in _DATE_RE.finditer(text_without_citations):
        parts = re.split(r"[-/]", match.group())
        year, month, day = parts
        normalized_date = f"{int(year):04d}-{int(month):02d}-{int(day):02d}"
        key = f"date:{normalized_date}"
        dates.append((key, match.group()))
        displays[key] = match.group()

    text_without_dates = _DATE_RE.sub(" ", text_without_citations)
    for match in _NUMBER_RE.finditer(text_without_dates):
        sign = match.group("sign") or match.group("currency_sign") or ""
        number = sign + re.sub(r"[,\s]", "", match.group("number"))
        prefix = (match.group("prefix") or "").upper()
        suffix = (match.group("suffix") or "").upper()
        currency = prefix if prefix in {"$", "€", "£", "¥", "₹", "USD", "EUR", "GBP", "INR"} else suffix
        percent = bool(match.group("percent"))
        if currency:
            key = f"currency:{currency}:{number}"
        elif percent:
            key = f"percent:{number}"
        else:
            key = f"number:{number}"
        displays[key] = match.group().strip()

    return set(displays), dates, displays


def _date_sequence_is_supported(answer_dates: list[tuple[str, str]], source_dates: list[tuple[str, str]]) -> bool:
    source_keys = [key for key, _ in source_dates]
    source_position = 0
    for key, _ in answer_dates:
        try:
            source_position = source_keys.index(key, source_position) + 1
        except ValueError:
            return False
    return True


def _verify_citations(answer: str, sources: Sequence[VerificationSource], answer_status: str | None) -> VerificationResult:
    valid_sources = {source.index: source.text for source in sources}
    invalid_citations: set[int] = set()
    uncited_claims: list[str] = []
    numeric_mismatches: set[str] = set()

    sentences = _sentences(answer)
    for sentence in sentences:
        citations = [int(value) for value in _CITATION_RE.findall(sentence)]
        if not citations:
            if answer_status != "insufficient_context":
                uncited_claims.append(sentence)
            continue

        valid_citations = [index for index in citations if index in valid_sources]
        invalid_citations.update(index for index in citations if index not in valid_sources)
        sentence_numbers, sentence_dates, sentence_displays = _normalized_values(sentence)
        cited_text = "\n".join(valid_sources[index] for index in valid_citations)
        source_numbers, source_dates, _ = _normalized_values(cited_text)
        numeric_mismatches.update(
            sentence_displays[value] for value in sentence_numbers - source_numbers
        )
        if not _date_sequence_is_supported(sentence_dates, source_dates):
            numeric_mismatches.update(display for _, display in sentence_dates)

    if not _CITATION_RE.search(answer) and not sentences and answer_status != "insufficient_context":
        uncited_claims.append(answer.strip() or "(empty answer)")

    failed = bool(invalid_citations or uncited_claims or numeric_mismatches)
    return VerificationResult(
        status="citations_failed" if failed else "citations_ok",
        scope="format_and_numeric_consistency",
        invalid_citations=sorted(invalid_citations),
        uncited_claims=uncited_claims,
        numeric_mismatches=sorted(numeric_mismatches),
        details="Checks citation presence and numeric consistency; it does not assess factual truth.",
    )


def _judge_prompt(question: str, answer: str, sources: Sequence[VerificationSource]) -> list[dict[str, str]]:
    numbered_sources = "\n".join(f"[{source.index}] {source.text}" for source in sources)
    return [
        {
            "role": "system",
            "content": (
                "You are a careful evidence judge. Decide whether every factual claim in the answer "
                "is supported by the numbered sources and whether any source contradicts it. "
                "Return only strict JSON with exactly these fields: "
                '{"supported": true|false, "unsupported_claims": ["..."], "contradictions": ["..."]}. '
                "Set supported to true only when all factual claims are supported and no contradictions remain."
            ),
        },
        {
            "role": "user",
            "content": f"Question:\n{question}\n\nNumbered sources:\n{numbered_sources}\n\nAnswer:\n{answer}",
        },
    ]


def _response_content(response: dict[str, Any]) -> str:
    choices = response.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("judge response did not contain a completion")
    choice = choices[0]
    if not isinstance(choice, dict):
        raise TypeError("judge response contained an invalid completion")
    message = choice.get("message")
    if not isinstance(message, dict):
        raise TypeError("judge response did not contain a message")
    content = message.get("content")
    if not isinstance(content, str):
        raise TypeError("judge response did not contain text content")
    return content


async def _verify_with_judge(
    question: str,
    answer: str,
    sources: Sequence[VerificationSource],
    llm_client: LiteLLMClient | None,
    llm_config: Mapping[str, str | None] | None,
    model: str,
) -> VerificationResult:
    config = llm_config or {}
    configured_model = config.get("model") or model
    api_key = config.get("api_key")
    try:
        client = llm_client or LiteLLMClient()
        response = await client.chat_completion(
            messages=_judge_prompt(question, answer, sources),
            model=configured_model,
            temperature=0.0,
            max_tokens=1000,
            provider=config.get("provider"),
            api_key=api_key,
            base_url=config.get("base_url"),
        )
    except Exception as exc:  # noqa: BLE001 - provider failures map to unchecked.
        return VerificationResult(
            status="unchecked",
            scope="unchecked",
            details=f"Judge provider request failed ({type(exc).__name__}).",
        )

    try:
        raw_text = _response_content(response)
        parsed, valid = SchemaValidator().validate_and_repair(raw_text, _JudgeVerdict)
        if not valid or parsed is None:
            raise ValueError("judge response was not valid JSON matching the required schema")
        verdict = _JudgeVerdict.model_validate(parsed)
        return VerificationResult(
            status="supported" if verdict.supported else "unsupported",
            scope="llm_judgment",
            unsupported_claims=verdict.unsupported_claims,
            contradictions=verdict.contradictions,
        )
    except Exception as exc:  # noqa: BLE001 - malformed judge responses map to unchecked.
        return VerificationResult(
            status="unchecked",
            scope="unchecked",
            details=f"Invalid judge response ({type(exc).__name__}).",
        )


async def verify_answer(
    question: str,
    answer: str,
    sources: Sequence[VerificationSource],
    mode: VerificationMode = "citations",
    *,
    answer_status: str | None = None,
    llm_client: LiteLLMClient | None = None,
    llm_config: Mapping[str, str | None] | None = None,
    model: str = "gpt-4o-mini",
) -> VerificationResult:
    """Verify citation/numeric formatting or ask an injected async LLM judge."""
    if mode == "off":
        return VerificationResult(status="unchecked", scope="unchecked", details="Verification is disabled.")
    if mode == "llm":
        return await _verify_with_judge(question, answer, sources, llm_client, llm_config, model)
    return _verify_citations(answer, sources, answer_status)


__all__ = [
    "VerificationMode",
    "VerificationResult",
    "VerificationScope",
    "VerificationSource",
    "VerificationStatus",
    "verify_answer",
]
