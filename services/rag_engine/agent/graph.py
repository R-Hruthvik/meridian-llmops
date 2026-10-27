"""LangGraph workflow for grounded retrieval, generation, and verification."""

import json
import logging
import re
import time
from collections.abc import Awaitable, Callable, Mapping
from contextlib import nullcontext
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, StateGraph

from packages.core.errors import ProviderError
from packages.core.models import Entity, SearchResult
from packages.core.settings import get_settings
from services.gateway.client import LiteLLMClient
from services.ingestion.graph_store import KnowledgeGraphStore
from services.rag_engine.agent.refusal import SafeRefusalGenerator
from services.rag_engine.agent.state import RagAgentState
from services.rag_engine.generation.prompt import build_prompt
from services.rag_engine.generation.sufficiency import has_sufficient_context
from services.rag_engine.observability.langfuse_client import normalize_usage
from services.rag_engine.retrieval.hybrid import RankedChunk
from services.rag_engine.verification import (
    VerificationMode,
    VerificationResult,
    VerificationSource,
    verify_answer,
)

logger = logging.getLogger("meridian.rag_engine.agent")
DEFAULT_TOP_K = 5
MIN_TOP_K = 1
MAX_TOP_K = 20
MAX_GRAPH_FACTS = 5
_REFORMULATE_PROMPT = (
    "Rewrite the source question as one concise, keyword-rich search query (at most 12 words). Preserve proper nouns, "
    "numbers, product names, and error codes exactly. Add 2–4 likely topic keywords without changing "
    "the question's meaning. Do not answer the question. Return only the query text."
)


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    return value


def resolve_retrieval_breadth(config: RunnableConfig | None) -> tuple[int, int]:
    configurable = (config or {}).get("configurable") or {}
    requested_top_k = _positive_int(configurable.get("top_k"))
    top_k = min(max(requested_top_k or DEFAULT_TOP_K, MIN_TOP_K), MAX_TOP_K)
    return top_k, top_k


def _to_search_result(ranked: RankedChunk) -> SearchResult:
    chunk = ranked.chunk
    return SearchResult(
        chunk_id=chunk.id,
        document_id=chunk.document_id,
        text=chunk.text,
        score=ranked.score,
        retrieval_method="hybrid",
        metadata=chunk.metadata,
        rank=ranked.rank,
        filename=ranked.filename,
        title=str(chunk.metadata.get("title", "")),
        page_start=ranked.page_start,
        heading_path=str(chunk.metadata.get("heading_path") or chunk.section_heading or ""),
        scores=dict(ranked.scores),
        chunk_index=chunk.chunk_index,
    )


def _result_dict(source: SearchResult | Mapping[str, Any]) -> dict[str, Any]:
    return source.model_dump() if isinstance(source, SearchResult) else dict(source)


def _format_graph_facts(
    graph_context: list[dict[str, Any]], selected_chunks: list[dict[str, Any]]
) -> str:
    selected_ids = {str(chunk.get("chunk_id", "")) for chunk in selected_chunks}
    citations_by_chunk = {
        str(chunk.get("chunk_id", "")): index
        for index, chunk in enumerate(selected_chunks, start=1)
    }
    lines = []
    for edge in graph_context:
        chunk_ids = [chunk_id for chunk_id in edge["chunk_ids"] if chunk_id in selected_ids]
        if not chunk_ids:
            continue
        citations = sorted({citations_by_chunk[chunk_id] for chunk_id in chunk_ids})
        citation_markers = "".join(f"[{index}]" for index in citations)
        lines.append(
            f"- {edge['source_entity']} -[{edge['relation_type']}]-> {edge['target_entity']} "
            f"(source chunk IDs: {', '.join(chunk_ids)}; cite: {citation_markers})"
        )
        if len(lines) == MAX_GRAPH_FACTS:
            break
    if not lines:
        return ""
    return (
        "\n\nGraph facts:\n"
        "Use each relation only when supported by its listed source chunks; cite the matching numbered source.\n"
        + "\n".join(lines)
    )


def _active_llm_config(getter: Callable[[], Mapping[str, Any]] | None) -> dict[str, Any]:
    return dict(getter() or {}) if getter else {}


