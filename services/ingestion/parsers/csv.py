"""CSV/TSV parser: turn delimited rows into table blocks."""

import csv
import io

from packages.core.models import DocumentFormat
from services.ingestion.parsers.base import Block, ParsedDocument


def parse_csv(content: str, title: str = "") -> ParsedDocument:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n")
    reader = csv.reader(io.StringIO(normalized))
    rows = [row for row in reader if any(cell.strip() for cell in row)]
    if not rows:
        return ParsedDocument(title=title or "Untitled document", format=DocumentFormat.CSV, blocks=[])

    blocks: list[Block] = []
    # First row as header.
    header = rows[0]
    blocks.append(Block(kind="table", text=" | ".join(cell.strip() for cell in header)))

    # Group data rows into chunks of ~20 rows to keep tables manageable.
    group_size = 20
    data_rows = rows[1:]
    for start in range(0, len(data_rows), group_size):
        group = data_rows[start : start + group_size]
        lines = [" | ".join(cell.strip() for cell in row) for row in group]
        blocks.append(Block(kind="table", text="\n".join(lines)))

    resolved_title = title or "Untitled document"
    # Try to derive a title from a 'title' or 'name' column.
    for idx, cell in enumerate(header):
        if cell.strip().lower() in ("title", "name", "document"):
            if len(rows) > 1 and idx < len(rows[1]):
                resolved_title = rows[1][idx].strip() or resolved_title
            break

    return ParsedDocument(title=resolved_title, format=DocumentFormat.CSV, blocks=blocks)
