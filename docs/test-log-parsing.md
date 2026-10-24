# Test Log: Document Parsing, Chunks, and Queries

Date: 2026-10-24. Backend on http://localhost:8000, provider custom (kc/kilo-auto/free via localhost:3010).

## Ingestion (6 files, all parsed)

| Format | File | Chunks | Entities | Relationships |
|---|---|---|---|---|
| md | notes.md | 1 | 4 | 3 |
| html | page.html | 1 | 2 | 1 |
| txt | plain.txt | 1 | 1 | 0 |
| txt | pdftest.txt | 1 | 2 | 1 |
| pdf | pdftest.pdf | 1 | 2 | 1 |
| docx | doc.docx | 1 | 2 | 1 |

Total documents: 6, total chunks: 6.

## Chunk text (observed)

- md `notes.md`: "Beacon Gateway stores vector records in Cobalt Index.\n\nAster Dispatch routes requests to Beacon Gateway.\n\nCobalt Index uses Delta Embeddings."
- html `page.html`: "Meridian uses Qdrant for vectors."
- txt `plain.txt`: "Plain text doc: The sky is blue and grass is green."
- txt `pdftest.txt`: "PDF Test Document\n\nMeridian indexes PDF files too."
- pdf `pdftest.pdf`: "PDF Test Document\nMeridian indexes PDF files too."
- docx `doc.docx`: "Meridian parses DOCX files into chunks."

## Queries

| Question | Answer status | Answer (summary) | Serving |
|---|---|---|---|
| What does Beacon Gateway do? | insufficient_context (dense 0.6886 < 0.70) | n/a | none |
| What does Aster Dispatch do? | insufficient_context | n/a | none |
| What embeddings does Cobalt Index use? | answered | Cobalt Index uses Delta Embeddings [1] | custom/reflection/beam |
| Does Meridian parse PDFs? | answered | Meridian indexes PDF files too [1][2] | custom/reflection/beam |
| What color is the sky? | answered | The sky is blue [1] | custom/reflection/beam |
| Does Meridian parse DOCX? | answered | Yes, Meridian parses DOCX files into chunks [1] | custom/reflection/beam |

## Findings

- All six supported formats (md, html, txt, pdf, docx) parse and chunk correctly.
- `min_dense_score=0.70` is too strict for small corpora: a clearly answerable question ("What does Beacon Gateway do?") was refused because top dense score 0.6886 < 0.70. Recommend lowering threshold or making corpus-aware.
- Entity extraction is noisy (capitalized words become entities), e.g. "With", "This", "Current".
- Serving provenance is null for refused/insufficient answers (expected).
