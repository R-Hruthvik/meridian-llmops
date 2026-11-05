"""Plain text parser: tolerant decoding, paragraph splitting, heuristic structure."""

import re

from packages.core.models import DocumentFormat
from services.ingestion.parsers.base import Block, ParsedDocument

_HEADING_RE = re.compile(r"^(?:#{1,6}\s+)?([A-Z][^.!?]{2,60})$")
_NUMBERED_RE = re.compile(r"^\d+(?:\.\d+)*\s+[A-Z].{2,80}$")
_CODE_FENCE_RE = re.compile(r"^```")


def _is_heading(line: str, prev_blank: bool, next_blank: bool) -> bool:
    stripped = line.strip()
    if not stripped or len(stripped) > 80:
        return False
    if _CODE_FENCE_RE.match(stripped):
        return False
    if _NUMBERED_RE.match(stripped):
        return True
    if _HEADING_RE.match(stripped) and (prev_blank or next_blank):
        # Title-case-ish short line surrounded by blanks.
        words = stripped.split()
        if 1 <= len(words) <= 8 and stripped == stripped.title() or stripped.isupper():
            return True
    return False


def decode_text(data: bytes) -> tuple[str, str | None]:
    for encoding in ("utf-8-sig", "utf-8"):
        try:
            return data.decode(encoding), None
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1"), "File is not valid UTF-8; decoded as latin-1, some characters may be wrong"


def parse_txt(content: str, title: str = "") -> ParsedDocument:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    blocks: list[Block] = []
    paragraph: list[str] = []
    code: list[str] = []
    in_code = False

    def flush_paragraph() -> None:
        if paragraph:
            text = "\n".join(paragraph).strip()
            if text:
                blocks.append(Block(kind="paragraph", text=text))
            paragraph.clear()

    def flush_code() -> None:
        if code:
            text = "\n".join(code).rstrip()
            if text.strip():
                blocks.append(Block(kind="code", text=text))
            code.clear()

    index = 0
    n = len(lines)
    while index < n:
        line = lines[index]
        stripped = line.strip()
        if _CODE_FENCE_RE.match(stripped):
            flush_paragraph()
            if in_code:
                flush_code()
                in_code = False
            else:
                in_code = True
            index += 1
            continue
        if in_code:
            code.append(line)
            index += 1
            continue
        if not stripped:
            flush_paragraph()
            index += 1
            continue
        prev_blank = index == 0 or not lines[index - 1].strip()
        next_blank = index + 1 >= n or not lines[index + 1].strip()
        if _is_heading(stripped, prev_blank, next_blank):
            flush_paragraph()
            blocks.append(Block(kind="heading", text=stripped.lstrip("#").strip(), level=1))
            index += 1
            continue
        paragraph.append(line)
        index += 1
    flush_paragraph()
    if in_code:
        flush_code()

    return ParsedDocument(
        title=title or "Untitled document", format=DocumentFormat.TXT, blocks=blocks
    )
