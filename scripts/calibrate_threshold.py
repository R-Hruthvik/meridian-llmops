"""Calibrate the minimum dense retrieval score on an isolated evaluation corpus.

    python scripts/calibrate_threshold.py
    python scripts/calibrate_threshold.py --questions evals/retrieval_smoke.json --docs sample_docs
"""

import argparse
import json
import math
import statistics
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from packages.core.errors import IndexReadError, IndexWriteError, IngestionError  # noqa: I001
from scripts.retrieval_check import DEFAULT_TENANT, SUPPORTED_SUFFIXES, build_engine


DEFAULT_OUTPUT = Path('.superpowers/sdd/meridian-phase3-plan/calibration-result.json')


class CalibrationInputError(ValueError):
    """An input path or evaluation dataset cannot be calibrated."""


def _load_cases(questions_path: Path) -> list[dict]:
    data = json.loads(questions_path.read_text(encoding='utf-8'))
    cases = data.get('cases') if isinstance(data, dict) else None
    if not isinstance(cases, list) or not cases:
        raise CalibrationInputError("questions JSON must contain a non-empty 'cases' list")

    has_answerable = False
    has_unanswerable = False
    for position, case in enumerate(cases, start=1):
        if not isinstance(case, dict):
            raise CalibrationInputError(f'case {position} must be an object')
        if not isinstance(case.get('id'), str) or not case['id'].strip():
            raise CalibrationInputError(f'case {position} must have a non-empty string id')
        if not isinstance(case.get('question'), str) or not case['question'].strip():
            raise CalibrationInputError(f"case {case['id']} must have a non-empty string question")
        answerable = case.get('answerable', True)
        if not isinstance(answerable, bool):
            raise CalibrationInputError(f"case {case['id']} answerable must be true or false")
        has_answerable |= answerable
        has_unanswerable |= not answerable
    if not has_answerable or not has_unanswerable:
        raise CalibrationInputError('questions must include answerable and unanswerable cases')
    return cases


def _validate_docs(docs_dir: Path) -> None:
    if not docs_dir.is_dir():
        raise CalibrationInputError(f'docs directory does not exist or is not a directory: {docs_dir}')
    if not any(path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES for path in docs_dir.glob('*')):
        raise CalibrationInputError(f'docs directory contains no supported documents: {docs_dir}')


def recommend_threshold(
    answerable_scores: list[float],
    unanswerable_scores: list[float],
    metric: str = 'youden',
) -> dict:
    """Choose a score cutoff, treating scores at or above it as answerable.

    Ties choose the higher cutoff, favoring specificity. Youden's J is the
    default because the smoke set has far fewer unanswerable than answerable cases.
    """
    if metric not in {'accuracy', 'youden'}:
        raise ValueError("metric must be 'accuracy' or 'youden'")
    if not answerable_scores or not unanswerable_scores:
        return {
            'threshold': None,
            'metric': metric,
            'objective': None,
            'accuracy': None,
            'youden_j': None,
            'true_positive': 0,
            'false_negative': len(answerable_scores),
            'true_negative': 0,
            'false_positive': len(unanswerable_scores),
        }

    values = sorted(set(answerable_scores + unanswerable_scores))
    candidates = values + [math.nextafter(values[-1], math.inf)]
    total = len(answerable_scores) + len(unanswerable_scores)
    best = None
    for threshold in candidates:
        true_positive = sum(score >= threshold for score in answerable_scores)
        false_negative = len(answerable_scores) - true_positive
        false_positive = sum(score >= threshold for score in unanswerable_scores)
        true_negative = len(unanswerable_scores) - false_positive
        accuracy = (true_positive + true_negative) / total
        youden_j = (
            true_positive / len(answerable_scores)
            + true_negative / len(unanswerable_scores)
            - 1.0
        )
        objective = accuracy if metric == 'accuracy' else youden_j
        result = {
            'threshold': threshold,
            'metric': metric,
            'objective': objective,
            'accuracy': accuracy,
            'youden_j': youden_j,
            'true_positive': true_positive,
            'false_negative': false_negative,
            'true_negative': true_negative,
            'false_positive': false_positive,
        }
        if best is None or (objective, threshold) > (best['objective'], best['threshold']):
            best = result
    return best


