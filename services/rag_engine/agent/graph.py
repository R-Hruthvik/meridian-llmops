import json
import logging
import re
import time
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, StateGraph

logger = logging.getLogger("meridian.rag_engine.agent")

# Per-request retrieval breadth. Travels in RunnableConfig["configurable"] rather
# than RagAgentState: a control knob must not bloat every checkpoint, and adding
# one later needs no state-schema change and no graph recompile.
DEFAULT_TOP_K = 5
MIN_TOP_K = 1
MAX_TOP_K = 20

from packages.core.errors import ProviderError
from packages.verification.tiered_verifier import TieredCitationVerifier
from services.gateway.client import LiteLLMClient
from services.ingestion.graph_store import KnowledgeGraphStore
from services.rag_engine.agent.critic import CriticAgent
from services.rag_engine.agent.reformulator import QueryReformulator
from services.rag_engine.agent.refusal import SafeRefusalGenerator
from services.rag_engine.agent.state import RagAgentState
from services.rag_engine.generation.prompt import build_prompt
from services.rag_engine.generation.sufficiency import has_sufficient_context
from services.rag_engine.retrieval.hybrid import RankedChunk


def _retrieval_state_dict(ranked: RankedChunk) -> dict[str, Any]:
    """Flatten a ranked chunk into the graph state's dict shape.

    Carries chunk_id and the fused score so downstream nodes and the API
    response can cite the real chunk with its metadata, not a relabeled guess.
    """
    chunk = ranked.chunk
    return {
        "chunk_id": chunk.id,
        "document_id": chunk.document_id,
        "text": chunk.text,
        "rank": ranked.rank,
        "chunk_index": chunk.chunk_index,
        "section_heading": chunk.section_heading or "",
        "heading_path": chunk.metadata.get("heading_path") or chunk.section_heading or "",
        "filename": ranked.filename,
        "page_start": ranked.page_start,
        "title": chunk.metadata.get("title", ""),
        "score": ranked.score,
        "scores": dict(ranked.scores),
        "metadata": chunk.metadata,
    }


def _positive_int(value: Any) -> int | None:
    """Return value if it is a usable positive int, else None (bools rejected)."""
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    return value


def resolve_retrieval_breadth(config: RunnableConfig | None) -> tuple[int, int]:
    """Resolve a bounded request cut, retaining the legacy tuple return shape."""
    configurable = (config or {}).get("configurable") or {}

    requested_top_k = _positive_int(configurable.get("top_k"))
    top_k = min(max(requested_top_k or DEFAULT_TOP_K, MIN_TOP_K), MAX_TOP_K)

    return top_k, top_k


