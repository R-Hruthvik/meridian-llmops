"""Code parser: language-aware structural blocks (functions/classes) with fallback grouping."""

import re

from packages.core.models import DocumentFormat
from services.ingestion.parsers.base import Block, ParsedDocument

# Language -> (line comment, function/class patterns)
_LANGUAGE_PATTERNS = {
    "py": [
        re.compile(r"^(def |class )\w+"),
    ],
    "js": [
        re.compile(r"^(export\s+)?(async\s+)?function\s+\w+"),
        re.compile(r"^(export\s+)?class\s+\w+"),
        re.compile(r"^(export\s+)?const\s+\w+\s*=\s*(async\s*)?\("),
    ],
    "ts": None,
    "tsx": None,
    "java": [
        re.compile(r"^\s*(public|private|protected|static|\s)*\s*(class|interface|enum)\s+\w+"),
        re.compile(r"^\s*(public|private|protected|static|\s)*\s*\w+\s+\w+\s*\("),
    ],
    "go": [
        re.compile(r"^func\s+"),
        re.compile(r"^type\s+\w+\s+struct"),
    ],
    "rs": [
        re.compile(r"^(pub\s+)?(async\s+)?fn\s+\w+"),
        re.compile(r"^(pub\s+)?struct\s+\w+"),
        re.compile(r"^(pub\s+)?enum\s+\w+"),
        re.compile(r"^(pub\s+)?trait\s+\w+"),
    ],
    "c": None,
    "cpp": None,
    "rb": [
        re.compile(r"^def\s+\w+"),
        re.compile(r"^class\s+\w+"),
        re.compile(r"^module\s+\w+"),
    ],
    "sh": None,
    "bash": None,
}

_FALLBACK_GROUP = 60


def _patterns_for(language: str):
    pats = _LANGUAGE_PATTERNS.get(language.lower())
    if pats is None:
        # Generic: top-level def/class/function
        return [
            re.compile(r"^(def |class |function |func |fn )\w+"),
        ]
    return pats


def parse_code(content: str, title: str = "", language: str = "text") -> ParsedDocument:
    lines = content.splitlines()
    blocks: list[Block] = []
    patterns = _patterns_for(language)

    # Find boundary line indices where a new top-level definition starts.
    boundaries: list[int] = []
    for index, line in enumerate(lines):
        stripped = line.lstrip()
        if not stripped or line.startswith((" ", "\t")):
            continue
        if any(p.match(stripped) for p in patterns):
            boundaries.append(index)

    if not boundaries:
        # Fallback: group lines.
        for start in range(0, len(lines), _FALLBACK_GROUP):
            chunk_lines = lines[start : start + _FALLBACK_GROUP]
            text = "\n".join(chunk_lines).strip()
            if text:
                blocks.append(Block(kind="code", text=text))
        if not blocks and content.strip():
            blocks.append(Block(kind="code", text=content.strip()))
        return ParsedDocument(
            title=title or "Untitled document", format=DocumentFormat.CODE, blocks=blocks
        )

    # Slice from each boundary to the next.
    boundaries.append(len(lines))
    for i in range(len(boundaries) - 1):
        start = boundaries[i]
        end = boundaries[i + 1]
        # include leading blanks? keep tight
        text = "\n".join(lines[start:end]).strip()
        if text:
            blocks.append(Block(kind="code", text=text))

    if not blocks and content.strip():
        blocks.append(Block(kind="code", text=content.strip()))

    resolved_title = title or "Untitled document"
    # Try to derive title from first function/class name.
    for line in lines:
        m = re.match(r"^\s*(?:export\s+)?(?:async\s+)?(?:def|class|function|func|fn|type)\s+(\w+)", line)
        if m:
            resolved_title = m.group(1)
            break

    return ParsedDocument(title=resolved_title, format=DocumentFormat.CODE, blocks=blocks)
