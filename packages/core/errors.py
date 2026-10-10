"""Typed index failures surfaced by ingestion and retrieval boundaries."""


class IndexMismatchError(RuntimeError):
    """The existing index schema cannot serve the configured model."""


class IndexWriteError(RuntimeError):
    """A Qdrant write failed or did not persist the expected chunks."""


class IndexReadError(RuntimeError):
    """Qdrant could not return a reliable query or count result."""
