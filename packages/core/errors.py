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


class ProviderError(RuntimeError):
    """A configured LLM provider failed to return a usable completion."""

    def __init__(self, provider: str, status: int, message: str, provider_message: str | None = None):
        super().__init__(message)
        self.provider = provider
        self.status = status
        self.message = message
        self.provider_message = provider_message


class ProviderConfigError(ProviderError):
    """The requested provider is unknown or is missing required configuration."""

    def __init__(self, provider: str, message: str):
        super().__init__(provider, 503, message)
