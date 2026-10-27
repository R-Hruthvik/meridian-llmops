"""Multi-format document parsers dispatched by extension and magic bytes."""

import uuid

from packages.core.errors import ParseError
from packages.core.models import Document, DocumentFormat
from services.ingestion.parsers.base import Block as Block
from services.ingestion.parsers.base import (NORMALIZER_VERSION, PARSER_VERSION)
from services.ingestion.parsers.base import ParsedDocument
from services.ingestion.parsers.docx import parse_docx
from services.ingestion.parsers.html import parse_html
from services.ingestion.parsers.md import parse_markdown
from services.ingestion.parsers.pdf import parse_pdf
from services.ingestion.parsers.txt import decode_text, parse_txt

_EXTENSION_FORMATS = {
    ".md": DocumentFormat.MARKDOWN,
    ".markdown": DocumentFormat.MARKDOWN,
    ".txt": DocumentFormat.TXT,
    ".pdf": DocumentFormat.PDF,
    ".docx": DocumentFormat.DOCX,
    ".html": DocumentFormat.HTML,
    ".htm": DocumentFormat.HTML,
}

_TEXT_FORMATS = {DocumentFormat.MARKDOWN, DocumentFormat.TXT, DocumentFormat.HTML}


def detect_format(filename: str, data: bytes) -> DocumentFormat:
    """Resolve the format from the extension, confirmed by magic bytes.

    A mismatch (a PDF renamed to .txt) is rejected rather than parsed as garbage.
    """
    extension = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in _EXTENSION_FORMATS:
        raise ParseError(f"Unsupported file type: {filename or '(no name)'}")
    declared = _EXTENSION_FORMATS[extension]

    is_pdf = data[:5] == b"%PDF-"
    is_zip = data[:2] == b"PK"
    if declared == DocumentFormat.PDF and not is_pdf:
        raise ParseError(f"{filename} is not a PDF (missing %PDF- header)")
    if declared == DocumentFormat.DOCX and not is_zip:
        raise ParseError(f"{filename} is not a DOCX (missing zip container)")
    if declared in _TEXT_FORMATS and (is_pdf or is_zip):
        raise ParseError(f"{filename} has a binary header but a text extension")
    return declared


def parse_file(filename: str, data: bytes, title: str | None = None) -> ParsedDocument:
    """Parse raw bytes into blocks using the extension-confirmed format."""
    doc_format = detect_format(filename, data)
    resolved_title = title or _title_from_filename(filename)

    if doc_format == DocumentFormat.PDF:
        return parse_pdf(data, title=resolved_title)
    if doc_format == DocumentFormat.DOCX:
        return parse_docx(data, title=resolved_title)

    if doc_format == DocumentFormat.TXT:
        text, warning = decode_text(data)
        parsed = parse_txt(text, title=resolved_title)
        if warning:
            return ParsedDocument(
                title=parsed.title, format=parsed.format, blocks=parsed.blocks, warnings=[warning]
            )
        return parsed
    if doc_format == DocumentFormat.HTML:
        text, warning = decode_text(data)
        parsed = parse_html(text, title=resolved_title)
        if warning:
            return ParsedDocument(
                title=parsed.title, format=parsed.format, blocks=parsed.blocks, warnings=[warning]
            )
        return parsed
    text, warning = decode_text(data)
    parsed = parse_markdown(text, title=title or "")
    if not title and parsed.title == "Untitled document":
        parsed = ParsedDocument(
            title=resolved_title,
            format=parsed.format,
            blocks=parsed.blocks,
            warnings=parsed.warnings,
        )
    if warning:
        return ParsedDocument(
            title=parsed.title, format=parsed.format, blocks=parsed.blocks, warnings=[warning]
        )
    return parsed


def parse_text(content: str, doc_format: DocumentFormat, title: str = "") -> ParsedDocument:
    """Parse already-decoded text content (ingest-text path)."""
    if doc_format == DocumentFormat.MARKDOWN:
        return parse_markdown(content, title=title)
    if doc_format == DocumentFormat.HTML:
        return parse_html(content, title=title)
    return parse_txt(content, title=title)


def _title_from_filename(filename: str) -> str:
    if not filename:
        return "Untitled document"
    stem = filename.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    return stem.replace("_", " ").replace("-", " ").strip().title() or "Untitled document"


def parse_document(
    content: str | bytes,
    title: str,
    doc_format: DocumentFormat,
    source: str,
    doc_id: str | None = None,
) -> Document:
    """Legacy flat-text entry point kept for the ingest-text path and existing callers."""
    parsed: ParsedDocument
    if isinstance(content, bytes):
        parsed = parse_file(source or "upload.txt", content, title=title)
    else:
        parsed = parse_text(content, doc_format, title=title)
    return Document(
        id=doc_id or f"doc-{uuid.uuid4().hex[:8]}",
        title=title or parsed.title,
        text=parsed.text,
        format=doc_format if doc_format in _TEXT_FORMATS else parsed.format,
        source=source,
    )
