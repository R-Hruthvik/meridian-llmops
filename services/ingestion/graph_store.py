"""Knowledge Graph extractor and store for Neo4j with in-memory graph fallback."""

import logging
import re
from itertools import pairwise

from packages.core.config import get_settings
from packages.core.models import Chunk, Entity, Relationship
from packages.core.retry_config import retry_on_connection_failure

logger = logging.getLogger("meridian.ingestion.graph_store")


def _normalized_name(name: str) -> str:
    return " ".join(re.findall(r"\w+", name.casefold()))


class KnowledgeGraphStore:
    """Extracts entities and relationships from text and persists to Neo4j / in-memory graph."""

    def __init__(self, in_memory: bool = True):
        self.in_memory = in_memory
        self.entities: dict[str, Entity] = {}
        self.relationships: list[Relationship] = []
        # doc_id -> set(entity names) and doc_id -> relationships for targeted cleanup
        self._doc_entities: dict[str, set[str]] = {}
        self._doc_relationships: dict[str, list[Relationship]] = {}
        self._tenant_entities: dict[str, dict[str, Entity]] = {}
        self._tenant_relationships: dict[str, list[Relationship]] = {}
        self._tenant_doc_entities: dict[tuple[str, str], set[str]] = {}
        self._tenant_doc_relationships: dict[tuple[str, str], list[Relationship]] = {}
        self._tenant_doc_chunks: dict[tuple[str, str], set[str]] = {}
        self.driver: object | None = None
        self._neo4j_available: bool = False
        self._neo4j_fallback: bool = False
        self._entity_names_lower: dict[str, str] = {}

        if not self.in_memory:
            from neo4j import GraphDatabase  # type: ignore[import-untyped]

            settings = get_settings()
            # Fail-closed: require explicit password configuration
            if not settings.neo4j_password:
                import os as _os

                if _os.environ.get("APP_ENV") == "testing":
                    # In testing, use in-memory fallback instead of connecting
                    logger.info(
                        "Neo4j password not configured in testing mode - using in-memory fallback"
                    )
                    self._neo4j_fallback = True
                    return  # Exit init, stay in memory mode
                else:
                    raise ValueError(
                        "NEO4J_PASSWORD environment variable is required. "
                        "Set it in your .env file or environment."
                    )

            # Bounded retry with tenacity: container may still be initializing (Bolt not yet serving)
            @retry_on_connection_failure(max_attempts=3)
            def _connect_neo4j():
                self.driver = GraphDatabase.driver(
                    settings.neo4j_uri,
                    auth=(settings.neo4j_user, settings.neo4j_password),
                    connection_timeout=10.0,
                    connection_acquisition_timeout=15.0,
                    max_transaction_retry_time=60.0,
                    max_connection_pool_size=50,
                )
                # Test connectivity
                self.driver.verify_connectivity()  # type: ignore[attr-defined]
                self._neo4j_available = True
                self._migrate_legacy_schema()
                logger.info("Neo4j connected at %s", settings.neo4j_uri)

            try:
                _connect_neo4j()
            except Exception as e:  # noqa: BLE001
                self.driver = None
                self._neo4j_available = False
                logger.warning("Neo4j unavailable - using in-memory fallback: %s", e)
                self._neo4j_fallback = True
        else:
            logger.info("KnowledgeGraphStore in-memory mode (forced)")

        self._build_entity_index()

    def extract_entities_and_relations(
        self, text: str, doc_id: str = "", chunks: list[Chunk] | None = None
    ) -> tuple[list[Entity], list[Relationship]]:
        # Hybrid NER pattern extractor for systems, components, and concepts
        known_keywords = [
            "FastAPI",
            "LiteLLM",
            "Qdrant",
            "Neo4j",
            "LangGraph",
            "Langfuse",
            "DeepEval",
            "NeMo Guardrails",
            "Critic Agent",
            "Query Reformulator",
            "BM25",
            "BGE-Reranker-Large",
            "OpenAI",
            "Anthropic",
            "Docker Compose",
        ]

        entity_types = {
            "fastapi": "System",
            "litellm": "System",
            "qdrant": "System",
            "neo4j": "System",
            "langfuse": "System",
        }
        display_names = {_normalized_name(word): word for word in known_keywords}
        entity_map: dict[str, Entity] = {}
        relation_map: dict[tuple[str, str, str], Relationship] = {}
        source_chunks = chunks or []
        sources = (
            [(chunk.text, chunk.id) for chunk in source_chunks] if source_chunks else [(text, "")]
        )
        for source_text, chunk_id in sources:
            names: dict[str, str] = {}
            for kw in known_keywords:
                if re.search(r"(?<!\w)" + re.escape(kw) + r"(?!\w)", source_text, re.IGNORECASE):
                    names[_normalized_name(kw)] = display_names[_normalized_name(kw)]
            # Capture capitalized multiword names as a single entity.
            for match in re.finditer(r"\b[A-Z][\w-]*(?:[ \t]+[A-Z][\w-]*){0,3}\b", source_text):
                name = match.group().strip(" .,:;!?()[]{}\"'")
                normalized = _normalized_name(name)
                if len(normalized) > 3:
                    names.setdefault(normalized, name)
            for normalized, name in names.items():
                entity_map.setdefault(
                    normalized,
                    Entity(
                        name=name,
                        normalized_name=normalized,
                        entity_type=entity_types.get(normalized, "Concept"),
                    ),
                )
                entity = entity_map[normalized]
                if doc_id and doc_id not in entity.document_ids:
                    entity.document_ids.append(doc_id)
                if chunk_id and chunk_id not in entity.chunk_ids:
                    entity.chunk_ids.append(chunk_id)

            sentences = re.split(r"(?<=[.!?])\s+", source_text)
            for sent in sentences:
                normalized_sentence = f" {_normalized_name(sent)} "
                present = [
                    normalized for normalized in names if f" {normalized} " in normalized_sentence
                ]
                present.sort(key=lambda normalized: normalized_sentence.index(f" {normalized} "))
                if len(present) < 2:
                    continue
                lowered = sent.casefold()
                relation_type = "RELATES_TO"
                if "routes" in lowered or "connects" in lowered:
                    relation_type = "ROUTES_TO"
                elif "stores" in lowered or "indexes" in lowered:
                    relation_type = "STORES_IN"
                elif "evaluates" in lowered or "checks" in lowered:
                    relation_type = "EVALUATES"
                for src, tgt in pairwise(present):
                    key = (src, tgt, relation_type)
                    relation = relation_map.setdefault(
                        key,
                        Relationship(
                            source_entity=entity_map[src].name,
                            target_entity=entity_map[tgt].name,
                            relation_type=relation_type,
                        ),
                    )
                    if doc_id and doc_id not in relation.document_ids:
                        relation.document_ids.append(doc_id)
                    if chunk_id and chunk_id not in relation.chunk_ids:
                        relation.chunk_ids.append(chunk_id)

        return list(entity_map.values()), list(relation_map.values())

    def _migrate_legacy_schema(self) -> None:
        """Upgrade legacy name/doc_ids and typed edge properties without dropping nodes."""
        if not self.driver:
            return
        with self.driver.session() as session:  # type: ignore[attr-defined]
            records = list(
                session.run(
                    "MATCH (e:Entity) RETURN id(e) AS node_id, e.name AS name, e.tenant_id AS tenant_id, "
                    "e.doc_ids AS legacy_doc_ids, e.document_ids AS document_ids, e.chunk_ids AS chunk_ids"
                )
            )
            for record in records:
                data = record.data() if hasattr(record, "data") else dict(record)
                document_ids = sorted(
                    set(data.get("document_ids") or []) | set(data.get("legacy_doc_ids") or [])
                )
                session.run(
                    "MATCH (e:Entity) WHERE id(e) = $node_id "
                    "SET e.normalized_name = $normalized_name, e.document_ids = $document_ids, "
                    "e.chunk_ids = coalesce(e.chunk_ids, $chunk_ids), "
                    "e.provenance_version = CASE WHEN size($document_ids) > 0 THEN 1 "
                    "ELSE e.provenance_version END",
                    node_id=data["node_id"],
                    normalized_name=_normalized_name(data.get("name") or ""),
                    document_ids=document_ids,
                    chunk_ids=data.get("chunk_ids") or [],
                )
                if document_ids and data.get("tenant_id"):
                    session.run(
                        "MATCH (e:Entity) WHERE id(e) = $node_id "
                        "UNWIND $document_ids AS document_id "
                        "MERGE (d:Document {id: document_id, tenant_id: $tenant_id}) "
                        "MERGE (e)-[:MENTIONED_IN]->(d)",
                        node_id=data["node_id"],
                        document_ids=document_ids,
                        tenant_id=data["tenant_id"],
                    )
            session.run(
                "MATCH ()-[r:RELATION]-() "
                "SET r.relation_type = coalesce(r.relation_type, r.type, 'RELATES_TO'), "
                "r.document_ids = coalesce(r.document_ids, CASE WHEN r.doc_id IS NULL THEN [] ELSE [r.doc_id] END), "
                "r.chunk_ids = coalesce(r.chunk_ids, [])"
            )

    def extract_and_store(
        self, doc_id: str, text: str, tenant_id: str = "default", chunks: list[Chunk] | None = None
    ) -> tuple[list[Entity], list[Relationship]]:
        entities, relations = self.extract_entities_and_relations(
            text, doc_id=doc_id, chunks=chunks
        )
        tenant_entities = self._tenant_entities.setdefault(tenant_id, {})
        tenant_relationships = self._tenant_relationships.setdefault(tenant_id, [])
        canonical_names = {
            entity.normalized_name: entity.name for entity in tenant_entities.values()
        }
        for entity in entities:
            entity.name = canonical_names.get(entity.normalized_name, entity.name)
        for relation in relations:
            relation.source_entity = canonical_names.get(
                _normalized_name(relation.source_entity), relation.source_entity
            )
            relation.target_entity = canonical_names.get(
                _normalized_name(relation.target_entity), relation.target_entity
            )
        for e in entities:
            existing_name = next(
                (
                    name
                    for name, entity in tenant_entities.items()
                    if entity.normalized_name == e.normalized_name
                ),
                None,
            )
            if existing_name:
                existing = tenant_entities[existing_name]
                existing.document_ids = sorted(set(existing.document_ids + e.document_ids))
                existing.chunk_ids = sorted(set(existing.chunk_ids + e.chunk_ids))
            else:
                tenant_entities[e.name] = e
            self.entities[e.name] = tenant_entities.get(existing_name or e.name, e)
        tenant_relationships.extend(relations)
        self.relationships = [
            relation
            for tenant_relations in self._tenant_relationships.values()
            for relation in tenant_relations
        ]
        # Track per-document lineage for precise deletion (hint: doc_id→chunk_ids index)
        self._tenant_doc_entities[(tenant_id, doc_id)] = {e.name for e in entities}
        self._tenant_doc_relationships[(tenant_id, doc_id)] = list(relations)
        self._tenant_doc_chunks[(tenant_id, doc_id)] = {chunk.id for chunk in chunks or []}
        self._doc_entities[doc_id] = {e.name for e in entities}
        self._doc_relationships[doc_id] = list(relations)

        # Persist to Neo4j if available
        if self._neo4j_available and self.driver is not None:
            try:
                with self.driver.session() as session:  # type: ignore[attr-defined]
                    if entities:
                        session.run(  # type: ignore[attr-defined]
                            """
                            UNWIND $entities AS ent
                            MERGE (e:Entity {normalized_name: ent.normalized_name, tenant_id: ent.tenant_id})
                            ON CREATE SET e.name = ent.name, e.type = ent.entity_type, e.created_at = datetime(),
                                          e.provenance_version = 1, e.document_ids = [], e.chunk_ids = []
                            SET e.document_ids = reduce(ids = coalesce(e.document_ids, []), id IN ent.document_ids |
                                CASE WHEN id IN ids THEN ids ELSE ids + id END),
                                e.chunk_ids = reduce(ids = coalesce(e.chunk_ids, []), id IN ent.chunk_ids |
                                CASE WHEN id IN ids THEN ids ELSE ids + id END)
                            """,
                            entities=[
                                {
                                    "name": e.name,
                                    "normalized_name": e.normalized_name,
                                    "entity_type": e.entity_type,
                                    "document_ids": e.document_ids,
                                    "chunk_ids": e.chunk_ids,
                                    "tenant_id": tenant_id,
                                }
                                for e in entities
                            ],
                        )
                        session.run(
                            "UNWIND $mentions AS mention "
                            "MATCH (e:Entity {normalized_name: mention.normalized_name, tenant_id: mention.tenant_id}) "
                            "MERGE (d:Document {id: mention.doc_id, tenant_id: mention.tenant_id}) "
                            "MERGE (e)-[:MENTIONED_IN]->(d) "
                            "WITH e, mention UNWIND mention.chunk_ids AS chunk_id "
                            "MERGE (c:Chunk {id: chunk_id, tenant_id: mention.tenant_id}) "
                            "ON CREATE SET c.document_id = mention.doc_id "
                            "MERGE (c)-[:MENTIONS]->(e)",
                            mentions=[
                                {
                                    "normalized_name": e.normalized_name,
                                    "doc_id": doc_id,
                                    "tenant_id": tenant_id,
                                    "chunk_ids": e.chunk_ids,
                                }
                                for e in entities
                            ],
                        )
                    if relations:
                        session.run(  # type: ignore[attr-defined]
                            """
                            UNWIND $relations AS rel
                            MATCH (s:Entity {normalized_name: rel.source_normalized, tenant_id: rel.tenant_id})
                            MATCH (t:Entity {normalized_name: rel.target_normalized, tenant_id: rel.tenant_id})
                            MERGE (s)-[r:RELATION {relation_type: rel.rel_type, tenant_id: rel.tenant_id}]->(t)
                            ON CREATE SET r.created_at = datetime(), r.document_ids = [], r.chunk_ids = []
                            SET r.document_ids = reduce(ids = coalesce(r.document_ids, []), id IN rel.document_ids |
                                CASE WHEN id IN ids THEN ids ELSE ids + id END),
                                r.chunk_ids = reduce(ids = coalesce(r.chunk_ids, []), id IN rel.chunk_ids |
                                CASE WHEN id IN ids THEN ids ELSE ids + id END)
                            """,
                            relations=[
                                {
                                    "source": r.source_entity,
                                    "target": r.target_entity,
                                    "source_normalized": _normalized_name(r.source_entity),
                                    "target_normalized": _normalized_name(r.target_entity),
                                    "rel_type": r.relation_type,
                                    "document_ids": r.document_ids,
                                    "chunk_ids": r.chunk_ids,
                                    "tenant_id": tenant_id,
                                }
                                for r in relations
                            ],
                        )
            except Exception as e:  # noqa: BLE001
                logger.warning("Neo4j extract_and_store failed for %s: %s", doc_id, e)

        self._build_entity_index()
        return entities, relations

    def delete_by_document(self, doc_id: str, tenant_id: str = "default") -> int:
        """Removes entities and relationships tied to doc_id; handles Neo4j persistence if present."""
        removed = 0
        key = (tenant_id, doc_id)
        persisted_doc_chunks: set[str] = set()
        if self._neo4j_available and self.driver is not None:
            try:
                with self.driver.session() as session:  # type: ignore[attr-defined]
                    records = session.run(
                        "MATCH (c:Chunk {document_id: $doc_id, tenant_id: $tenant_id}) "
                        "RETURN c.id AS chunk_id",
                        doc_id=doc_id,
                        tenant_id=tenant_id,
                    )
                    for record in records:
                        data = record.data() if hasattr(record, "data") else dict(record)
                        chunk_id = data.get("chunk_id")
                        if isinstance(chunk_id, str):
                            persisted_doc_chunks.add(chunk_id)
            except Exception as e:  # noqa: BLE001
                logger.warning("Neo4j chunk provenance read failed for %s: %s", doc_id, e)
        doc_ents = self._tenant_doc_entities.pop(key, set())
        doc_rels = self._tenant_doc_relationships.pop(key, [])
        doc_chunks = self._tenant_doc_chunks.pop(key, set())
        doc_chunks.update(persisted_doc_chunks)
        tenant_rels = self._tenant_relationships.get(tenant_id, [])
        # Remove relationships first
        for rel in doc_rels:
            if rel in tenant_rels:
                tenant_rels.remove(rel)
                removed += 1
        # Remove entities only if no other doc references them
        remaining_ents = set()
        for (owner_tenant, _), ents in self._tenant_doc_entities.items():
            if owner_tenant == tenant_id:
                remaining_ents.update(ents)
        tenant_entities = self._tenant_entities.get(tenant_id, {})
        for name in list(doc_ents):
            if name not in tenant_entities:
                continue
            if name not in remaining_ents:
                del tenant_entities[name]
                removed += 1
            else:
                entity = tenant_entities[name]
                entity.document_ids = [item for item in entity.document_ids if item != doc_id]
                entity.chunk_ids = [item for item in entity.chunk_ids if item not in doc_chunks]
        self._doc_entities.pop(doc_id, None)
        self._doc_relationships.pop(doc_id, None)
        self.entities = {
            name: entity
            for tenant_entities in self._tenant_entities.values()
            for name, entity in tenant_entities.items()
        }
        self.relationships = [
            relation
            for tenant_relations in self._tenant_relationships.values()
            for relation in tenant_relations
        ]
        self._build_entity_index()
        # If Neo4j client exists (non in_memory), delete via Cypher
        if self._neo4j_available and self.driver is not None:
            try:
                with self.driver.session() as session:  # type: ignore[attr-defined]
                    session.run(
                        "MATCH ()-[r:RELATION {tenant_id: $tenant_id}]-() "
                        "WHERE $doc_id IN coalesce(r.document_ids, []) "
                        "SET r.document_ids = [id IN r.document_ids WHERE id <> $doc_id], "
                        "r.chunk_ids = [id IN coalesce(r.chunk_ids, []) WHERE NOT id IN $chunk_ids]",
                        doc_id=doc_id,
                        tenant_id=tenant_id,
                        chunk_ids=list(doc_chunks),
                    )
                    session.run(
                        "MATCH ()-[r:RELATION {tenant_id: $tenant_id}]-() "
                        "WHERE size(coalesce(r.document_ids, [])) = 0 DELETE r",
                        tenant_id=tenant_id,
                    )
                    session.run(
                        "MATCH (e:Entity {tenant_id: $tenant_id})-"
                        "[m:MENTIONED_IN]->(d:Document {id: $doc_id, tenant_id: $tenant_id}) DELETE m",
                        doc_id=doc_id,
                        tenant_id=tenant_id,
                    )
                    session.run(
                        "MATCH (c:Chunk {document_id: $doc_id, tenant_id: $tenant_id}) DETACH DELETE c",
                        doc_id=doc_id,
                        tenant_id=tenant_id,
                    )
                    session.run(
                        "MATCH (d:Document {id: $doc_id, tenant_id: $tenant_id}) DETACH DELETE d",
                        doc_id=doc_id,
                        tenant_id=tenant_id,
                    )
                    session.run(
                        "MATCH (e:Entity {tenant_id: $tenant_id}) "
                        "WHERE $doc_id IN coalesce(e.document_ids, []) "
                        "SET e.document_ids = [id IN e.document_ids WHERE id <> $doc_id], "
                        "e.chunk_ids = [id IN coalesce(e.chunk_ids, []) WHERE NOT id IN $chunk_ids]",
                        doc_id=doc_id,
                        tenant_id=tenant_id,
                        chunk_ids=list(doc_chunks),
                    )
                    session.run(  # type: ignore[attr-defined]
                        "MATCH (e:Entity {tenant_id: $tenant_id}) "
                        "WHERE e.provenance_version = 1 AND NOT (e)-[:MENTIONED_IN]->(:Document) DETACH DELETE e",
                        tenant_id=tenant_id,
                    )
            except Exception as e:  # noqa: BLE001 - Neo4j driver may raise varied exceptions
                logger.warning("Neo4j delete_by_document failed for %s: %s", doc_id, e)
        return removed

    def clear_all_graph(self, tenant_id: str | None = None) -> None:
        """Clears in-memory graph state and Neo4j if configured.

        When ``tenant_id`` is provided, only that tenant's graph data is removed.
        """
        if tenant_id is None:
            self.entities.clear()
            self.relationships.clear()
            self._doc_entities.clear()
            self._doc_relationships.clear()
            self._tenant_entities.clear()
            self._tenant_relationships.clear()
            self._tenant_doc_entities.clear()
            self._tenant_doc_relationships.clear()
            self._tenant_doc_chunks.clear()
            if self._neo4j_available and self.driver is not None:
                try:
                    with self.driver.session() as session:  # type: ignore[attr-defined]
                        session.run("MATCH (n) DETACH DELETE n")  # type: ignore[attr-defined]
                except Exception as e:  # noqa: BLE001 - Neo4j driver may raise varied exceptions
                    logger.warning("Neo4j clear_all failed: %s", e)
            self._build_entity_index()
            return

        self._tenant_entities.pop(tenant_id, None)
        self._tenant_relationships.pop(tenant_id, None)
        tenant_docs = [key[1] for key in list(self._tenant_doc_entities) if key[0] == tenant_id]
        for key in [key for key in list(self._tenant_doc_entities) if key[0] == tenant_id]:
            self._tenant_doc_entities.pop(key, None)
        for key in [key for key in list(self._tenant_doc_relationships) if key[0] == tenant_id]:
            self._tenant_doc_relationships.pop(key, None)
        for key in [key for key in list(self._tenant_doc_chunks) if key[0] == tenant_id]:
            self._tenant_doc_chunks.pop(key, None)
        for doc_id in tenant_docs:
            self._doc_entities.pop(doc_id, None)
            self._doc_relationships.pop(doc_id, None)
        # Drop global doc entries whose tenant matches is not tracked; keep others.
        self.entities = {
            name: entity
            for tenant_entities in self._tenant_entities.values()
            for name, entity in tenant_entities.items()
        }
        self.relationships = [
            relation
            for tenant_relations in self._tenant_relationships.values()
            for relation in tenant_relations
        ]
        self._build_entity_index()
        if self._neo4j_available and self.driver is not None:
            try:
                with self.driver.session() as session:  # type: ignore[attr-defined]
                    session.run(
                        "MATCH (n {tenant_id: $tenant_id}) DETACH DELETE n", tenant_id=tenant_id
                    )  # type: ignore[attr-defined]
            except Exception as e:  # noqa: BLE001 - Neo4j driver may raise varied exceptions
                logger.warning("Neo4j clear_all failed: %s", e)

    def query_entity_neighborhood(
        self, entity_name: str, tenant_id: str = "default"
    ) -> list[Relationship]:
        if self._neo4j_available and self.driver is not None:
            try:
                with self.driver.session() as session:  # type: ignore[attr-defined]
                    result = session.run(
                        "MATCH (e:Entity {normalized_name: $normalized_name, tenant_id: $tenant_id})-"
                        "[r:RELATION]-(neighbor:Entity {tenant_id: $tenant_id}) "
                        "RETURN startNode(r).name AS source_entity, endNode(r).name AS target_entity, "
                        "r.relation_type AS relation_type, r.document_ids AS document_ids, "
                        "r.chunk_ids AS chunk_ids LIMIT 50",
                        normalized_name=_normalized_name(entity_name),
                        tenant_id=tenant_id,
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
                                    document_ids=data.get("document_ids") or [],
                                    chunk_ids=data.get("chunk_ids") or [],
                                )
                            )
                        if neo_rels:
                            return neo_rels
            except Exception as e:  # noqa: BLE001
                logger.warning("Neo4j query_neighborhood failed for %s: %s", entity_name, e)

        return [
            r
            for r in self._tenant_relationships.get(tenant_id, [])
            if r.source_entity.lower() == entity_name.lower()
            or r.target_entity.lower() == entity_name.lower()
        ]

    def query_neighborhood(
        self, entity_name: str, tenant_id: str = "default"
    ) -> list[Relationship]:
        return self.query_entity_neighborhood(entity_name, tenant_id=tenant_id)

    def _build_entity_index(self) -> None:
        self._entity_names_lower.clear()
        for name in self.entities:
            self._entity_names_lower[_normalized_name(name)] = name

    def get_entity_by_lowercase_name(
        self, name_lower: str, tenant_id: str = "default"
    ) -> Entity | None:
        entities = self._tenant_entities.get(tenant_id, {})
        original_name = next(
            (
                name
                for name, entity in entities.items()
                if entity.normalized_name == _normalized_name(name_lower)
            ),
            None,
        )
        if original_name:
            return entities.get(original_name)
        return None

    def get_entities(self, tenant_id: str = "default") -> list[Entity]:
        """Returns only entities owned by the requested tenant."""
        if self._neo4j_available and self.driver is not None:
            try:
                with self.driver.session() as session:  # type: ignore[attr-defined]
                    records = list(
                        session.run(
                            "MATCH (e:Entity {tenant_id: $tenant_id}) "
                            "RETURN e.name AS name, e.normalized_name AS normalized_name, e.type AS entity_type, "
                            "e.document_ids AS document_ids, e.chunk_ids AS chunk_ids ORDER BY e.name",
                            tenant_id=tenant_id,
                        )
                    )
                return [
                    Entity(
                        name=data.get("name", ""),
                        normalized_name=data.get("normalized_name", ""),
                        entity_type=data.get("entity_type", "Concept"),
                        document_ids=data.get("document_ids") or [],
                        chunk_ids=data.get("chunk_ids") or [],
                    )
                    for record in records
                    for data in [record.data() if hasattr(record, "data") else dict(record)]
                ]
            except Exception as e:  # noqa: BLE001
                logger.warning("Neo4j get_entities failed for tenant %s: %s", tenant_id, e)
        return list(self._tenant_entities.get(tenant_id, {}).values())

    @property
    def is_fallback(self) -> bool:
        return self._neo4j_fallback or not self._neo4j_available and not self.in_memory
