"""Token-aware chunking with a dependency-free approximate tokenizer.

Approximate by design: `count_tokens` counts word and punctuation tokens with a
regex. It does not guarantee a chunk fits any particular model tokenizer.
Swap the function for a real tokenizer later without touching the algorithm.
"""

import hashlib
import re
from dataclasses import dataclass

from packages.core.models import Chunk, Document, DocumentFormat
from services.ingestion.parsers.base import ParsedDocument
from services.ingestion.parsers.base import NORMALIZER_VERSION, PARSER_VERSION
from services.ingestion.parsers.md import parse_markdown

# Per-format chunking parameters (target_tokens, max_tokens, overlap_tokens)
CHUNKER_VERSION = "token-aware-v1"
PARSER_VERSION = PARSER_VERSION
NORMALIZER_VERSION = NORMALIZER_VERSION
FORMAT_CHUNK_PARAMS: dict[str, tuple[int, int, int]] = {
    "md": (350, 450, 50),
    "txt": (300, 400, 40),
    "html": (300, 400, 40),
    "pdf": (400, 500, 50),
    "docx": (350, 450, 50),
    "default": (350, 450, 50),
}
CONTEXT_HEADER_MAX_TOKENS = 50

_TOKEN_RE = re.compile(r"\w+|[^\w\s]")
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")


def count_tokens(text: str) -> int:
    """Approximate token count: words plus standalone punctuation."""
    return len(_TOKEN_RE.findall(text))


def embedded_text(chunk: Chunk) -> str:
    """Text handed to the embedder and BM25: contextual header plus chunk text."""
    header = " > ".join(
        part for part in (chunk.metadata.get("title"), chunk.section_heading) if part
    )
    header_tokens = list(_TOKEN_RE.finditer(header))
    if len(header_tokens) > CONTEXT_HEADER_MAX_TOKENS:
        header = header[header_tokens[-CONTEXT_HEADER_MAX_TOKENS].start() :].lstrip()
    return f"{header}\n{chunk.text}" if header else chunk.text


@dataclass(frozen=True)
class _Unit:
    """One indivisible piece of a block: sentence-window, table row, or code line."""

    text: str
    tokens: int


def _split_units(text: str, kind: str) -> list[_Unit]:
    if kind == "table" or kind == "code":
        pieces = text.split("\n")
    else:
        pieces = _SENTENCE_RE.split(text)
    units: list[_Unit] = []
    for piece in pieces:
        if not piece.strip():
            continue
        # Preserve leading indentation for code blocks; trim table rows.
        if kind == "code":
            cleaned = piece.rstrip()
        else:
            cleaned = piece.strip()
        if cleaned.strip():
            units.append(_Unit(text=cleaned, tokens=count_tokens(cleaned)))
    return units


