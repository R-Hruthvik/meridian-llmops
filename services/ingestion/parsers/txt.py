"""Plain text parser: tolerant decoding, paragraph splitting on blank lines."""

import re

from packages.core.models import DocumentFormat
from services.ingestion.parsers.base import Block, ParsedDocument


def decode_text(data: bytes) -> tuple[str, str | None]:
    """Decode bytes as utf-8, then utf-8-sig, then latin-1 (with a warning)."""
    for encoding in ("utf-8-sig", "utf-8"): 
        try:
            return data.decode(encoding), None
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1"), "File is not valid UTF-8; decoded as latin-1, some characters may be wrong"


def parse_txt(content: str, title: str = "") -> ParsedDocument:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n")
    blocks: list[Block] = []
    for paragraph in re.split(r"\n[ \t]*\n+", normalized):
        text = paragraph.strip()
        if text:
            blocks.append(Block(kind="paragraph", text=text))
    return ParsedDocument(
        title=title or "Untitled document", format=DocumentFormat.TXT, blocks=blocks
    )
