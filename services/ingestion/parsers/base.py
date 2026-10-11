"""Shared parser output contract."""

from dataclasses import dataclass, field

from packages.core.models import DocumentFormat


@dataclass(frozen=True)
class Block:
    """A structural unit of a parsed document.

    ``kind`` is one of ``heading | paragraph | list | table | code``.
    ``page`` is 1-based for paginated formats and None otherwise.
    """

    kind: str
    text: str
    level: int | None = None
    page: int | None = None


@dataclass(frozen=True)
class ParsedPage:
    """One extracted page of a paginated document."""

    number: int
    text: str


@dataclass(frozen=True)
class ParsedDocument:
    """Format-independent parse result consumed by the chunker."""

    title: str
    format: DocumentFormat
    blocks: list[Block] = field(default_factory=list)
    pages: list[ParsedPage] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        """Flattened text view (legacy callers and the graph extractor).

        Headings are re-emitted as Markdown headings so the flattened text keeps
        its structure for downstream structural chunking.
        """
        parts: list[str] = []
        for block in self.blocks:
            if not block.text.strip():
                continue
            if block.kind == "heading":
                level = block.level if isinstance(block.level, int) and 1 <= block.level <= 6 else 1
                parts.append(f"{'#' * level} {block.text.strip()}")
            else:
                parts.append(block.text)
        return "\n\n".join(parts)
