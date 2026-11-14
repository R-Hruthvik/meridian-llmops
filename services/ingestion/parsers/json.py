"""JSON/JSONL parser: structural blocks for object keys and arrays."""

import json

from packages.core.models import DocumentFormat
from services.ingestion.parsers.base import Block, ParsedDocument


def parse_json(content: str, title: str = "") -> ParsedDocument:
    text = content.strip()
    blocks: list[Block] = []

    # JSONL: one JSON value per line.
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) > 1:
        try:
            values = [json.loads(ln) for ln in lines]
            parsed = values
            is_jsonl = True
        except json.JSONDecodeError:
            parsed = None
            is_jsonl = False
    else:
        parsed = None
        is_jsonl = False
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None

    if parsed is None:
        # Fall back to treating as text.
        blocks.append(Block(kind="code", text=content))
        return ParsedDocument(title=title or "Untitled document", format=DocumentFormat.JSON, blocks=blocks)

    resolved_title = title or "Untitled document"

    def _block_for(key: str, value) -> None:
        nonlocal resolved_title
        if isinstance(value, (dict, list)):
            rendered = json.dumps(value, indent=2, ensure_ascii=False)
            blocks.append(Block(kind="heading", text=str(key), level=2))
            blocks.append(Block(kind="code", text=rendered))
        else:
            blocks.append(Block(kind="paragraph", text=f"{key}: {value}"))
            if resolved_title == "Untitled document" and key.lower() in ("title", "name"):
                resolved_title = str(value)

    if isinstance(parsed, dict):
        if not blocks:
            for key, value in parsed.items():
                _block_for(key, value)
    elif isinstance(parsed, list):
        if is_jsonl:
            blocks.append(Block(kind="heading", text="Records", level=1))
            rendered = json.dumps(parsed, indent=2, ensure_ascii=False)
            blocks.append(Block(kind="code", text=rendered))
        else:
            for index, item in enumerate(parsed):
                if isinstance(item, dict):
                    blocks.append(Block(kind="heading", text=f"Item {index + 1}", level=2))
                    for key, value in item.items():
                        _block_for(key, value)
                else:
                    blocks.append(Block(kind="paragraph", text=json.dumps(item, ensure_ascii=False)))
    else:
        blocks.append(Block(kind="paragraph", text=json.dumps(parsed, ensure_ascii=False)))

    if not blocks:
        blocks.append(Block(kind="code", text=text))

    return ParsedDocument(title=resolved_title, format=DocumentFormat.JSON, blocks=blocks)
