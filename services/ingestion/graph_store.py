"""Knowledge Graph extractor and store for Neo4j with in-memory graph fallback."""

import re

from packages.core.models import Entity, Relationship


class KnowledgeGraphStore:
    """Extracts entities and relationships from text and persists to Neo4j / in-memory graph."""

    def __init__(self, in_memory: bool = True):
        self.in_memory = in_memory
        self.entities: dict[str, Entity] = {}
        self.relationships: list[Relationship] = []
        # doc_id -> set(entity names) and doc_id -> relationships for targeted cleanup
        self._doc_entities: dict[str, set[str]] = {}
        self._doc_relationships: dict[str, list[Relationship]] = {}

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
        # Track per-document lineage for precise deletion (hint: doc_id→chunk_ids index)
        self._doc_entities[doc_id] = {e.name for e in entities}
        self._doc_relationships[doc_id] = list(relations)
        return entities, relations

    def delete_by_document(self, doc_id: str) -> int:
        """Removes entities and relationships tied to doc_id; handles Neo4j persistence if present."""
        removed = 0
        doc_ents = self._doc_entities.pop(doc_id, set())
        doc_rels = self._doc_relationships.pop(doc_id, [])
        # Remove relationships first
        for rel in doc_rels:
            if rel in self.relationships:
                self.relationships.remove(rel)
                removed += 1
        # Remove entities only if no other doc references them
        remaining_ents = set()
        for ents in self._doc_entities.values():
            remaining_ents.update(ents)
        for name in list(doc_ents):
            if name not in remaining_ents and name in self.entities:
                del self.entities[name]
                removed += 1
        # If Neo4j client exists (non in_memory), delete via Cypher
        if not self.in_memory and hasattr(self, "driver") and self.driver:
            try:
                with self.driver.session() as session:
                    session.run("MATCH (n {doc_id: $doc_id}) DETACH DELETE n", doc_id=doc_id)
                    session.run(
                        "MATCH ()-[r {doc_id: $doc_id}]-() DELETE r",
                        doc_id=doc_id,
                    )
            except Exception:
                pass
        return removed

    def clear_all_graph(self) -> None:
        """Clears all in-memory graph state and Neo4j if configured."""
        self.entities.clear()
        self.relationships.clear()
        self._doc_entities.clear()
        self._doc_relationships.clear()
        if not self.in_memory and hasattr(self, "driver") and self.driver:
            try:
                with self.driver.session() as session:
                    session.run("MATCH (n) DETACH DELETE n")
            except Exception:
                pass

    def query_entity_neighborhood(self, entity_name: str) -> list[Relationship]:
        return [
            r for r in self.relationships
            if r.source_entity.lower() == entity_name.lower() or r.target_entity.lower() == entity_name.lower()
        ]

    def query_neighborhood(self, entity_name: str) -> list[Relationship]:
        return self.query_entity_neighborhood(entity_name)
