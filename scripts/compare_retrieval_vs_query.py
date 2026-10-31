"""Compare retrieval-only (/v1/retrieve) and full-pipeline (/v1/query) results.

Usage:
    python scripts/compare_retrieval_vs_query.py --base-url http://127.0.0.1:8000 --api-key local-admin-key
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _load_api_key(explicit):
    if explicit:
        return explicit
    import os

    raw = os.environ.get("API_KEYS", "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict) and parsed:
                return next(iter(parsed))
        except json.JSONDecodeError:
            return raw.strip().strip('"').strip("'")
    raise SystemExit("No API key found; pass --api-key.")


def _post(base_url, path, api_key, payload, timeout):
    url = base_url.rstrip("/") + path
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"X-API-Key": api_key, "Content-Type": "application/json"},
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            elapsed = (time.perf_counter() - started) * 1000
            return response.status, json.loads(body), elapsed
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        elapsed = (time.perf_counter() - started) * 1000
        try:
            return error.code, json.loads(body), elapsed
        except json.JSONDecodeError:
            return error.code, {"raw": body}, elapsed
    except Exception as error:  # noqa: BLE001
        elapsed = (time.perf_counter() - started) * 1000
        return 0, {"error": str(error)}, elapsed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--questions", type=Path, default=Path("evals/golden_queries.json"))
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument(
        "--output", type=Path, default=Path("evals/reports/query_pipeline_compare.json")
    )
    args = parser.parse_args()

    api_key = _load_api_key(args.api_key)
    cases = json.loads(args.questions.read_text(encoding="utf-8"))
    rows = []
    for case in cases:
        question = case["question"]
        retrieve_status, retrieve_body, retrieve_elapsed = _post(
            args.base_url,
            "/v1/retrieve",
            api_key,
            {"query": question, "top_k": args.top_k},
            args.timeout,
        )
        query_status, query_body, query_elapsed = _post(
            args.base_url,
            "/v1/query",
            api_key,
            {"query": question, "top_k": args.top_k, "max_cycles": 2, "enforce_guardrails": True},
            args.timeout,
        )
        verification = query_body.get("verification") if isinstance(query_body, dict) else None
        rows.append(
            {
                "id": case.get("id"),
                "question": question,
                "answerable": case.get("answerable", True),
                "retrieve_status": retrieve_status,
                "retrieve_chunks": len((retrieve_body or {}).get("chunks", []))
                if isinstance(retrieve_body, dict)
                else 0,
                "retrieve_elapsed_ms": round(retrieve_elapsed, 1),
                "query_status": query_status,
                "answer_status": (query_body or {}).get("answer_status")
                if isinstance(query_body, dict)
                else None,
                "verified": (query_body or {}).get("verified")
                if isinstance(query_body, dict)
                else False,
                "cycle_count": (query_body or {}).get("cycle_count")
                if isinstance(query_body, dict)
                else 0,
                "verification_status": (verification or {}).get("status")
                if isinstance(verification, dict)
                else None,
                "query_elapsed_ms": round(query_elapsed, 1),
            }
        )
        print(
            f"{case.get('id')}: retrieve={retrieve_status} chunks={rows[-1]['retrieve_chunks']} "
            f"query={query_status} answer_status={rows[-1]['answer_status']} "
            f"verified={rows[-1]['verified']} cycles={rows[-1]['cycle_count']}"
        )

    summary = {
        "total_cases": len(rows),
        "retrieval_success_rate": sum(r["retrieve_status"] == 200 for r in rows) / len(rows)
        if rows
        else 0.0,
        "query_success_rate": sum(r["query_status"] == 200 for r in rows) / len(rows)
        if rows
        else 0.0,
        "answered_rate": sum(r["answer_status"] == "answered" for r in rows) / len(rows)
        if rows
        else 0.0,
        "verified_rate": sum(bool(r["verified"]) for r in rows) / len(rows) if rows else 0.0,
        "avg_cycle_count": sum(r["cycle_count"] or 0 for r in rows) / len(rows) if rows else 0.0,
    }
    print("\n=== SUMMARY ===")
    for key, value in summary.items():
        print(f"{key}: {value:.3f}" if isinstance(value, float) else f"{key}: {value}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps({"summary": summary, "cases": rows}, indent=2), encoding="utf-8"
    )
    print(f"\nReport written to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
