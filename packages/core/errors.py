"""Typed index failures surfaced by ingestion and retrieval boundaries."""


class IndexMismatchError(RuntimeError):
    """The existing index schema cannot serve the configured model."""


class IndexWriteError(RuntimeError):
    """A Qdrant write failed or did not persist the expected chunks."""


class IndexReadError(RuntimeError):
    """Qdrant could not return a reliable query or count result."""


class ParseError(ValueError):
    """A file could not be parsed; the message is safe to show to the caller."""


class IngestionError(RuntimeError):
    """Ingestion failed and was rolled back; nothing was partially indexed."""
