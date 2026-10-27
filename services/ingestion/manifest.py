"""Disk provenance for a vector index; missing or stale provenance fails closed."""

import json
from dataclasses import asdict, dataclass
from pathlib import Path

from packages.core.settings import Settings
from services.ingestion.chunker import CHUNKER_VERSION
from services.ingestion.parsers.base import NORMALIZER_VERSION, PARSER_VERSION
from services.ingestion.storage import DocumentStorageManager, get_default_storage_root


@dataclass(frozen=True)
class IndexManifest:
    embedding_model: str
    embedding_dim: int
    chunker_version: str
    created_at: str
    chunk_count: int
    parser_version: str = PARSER_VERSION
    normalizer_version: str = NORMALIZER_VERSION


@dataclass(frozen=True)
class ConsistencyReport:
    ok: bool
    reasons: list[str]


def read_manifest(storage_root: Path | str | None = None) -> IndexManifest | None:
    root = Path(storage_root) if storage_root is not None else get_default_storage_root()
    path = root / 'index_manifest.json'
    if not path.exists():
        return None
    return IndexManifest(**json.loads(path.read_text(encoding='utf-8')))


def write_manifest(storage_root: Path | str, manifest: IndexManifest) -> None:
    root = Path(storage_root)
    root.mkdir(parents=True, exist_ok=True)
    temporary = root / 'index_manifest.json.tmp'
    temporary.write_text(json.dumps(asdict(manifest), indent=2), encoding='utf-8')
    temporary.replace(root / 'index_manifest.json')


def check_consistency(
    settings: Settings,
    qdrant_count: int | None,
    disk_count: int,
    *,
    storage_root: Path | str | None = None,
    chunker_version: str = CHUNKER_VERSION,
    parser_version: str = PARSER_VERSION,
    normalizer_version: str = NORMALIZER_VERSION,
) -> ConsistencyReport:
    reasons: list[str] = []
    if qdrant_count is None:
        reasons.append('collection missing')
    elif qdrant_count != disk_count:
        reasons.append(f'count mismatch: Qdrant={qdrant_count}, disk={disk_count}')
    try:
        manifest = read_manifest(storage_root)
    except (OSError, ValueError, TypeError):
        manifest = None
        reasons.append('manifest unreadable')
    if manifest is None:
        reasons.append('manifest missing')
    else:
        if manifest.embedding_model != settings.embedding_model:
            reasons.append(f'model mismatch: {manifest.embedding_model} != {settings.embedding_model}')
        if manifest.embedding_dim != settings.qdrant_vector_dim:
            reasons.append(f'dim mismatch: {manifest.embedding_dim} != {settings.qdrant_vector_dim}')
        if manifest.chunker_version != chunker_version:
            reasons.append(f'chunker version mismatch: {manifest.chunker_version} != {chunker_version}')
        if manifest.parser_version != parser_version:
            reasons.append(f'parser version mismatch: {manifest.parser_version} != {parser_version}')
        if manifest.normalizer_version != normalizer_version:
            reasons.append(f'normalizer version mismatch: {manifest.normalizer_version} != {normalizer_version}')
        if manifest.chunk_count != disk_count:
            reasons.append(f'count mismatch: manifest={manifest.chunk_count}, disk={disk_count}')
    try:
        storage = DocumentStorageManager(storage_root)
        actual_disk_count = len(storage.load_all_chunks(strict=True))
        if actual_disk_count != disk_count:
            reasons.append(f'count mismatch: disk records={actual_disk_count}, reported disk={disk_count}')
        if storage.has_legacy_embeddings():
            reasons.append('legacy embeddings require reindex')
    except (OSError, ValueError, KeyError, TypeError):
        reasons.append('disk records unreadable')
    return ConsistencyReport(ok=not reasons, reasons=reasons)
