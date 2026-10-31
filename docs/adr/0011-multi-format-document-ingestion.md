# 0011. Multi-Format Structural Document Ingestion

**Status:** Accepted (drifted) · **Date:** 2026-08-17

The ingestion pipeline supports multi-format parsing (PDF, Markdown, DOCX, HTML, TXT) with semantic section and heading awareness using PyMuPDF and Unstructured parsers. Documents are chunked along logical boundaries to preserve semantic coherence before vectorization and entity extraction.

## Current Status

**Current state (verified 2026-10-13):** PDF, Markdown, TXT, DOCX, and HTML parsers are used by the ingestion pipeline. Parsing uses `pypdf`, BeautifulSoup, and `python-docx` plus repository code; PyMuPDF and Unstructured are not dependencies. Scanned PDFs are detected/warned but OCR is not performed. See `services/ingestion/parsers/`.
