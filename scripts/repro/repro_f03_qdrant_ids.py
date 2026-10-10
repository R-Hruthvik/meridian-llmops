"""Show the Qdrant ID produced for a legacy logical chunk ID."""

import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from services.ingestion.vector_store import _qdrant_point_id

legacy_id = "doc-00000000-0000-0000-0000-000000000001-chunk-0"
point_id = _qdrant_point_id(legacy_id)
print(json.dumps({"logical_id": legacy_id, "point_id": point_id, "is_uuid": str(uuid.UUID(point_id)) == point_id}))