def build_rag_agent_graph(
    retriever: Any,
    graph_store: KnowledgeGraphStore,
    llm_client: LiteLLMClient | None = None,
    llm_config_getter: Any | None = None,
    min_dense_score: float = 0.70,
    graph_enabled: bool = False,
    debug_log_prompts: bool = False,
):
    """Assembles and compiles the cyclic LangGraph RAG workflow."""
    critic = CriticAgent()
    tiered_verifier = TieredCitationVerifier()
    reformulator = QueryReformulator()

    refusal_gen = SafeRefusalGenerator()
    client = llm_client or LiteLLMClient()
    insufficient_answer = "I don't have enough information in the provided documents to answer that."

    # --- Node Definitions ---

    def retrieve_node(state: RagAgentState, config: RunnableConfig) -> dict[str, Any]:
        query = state.get("current_search_query") or state["query"]
        cycle = state.get("cycle_count", 0) + 1
        top_k, _recall_k = resolve_retrieval_breadth(config)
        started = time.perf_counter()
        result = retriever.retrieve(query, top_k=top_k, tenant_id=state.get("tenant_id", "default"))
        chunk_dicts = [_retrieval_state_dict(ranked) for ranked in result.chunks[:top_k]]

        extracted_entities: list[dict[str, Any]] = []
        if graph_enabled:
            query_words = [re.sub(r"[^\w-]", "", word).strip() for word in query.split()]
            stopwords = {"the", "and", "for", "what", "which", "who", "does", "did", "is", "are", "was", "were", "its", "how", "why", "when", "where", "use", "uses", "used", "using", "each", "provide", "because", "between", "from", "with", "that", "this", "into", "about", "can", "will"}
            exact_hits: list[dict[str, Any]] = []
            fuzzy_hits: list[dict[str, Any]] = []
            seen: set[str] = set()
            for word in query_words:
                lowered = word.lower()
                if len(lowered) < 3 or lowered in stopwords:
                    continue
                entity = graph_store.get_entity_by_lowercase_name(lowered)
                if entity and entity.name not in seen:
                    exact_hits.append({"name": entity.name, "entity_type": entity.entity_type})
                    seen.add(entity.name)
                else:
                    for entity_name, entity in graph_store.entities.items():
                        if entity_name in seen:
                            continue
                        name = entity_name.lower()
                        if min(len(lowered), len(name)) >= 5 and (lowered in name or name in lowered):
                            fuzzy_hits.append({"name": entity.name, "entity_type": entity.entity_type})
                            seen.add(entity_name)
            extracted_entities.extend(exact_hits[:8])
            extracted_entities.extend(fuzzy_hits[: max(0, 12 - len(extracted_entities))])
            matched_names = {entity["name"] for entity in extracted_entities}
            for entity_info in list(extracted_entities):
                for relation in graph_store.query_neighborhood(entity_info["name"]):
                    for target in (relation.source_entity, relation.target_entity):
                        if target and target not in matched_names:
                            matched_names.add(target)
                            graph_entity = graph_store.entities.get(target)
                            extracted_entities.append({"name": target, "entity_type": graph_entity.entity_type if graph_entity else "Concept"})
            if not extracted_entities and graph_store.entities:
                extracted_entities = [{"name": entity.name, "entity_type": entity.entity_type} for entity in list(graph_store.entities.values())[:10]]

        timings = dict(state.get("timings_ms") or {})
        timings["retrieve"] = timings.get("retrieve", 0.0) + result.timings_ms.get("total", (time.perf_counter() - started) * 1000)
        return {
            "retrieved_chunks": chunk_dicts,
            "entities": extracted_entities,
            "cycle_count": cycle,
            "timings_ms": timings,
        }

    async def generate_node(state: RagAgentState) -> dict[str, Any]:
        query = state["query"].strip()
        clean_q = query.lower()

        # Handle greetings & general conversational queries
        greetings = [
            "hi", "hello", "hey", "greetings", "good morning", "good afternoon",
            "good evening", "how are you", "who are you", "what can you do", "help"
        ]
        if clean_q in greetings or any(clean_q.startswith(g) for g in ["hi ", "hello ", "hey "]):
            return {
                "draft_answer": (
                    "Hello! I am Meridian AI, your enterprise LLMOps and Knowledge Assistant. "
                    "I can answer questions from your knowledge base, check security guardrails, "
                    "or ingest documentation into Qdrant & Neo4j. How can I assist you today?"
                ),
                "answer_status": "answered",
            }

        chunks = state.get("retrieved_chunks", [])
        if not has_sufficient_context(query, chunks, min_dense_score=min_dense_score):
            return {
                "draft_answer": insufficient_answer,
                "answer_status": "insufficient_context",
                "is_grounded": False,
            }

        prompt = build_prompt(query, chunks)
        selected_chunks = prompt.selected_chunks
        if not selected_chunks or not has_sufficient_context(
            query, selected_chunks, min_dense_score=min_dense_score
        ):
            return {
                "draft_answer": insufficient_answer,
                "answer_status": "insufficient_context",
                "is_grounded": False,
            }
        messages = prompt.messages

        cfg = llm_config_getter() if llm_config_getter else {}
        provider = cfg.get("provider", "openai")
        api_key = cfg.get("api_key")
        base_url = cfg.get("base_url")
        model = cfg.get("model", "gpt-4o-mini")

        started = time.perf_counter()
        try:
            if debug_log_prompts:
                _log_debug_payload("prompt", state.get("request_id", ""), messages, api_key)
            resp = await client.chat_completion(
                messages=messages,
                model=model,
                provider=provider,
                api_key=api_key,
                base_url=base_url,
                temperature=0.0,
                max_tokens=600,
            )
            draft = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
            if debug_log_prompts:
                _log_debug_payload("response", state.get("request_id", ""), resp.get("raw_response", resp), api_key)
            if not draft.strip():
                raise ProviderError(
                    provider,
                    502,
                    f"Provider {provider} returned an empty completion",
                )
        except ProviderError:
            raise
        except Exception as e:
            provider_message = str(e)
            if api_key:
                provider_message = provider_message.replace(api_key, "[REDACTED]")
            logger.error("LLM generation failed via %s (%s): %s", provider, model, provider_message)
            raise ProviderError(
                provider,
                502,
                f"Provider {provider} request failed",
                provider_message,
            ) from e

        timings = dict(state.get("timings_ms") or {})
        timings["generate"] = timings.get("generate", 0.0) + (time.perf_counter() - started) * 1000
        return {
            "draft_answer": draft,
            "generation_error": None,
            "retrieved_chunks": selected_chunks,
            "answer_status": "answered",
            "serving_provider": resp.get("provider", provider),
            "serving_model": resp.get("model", model),
            "usage": resp.get("usage"),
            "timings_ms": timings,
        }

    def _log_debug_payload(kind: str, request_id: str, payload: Any, api_key: str | None) -> None:
        serialized = json.dumps(payload, ensure_ascii=False, default=str)
        if api_key:
            serialized = serialized.replace(api_key, "[REDACTED]")
        logger.debug("request_id=%s %s=%s", request_id, kind, serialized)

    def critic_node(state: RagAgentState) -> dict[str, Any]:
        started = time.perf_counter()
        query = state["query"]
        draft = state.get("draft_answer", "")
        context = "\n".join([c.get("text", "") for c in state.get("retrieved_chunks", [])])

        verdict = critic.evaluate(query=query, draft=draft, context=context)

        # Decompose draft into sentence claims and verify via 3-Tier Verifier
        sentences = [s.strip() for s in draft.split(".") if s.strip()]
        verification_res = tiered_verifier.verify_claims(sentences, state.get("retrieved_chunks", []))

        timings = dict(state.get("timings_ms") or {})
        timings["verify"] = timings.get("verify", 0.0) + (time.perf_counter() - started) * 1000
        return {
            "critic_verdict": verdict.model_dump(),
            "is_grounded": verdict.is_grounded,
            "claims": [c.model_dump() for c in verification_res.claims],
            "verification_result": verification_res.model_dump(),
            "timings_ms": timings,
        }


    def reformulate_node(state: RagAgentState) -> dict[str, Any]:
        cycle = state.get("cycle_count", 1)
        new_query = reformulator.reformulate(state["query"], cycle)
        return {"current_search_query": new_query}

    def refusal_node(state: RagAgentState) -> dict[str, Any]:
        refusal_text = refusal_gen.generate(state["query"])
        return {
            "draft_answer": refusal_text,
            "is_refusal": True,
            "is_grounded": False,
        }

    # --- Routing Condition ---

    def route_after_critique(state: RagAgentState) -> str:
        if state.get("answer_status") == "insufficient_context":
            return "end"
        if state.get("is_grounded", False):
            return "end"

        # If not grounded, check cycle limit
        if state.get("cycle_count", 0) >= state.get("max_cycles", 2):
            return "refuse"

        return "reformulate"

    # --- Build Graph ---

    workflow = StateGraph(RagAgentState)

    workflow.add_node("retrieve", retrieve_node)
    workflow.add_node("generate", generate_node)
    workflow.add_node("critique", critic_node)
    workflow.add_node("reformulate", reformulate_node)
    workflow.add_node("refuse", refusal_node)

    workflow.set_entry_point("retrieve")
    workflow.add_edge("retrieve", "generate")
    workflow.add_edge("generate", "critique")

    workflow.add_conditional_edges(
        "critique",
        route_after_critique,
        {
            "end": END,
            "reformulate": "reformulate",
            "refuse": "refuse",
        },
    )

    workflow.add_edge("reformulate", "retrieve")
    workflow.add_edge("refuse", END)

    return workflow.compile()
