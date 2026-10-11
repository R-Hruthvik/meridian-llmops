"""DOCX parser (python-docx): heading styles, paragraphs, and row-wise tables."""

from packages.core.errors import ParseError
from packages.core.models import DocumentFormat
from services.ingestion.parsers.base import Block, ParsedDocument


def parse_docx(data: bytes, title: str = "") -> ParsedDocument:
    import io

    import docx

    try:
        document = docx.Document(io.BytesIO(data))
    except Exception as error:
        raise ParseError(f"Could not read DOCX: {error}") from error

    blocks: list[Block] = []
    first_heading = ""
    from docx.document import Document as _Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    def iter_block_items(parent: _Document):
        for child in parent.element.body.iterchildren():
            if child.tag.endswith("}p"):
                yield Paragraph(child, parent)
            elif child.tag.endswith("}tbl"):
                yield Table(child, parent)

    for item in iter_block_items(document):
        if isinstance(item, Paragraph):
            text = item.text.strip()
            if not text:
                continue
            style = item.style.name if item.style is not None else ""
            if style.startswith("Heading"):
                level = style.replace("Heading", "").strip()
                blocks.append(
                    Block(
                        kind="heading",
                        text=text,
                        level=int(level) if level.isdigit() else None,
                    )
                )
                if not first_heading:
                    first_heading = text
            elif style in ("Title",):
                blocks.append(Block(kind="heading", text=text, level=1))
                if not first_heading:
                    first_heading = text
            else:
                blocks.append(Block(kind="paragraph", text=text))
        elif isinstance(item, Table):
            rows = []
            for row in item.rows:
                cells = [cell.text.strip() for cell in row.cells]
                rows.append(" | ".join(cells))
            if rows:
                blocks.append(Block(kind="table", text="\n".join(rows)))

    return ParsedDocument(
        title=title or first_heading or "Untitled document",
        format=DocumentFormat.DOCX,
        blocks=blocks,
    )
