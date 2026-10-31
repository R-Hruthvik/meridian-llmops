import os

import pytest

from packages.core.models import Chunk
from services.ingestion.graph_store import KnowledgeGraphStore


def test_extracts_multiword_entities_with_normalized_names_and_chunk_provenance():
    store = KnowledgeGraphStore(in_memory=True)
    chunks = [
        Chunk(id="c-a", document_id="d-a", text="North Star connects Qdrant."),
        Chunk(id="c-b", document_id="d-a", text="North-Star connects to Neo4j."),
    ]

    entities, relations = store.extract_and_store(
        "d-a", "North Star connects Qdrant. North-Star connects to Neo4j.", chunks=chunks
    )

    star = next(entity for entity in entities if entity.normalized_name == "north star")
    assert star.name == "North Star"
    assert star.document_ids == ["d-a"]
    assert star.chunk_ids == ["c-a", "c-b"]
    assert any(rel.relation_type == "ROUTES_TO" for rel in relations)
    assert all(rel.document_ids == ["d-a"] and rel.chunk_ids for rel in relations)
    assert store.get_entity_by_lowercase_name("north star") == star
    assert store.get_entity_by_lowercase_name("NORTH-STAR") == star


def test_deleting_document_preserves_entities_used_by_another_document():
    store = KnowledgeGraphStore(in_memory=True)
    store.extract_and_store("d-a", "Qdrant connects Neo4j.")
    store.extract_and_store("d-b", "Qdrant connects FastAPI.")

    store.delete_by_document("d-a")

    assert {entity.name for entity in store.get_entities()} == {"Qdrant", "FastAPI"}
    qdrant = next(entity for entity in store.get_entities() if entity.name == "Qdrant")
    assert qdrant.document_ids == ["d-b"]
    assert all(
        "d-a" not in relation.document_ids for relation in store.query_neighborhood("Qdrant")
    )


def test_relationship_direction_follows_text_mention_order():
    store = KnowledgeGraphStore(in_memory=True)
    _, relations = store.extract_and_store("d-direction", "Neo4j connects Qdrant.")

    assert [(rel.source_entity, rel.target_entity) for rel in relations] == [("Neo4j", "Qdrant")]


@pytest.mark.integration
def test_neo4j_persist_read_and_delete_shared_entity():
    if not os.environ.get("NEO4J_PASSWORD") or os.environ.get("APP_ENV") == "testing":
        pytest.skip(
            "Set NEO4J_PASSWORD and APP_ENV=development to run against a real Neo4j container"
        )
    store = KnowledgeGraphStore(in_memory=False)
    assert store._neo4j_available, "Configured Neo4j container is unavailable"
    reopened = None
    migrated = None
    try:
        store.clear_all_graph()
        store.extract_and_store(
            "d-a",
            "Qdrant connects Neo4j.",
            chunks=[Chunk(id="c-a", document_id="d-a", text="Qdrant connects Neo4j.")],
        )
        store.extract_and_store(
            "d-b",
            "Qdrant connects FastAPI.",
            chunks=[Chunk(id="c-b", document_id="d-b", text="Qdrant connects FastAPI.")],
        )

        reopened = KnowledgeGraphStore(in_memory=False)
        assert {entity.name for entity in reopened.get_entities()} >= {"Qdrant", "Neo4j", "FastAPI"}
        qdrant = next(entity for entity in reopened.get_entities() if entity.name == "Qdrant")
        assert set(qdrant.document_ids) == {"d-a", "d-b"}
        assert set(qdrant.chunk_ids) == {"c-a", "c-b"}
        assert {
            (rel.source_entity, rel.relation_type, rel.target_entity)
            for rel in reopened.query_neighborhood("Qdrant")
        } == {("Qdrant", "ROUTES_TO", "Neo4j"), ("Qdrant", "ROUTES_TO", "FastAPI")}
        with reopened.driver.session() as session:
            assert (
                session.run(
                    "MATCH (:Entity)-[r:MENTIONED_IN]->(:Document) RETURN count(r) AS count"
                ).single()["count"]
                == 4
            )
            assert (
                session.run(
                    "MATCH (:Chunk)-[r:MENTIONS]->(:Entity) RETURN count(r) AS count"
                ).single()["count"]
                == 4
            )
        reopened.delete_by_document("d-a")
        qdrant = next(entity for entity in reopened.get_entities() if entity.name == "Qdrant")
        assert set(qdrant.document_ids) == {"d-b"}
        assert set(qdrant.chunk_ids) == {"c-b"}
        remaining = reopened.query_neighborhood("Qdrant")
        assert {(rel.source_entity, rel.relation_type, rel.target_entity) for rel in remaining} == {
            ("Qdrant", "ROUTES_TO", "FastAPI")
        }
        assert all("d-a" not in rel.document_ids for rel in remaining)
        assert all("c-a" not in rel.chunk_ids for rel in remaining)
        with reopened.driver.session() as session:
            assert (
                session.run(
                    "MATCH (:Entity)-[r:MENTIONED_IN]->(:Document) RETURN count(r) AS count"
                ).single()["count"]
                == 2
            )
            assert (
                session.run(
                    "MATCH (:Chunk)-[r:MENTIONS]->(:Entity) RETURN count(r) AS count"
                ).single()["count"]
                == 2
            )
            session.run(
                "CREATE (a:Entity {name: 'Legacy Alpha', type: 'Concept', tenant_id: 'default', doc_ids: ['d-legacy']}), "
                "(b:Entity {name: 'Legacy Beta', type: 'Concept', tenant_id: 'default', doc_ids: ['d-legacy']}), "
                "(a)-[:RELATION {type: 'DEPENDS_ON', doc_id: 'd-legacy', tenant_id: 'default'}]->(b)"
            ).consume()
        migrated = KnowledgeGraphStore(in_memory=False)
        assert migrated._neo4j_available, (
            "Configured Neo4j container is unavailable after legacy migration"
        )
        legacy_entities = {entity.name for entity in migrated.get_entities()}
        assert {"Legacy Alpha", "Legacy Beta"} <= legacy_entities
        assert {
            (rel.source_entity, rel.relation_type, rel.target_entity)
            for rel in migrated.query_neighborhood("Legacy Alpha")
        } == {("Legacy Alpha", "DEPENDS_ON", "Legacy Beta")}
        migrated.delete_by_document("d-legacy")
        assert not {"Legacy Alpha", "Legacy Beta"} & {
            entity.name for entity in migrated.get_entities()
        }
    finally:
        store.clear_all_graph()
        store.driver.close()
        if reopened is not None:
            reopened.driver.close()
        if migrated is not None:
            migrated.driver.close()
