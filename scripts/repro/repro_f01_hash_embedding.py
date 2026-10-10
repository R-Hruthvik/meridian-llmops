"""Compare current deterministic pseudo-embeddings across fresh processes."""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


code = (
    "from services.ingestion.vector_store import generate_embedding; "
    "v=generate_embedding('Qdrant vector database'); "
    "print(json.dumps([(i,x) for i,x in enumerate(v) if x]))"
)
results = [
    subprocess.check_output(
        [sys.executable, "-c", f"import sys; sys.path.insert(0, {str(ROOT)!r}); import json; " + code],
        cwd=ROOT,
        text=True,
    ).strip()
    for _ in range(2)
]
print(json.dumps({"same_across_processes": results[0] == results[1], "vectors": results}))