async def _stream_completion(
    client: LiteLLMClient,
    messages: list[dict[str, str]],
    model: str,
    provider: str,
    api_key: str | None,
    base_url: str | None,
    token_sink: Any,
) -> dict[str, Any]:
    """Stream a completion, forwarding each delta to ``token_sink`` and accumulating the text.

    Returns the same response shape as :meth:`LiteLLMClient.chat_completion` so the
    caller's usage normalization, provenance, and tracing keep working unchanged.
    """
    pieces: list[str] = []
    async for delta in client.chat_completion_stream(
        messages=messages,
        model=model,
        provider=provider,
        api_key=api_key,
        base_url=base_url,
        temperature=0.0,
        max_tokens=600,
    ):
        pieces.append(delta)
        token_sink.put_nowait(delta)
    draft = "".join(pieces)
    last = client.last_response or {}
    served_model = last.get("model") or model
    return {
        "id": "cmpl-stream",
        "object": "chat.completion",
        "model": served_model,
        "provider": last.get("provider") or provider,
        "requested_model": model,
        "raw_response": {"model": served_model, "choices": [{"message": {"content": draft}}]},
        "choices": [{"index": 0, "message": {"role": "assistant", "content": draft}, "finish_reason": "stop"}],
        "usage": None,
    }


_SHORT_FACTUAL_MAX_CHARS = 50
_REFORMULATION_META_MARKERS = (
    "source question",
    "rewrite the",
    "keyword-rich",
    "proper nouns",
    "return only the query",
    "do not answer",
)


def _is_short_factual_query(query: str) -> bool:
    text = (query or "").strip()
    if not text:
        return True
    if len(text) < _SHORT_FACTUAL_MAX_CHARS:
        return True
    words = text.split()
    if len(words) <= 8 and re.match(
        r"^(what|which|who|where|when|how many|how much|is|are|does|do|can|could)\b",
        text,
        re.IGNORECASE,
    ):
        return True
    # Identifier-like queries (codes, names, dotted/underscored identifiers).
    return len(words) <= 3 and any(re.search(r"[\d_.-]", word) for word in words)


def _first_pass_retrieval_weak(chunks: Any, min_dense_score: float = 0.60) -> bool:
    if not chunks:
        return True
    for chunk in chunks:
        data = _result_dict(chunk)
        scores = data.get("scores")
        if not isinstance(scores, dict):
            scores = {key: data.get(key) for key in ("dense", "bm25")}
        dense = scores.get("dense")
        if isinstance(dense, (int, float)) and not isinstance(dense, bool) and dense >= min_dense_score:
            return False
    return True


def _guard_reformulated_query(original: str, rewritten: Any) -> str:
    text = re.sub(r"\s+", " ", str(rewritten or "")).strip().strip('"').strip("'")
    if not text:
        return original
    lowered = text.lower()
    if any(marker in lowered for marker in _REFORMULATION_META_MARKERS):
        return original
    if len(text) > max(120, len(original.strip()) + 40):
        return original
    original_tokens = {token for token in re.findall(r"\w+", original.lower()) if len(token) > 2}
    rewritten_tokens = set(re.findall(r"\w+", text.lower()))
    if original_tokens and not (original_tokens & rewritten_tokens):
        return original
    return text


async def _rewrite_query(
    query: str,
    client: LiteLLMClient,
    config: Mapping[str, Any],
) -> str:
    response = await client.chat_completion(
        messages=[
            {"role": "system", "content": _REFORMULATE_PROMPT},
            {"role": "user", "content": f"Source question:\n{query}"},
        ],
        model=config.get("model") or "gpt-4o-mini",
        provider=config.get("provider"),
        api_key=config.get("api_key"),
        base_url=config.get("base_url"),
        temperature=0.0,
        max_tokens=120,
    )
    content = response.get("choices", [{}])[0].get("message", {}).get("content", "")
    rewritten = re.sub(r"\s+", " ", content).strip().strip('"')
    return _guard_reformulated_query(query, rewritten)


