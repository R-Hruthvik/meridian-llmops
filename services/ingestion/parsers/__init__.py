"""Multi-format document parsers dispatched by extension and magic bytes."""

import uuid

from packages.core.errors import ParseError
from packages.core.models import Document, DocumentFormat
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
    ".text": DocumentFormat.TXT,
    ".log": DocumentFormat.TXT,
    ".pdf": DocumentFormat.PDF,
    ".docx": DocumentFormat.DOCX,
    ".html": DocumentFormat.HTML,
    ".htm": DocumentFormat.HTML,
    ".csv": DocumentFormat.CSV,
    ".tsv": DocumentFormat.CSV,
    ".json": DocumentFormat.JSON,
    ".jsonl": DocumentFormat.JSON,
    ".ndjson": DocumentFormat.JSON,
    ".yaml": DocumentFormat.YAML,
    ".yml": DocumentFormat.YAML,
    ".py": DocumentFormat.CODE,
    ".js": DocumentFormat.CODE,
    ".ts": DocumentFormat.CODE,
    ".tsx": DocumentFormat.CODE,
    ".jsx": DocumentFormat.CODE,
    ".java": DocumentFormat.CODE,
    ".go": DocumentFormat.CODE,
    ".rs": DocumentFormat.CODE,
    ".c": DocumentFormat.CODE,
    ".cpp": DocumentFormat.CODE,
    ".cc": DocumentFormat.CODE,
    ".h": DocumentFormat.CODE,
    ".hpp": DocumentFormat.CODE,
    ".rb": DocumentFormat.CODE,
    ".sh": DocumentFormat.CODE,
    ".bash": DocumentFormat.CODE,
    ".php": DocumentFormat.CODE,
    ".swift": DocumentFormat.CODE,
    ".kt": DocumentFormat.CODE,
    ".scala": DocumentFormat.CODE,
    ".r": DocumentFormat.CODE,
    ".sql": DocumentFormat.CODE,
}

_TEXT_FORMATS = {
    DocumentFormat.MARKDOWN,
    DocumentFormat.TXT,
    DocumentFormat.HTML,
    DocumentFormat.CSV,
    DocumentFormat.JSON,
    DocumentFormat.YAML,
    DocumentFormat.CODE,
}


def detect_format(filename: str, data: bytes) -> DocumentFormat:
    extension = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in _EXTENSION_FORMATS:
        raise ParseError(f"Unsupported file type: {filename or '(no name)'}")
    declared = _EXTENSION_FORMATS[extension]

    is_pdf = data[:5] == b"%PDF-"
    is_zip = data[:2] == b"PK"
    if declared == DocumentFormat.PDF and not is_pdf and data.strip():
        raise ParseError(f"{filename} is not a PDF (missing %PDF- header)")
    if declared == DocumentFormat.DOCX and not is_zip and data.strip():
        raise ParseError(f"{filename} is not a DOCX (missing zip container)")
    if declared in _TEXT_FORMATS and (is_pdf or is_zip):
        raise ParseError(f"{filename} has a binary header but a text extension")
    return declared


def parse_file(filename: str, data: bytes, title: str | None = None) -> ParsedDocument:
    doc_format = detect_format(filename, data)
    resolved_title = title or _title_from_filename(filename)

    if doc_format == DocumentFormat.PDF:
        return parse_pdf(data, title=resolved_title)
    if doc_format == DocumentFormat.DOCX:
        return parse_docx(data, title=resolved_title)

    text, warning = decode_text(data)

    if doc_format == DocumentFormat.HTML:
        parsed = parse_html(text, title=resolved_title)
    elif doc_format == DocumentFormat.MARKDOWN:
        parsed = parse_markdown(text, title=title or "")
        if not title and parsed.title == "Untitled document":
            parsed = ParsedDocument(
                title=resolved_title,
                format=parsed.format,
                blocks=parsed.blocks,
                warnings=parsed.warnings,
            )
    elif doc_format == DocumentFormat.CSV:
        from services.ingestion.parsers.csv import parse_csv

        parsed = parse_csv(text, title=resolved_title)
    elif doc_format == DocumentFormat.JSON:
        from services.ingestion.parsers.json import parse_json

        parsed = parse_json(text, title=resolved_title)
    elif doc_format == DocumentFormat.CODE:
        from services.ingestion.parsers.code import parse_code

        language = _language_from_filename(filename)
        parsed = parse_code(text, title=resolved_title, language=language)
    elif doc_format == DocumentFormat.YAML:
        parsed = parse_txt(text, title=resolved_title)
    else:
        parsed = parse_txt(text, title=resolved_title)

    if warning:
        parsed = ParsedDocument(
            title=parsed.title,
            format=parsed.format,
            blocks=parsed.blocks,
            warnings=[*parsed.warnings, warning],
        )
    if doc_format == DocumentFormat.MARKDOWN and title and parsed.title != title:
        pass
    return parsed


def parse_text(content: str, doc_format: DocumentFormat, title: str = "") -> ParsedDocument:
    if doc_format == DocumentFormat.MARKDOWN:
        return parse_markdown(content, title=title)
    if doc_format == DocumentFormat.HTML:
        return parse_html(content, title=title)
    if doc_format == DocumentFormat.CSV:
        from services.ingestion.parsers.csv import parse_csv

        return parse_csv(content, title=title)
    if doc_format == DocumentFormat.JSON:
        from services.ingestion.parsers.json import parse_json

        return parse_json(content, title=title)
    if doc_format == DocumentFormat.CODE:
        from services.ingestion.parsers.code import parse_code

        return parse_code(content, title=title, language="text")
    if doc_format == DocumentFormat.YAML:
        return parse_txt(content, title=title)
    return parse_txt(content, title=title)


def _title_from_filename(filename: str) -> str:
    if not filename:
        return "Untitled document"
    stem = filename.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    return stem.replace("_", " ").replace("-", " ").strip().title() or "Untitled document"


def _language_from_filename(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext or "text"


def parse_document(
    content: str | bytes,
    title: str,
    doc_format: DocumentFormat,
    source: str,
    doc_id: str | None = None,
) -> Document:
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