def _distribution(scores: list[float]) -> dict:
    if not scores:
        return {'count': 0, 'min': None, 'median': None, 'mean': None, 'max': None}
    return {
        'count': len(scores),
        'min': min(scores),
        'median': statistics.median(scores),
        'mean': statistics.mean(scores),
        'max': max(scores),
    }


def calibrate(questions_path: Path, docs_dir: Path, tenant: str) -> dict:
    _validate_docs(docs_dir)
    cases = _load_cases(questions_path)
    from packages.core.settings import get_settings

    settings = get_settings()
    with tempfile.TemporaryDirectory(prefix='threshold_calibration_') as temporary:
        retriever, store = build_engine(
            docs_dir, Path(temporary), settings.embedding_model,
            settings.fastembed_cache_path, tenant,
        )
        if store.count(tenant_id=tenant) == 0:
            raise CalibrationInputError(f'docs produced no indexed chunks: {docs_dir}')
        groups = {'answerable': [], 'unanswerable': []}
        for case in cases:
            vector = retriever.embedder.embed_query(case['question'])
            dense_hits = store.search(vector, k=1, tenant_id=tenant)
            dense_score = float(dense_hits[0].score) if dense_hits else 0.0
            bm25_hits = retriever.bm25_index.search(case['question'], top_k=5)
            groups['answerable' if case.get('answerable', True) else 'unanswerable'].append({
                'id': case['id'],
                'question': case['question'],
                'top_dense_score': dense_score,
                'dense_hit_found': bool(dense_hits),
                'bm25_positive_hit_count': len(bm25_hits),
                'bm25_top_hits': [
                    {'filename': hit.metadata.get('filename') or hit.metadata.get('source', ''),
                     'score': hit.score}
                    for hit in bm25_hits[:3]
                ],
            })

    answerable_scores = [row['top_dense_score'] for row in groups['answerable']]
    unanswerable_scores = [row['top_dense_score'] for row in groups['unanswerable']]
    recommendation = recommend_threshold(answerable_scores, unanswerable_scores)
    positive_bm25 = [
        row for row in groups['unanswerable'] if row['bm25_positive_hit_count'] > 0
    ]
    return {
        'questions': str(questions_path),
        'docs': str(docs_dir),
        'tenant': tenant,
        'threshold_rule': 'answerable when top_dense_score >= threshold',
        'metric_note': 'Youden J is used to balance sensitivity and specificity; ties choose the higher threshold.',
        'distributions': {
            label: _distribution([row['top_dense_score'] for row in rows])
            for label, rows in groups.items()
        },
        'recommendation': recommendation,
        'answerable': groups['answerable'],
        'unanswerable': groups['unanswerable'],
        'bm25_unanswerable_diagnostic': {
            'queries_with_positive_bm25_hits': len(positive_bm25),
            'query_count': len(groups['unanswerable']),
            'queries': [row['id'] for row in positive_bm25],
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--questions', type=Path, default=Path('evals/retrieval_smoke.json'))
    parser.add_argument('--docs', type=Path, default=Path('sample_docs'))
    parser.add_argument('--tenant', default=DEFAULT_TENANT)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--metric', choices=('youden', 'accuracy'), default='youden')
    args = parser.parse_args(argv)

    try:
        summary = calibrate(args.questions, args.docs, args.tenant)
        if args.metric != 'youden':
            summary['recommendation'] = recommend_threshold(
                [row['top_dense_score'] for row in summary['answerable']],
                [row['top_dense_score'] for row in summary['unanswerable']],
                metric=args.metric,
            )
            summary['metric_note'] = f'{args.metric} is used; ties choose the higher threshold.'
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    except (
        OSError, UnicodeError, json.JSONDecodeError, CalibrationInputError,
        IngestionError, IndexReadError, IndexWriteError,
    ) as error:
        print(f'error: {error}', file=sys.stderr)
        return 2

    print('Top dense score distributions:')
    for label, distribution in summary['distributions'].items():
        print(f"  {label}: {distribution}")
    recommendation = summary['recommendation']
    print(f"Recommended threshold: {recommendation['threshold']} ({recommendation['metric']})")
    print(f"  accuracy={recommendation['accuracy']} Youden J={recommendation['youden_j']}")
    diagnostic = summary['bm25_unanswerable_diagnostic']
    print(
        'Unanswerable queries with positive BM25 hits: '
        f"{diagnostic['queries_with_positive_bm25_hits']}/{diagnostic['query_count']}"
    )
    print(f'Summary written to {args.output}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
