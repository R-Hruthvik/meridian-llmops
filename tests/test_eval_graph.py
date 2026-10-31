from types import SimpleNamespace

from evals.eval_retrieval import evaluate_graph_ab
from packages.core.models import Chunk
from services.ingestion.graph_store import KnowledgeGraphStore


def test_graph_ab_reports_baseline_and_grounded_path_coverage():
    first = Chunk(
        id="gateway-c0000",
        document_id="gateway",
        text="Aster Dispatch routes requests to Beacon Gateway.",
    )
    second = Chunk(
        id="storage-c0000",
        document_id="storage",
        text="Beacon Gateway stores vector records in Cobalt Index.",
    )
    graph = KnowledgeGraphStore(in_memory=True)
    graph.extract_and_store(first.document_id, first.text, tenant_id="eval", chunks=[first])
    graph.extract_and_store(second.document_id, second.text, tenant_id="eval", chunks=[second])

    class Retriever:
        bm25_index = SimpleNamespace(chunks=[first, second])

        def retrieve(self, question, top_k, tenant_id):
            return SimpleNamespace(chunks=[SimpleNamespace(chunk=first)])

    report = evaluate_graph_ab(
        Retriever(),
        graph,
        [
            {
                "id": "path-1",
                "question": "Where does Aster Dispatch store records?",
                "expected_hops": [
                    {
                        "source_entity": "Aster Dispatch",
                        "relation_type": "ROUTES_TO",
                        "target_entity": "Beacon Gateway",
                        "chunk_id": "gateway-c0000",
                    },
                    {
                        "source_entity": "Beacon Gateway",
                        "relation_type": "STORES_IN",
                        "target_entity": "Cobalt Index",
                        "chunk_id": "storage-c0000",
                    },
                ],
            }
        ],
    )

    assert report["baseline"]["hop_recall"] == 0.5
    assert report["graph_enabled"]["grounded_hop_recall"] == 0.5
    assert report["baseline"]["complete_path_rate"] == 0.0
    assert report["graph_enabled"]["complete_path_rate"] == 0.0
    assert report["delta"] == {"hop_recall": 0.0, "complete_path_rate": 0.0}
