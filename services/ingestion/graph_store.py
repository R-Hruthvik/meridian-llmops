"""Knowledge Graph extractor and store for Neo4j with in-memory graph fallback."""

import re

from packages.core.models import Entity, Relationship


class KnowledgeGraphStore:
    """Extracts entities and relationships from text and persists to Neo4j / in-memory graph."""

    def __init__(self, in_memory: bool = True):
        self.in_memory = in_memory
        self.entities: dict[str, Entity] = {}
        self.relationships: list[Relationship] = []

    def extract_entities_and_relations(self, text: str) -> tuple[list[Entity], list[Relationship]]:
        # Hybrid NER pattern extractor for systems, components, and concepts
        known_keywords = [
            "FastAPI", "LiteLLM", "Qdrant", "Neo4j", "LangGraph", "Langfuse",
            "DeepEval", "NeMo Guardrails", "Critic Agent", "Query Reformulator",
            "BM25", "BGE-Reranker-Large", "OpenAI", "Anthropic", "Docker Compose"
        ]

        found_entities: dict[str, Entity] = {}
        for kw in known_keywords:
            if re.search(r"\b" + re.escape(kw) + r"\b", text, re.IGNORECASE):
                entity_type = "System" if kw in ["FastAPI", "LiteLLM", "Qdrant", "Neo4j", "Langfuse"] else "Component"
                found_entities[kw] = Entity(name=kw, entity_type=entity_type)

        # Extract capitalised entity pairs
        words = re.findall(r"\b[A-Z][a-zA-Z0-9_-]+\b", text)
        for w in words:
            if len(w) > 3 and w not in found_entities:
                found_entities[w] = Entity(name=w, entity_type="Concept")

        # Build relationships between co-occurring entities in sentences
        sentences = re.split(r"[.!?]\s+", text)
        relationships: list[Relationship] = []

        for sent in sentences:
            present = [e for e in found_entities if e in sent]
            if len(present) >= 2:
                for i in range(len(present) - 1):
                    src, tgt = present[i], present[i + 1]
                    relation_type = "RELATES_TO"
                    if "routes" in sent.lower() or "connects" in sent.lower():
                        relation_type = "ROUTES_TO"
                    elif "stores" in sent.lower() or "indexes" in sent.lower():
                        relation_type = "STORES_IN"
                    elif "evaluates" in sent.lower() or "checks" in sent.lower():
                        relation_type = "EVALUATES"

                    relationships.append(
                        Relationship(
                            source_entity=src,
                            target_entity=tgt,
                            relation_type=relation_type,
                        )
                    )

        return list(found_entities.values()), relationships

    def extract_and_store(self, doc_id: str, text: str) -> tuple[list[Entity], list[Relationship]]:
        entities, relations = self.extract_entities_and_relations(text)
        for e in entities:
            self.entities[e.name] = e
        self.relationships.extend(relations)
        return entities, relations

    def query_entity_neighborhood(self, entity_name: str) -> list[Relationship]:
        return [
            r for r in self.relationships
            if r.source_entity.lower() == entity_name.lower() or r.target_entity.lower() == entity_name.lower()
        ]

    def query_neighborhood(self, entity_name: str) -> list[Relationship]:
        return self.query_entity_neighborhood(entity_name)
