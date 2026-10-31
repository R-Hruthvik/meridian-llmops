"""End-to-end /v1/query check against a running Meridian API."""

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _normalize(text: str) -> str:
    return " ".join(str(text).lower().split())


def _load_api_key(explicit: str | None) -> str:
    if explicit:
        return explicit
    import os

    raw = os.environ.get("API_KEYS", "").strip()
    if not raw and Path(".env.local").exists():
        for line in Path(".env.local").read_text(encoding="utf-8").splitlines():
            if line.startswith("API_KEYS="):
                raw = line.split("=", 1)[1].strip()
                break
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict) and parsed:
                return next(iter(parsed))
        except json.JSONDecodeError:
            return raw.strip().strip('"').strip("'")
    if Path(".env").exists():
        for line in Path(".env").read_text(encoding="utf-8").splitlines():
            if line.startswith("API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("No API key found; pass --api-key or set API_KEYS/API_KEY.")


def _request(base_url: str, path: str, api_key: str, payload: dict, timeout: float):
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
            try:
                return response.status, json.loads(body), elapsed
            except json.JSONDecodeError:
                return response.status, body, elapsed
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        elapsed = (time.perf_counter() - started) * 1000
        try:
            return error.code, json.loads(body), elapsed
        except json.JSONDecodeError:
            return error.code, body, elapsed
    except Exception as error:
        elapsed = (time.perf_counter() - started) * 1000
        return 0, {"error": str(error)}, elapsed


def _retrieval_hit(chunks, expected_doc, expected_phrases):
    wanted = [_normalize(phrase) for phrase in expected_phrases]
    for chunk in chunks:
        source = str(chunk.get("filename") or (chunk.get("metadata") or {}).get("source") or "")
        if expected_doc and expected_doc not in source:
            continue
        text = _normalize(chunk.get("text", ""))
        if not wanted or any(phrase in text for phrase in wanted):
            return True
    return False


def _phrase_in_answer(answer, phrases):
    normalized_answer = _normalize(answer)
    return any(_normalize(phrase) in normalized_answer for phrase in phrases if phrase)


def _phrase_in_sources(chunks, phrases):
    normalized_sources = " ".join(_normalize(chunk.get("text", "")) for chunk in chunks)
    return any(_normalize(phrase) in normalized_sources for phrase in phrases if phrase)


def run_case(base_url, api_key, case, top_k, max_cycles, timeout):
    question = case["question"]
    expected_doc = case.get("expected_doc", "")
    expected_phrases = case.get("expected_phrases", [])
    answerable = bool(case.get("answerable", True))

    retrieve_status, retrieve_body, retrieve_elapsed = _request(
        base_url, "/v1/retrieve", api_key, {"query": question, "top_k": top_k}, timeout
    )
    retrieve_chunks = retrieve_body.get("chunks", []) if isinstance(retrieve_body, dict) else []
    retrieval_hit = (
        _retrieval_hit(retrieve_chunks, expected_doc, expected_phrases)
        if retrieve_status == 200
        else False
    )

    query_status, query_body, query_elapsed = _request(
        base_url,
        "/v1/query",
        api_key,
        {"query": question, "top_k": top_k, "max_cycles": max_cycles, "enforce_guardrails": True},
        timeout,
    )

    if not isinstance(query_body, dict):
        return {
            "id": case["id"],
            "category": case.get("category"),
            "answerable": answerable,
            "question": question,
            "retrieve_status": retrieve_status,
            "query_status": query_status,
            "error": str(query_body),
            "retrieval_hit": retrieval_hit,
        }

    answer = query_body.get("answer", "")
    answer_status = query_body.get("answer_status")
    verified = bool(query_body.get("verified", False))
    cycle_count = query_body.get("cycle_count", 0)
    verification = query_body.get("verification") or {}
    source_chunks = query_body.get("source_chunks") or query_body.get("sources") or []
    refusal = bool(query_body.get("refusal", False))
    timings = query_body.get("timings_ms") or {}

    expected_answer_status = "answered" if answerable else "insufficient_context"
    answer_status_ok = answer_status == expected_answer_status
    if answerable:
        expected_phrase_hit = _phrase_in_answer(answer, expected_phrases)
    else:
        expected_phrase_hit = _normalize(answer) == _normalize(
            "I don't have enough information in the provided documents to answer that."
        )
    source_phrase_hit = _phrase_in_sources(source_chunks, expected_phrases) if answerable else True
    full_pipeline_success = (
        answer_status_ok and (expected_phrase_hit or source_phrase_hit) and not refusal
    )

    return {
        "id": case["id"],
        "category": case.get("category"),
        "answerable": answerable,
        "question": question,
        "expected_doc": expected_doc,
        "retrieve_status": retrieve_status,
        "retrieval_hit": retrieval_hit,
        "query_status": query_status,
        "answer_status": answer_status,
        "expected_answer_status": expected_answer_status,
        "answer_status_ok": answer_status_ok,
        "verified": verified,
        "cycle_count": cycle_count,
        "verification_status": verification.get("status"),
        "refusal": refusal,
        "source_count": len(source_chunks),
        "answer_contains_expected": expected_phrase_hit,
        "source_contains_expected": source_phrase_hit,
        "full_pipeline_success": full_pipeline_success,
        "execution_time_ms": query_body.get("execution_time_ms"),
        "generate_ms": timings.get("generate"),
        "retrieve_ms": timings.get("retrieve"),
        "total_ms": timings.get("total"),
        "answer_preview": answer[:240],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--questions", type=Path, default=Path("evals/golden_dataset.json"))
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--max-cycles", type=int, default=2)
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    api_key = _load_api_key(args.api_key)
    cases = json.loads(args.questions.read_text(encoding="utf-8"))
    if args.offset:
        cases = cases[args.offset :]
    if args.limit and args.limit > 0:
        cases = cases[: args.limit]

    rows = []
    for index, case in enumerate(cases, start=1):
        print(f"[{index}/{len(cases)}] {case['id']}: {case['question']}", flush=True)
        row = run_case(args.base_url, api_key, case, args.top_k, args.max_cycles, args.timeout)
        rows.append(row)
        print(
            f"    retrieve={row.get('retrieval_hit')} query_status={row.get('query_status')} "
            f"answer_status={row.get('answer_status')} verified={row.get('verified')} "
            f"cycles={row.get('cycle_count')} success={row.get('full_pipeline_success')}"
        )

    answerable = [r for r in rows if r.get("answerable")]
    unanswerable = [r for r in rows if not r.get("answerable")]

    def rate(items, key):
        if not items:
            return 0.0
        return sum(1 for item in items if item.get(key)) / len(items)

    summary = {
        "total_cases": len(rows),
        "top_k": args.top_k,
        "max_cycles": args.max_cycles,
        "retrieval_hit_rate": rate(rows, "retrieval_hit"),
        "answer_status_accuracy": rate(rows, "answer_status_ok"),
        "answerable_success_rate": rate(answerable, "full_pipeline_success"),
        "unanswerable_success_rate": rate(unanswerable, "full_pipeline_success"),
        "full_pipeline_success_rate": rate(rows, "full_pipeline_success"),
        "verified_rate_answered": (
            sum(1 for r in answerable if r.get("verified")) / len(answerable) if answerable else 0.0
        ),
        "avg_cycle_count": statistics.mean(r.get("cycle_count", 0) for r in rows) if rows else 0.0,
        "max_cycle_count": max((r.get("cycle_count", 0) for r in rows), default=0),
        "avg_query_ms": statistics.mean(r.get("total_ms", 0) or 0 for r in rows) if rows else 0.0,
        "avg_generate_ms": statistics.mean(
            r.get("generate_ms", 0) or 0 for r in rows if r.get("generate_ms")
        )
        if any(r.get("generate_ms") for r in rows)
        else 0.0,
        "answer_contains_expected_rate": rate(answerable, "answer_contains_expected"),
        "source_contains_expected_rate": rate(answerable, "source_contains_expected"),
        "verification_statuses": {},
    }
    for row in rows:
        status = row.get("verification_status") or "unknown"
        summary["verification_statuses"][status] = (
            summary["verification_statuses"].get(status, 0) + 1
        )

    print("\n=== SUMMARY ===")
    for key, value in summary.items():
        if isinstance(value, float):
            print(f"{key}: {value:.3f}")
        else:
            print(f"{key}: {value}")

    report = {"summary": summary, "cases": rows}
    output = args.output
    if output is None:
        output = Path("evals/reports") / "query_check_report.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nReport written to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
