#!/usr/bin/env python3
"""Batch ingestion script to load local markdown/text files into Meridian LLMOps."""

import argparse
from pathlib import Path

import httpx


def ingest_directory(directory: str, api_url: str = "http://localhost:8000", api_key: str = "meridian-test-secret-key-2026"):
    doc_dir = Path(directory)
    if not doc_dir.exists():
        print(f"❌ Error: Directory '{directory}' does not exist.")
        return

    files = [f for f in doc_dir.glob("*") if f.suffix.lower() in [".md", ".txt", ".html", ".json"]]
    if not files:
        print(f"⚠️ No markdown/text files found in '{directory}'.")
        return

    print(f"📂 Found {len(files)} documents in '{directory}'. Starting ingestion into Meridian...")

    headers = {
        "Content-Type": "application/json",
        "X-API-Key": api_key,
        "X-Tenant-Id": "batch-ingestion",
    }

    success_count = 0
    with httpx.Client(timeout=30.0) as client:
        for file_path in files:
            title = file_path.stem.replace("_", " ").title()
            text = file_path.read_text(encoding="utf-8", errors="ignore")

            try:
                resp = client.post(
                    f"{api_url}/v1/ingest",
                    headers=headers,
                    json={
                        "title": title,
                        "text": text,
                        "source": str(file_path),
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    print(f"  ✅ Ingested: '{title}' -> {data.get('chunks_indexed', 0)} chunks, {data.get('entities_extracted', 0)} entities")
                    success_count += 1
                else:
                    print(f"  ❌ Failed '{title}': HTTP {resp.status_code} - {resp.text[:100]}")
            except (httpx.HTTPError, httpx.RequestError, OSError, ValueError) as e:
                print(f"  ❌ Connection error ingesting '{title}': {e}")

    print(f"\n🎉 Ingestion complete: {success_count}/{len(files)} documents successfully indexed into Qdrant & Neo4j.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest documentation into Meridian LLMOps")
    parser.add_argument("--dir", default="sample_docs", help="Directory containing documents")
    parser.add_argument("--url", default="http://localhost:8000", help="Meridian API URL")
    parser.add_argument("--key", default="meridian-test-secret-key-2026", help="X-API-Key")
    args = parser.parse_args()

    ingest_directory(args.dir, args.url, args.key)
