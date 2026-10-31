"""End-to-end checks for /v1/query against a running Meridian API.

Usage:
    python scripts/query_e2e_test.py --base-url http://127.0.0.1:8000 --api-key local-admin-key
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
    if Path(".env.local").exists():
        for line in Path(".env.local").read_text(encoding="utf-8").splitlines():
            if line.startswith("API_KEYS="):
                raw = line.split("=", 1)[1].strip()
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
            try:
                return response.status, json.loads(body), elapsed
            except json.JSONDecodeError:
                return response.status, {"raw": body}, elapsed
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        elapsed = (time.perf_counter() - started) * 1000
        try:
            return error.code, json.loads(body), elapsed
        except json.JSONDecodeError:
            return error.code, {"raw": body}, elapsed
    except Exception as error:  # noqa: BLE001 - network/timeout failures are reported per case
        elapsed = (time.perf_counter() - started) * 1000
        return 0, {"error": str(error)}, elapsed


def run_case(base_url, api_key, case, top_k, max_cycles, timeout):
    question = case["question"]
    answerable = bool(case.get("answerable", True))

    status, body, elapsed = _post(
        base_url,
        "/v1/query",
        api_key,
        {"query": question, "top_k": top_k, "max_cycles": max_cycles, "enforce_guardrails": True},
        timeout,
    )

    if not isinstance(body, dict) or "answer" not in body:
        return {
            "id": case["id"],
            "question": question,
            "answerable": answerable,
            "query_status": status,
            "answer_status": None,
            "verified": False,
            "cycle_count": 0,
            "verification_status": None,
            "error": body.get("error") or body.get("detail") or body.get("raw"),
            "elapsed_ms": round(elapsed, 1),
        }

    verification = body.get("verification") or {}
    return {
        "id": case["id"],
        "question": question,
        "answerable": answerable,
        "query_status": status,
        "answer_status": body.get("answer_status"),
        "verified": bool(body.get("verified", False)),
        "cycle_count": body.get("cycle_count", 0),
        "verification_status": verification.get("status"),
        "refusal": bool(body.get("refusal", False)),
        "source_count": len(body.get("source_chunks") or []),
        "elapsed_ms": round(elapsed, 1),
        "answer_preview": str(body.get("answer", ""))[:120],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--questions", type=Path, default=Path("evals/golden_dataset.json"))
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--max-cycles", type=int, default=2)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--output", type=Path, default=Path("evals/reports/query_e2e_test.json"))
    args = parser.parse_args()

    api_key = _load_api_key(args.api_key)
    cases = json.loads(args.questions.read_text(encoding="utf-8"))
    if args.limit and args.limit > 0:
        cases = cases[: args.limit]

    rows = []
    for index, case in enumerate(cases, start=1):
        row = run_case(args.base_url, api_key, case, args.top_k, args.max_cycles, args.timeout)
        rows.append(row)
        print(
            f"[{index}/{len(cases)}] {row['id']}: "
            f"status={row['query_status']} answer_status={row['answer_status']} "
            f"verified={row['verified']} cycles={row['cycle_count']} "
            f"verification={row['verification_status']}"
        )

    answerable = [r for r in rows if r.get("answerable")]
    unanswerable = [r for r in rows if not r.get("answerable")]

    def rate(items, key, expected=True):
        if not items:
            return 0.0
        return sum(1 for item in items if item.get(key) == expected) / len(items)

    summary = {
        "total_cases": len(rows),
        "top_k": args.top_k,
        "max_cycles": args.max_cycles,
        "answer_status_answered_rate": rate(answerable, "answer_status", "answered"),
        "verified_rate": sum(1 for r in rows if r.get("verified")) / len(rows) if rows else 0.0,
        "avg_cycle_count": sum(r.get("cycle_count", 0) for r in rows) / len(rows) if rows else 0.0,
        "error_count": sum(1 for r in rows if r.get("error")),
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

    # Comparison table
    print("\n=== COMPARISON (answerable cases) ===")
    print(f"{'id':8} {'answer_status':18} {'verified':8} {'cycles':7} {'verification':16}")
    for row in answerable:
        print(
            f"{row['id']:8} {str(row.get('answer_status')):18} "
            f"{str(row.get('verified')):8} {str(row.get('cycle_count')):7} "
            f"{str(row.get('verification_status')):16}"
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps({"summary": summary, "cases": rows}, indent=2), encoding="utf-8"
    )
    print(f"\nReport written to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
PY
