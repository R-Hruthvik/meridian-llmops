"""Show the current upload contract and frontend file reader behavior."""

from pathlib import Path

app_source = Path("services/rag_engine/app.py").read_text()
ui_source = Path("web/src/components/IngestionStudio.tsx").read_text()
route = app_source[app_source.index('@app.post("/v1/ingest")') :]
route = route[: route.index("\n@app.")]
print("/v1/ingest takes IngestDocumentRequest:", "IngestDocumentRequest" in route)
print("UI still uses FileReader.readAsText:", "readAsText" in ui_source)
