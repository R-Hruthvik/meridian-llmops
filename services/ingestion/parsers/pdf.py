"""PDF parser (pypdf): per-page extraction, hyphenation joining, quality checks."""

import re

from packages.core.errors import ParseError
from packages.core.models import DocumentFormat
from services.ingestion.parsers.base import Block, ParsedDocument, ParsedPage

_HYPHEN_BREAK = re.compile(r"(\w)-\n(\w)")
_WS = re.compile(r"[ \t]+")


def _normalize_page_text(text: str) -> str:
    joined = _HYPHEN_BREAK.sub(r"\1\2", text)
    return _WS.sub(" ", joined).strip()


def parse_pdf(data: bytes, title: str = "") -> ParsedDocument:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(__import__("io").BytesIO(data))
    except PdfReadError as error:
        raise ParseError(f"Could not read PDF: {error}") from error
    if reader.is_encrypted:
        try:
            if not reader.decrypt(""):
                raise ParseError("PDF is encrypted and cannot be read without a password")
        except ParseError:
            raise
        except Exception as error:
            raise ParseError("PDF is encrypted and cannot be read without a password") from error

    pages: list[ParsedPage] = []
    blocks: list[Block] = []
    line_counts: dict[str, int] = {}
    page_texts: list[str] = []
    for number, page in enumerate(reader.pages, start=1):
        try:
            raw = page.extract_text() or ""
        except Exception as error:
            raise ParseError(f"Could not extract text from PDF page {number}: {error}") from error
        text = _normalize_page_text(raw)
        pages.append(ParsedPage(number=number, text=text))
        page_texts.append(text)
        for line in {line.strip() for line in text.splitlines() if len(line.strip()) >= 3}:
            line_counts[line] = line_counts.get(line, 0) + 1

    # Repeated lines on >60% of pages are header/footer noise.
    threshold = int(0.6 * len(pages)) + 1
    repeated = {line for line, count in line_counts.items() if count >= threshold and len(pages) >= 2}

    empty_pages = 0
    garbled_pages = 0
    for number, text in enumerate(page_texts, start=1):
        content = "\n".join(line for line in text.splitlines() if line.strip() not in repeated).strip()
        non_space = len(re.sub(r"\s", "", content))
        if non_space < 20:
            empty_pages += 1
            continue
        non_alnum = sum(1 for char in content if not char.isalnum() and not char.isspace())
        if (non_alnum / max(1, len(content))) > 0.35 or "\ufffd" in content:
            garbled_pages += 1
            continue
        for paragraph in content.split("\n\n"):
            if paragraph.strip():
                blocks.append(Block(kind="paragraph", text=paragraph.strip(), page=number))

    warnings: list[str] = []
    if empty_pages:
        warnings.append(f"{empty_pages} of {len(pages)} pages have no extractable text")
    if garbled_pages:
        warnings.append(f"{garbled_pages} of {len(pages)} pages look garbled")
    if pages and (empty_pages + garbled_pages) >= 0.5 * len(pages):
        warnings.append("File looks scanned; OCR is not supported, so no garbage was indexed")

    return ParsedDocument(
        title=title or "Untitled document", format=DocumentFormat.PDF, blocks=blocks, pages=pages, warnings=warnings
    )
