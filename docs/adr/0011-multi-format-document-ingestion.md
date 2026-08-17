# 0011. Multi-Format Structural Document Ingestion

The ingestion pipeline supports multi-format parsing (PDF, Markdown, DOCX, HTML, TXT) with semantic section and heading awareness using PyMuPDF and Unstructured parsers. Documents are chunked along logical boundaries to preserve semantic coherence before vectorization and entity extraction.
