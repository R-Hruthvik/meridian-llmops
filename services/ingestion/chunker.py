"""Structural chunker splitting documents by headings and semantic hierarchy."""

import re

from packages.core.models import Chunk, Document


class StructuralChunker:
    """Splits documents along heading lines (Markdown #, ##, ###) while preserving context."""

    def __init__(self, max_chunk_size: int = 500, chunk_overlap: int = 50):
        self.max_chunk_size = max_chunk_size
        self.chunk_overlap = chunk_overlap

    def chunk(self, doc: Document) -> list[Chunk]:
        lines = doc.text.split("\n")
        chunks: list[Chunk] = []

        current_heading: str | None = doc.title
        current_lines: list[str] = []
        chunk_index = 0

        heading_pattern = re.compile(r"^(#{1,4})\s+(.+)$")

        for line in lines:
            match = heading_pattern.match(line.strip())
            if match:
                # If we have accumulated text under the previous heading, flush it
                if current_lines:
                    text_block = "\n".join(current_lines).strip()
                    if text_block:
                        chunks.append(
                            Chunk(
                                id=f"{doc.id}-chunk-{chunk_index}",
                                document_id=doc.id,
                                text=text_block,
                                chunk_index=chunk_index,
                                section_heading=current_heading,
                                metadata={"title": doc.title, "source": doc.source},
                            )
                        )
                        chunk_index += 1
                        current_lines = []
                current_heading = match.group(2).strip()

            current_lines.append(line)

            # Check if block exceeds max chunk size
            total_chars = sum(len(l) for l in current_lines)
            if total_chars >= self.max_chunk_size:
                text_block = "\n".join(current_lines).strip()
                if text_block:
                    chunks.append(
                        Chunk(
                            id=f"{doc.id}-chunk-{chunk_index}",
                            document_id=doc.id,
                            text=text_block,
                            chunk_index=chunk_index,
                            section_heading=current_heading,
                            metadata={"title": doc.title, "source": doc.source},
                        )
                    )
                    chunk_index += 1
                    current_lines = []

        # Flush remaining lines
        if current_lines:
            text_block = "\n".join(current_lines).strip()
            if text_block:
                chunks.append(
                    Chunk(
                        id=f"{doc.id}-chunk-{chunk_index}",
                        document_id=doc.id,
                        text=text_block,
                        chunk_index=chunk_index,
                        section_heading=current_heading,
                        metadata={"title": doc.title, "source": doc.source},
                    )
                )

        return chunks
