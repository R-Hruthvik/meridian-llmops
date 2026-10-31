"""Markdown parser: headings, fenced code, lists, tables, paragraphs."""

import re

from packages.core.models import DocumentFormat
from services.ingestion.parsers.base import Block, ParsedDocument

_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_FENCE = re.compile(r"^(```|~~~)")
_TABLE_ROW = re.compile(r"^\s*\|.*\|\s*$")
_LIST_ITEM = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")


def parse_markdown(content: str, title: str = "") -> ParsedDocument:
    lines = content.splitlines()
    blocks: list[Block] = []
    paragraph: list[str] = []
    index = 0

    def flush_paragraph() -> None:
        if paragraph:
            text = "\n".join(paragraph).strip()
            if text:
                blocks.append(Block(kind="paragraph", text=text))
            paragraph.clear()

    while index < len(lines):
        line = lines[index]
        fence = _FENCE.match(line.strip())
        if fence:
            flush_paragraph()
            marker = fence.group(1)
            code_lines: list[str] = []
            index += 1
            while index < len(lines) and not lines[index].strip().startswith(marker):
                code_lines.append(lines[index])
                index += 1
            index += 1  # consume the closing fence
            if code_lines:
                blocks.append(Block(kind="code", text="\n".join(code_lines)))
            continue

        heading = _HEADING.match(line)
        if heading:
            flush_paragraph()
            blocks.append(
                Block(kind="heading", text=heading.group(2).strip(), level=len(heading.group(1)))
            )
            index += 1
            continue

        if _TABLE_ROW.match(line):
            flush_paragraph()
            table_lines: list[str] = []
            while index < len(lines) and _TABLE_ROW.match(lines[index]):
                table_lines.append(lines[index])
                index += 1
            blocks.append(Block(kind="table", text="\n".join(table_lines)))
            continue

        if _LIST_ITEM.match(line):
            flush_paragraph()
            list_lines: list[str] = []
            while index < len(lines) and (
                _LIST_ITEM.match(lines[index])
                or (lines[index].startswith((" ", "\t")) and list_lines)
            ):
                list_lines.append(lines[index])
                index += 1
            blocks.append(Block(kind="list", text="\n".join(list_lines)))
            continue

        if not line.strip():
            flush_paragraph()
        else:
            paragraph.append(line)
        index += 1

    flush_paragraph()
    resolved_title = title or _first_heading_text(blocks) or "Untitled document"
    return ParsedDocument(title=resolved_title, format=DocumentFormat.MARKDOWN, blocks=blocks)


def _first_heading_text(blocks: list[Block]) -> str:
    for block in blocks:
        if block.kind == "heading" and block.level == 1 and block.text.strip():
            return block.text.strip()
    return ""
