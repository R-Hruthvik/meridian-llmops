"""Knowledge Graph extractor and store for Neo4j with in-memory graph fallback."""

import logging
import re

from packages.core.config import get_settings
from packages.core.models import Entity, Relationship

logger = logging.getLogger("meridian.ingestion.graph_store")


class KnowledgeGraphStore:
    """Extracts entities and relationships from text and persists to Neo4j / in-memory graph."""

    def __init__(self, in_memory: bool = True):
        self.in_memory = in_memory
        self.entities: dict[str, Entity] = {}
        self.relationships: list[Relationship] = []
        # doc_id -> set(entity names) and doc_id -> relationships for targeted cleanup
        self._doc_entities: dict[str, set[str]] = {}
        self._doc_relationships: dict[str, list[Relationship]] = {}
        self.driver: object | None = None
        self._neo4j_available: bool = False
        self._neo4j_fallback: bool = False

        if not self.in_memory:
            try:
                from neo4j import GraphDatabase  # type: ignore[import-untyped]

                settings = get_settings()
                self.driver = GraphDatabase.driver(
                    settings.neo4j_uri,
                    auth=(settings.neo4j_user, settings.neo4j_password or "meridian_password"),
                )
                # Test connectivity
                self.driver.verify_connectivity()  # type: ignore[attr-defined]
                self._neo4j_available = True
                logger.info("Neo4j connected at %s", settings.neo4j_uri)
            except Exception as e:  # noqa: BLE001
                logger.warning("Neo4j unavailable - using in-memory fallback: %s", e)
                self.driver = None
                self._neo4j_available = False
                self._neo4j_fallback = True
        else:
            logger.info("KnowledgeGraphStore in-memory mode (forced)")

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

        # Persist to Neo4j if available
        if self._neo4j_available and self.driver is not None:
            try:
                with self.driver.session() as session:  # type: ignore[attr-defined]
                    for e in entities:
                        session.run(  # type: ignore[attr-defined]
                            "MERGE (e:Entity {name: $name}) ON CREATE SET e.type = $entity_type, e.created_at = datetime(), e.doc_id = $doc_id",
                            name=e.name,
                            entity_type=e.entity_type,
                            doc_id=doc_id,
                        )
                    for r in relations:
                        session.run(  # type: ignore[attr-defined]
                            "MATCH (s:Entity {name: $source}), (t:Entity {name: $target}) MERGE (s)-[rel:RELATION {type: $rel_type}]->(t) ON CREATE SET rel.created_at = datetime(), rel.doc_id = $doc_id",
                            source=r.source_entity,
                            target=r.target_entity,
                            rel_type=r.relation_type,
                            doc_id=doc_id,
                        )
            except Exception as e:  # noqa: BLE001
                logger.warning("Neo4j extract_and_store failed for %s: %s", doc_id, e)

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
        if self._neo4j_available and self.driver is not None:
            try:
                with self.driver.session() as session:  # type: ignore[attr-defined]
                    session.run("MATCH (n {doc_id: $doc_id}) DETACH DELETE n", doc_id=doc_id)  # type: ignore[attr-defined]
                    session.run(  # type: ignore[attr-defined]
                        "MATCH ()-[r {doc_id: $doc_id}]-() DELETE r",
                        doc_id=doc_id,
                    )
            except Exception as e:  # noqa: BLE001 - Neo4j driver may raise varied exceptions
                logger.warning("Neo4j delete_by_document failed for %s: %s", doc_id, e)
        return removed

    def clear_all_graph(self) -> None:
        """Clears all in-memory graph state and Neo4j if configured."""
        self.entities.clear()
        self.relationships.clear()
        self._doc_entities.clear()
        self._doc_relationships.clear()
        if self._neo4j_available and self.driver is not None:
            try:
                with self.driver.session() as session:  # type: ignore[attr-defined]
                    session.run("MATCH (n) DETACH DELETE n")  # type: ignore[attr-defined]
            except Exception as e:  # noqa: BLE001 - Neo4j driver may raise varied exceptions
                logger.warning("Neo4j clear_all failed: %s", e)

    def query_entity_neighborhood(self, entity_name: str) -> list[Relationship]:
        if self._neo4j_available and self.driver is not None:
            try:
                with self.driver.session() as session:  # type: ignore[attr-defined]
                    result = session.run(  # type: ignore[attr-defined]
                        "MATCH (e:Entity {name: $entity_name})-[r]-(neighbor:Entity) RETURN e.name AS source_entity, type(r) AS relation_type, neighbor.name AS target_entity LIMIT 50",
                        entity_name=entity_name,
                    )
                    records = list(result)  # type: ignore[arg-type]
                    if records:
                        neo_rels: list[Relationship] = []
                        for rec in records:
                            data = rec.data() if hasattr(rec, "data") else dict(rec)
                            neo_rels.append(
                                Relationship(
                                    source_entity=data.get("source_entity", entity_name),
                                    target_entity=data.get("target_entity", ""),
                                    relation_type=data.get("relation_type", "RELATES_TO"),
                                )
                            )
                        if neo_rels:
                            return neo_rels
            except Exception as e:  # noqa: BLE001
                logger.warning("Neo4j query_neighborhood failed for %s: %s", entity_name, e)

        return [
            r for r in self.relationships
            if r.source_entity.lower() == entity_name.lower() or r.target_entity.lower() == entity_name.lower()
        ]

    def query_neighborhood(self, entity_name: str) -> list[Relationship]:
        return self.query_entity_neighborhood(entity_name)

    @property
    def is_fallback(self) -> bool:
        return self._neo4j_fallback or not self._neo4j_available and not self.in_memory