class TokenAwareChunker:
    """Splits parsed blocks into chunks bounded by an approximate token budget."""

    def __init__(
        self,
        target_tokens: int = 350,
        max_tokens: int = 450,
        overlap_tokens: int = 50,
        source_format: str = "default",
        format: str | None = None,
        doc_format: str | None = None,
    ):
        if format is not None:
            source_format = format
        if doc_format is not None:
            source_format = doc_format
        # Accept DocumentFormat-like values.
        source_format = getattr(source_format, "value", source_format)
        source_format = str(source_format).lower() if source_format else "default"
        params = FORMAT_CHUNK_PARAMS.get(source_format, FORMAT_CHUNK_PARAMS["default"])
        self.target_tokens = target_tokens if target_tokens != 350 else params[0]
        self.max_tokens = max_tokens if max_tokens != 450 else params[1]
        self.overlap_tokens = overlap_tokens if overlap_tokens != 50 else params[2]
        self.source_format = source_format

    # ------------------------------------------------------------------ API

    def chunk(self, doc: Document) -> list[Chunk]:
        """Legacy entry point: parse the document text, then chunk it."""
        parsed = parse_markdown(doc.text, title=doc.title)
        return self.chunk_document(
            parsed,
            doc_id=doc.id,
            source=doc.source,
            source_format=str(doc.format.value if hasattr(doc.format, "value") else doc.format),
            title=doc.title,
        )

    def chunk_document(
        self,
        parsed: ParsedDocument,
        doc_id: str,
        source: str = "",
        source_format: str = "",
        title: str | None = None,
        tenant_id: str = "default",
        format: str | None = None,
    ) -> list[Chunk]:
        if format is not None:
            source_format = format
        source_format = getattr(source_format, "value", source_format)
        source_format = str(source_format).lower() if source_format not in (None, "") else ""
        if source_format and source_format not in FORMAT_CHUNK_PARAMS:
            source_format = "default" if not source_format else source_format
        resolved_title = title or parsed.title
        # Use format-specific chunker params when available, without clobbering
        # explicitly configured budgets.
        if (
            source_format
            and source_format in FORMAT_CHUNK_PARAMS
            and source_format != self.source_format
        ):
            fmt_params = FORMAT_CHUNK_PARAMS.get(source_format, FORMAT_CHUNK_PARAMS["default"])
            defaults = FORMAT_CHUNK_PARAMS["default"]
            if self.target_tokens == defaults[0]:
                self.target_tokens = fmt_params[0]
            if self.max_tokens == defaults[1]:
                self.max_tokens = fmt_params[1]
            if self.overlap_tokens == defaults[2]:
                self.overlap_tokens = fmt_params[2]
            self.source_format = source_format
        heading_chain: list[tuple[int, str]] = []
        pending: list[tuple[str, str, int | None]] = []  # (text, kind, page)
        pending_tokens = 0
        chunks: list[Chunk] = []

        def heading_path() -> str:
            return " > ".join(text for _, text in heading_chain)

        def flush(force: bool = False) -> None:
            nonlocal pending, pending_tokens
            if not pending:
                return
            text = "\n\n".join(item[0] for item in pending).strip()
            if not text:
                pending, pending_tokens = [], 0
                return
            pages = [page for _, _, page in pending if page is not None]
            chunks.append(
                self._build_chunk(
                    index=len(chunks),
                    doc_id=doc_id,
                    text=text,
                    heading_path=heading_path(),
                    page_start=min(pages) if pages else None,
                    page_end=max(pages) if pages else None,
                    title=resolved_title,
                    source=source,
                    source_format=source_format or self.source_format,
                    tenant_id=tenant_id,
                )
            )
            pending, pending_tokens = [], 0

        for block in parsed.blocks:
            tokens = count_tokens(block.text)
            if block.kind == "heading":
                # Flush at top-level boundaries when the chunk is already substantial.
                if (
                    block.level is not None
                    and block.level <= 2
                    and pending_tokens >= 0.4 * self.target_tokens
                ):
                    flush()
                level = block.level if block.level is not None else 1
                heading_chain = [(lvl, text) for lvl, text in heading_chain if lvl < level]
                heading_chain.append((level, block.text))
                continue

            if tokens > self.max_tokens:
                flush()
                for piece in self._split_oversized(block):
                    if pending_tokens + piece[1] > self.target_tokens and pending_tokens > 0:
                        flush()
                        prefix = self._overlap_prefix(chunks, heading_path())
                        if prefix[0]:
                            pending.append(prefix)
                            pending_tokens = count_tokens(prefix[0])
                    pending.append((piece[0], block.kind, block.page))
                    pending_tokens += piece[1]
                continue

            if pending_tokens + tokens > self.target_tokens and pending_tokens > 0:
                flush()
            pending.append((block.text, block.kind, block.page))
            pending_tokens += tokens
        flush()

        return self._merge_tiny(chunks)

    # -------------------------------------------------------------- internals

    def _overlap_prefix(
        self, chunks: list[Chunk], current_heading_path: str
    ) -> tuple[str, str, int | None]:
        """Sentence-aligned tail of the previous chunk, bounded by overlap_tokens.

        Text without sentence punctuation falls back to a word window so the
        overlap never balloons past the configured budget.
        """
        if (
            not chunks
            or not self.overlap_tokens
            or chunks[-1].metadata.get("heading_path", "") != current_heading_path
        ):
            return ("", "paragraph", None)
        sentences = _SENTENCE_RE.split(chunks[-1].text)
        taken: list[str] = []
        budget = self.overlap_tokens
        for sentence in reversed(sentences):
            cost = count_tokens(sentence)
            if cost > budget:
                if taken:
                    break
                taken.append(self._word_window(sentence))
                break
            taken.append(sentence)
            budget -= cost
            if budget <= 0:
                break
        return (" ".join(reversed(taken)).strip(), "paragraph", chunks[-1].metadata.get("page_end"))

    def _word_window(self, text: str) -> str:
        words = text.split()
        window: list[str] = []
        total = 0
        for word in reversed(words):
            cost = count_tokens(word)
            if window and total + cost > self.overlap_tokens:
                break
            window.append(word)
            total += cost
            if total >= self.overlap_tokens:
                break
        return " ".join(reversed(window))

    def _split_oversized(self, block) -> list[tuple[str, int]]:
        units = _split_units(block.text, block.kind)
        pieces: list[tuple[str, int]] = []
        piece_budget = max(
            1,
            min(
                self.target_tokens, self.max_tokens - min(self.overlap_tokens, self.max_tokens - 1)
            ),
        )
        current: list[str] = []
        current_tokens = 0
        for unit in units:
            if unit.tokens > self.max_tokens:
                # A single unit (very long sentence/row/line) is hard-split by words.
                if current:
                    pieces.append(("\n".join(current), current_tokens))
                    current, current_tokens = [], 0
                words = unit.text.split()
                window: list[str] = []
                window_tokens = 0
                for word in words:
                    cost = count_tokens(word)
                    if window and window_tokens + cost > piece_budget:
                        pieces.append((" ".join(window), window_tokens))
                        window, window_tokens = [], 0
                    window.append(word)
                    window_tokens += cost
                if window:
                    pieces.append((" ".join(window), window_tokens))
                continue
            if current_tokens + unit.tokens > piece_budget and current:
                pieces.append(("\n".join(current), current_tokens))
                current, current_tokens = [], 0
            current.append(unit.text)
            current_tokens += unit.tokens
        if current:
            pieces.append(("\n".join(current), current_tokens))
        return pieces

    def _merge_tiny(self, chunks: list[Chunk]) -> list[Chunk]:
        """Merge sub-20-token chunks into a same-section neighbour; renumber afterwards."""
        merged: list[Chunk] = []
        index = 0
        while index < len(chunks):
            chunk = chunks[index]
            if (
                merged
                and chunk.metadata.get("token_count", 0) < 20
                and merged[-1].section_heading == chunk.section_heading
                and count_tokens(merged[-1].text) + count_tokens(chunk.text) <= self.max_tokens
            ):
                previous = merged[-1]
                combined_text = f"{previous.text}\n\n{chunk.text}".strip()
                pages = [
                    page
                    for page in (
                        previous.metadata.get("page_start"),
                        chunk.metadata.get("page_start"),
                    )
                    if page is not None
                ]
                page_ends = [
                    page
                    for page in (previous.metadata.get("page_end"), chunk.metadata.get("page_end"))
                    if page is not None
                ]
                metadata = dict(previous.metadata)
                metadata.update(
                    token_count=count_tokens(combined_text),
                    content_hash=hashlib.sha256(combined_text.encode()).hexdigest(),
                    page_start=min(pages) if pages else None,
                    page_end=max(page_ends) if page_ends else None,
                )
                merged[-1] = previous.model_copy(
                    update={"text": combined_text, "metadata": metadata}
                )
                index += 1
                continue
            if (
                chunk.metadata.get("token_count", 0) < 20
                and index + 1 < len(chunks)
                and chunk.section_heading == chunks[index + 1].section_heading
                and count_tokens(chunk.text) + count_tokens(chunks[index + 1].text)
                <= self.max_tokens
            ):
                following = chunks[index + 1]
                combined_text = f"{chunk.text}\n\n{following.text}".strip()
                metadata = dict(following.metadata)
                pages = [
                    page
                    for page in (
                        chunk.metadata.get("page_start"),
                        following.metadata.get("page_start"),
                    )
                    if page is not None
                ]
                page_ends = [
                    page
                    for page in (chunk.metadata.get("page_end"), following.metadata.get("page_end"))
                    if page is not None
                ]
                metadata.update(
                    token_count=count_tokens(combined_text),
                    content_hash=hashlib.sha256(combined_text.encode()).hexdigest(),
                    page_start=min(pages) if pages else None,
                    page_end=max(page_ends) if page_ends else None,
                )
                merged.append(
                    following.model_copy(update={"text": combined_text, "metadata": metadata})
                )
                index += 2
                continue
            merged.append(chunk)
            index += 1
        return [
            chunk.model_copy(
                update={
                    "id": self._chunk_id(chunk.document_id, position),
                    "chunk_index": position,
                    "metadata": {**chunk.metadata, "chunk_index": position},
                }
            )
            for position, chunk in enumerate(merged)
        ]

    @staticmethod
    def _chunk_id(doc_id: str, index: int) -> str:
        return f"{doc_id}-c{index:04d}"

    def _build_chunk(
        self,
        index: int,
        doc_id: str,
        text: str,
        heading_path: str,
        page_start: int | None,
        page_end: int | None,
        title: str,
        source: str,
        source_format: str,
        tenant_id: str,
    ) -> Chunk:
        return Chunk(
            id=self._chunk_id(doc_id, index),
            document_id=doc_id,
            text=text,
            chunk_index=index,
            section_heading=heading_path or None,
            metadata={
                "tenant_id": tenant_id,
                "filename": source.rsplit("/", 1)[-1] if source else "",
                "title": title,
                "source": source,
                "source_format": source_format or DocumentFormat.TXT.value,
                "heading_path": heading_path,
                "page_start": page_start,
                "page_end": page_end,
                "chunk_index": index,
                "token_count": count_tokens(text),
                "content_hash": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            },
        )