def build_rag_agent_graph(
    retriever: Any,
    graph_store: KnowledgeGraphStore,
    llm_client: LiteLLMClient | None = None,
    llm_config_getter: Callable[[], Mapping[str, Any]] | None = None,
    min_dense_score: float = 0.60,
    graph_enabled: bool = False,
    graph_context_enabled: bool = False,
    debug_log_prompts: bool = False,
    verify_mode: VerificationMode | None = None,
    verify_fn: Callable[..., Awaitable[VerificationResult]] | None = None,
    reformulate_fn: Callable[..., str | Awaitable[str]] | None = None,
    tracer: Any | None = None,
):
    """Compile the retrieve, sufficiency, generation, verification, and retry graph."""
    mode = verify_mode or get_settings().verify_mode
    client = llm_client or LiteLLMClient()
    verifier = verify_fn or verify_answer
    refusal_generator = SafeRefusalGenerator()
    insufficient_answer = "I don't have enough information in the provided documents to answer that."

    def retrieve_node(state: RagAgentState, config: RunnableConfig) -> dict[str, Any]:
        query = state.get("current_search_query") or state["query"]
        cycle = state.get("cycle_count", 0) + 1
        configured_top_k, _ = resolve_retrieval_breadth(config)
        top_k = min(max(state.get("retry_top_k", configured_top_k), MIN_TOP_K), MAX_TOP_K)
        started = time.perf_counter()
        retrieve_options = {
            "top_k": top_k,
            "tenant_id": state.get("tenant_id", "default"),
        }
        flagged_chunk_ids = set(state.get("flagged_chunk_ids", []))
        if flagged_chunk_ids:
            retrieve_options["flagged_chunk_ids"] = flagged_chunk_ids
        result = retriever.retrieve(query, **retrieve_options)
        sources = [_to_search_result(ranked) for ranked in result.chunks[:top_k]]
        entities: list[Entity] = []
        graph_context: list[dict[str, Any]] = []

        if graph_enabled:
            tenant_id = state.get("tenant_id", "default")
            tenant_entities = graph_store.get_entities(tenant_id=tenant_id)
            tenant_entities_by_name = {entity.name: entity for entity in tenant_entities}
            query_words = [re.sub(r"[^\w-]", "", word).strip() for word in query.split()]
            stopwords = {
                "the", "and", "for", "what", "which", "who", "does", "did", "is", "are", "was", "were",
                "its", "how", "why", "when", "where", "use", "uses", "used", "using", "each", "provide",
                "because", "between", "from", "with", "that", "this", "into", "about", "can", "will",
            }
            exact_hits: list[Entity] = []
            fuzzy_hits: list[Entity] = []
            seen: set[str] = set()
            normalized_query = " ".join(re.findall(r"\w+", query.casefold()))
            for candidate in tenant_entities:
                name = candidate.normalized_name or " ".join(re.findall(r"\w+", candidate.name.casefold()))
                if name and f" {name} " in f" {normalized_query} " and candidate.name not in seen:
                    exact_hits.append(candidate)
                    seen.add(candidate.name)
            for word in query_words:
                lowered = word.lower()
                if len(lowered) < 3 or lowered in stopwords:
                    continue
                entity = graph_store.get_entity_by_lowercase_name(lowered, tenant_id=tenant_id)
                if entity and entity.name not in seen:
                    exact_hits.append(entity)
                    seen.add(entity.name)
                else:
                    for entity_name, candidate in tenant_entities_by_name.items():
                        if entity_name in seen:
                            continue
                        name = entity_name.lower()
                        if min(len(lowered), len(name)) >= 5 and lowered == name:
                            fuzzy_hits.append(candidate)
                            seen.add(entity_name)
            entities.extend(exact_hits[:8])
            entities.extend(fuzzy_hits[: max(0, 12 - len(entities))])
            matched_names = {entity.name for entity in entities}
            frontier = list(entities)
            source_chunk_ids = {source.chunk_id for source in sources}
            traversed: set[tuple[str, str, str]] = set()
            for _depth in range(2):
                next_frontier: list[Entity] = []
                for entity in frontier:
                    for relation in graph_store.query_neighborhood(entity.name, tenant_id=tenant_id):
                        edge = (relation.source_entity, relation.relation_type, relation.target_entity)
                        if edge not in traversed:
                            traversed.add(edge)
                            cited_chunk_ids = sorted(set(relation.chunk_ids) & source_chunk_ids)
                            if graph_context_enabled and cited_chunk_ids:
                                graph_context.append({
                                    "source_entity": relation.source_entity,
                                    "relation_type": relation.relation_type,
                                    "target_entity": relation.target_entity,
                                    "chunk_ids": cited_chunk_ids,
                                })
                        for target in (relation.source_entity, relation.target_entity):
                            if target and target not in matched_names:
                                matched_names.add(target)
                                graph_entity = tenant_entities_by_name.get(target)
                                if graph_entity:
                                    entities.append(graph_entity)
                                    next_frontier.append(graph_entity)
                frontier = next_frontier
            if not entities and tenant_entities:
                entities = tenant_entities[:10]

        timings = dict(state.get("timings_ms") or {})
        for stage, value in (result.timings_ms or {}).items():
            timings[stage] = timings.get(stage, 0.0) + (value or 0.0)
        if "retrieve" not in timings:
            timings["retrieve"] = (time.perf_counter() - started) * 1000
        return {
            "retrieved_chunks": sources,
            "entities": entities,
            "graph_context": graph_context,
            "cycle_count": cycle,
            "base_top_k": configured_top_k,
            "retry_top_k": top_k,
            "timings_ms": timings,
        }

    def check_sufficiency_node(state: RagAgentState) -> dict[str, Any]:
        chunks = [_result_dict(source) for source in state.get("retrieved_chunks", [])]
        if has_sufficient_context(state["query"], chunks, min_dense_score=min_dense_score):
            return {}
        return {
            "draft_answer": insufficient_answer,
            "answer_status": "insufficient_context",
            "verification_result": VerificationResult(status="unchecked", scope="unchecked"),
            "is_refusal": False,
        }

    async def generate_node(state: RagAgentState, config: RunnableConfig) -> dict[str, Any]:
        chunks = [_result_dict(source) for source in state.get("retrieved_chunks", [])]
        prompt = build_prompt(state["query"].strip(), chunks)
        selected_chunks = prompt.selected_chunks
        if not selected_chunks or not has_sufficient_context(
            state["query"], selected_chunks, min_dense_score=min_dense_score
        ):
            return {
                "draft_answer": insufficient_answer,
                "answer_status": "insufficient_context",
                "verification_result": VerificationResult(status="unchecked", scope="unchecked"),
            }

        if graph_context_enabled and state.get("graph_context"):
            prompt.messages[1]["content"] += _format_graph_facts(
                state["graph_context"], selected_chunks
            )

        cfg = _active_llm_config(llm_config_getter)
        token_sink = ((config or {}).get("configurable") or {}).get("token_sink")
        provider = cfg.get("provider", "openai")
        api_key = cfg.get("api_key")
        model = cfg.get("model") or "gpt-4o-mini"
        started = time.perf_counter()
        try:
            if debug_log_prompts:
                _log_debug_payload("prompt", state.get("request_id", ""), prompt.messages, api_key)
            generation_context = (
                tracer.generation(
                    "generate",
                    tenant_id=state.get("tenant_id", "default"),
                    model=model,
                    provider=provider,
                )
                if tracer is not None
                else nullcontext(None)
            )
            with generation_context as generation:
                if token_sink is None:
                    response = await client.chat_completion(
                        messages=prompt.messages,
                        model=model,
                        provider=provider,
                        api_key=api_key,
                        base_url=cfg.get("base_url"),
                        temperature=0.0,
                        max_tokens=600,
                    )
                else:
                    response = await _stream_completion(
                        client,
                        prompt.messages,
                        model,
                        provider,
                        api_key,
                        cfg.get("base_url"),
                        token_sink,
                    )
                draft = response.get("choices", [{}])[0].get("message", {}).get("content", "")
                served_model = response.get("model", model)
                usage = normalize_usage(
                    response,
                    prompt=json.dumps(prompt.messages, ensure_ascii=False),
                    completion=draft,
                    model=served_model,
                )
                if generation is not None:
                    generation.set_attribute("model", served_model)
                    generation.set_attribute("provider", response.get("provider", provider))
                    generation.set_tokens(
                        prompt_tokens=usage["prompt_tokens"],
                        completion_tokens=usage["completion_tokens"],
                        model=served_model,
                        estimated=usage["estimated"],
                        cost_usd=usage["cost_usd"],
                    )
            if debug_log_prompts:
                _log_debug_payload("response", state.get("request_id", ""), response.get("raw_response", response), api_key)
            if not draft.strip():
                return {
                    "draft_answer": insufficient_answer,
                    "answer_status": "insufficient_context",
                    "verification_result": VerificationResult(status="unchecked", scope="unchecked"),
                }
        except ProviderError as error:
            if "empty completion" in str(error.message if hasattr(error, "message") else error).lower():
                return {
                    "draft_answer": insufficient_answer,
                    "answer_status": "insufficient_context",
                    "verification_result": VerificationResult(status="unchecked", scope="unchecked"),
                }
            raise
        except Exception as exc:
            provider_message = str(exc)
            if api_key:
                provider_message = provider_message.replace(api_key, "[REDACTED]")
            logger.error("LLM generation failed via %s (%s): %s", provider, model, provider_message)
            raise ProviderError(provider, 502, f"Provider {provider} request failed", provider_message) from exc

        timings = dict(state.get("timings_ms") or {})
        timings["generate"] = timings.get("generate", 0.0) + (time.perf_counter() - started) * 1000
        draft_status = (
            "insufficient_context"
            if isinstance(draft, str)
            and (draft.strip() == insufficient_answer or draft.strip().startswith(insufficient_answer))
            else "answered"
        )
        return {
            "draft_answer": draft,
            "retrieved_chunks": [SearchResult.model_validate(item) for item in selected_chunks],
            "answer_status": draft_status,
            "verification_result": None,
            "is_refusal": False,
            "serving_provider": response.get("provider", provider),
            "serving_model": served_model,
            "usage": usage,
            "timings_ms": timings,
        }

    def _log_debug_payload(kind: str, request_id: str, payload: Any, api_key: str | None) -> None:
        serialized = json.dumps(payload, ensure_ascii=False, default=str)
        if api_key:
            serialized = serialized.replace(api_key, "[REDACTED]")
        logger.debug("request_id=%s %s=%s", request_id, kind, serialized)

    async def verify_node(state: RagAgentState) -> dict[str, Any]:
        if state.get("answer_status") == "insufficient_context" or (
            isinstance(state.get("draft_answer"), str)
            and (
                state.get("draft_answer", "").strip() == insufficient_answer
                or state.get("draft_answer", "").strip().startswith(insufficient_answer)
            )
        ):
            return {
                "answer_status": "insufficient_context",
                "verification_result": VerificationResult(status="unchecked", scope="unchecked"),
            }
        sources = [
            VerificationSource(index=index, text=source.text, chunk_id=source.chunk_id)
            for index, source in enumerate(state.get("retrieved_chunks", []), start=1)
        ]
        cfg = _active_llm_config(llm_config_getter)
        started = time.perf_counter()
        span_context = (
            tracer.span(
                "verify",
                tenant_id=state.get("tenant_id", "default"),
                mode=mode,
            )
            if tracer is not None
            else nullcontext()
        )
        with span_context:
            result = await verifier(
                question=state["query"],
                answer=state.get("draft_answer", ""),
                sources=sources,
                mode=mode,
                answer_status=state.get("answer_status", "answered"),
                llm_client=client,
                llm_config=cfg,
                model=cfg.get("model") or "gpt-4o-mini",
            )
        timings = dict(state.get("timings_ms") or {})
        timings["verify"] = timings.get("verify", 0.0) + (time.perf_counter() - started) * 1000
        return {"verification_result": result, "timings_ms": timings}

    async def reformulate_node(state: RagAgentState) -> dict[str, Any]:
        query = state["query"]
        cfg = _active_llm_config(llm_config_getter)
        llm_available = bool(cfg.get("api_key") or cfg.get("base_url"))
        top_k = state.get("base_top_k", DEFAULT_TOP_K)
        short_query = _is_short_factual_query(query)
        retrieval_weak = _first_pass_retrieval_weak(state.get("retrieved_chunks", []), min_dense_score)
        use_llm_reformulation = (
            (not short_query)
            and retrieval_weak
            and bool(reformulate_fn or mode == "llm" or llm_available)
        )
        next_top_k = state.get("retry_top_k", top_k)
        if not use_llm_reformulation:
            next_top_k = min(max(next_top_k * 2, MIN_TOP_K), MAX_TOP_K)
        if use_llm_reformulation:
            try:
                if reformulate_fn:
                    value = reformulate_fn(query, llm_client=client, llm_config=cfg)
                    rewritten = await value if hasattr(value, "__await__") else value
                    rewritten = _guard_reformulated_query(query, rewritten)
                else:
                    rewritten = await _rewrite_query(query, client, cfg)
            except Exception as exc:  # noqa: BLE001 - a failed rewrite falls back to broader retrieval.
                logger.warning("Query reformulation failed (%s); retrying with broader retrieval", type(exc).__name__)
                rewritten = query
                next_top_k = min(max(next_top_k * 2, MIN_TOP_K), MAX_TOP_K)
        else:
            rewritten = query
        rewritten = str(rewritten).strip() or query
        debug = dict(state.get("debug") or {})
        debug.setdefault("reformulated_queries", []).append(rewritten)
        debug.setdefault("retrieval_attempts", []).append({"query": rewritten, "top_k": next_top_k})
        return {
            "current_search_query": rewritten,
            "retry_top_k": next_top_k,
            "debug": debug,
        }

    def route_after_sufficiency(state: RagAgentState) -> str:
        return "end" if state.get("answer_status") == "insufficient_context" else "generate"

    def route_after_verification(state: RagAgentState) -> str:
        result = state.get("verification_result")
        draft = state.get("draft_answer", "")
        if state.get("answer_status") == "insufficient_context" or (
            isinstance(draft, str)
            and (draft.strip() == insufficient_answer or draft.strip().startswith(insufficient_answer))
        ):
            return "end"
        if result is None or result.status not in {"citations_failed", "unsupported"}:
            return "end"
        if state.get("cycle_count", 0) < state.get("max_cycles", 1):
            return "reformulate"
        if result.status == "citations_failed":
            return "unverified"
        return "refused"

    def exhausted_attempts_node(state: RagAgentState) -> dict[str, Any]:
        result = state.get("verification_result")
        draft = state.get("draft_answer", "")
        if isinstance(draft, str) and (
            draft.strip() == insufficient_answer or draft.strip().startswith(insufficient_answer)
        ):
            status = "insufficient_context"
        else:
            status = "unverified" if result and result.status == "citations_failed" else "refused"
        update: dict[str, Any] = {"answer_status": status, "is_refusal": status == "refused"}
        if status == "refused":
            update["draft_answer"] = refusal_generator.generate(state["query"])
        return update

    workflow = StateGraph(RagAgentState)
    workflow.add_node("retrieve", retrieve_node)
    workflow.add_node("check_sufficiency", check_sufficiency_node)
    workflow.add_node("generate", generate_node)
    workflow.add_node("verify", verify_node)
    workflow.add_node("route", lambda state: {})
    workflow.add_node("reformulate", reformulate_node)
    workflow.add_node("finish_failed", exhausted_attempts_node)
    workflow.set_entry_point("retrieve")
    workflow.add_edge("retrieve", "check_sufficiency")
    workflow.add_conditional_edges(
        "check_sufficiency",
        route_after_sufficiency,
        {"end": END, "generate": "generate"},
    )
    workflow.add_edge("generate", "verify")
    workflow.add_edge("verify", "route")
    workflow.add_conditional_edges(
        "route",
        route_after_verification,
        {"end": END, "reformulate": "reformulate", "unverified": "finish_failed", "refused": "finish_failed"},
    )
    workflow.add_edge("reformulate", "retrieve")
    workflow.add_edge("finish_failed", END)
    return workflow.compile()
