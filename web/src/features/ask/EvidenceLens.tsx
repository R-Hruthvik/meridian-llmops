/**
 * Meridian — Evidence Lens.
 *
 * A right-hand slide-over that answers one question: "where did that sentence
 * come from?". Three tabs, three backend surfaces:
 *
 *   1. Cited Evidence  — the chunks behind this answer + the verification verdict.
 *   2. Retrieval Lab   — `POST /v1/retrieve` with `debug: true`, no LLM involved.
 *   3. Guardrail Check — `POST /v1/guardrails/check` against arbitrary text.
 */
import { AnimatePresence, motion } from 'framer-motion';
import {
  Ban,
  Check,
  ChevronDown,
  FileText,
  Files,
  FlaskConical,
  Hash,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { StatusBadge, type StatusTone } from '../../components/shell/StatusBadge';
import { ApiError, apiFetch } from '../../core/api';
import { DRAWER_SLIDE, SCRIM_FADE, SPRING_GENTLE, SPRING_SNAPPY } from '../../core/motion';
import type { GuardrailResult, SearchResult, VerificationSummary } from '../../core/types';
import {
  asNumber,
  isRecord,
  normalizeGuardrailResult,
  normalizeSearchResults,
  type EvidenceTab,
} from './types';

/* -------------------------------------------------------------------------- */
/* Shared presentation helpers                                                */
/* -------------------------------------------------------------------------- */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Verdict → badge tone. Exported so AskView renders the same verdict identically. */
export function verificationTone(verification: VerificationSummary | null): StatusTone {
  if (!verification || verification.status === 'unchecked') return 'neutral';
  if (verification.status === 'citations_ok' || verification.status === 'supported') return 'ok';
  return 'fail';
}

export function verificationLabel(verification: VerificationSummary | null): string {
  if (!verification) return 'unverified';
  return verification.status.replace(/_/g, ' ');
}

function scorePercent(score: number): number {
  if (!Number.isFinite(score)) return 0;
  const scaled = score <= 1 ? score * 100 : score;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Highlight the meaningful words of the question inside a chunk. */
function HighlightedText({ text, query }: { text: string; query: string }): ReactNode {
  const terms = useMemo(() => {
    const words = query
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((word) => word.length > 3);
    return new Set(words.slice(0, 10));
  }, [query]);

  const parts = useMemo(() => {
    if (terms.size === 0) return null;
    const pattern = new RegExp(`(${[...terms].map(escapeRegExp).join('|')})`, 'gi');
    return text.split(pattern);
  }, [text, terms]);

  if (!parts) return text;

  return parts.map((part, index) =>
    terms.has(part.toLowerCase()) ? (
      <mark key={index} className="rounded-[3px] bg-warn/25 px-0.5 text-ink">
        {part}
      </mark>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Small primitives                                                           */
/* -------------------------------------------------------------------------- */

function ScoreBar({ score }: { score: number }) {
  const percent = scorePercent(score);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-subtle">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent"
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={SPRING_GENTLE}
        />
      </div>
      <span className="tabular w-10 shrink-0 text-right text-[10px] text-ink-muted">
        {score.toFixed(3)}
      </span>
    </div>
  );
}

function IssueList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">{title}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="flex gap-1.5 text-[11.5px] leading-snug text-ink-muted">
            <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-fail/70" aria-hidden="true" />
            <span className="min-w-0 break-words">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Verification panel                                                         */
/* -------------------------------------------------------------------------- */

function VerificationPanel({ verification }: { verification: VerificationSummary | null }) {
  if (!verification) {
    return (
      <div className="rounded-md border border-hairline bg-subtle/50 px-3 py-2.5">
        <p className="text-[11.5px] text-ink-muted">
          No verification payload for this turn — citations were not judged.
        </p>
      </div>
    );
  }

  const issues =
    verification.invalid_citations.length +
    verification.uncited_claims.length +
    verification.numeric_mismatches.length +
    verification.unsupported_claims.length +
    verification.contradictions.length;

  return (
    <div className="rounded-md border border-hairline bg-subtle/50 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge
          tone={verificationTone(verification)}
          size="sm"
          label={verificationLabel(verification)}
        />
        <span className="font-mono text-[10px] text-ink-faint">
          scope · {verification.scope.replace(/_/g, ' ')}
        </span>
        {issues === 0 ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-ok-ink">
            <Check className="h-3 w-3" strokeWidth={2.6} />
            no issues
          </span>
        ) : (
          <span className="ml-auto text-[10px] font-semibold text-fail-ink">{issues} issues</span>
        )}
      </div>

      {verification.invalid_citations.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
            invalid
          </span>
          {verification.invalid_citations.map((citation) => (
            <span
              key={`invalid-${citation}`}
              className="rounded-pill border border-fail/30 bg-fail-soft px-1.5 text-[10px] font-semibold tabular text-fail-ink"
            >
              [{citation}]
            </span>
          ))}
        </div>
      ) : null}

      <IssueList title="Uncited claims" items={verification.uncited_claims} />
      <IssueList title="Unsupported claims" items={verification.unsupported_claims} />
      <IssueList title="Numeric mismatches" items={verification.numeric_mismatches} />
      <IssueList title="Contradictions" items={verification.contradictions} />

      {verification.details ? (
        <p className="mt-2 border-t border-hairline pt-2 text-[11px] leading-snug text-ink-muted">
          {verification.details}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chunk card                                                                 */
/* -------------------------------------------------------------------------- */

interface ChunkCardProps {
  result: SearchResult;
  index: number;
  query: string;
  highlighted?: boolean;
  flagged?: boolean;
}

function ChunkCard({ result, index, query, highlighted = false, flagged = false }: ChunkCardProps) {
  const [expanded, setExpanded] = useState(false);
  const rank = result.rank ?? index + 1;
  const isLong = result.text.length > 460;
  const scoreEntries = Object.entries(result.scores).slice(0, 4);

  return (
    <article
      data-chunk-id={result.chunk_id}
      className={cx(
        'group relative rounded-md border bg-elevated px-3 py-2.5 transition-colors',
        highlighted
          ? 'border-accent/50 ring-1 ring-accent/25'
          : 'border-hairline hover:border-accent/25',
      )}
    >
      {highlighted ? (
        <motion.span
          layoutId="lens-active-chunk"
          className="absolute inset-y-0 left-0 w-[2px] rounded-full bg-accent"
          transition={SPRING_SNAPPY}
        />
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-[5px] border border-hairline bg-subtle px-1 text-[10px] font-semibold tabular text-ink-muted">
            {rank}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] font-medium text-ink">{result.title}</span>
            <span className="block truncate font-mono text-[10px] text-ink-faint">
              {result.filename}
              {result.page_start !== null ? ` · p.${result.page_start}` : ''}
              {result.heading_path ? ` · ${result.heading_path}` : ''}
            </span>
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {flagged ? (
            <StatusBadge tone="warn" size="sm" label="flagged" className="hidden sm:inline-flex" />
          ) : null}
          <span className="rounded-pill border border-hairline bg-subtle px-1.5 py-[2px] font-mono text-[9.5px] uppercase tracking-wide text-ink-muted">
            {result.retrieval_method}
          </span>
        </div>
      </div>

      <div className="mt-2">
        <ScoreBar score={result.score} />
      </div>

      <p
        className={cx(
          'mt-2 text-[12px] leading-[1.6] text-ink-muted',
          !expanded && isLong && 'line-clamp-4',
        )}
      >
        <HighlightedText text={result.text} query={query} />
      </p>

      {isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-medium text-accent hover:underline"
        >
          <ChevronDown
            className={cx('h-3 w-3 transition-transform', expanded && 'rotate-180')}
            strokeWidth={2.4}
          />
          {expanded ? 'Collapse chunk' : 'Show full chunk'}
        </button>
      ) : null}

      {scoreEntries.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1 border-t border-hairline pt-2">
          {scoreEntries.map(([key, value]) => (
            <span
              key={key}
              className="rounded-[5px] bg-subtle px-1.5 py-[1px] font-mono text-[9.5px] text-ink-muted"
            >
              {key} {typeof value === 'number' ? value.toFixed(3) : String(value)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-1.5 flex items-center gap-1 font-mono text-[9.5px] text-ink-faint">
        <Hash className="h-2.5 w-2.5" strokeWidth={2.4} />
        <span className="truncate">{result.chunk_id}</span>
        <span className="opacity-40">·</span>
        <span className="truncate">{result.document_id}</span>
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab 1 — Cited Evidence                                                     */
/* -------------------------------------------------------------------------- */

interface CitedEvidenceTabProps {
  sources: SearchResult[];
  verification: VerificationSummary | null;
  query: string;
  highlightedChunkId: string | null;
  flaggedChunkIds: string[];
}

function CitedEvidenceTab({
  sources,
  verification,
  query,
  highlightedChunkId,
  flaggedChunkIds,
}: CitedEvidenceTabProps) {
  const rowRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!highlightedChunkId) return;
    const node = rowRefs.current.get(highlightedChunkId);
    if (!node) return;
    const timer = window.setTimeout(() => {
      if (typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [highlightedChunkId]);

  return (
    <div className="flex flex-col gap-3">
      <VerificationPanel verification={verification} />

      {sources.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-hairline px-4 py-10 text-center">
          <Files className="h-5 w-5 text-ink-faint" strokeWidth={1.6} />
          <p className="text-[12.5px] font-medium text-ink">No cited chunks yet</p>
          <p className="max-w-[15rem] text-[11px] leading-relaxed text-ink-muted">
            This turn produced no retrievable evidence. Use the Retrieval Lab to inspect raw
            retrieval for the same question.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {sources.map((source, index) => (
            <div
              key={`${source.chunk_id}-${index}`}
              ref={(node) => {
                if (node) rowRefs.current.set(source.chunk_id, node);
                else rowRefs.current.delete(source.chunk_id);
              }}
            >
              <ChunkCard
                result={source}
                index={index}
                query={query}
                highlighted={source.chunk_id === highlightedChunkId}
                flagged={flaggedChunkIds.includes(source.chunk_id)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab 2 — Retrieval Lab                                                      */
/* -------------------------------------------------------------------------- */

interface LabState {
  status: 'idle' | 'loading' | 'done' | 'error';
  results: SearchResult[];
  error: string | null;
  ms: number | null;
  timings: Record<string, number>;
}

const EMPTY_LAB: LabState = { status: 'idle', results: [], error: null, ms: null, timings: {} };

function extractTimings(raw: unknown): Record<string, number> {
  if (!isRecord(raw)) return {};
  const source = isRecord(raw.timings_ms) ? raw.timings_ms : isRecord(raw.timings) ? raw.timings : null;
  if (!source) return {};
  const timings: Record<string, number> = {};
  for (const [key, value] of Object.entries(source)) {
    const parsed = asNumber(value, Number.NaN);
    if (Number.isFinite(parsed)) timings[key] = parsed;
  }
  return timings;
}

function RetrievalLabTab({ defaultQuery }: { defaultQuery: string }) {
  const [query, setQuery] = useState(defaultQuery);
  const [topK, setTopK] = useState(8);
  const [state, setState] = useState<LabState>(EMPTY_LAB);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setQuery((current) => (current.trim().length === 0 ? defaultQuery : current));
  }, [defaultQuery]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const run = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const startedAt = performance.now();
    setState({ ...EMPTY_LAB, status: 'loading' });

    try {
      const raw = await apiFetch<unknown>('/v1/retrieve', {
        method: 'POST',
        body: JSON.stringify({ query: trimmed, top_k: topK, debug: true }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setState({
        status: 'done',
        results: normalizeSearchResults(raw),
        error: null,
        ms: Math.round(performance.now() - startedAt),
        timings: extractTimings(raw),
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        ...EMPTY_LAB,
        status: 'error',
        error:
          error instanceof ApiError
            ? (error.detailMessage ?? error.message)
            : error instanceof Error
              ? error.message
              : 'Retrieval failed',
      });
    }
  }, [query, topK]);

  const methodCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const result of state.results) {
      counts.set(result.retrieval_method, (counts.get(result.retrieval_method) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [state.results]);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-hairline bg-subtle/50 p-2.5">
        <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint" htmlFor="lab-query">
          Raw retrieval
        </label>
        <textarea
          id="lab-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void run();
            }
          }}
          rows={2}
          placeholder="Query the index without generation…"
          className="mt-1.5 w-full resize-none rounded-[7px] border border-hairline bg-elevated px-2 py-1.5 text-[12px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-accent/40"
        />

        <div className="mt-2 flex items-center gap-2">
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint">
            top_k
          </span>
          <input
            type="range"
            min={1}
            max={20}
            step={1}
            value={topK}
            aria-label="Chunks to retrieve"
            onChange={(event) => setTopK(Number(event.target.value))}
            className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-hairline [accent-color:var(--accent)]"
          />
          <span className="tabular w-5 shrink-0 text-right text-[11px] font-semibold text-ink">{topK}</span>
          <button
            type="button"
            onClick={() => void run()}
            disabled={state.status === 'loading' || query.trim().length === 0}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[7px] bg-accent px-2.5 text-[11px] font-semibold text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            {state.status === 'loading' ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />
            ) : (
              <Search className="h-3 w-3" strokeWidth={2.4} />
            )}
            Retrieve
          </button>
        </div>
      </div>

      {state.status === 'idle' ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-hairline px-4 py-8 text-center">
          <FlaskConical className="h-5 w-5 text-ink-faint" strokeWidth={1.6} />
          <p className="max-w-[18rem] text-[11px] leading-relaxed text-ink-muted">
            Run a raw retrieval query to inspect dense, lexical, and reranked chunk scores without
            calling an LLM.
          </p>
        </div>
      ) : null}

      {state.status === 'error' && state.error ? (
        <p className="rounded-md border border-fail/30 bg-fail-soft px-3 py-2 text-[11.5px] text-fail-ink">
          {state.error}
        </p>
      ) : null}

      {state.status === 'done' ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge
            tone={state.results.length > 0 ? 'ok' : 'warn'}
            size="sm"
            label={`${state.results.length} chunks`}
          />
          {state.ms !== null ? (
            <span className="tabular text-[10px] text-ink-muted">{state.ms}ms round trip</span>
          ) : null}
          {methodCounts.map(([method, count]) => (
            <span
              key={method}
              className="rounded-pill border border-hairline bg-subtle px-1.5 py-[1px] font-mono text-[9.5px] uppercase text-ink-muted"
            >
              {method} {count}
            </span>
          ))}
          {Object.entries(state.timings).map(([key, value]) => (
            <span key={key} className="rounded-pill bg-subtle px-1.5 py-[1px] font-mono text-[9.5px] text-ink-muted">
              {key} {value}ms
            </span>
          ))}
        </div>
      ) : null}

      {state.status === 'loading' ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-20 animate-pulse rounded-md border border-hairline bg-subtle/60"
            />
          ))}
        </div>
      ) : null}

      {state.status === 'done' && state.results.length === 0 ? (
        <p className="rounded-md border border-dashed border-hairline px-3 py-6 text-center text-[11.5px] text-ink-muted">
          No chunks matched. Try a broader query or raise top_k.
        </p>
      ) : null}

      {state.results.length > 0 ? (
        <div className="flex flex-col gap-2">
          {state.results.map((result, index) => (
            <ChunkCard key={`${result.chunk_id}-${index}`} result={result} index={index} query={query} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab 3 — Guardrail Check                                                    */
/* -------------------------------------------------------------------------- */

interface GuardrailState {
  status: 'idle' | 'loading' | 'done' | 'error';
  result: GuardrailResult | null;
  error: string | null;
}

function GuardrailTab({ sampleText }: { sampleText: string }) {
  const [text, setText] = useState(sampleText);
  const [state, setState] = useState<GuardrailState>({ status: 'idle', result: null, error: null });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const run = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setState({ status: 'loading', result: null, error: null });
    try {
      const raw = await apiFetch<unknown>('/v1/guardrails/check', {
        method: 'POST',
        body: JSON.stringify({ text: trimmed }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const result = normalizeGuardrailResult(raw);
      if (!result) throw new Error('Guardrail response was not a guardrail result');
      setState({ status: 'done', result, error: null });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        status: 'error',
        result: null,
        error:
          error instanceof ApiError
            ? (error.detailMessage ?? error.message)
            : error instanceof Error
              ? error.message
              : 'Guardrail check failed',
      });
    }
  }, [text]);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-hairline bg-subtle/50 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <label
            className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint"
            htmlFor="guardrail-text"
          >
            Policy evaluation
          </label>
          <span className="tabular text-[10px] text-ink-faint">{text.length} chars</span>
        </div>

        <textarea
          id="guardrail-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          placeholder="Paste prompt or model output to test against the guardrail policy…"
          className="mt-1.5 w-full resize-none rounded-[7px] border border-hairline bg-elevated p-2 text-[12px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-accent/40"
        />

        <div className="mt-2 flex items-center justify-between gap-2">
          {sampleText ? (
            <button
              type="button"
              onClick={() => setText(sampleText)}
              className="inline-flex items-center gap-1 text-[10.5px] font-medium text-ink-muted transition-colors hover:text-accent"
            >
              <Sparkles className="h-3 w-3" strokeWidth={2.2} />
              Use last answer
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => void run()}
            disabled={state.status === 'loading' || text.trim().length === 0}
            className="inline-flex h-8 items-center gap-1 rounded-[7px] bg-accent px-2.5 text-[11px] font-semibold text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            {state.status === 'loading' ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />
            ) : (
              <ShieldCheck className="h-3 w-3" strokeWidth={2.4} />
            )}
            Evaluate
          </button>
        </div>
      </div>

      {state.error ? (
        <p className="rounded-md border border-fail/30 bg-fail-soft px-3 py-2 text-[11.5px] text-fail-ink">
          {state.error}
        </p>
      ) : null}

      {state.result ? (
        <div className="flex flex-col gap-2.5 rounded-md border border-hairline bg-elevated px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge
              tone={state.result.allowed ? 'ok' : 'fail'}
              size="sm"
              pulse={false}
              label={state.result.allowed ? 'allowed' : 'blocked'}
            />
            <span className="rounded-pill border border-hairline bg-subtle px-1.5 py-[1px] font-mono text-[9.5px] uppercase tracking-wide text-ink-muted">
              {state.result.action_taken}
            </span>
            {state.result.policy_violations.length > 0 ? (
              <span className="ml-auto text-[10px] font-semibold text-fail-ink">
                {state.result.policy_violations.length} violations
              </span>
            ) : null}
          </div>

          {state.result.policy_violations.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {state.result.policy_violations.map((violation, index) => (
                <li
                  key={`${violation}-${index}`}
                  className="flex items-start gap-1.5 rounded-[6px] border border-fail/25 bg-fail-soft px-2 py-1 text-[11px] text-fail-ink"
                >
                  <Ban className="mt-[2px] h-3 w-3 shrink-0" strokeWidth={2.2} />
                  <span className="min-w-0 break-words">{violation}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-ink-muted">No policy violations detected.</p>
          )}

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
              Sanitized text
            </p>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[7px] border border-hairline bg-subtle/60 p-2 font-mono text-[10.5px] leading-relaxed text-ink-muted">
              {state.result.sanitized_text || '∅'}
            </pre>
          </div>
        </div>
      ) : null}

      {state.status === 'idle' ? (
        <p className="rounded-md border border-dashed border-hairline px-3 py-5 text-center text-[11px] leading-relaxed text-ink-muted">
          Runs the same input/output guardrail the query pipeline applies — nothing is sent to an LLM.
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Drawer                                                                     */
/* -------------------------------------------------------------------------- */

const TABS: ReadonlyArray<{ id: EvidenceTab; label: string; short: string; icon: LucideIcon }> = [
  { id: 'cited', label: 'Cited Evidence', short: 'Cited', icon: Files },
  { id: 'lab', label: 'Retrieval Lab', short: 'Lab', icon: FlaskConical },
  { id: 'guardrails', label: 'Guardrail Check', short: 'Guards', icon: ShieldCheck },
] as const;

export interface EvidenceLensProps {
  open: boolean;
  onClose: () => void;
  tab: EvidenceTab;
  onTabChange: (tab: EvidenceTab) => void;
  sources: SearchResult[];
  verification: VerificationSummary | null;
  /** The question this evidence answers — used for term highlighting and lab prefill. */
  query: string;
  highlightedChunkId?: string | null;
  flaggedChunkIds?: string[];
  /** Prefills the guardrail tab (usually the last answer). */
  sampleText?: string;
}

export function EvidenceLens({
  open,
  onClose,
  tab,
  onTabChange,
  sources,
  verification,
  query,
  highlightedChunkId = null,
  flaggedChunkIds = [],
  sampleText = '',
}: EvidenceLensProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  /**
   * Portals cannot be server rendered, so mount ours only after hydration.
   * Stays true after the first open so the exit spring can still play.
   */
  const [clientReady, setClientReady] = useState(false);
  const [everOpened, setEverOpened] = useState(open);

  useEffect(() => {
    setClientReady(true);
  }, []);

  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  /* Escape to close + scroll lock behind the lens */
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 60);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [open, onClose]);

  const activeTab = TABS.find((entry) => entry.id === tab) ?? TABS[0];

  if (!clientReady || !everOpened) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="evidence-lens"
          variants={SCRIM_FADE}
          initial="initial"
          animate="animate"
          exit="exit"
          className="fixed inset-0 z-50"
        >
          <div
            aria-hidden="true"
            onClick={onClose}
            className="absolute inset-0 bg-ink/25 backdrop-blur-[2px] dark:bg-black/60"
          />

          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Evidence lens"
            variants={DRAWER_SLIDE}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={SPRING_GENTLE}
            className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col border-l border-hairline bg-elevated/95 shadow-palette backdrop-blur-2xl"
          >
            {/* header */}
            <header className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                  Evidence Lens
                </p>
                <h2 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-ink">
                  {activeTab.label}
                </h2>
                {tab === 'cited' ? (
                  <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                    {sources.length} chunks · {verificationLabel(verification)}
                  </p>
                ) : null}
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close evidence lens"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-pill border border-hairline bg-elevated text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
            </header>

            {/* tabs */}
            <div className="border-b border-hairline px-3 py-2">
              <div
                role="tablist"
                aria-label="Evidence lens sections"
                className="flex gap-0.5 rounded-pill bg-subtle p-1"
              >
                {TABS.map((entry) => {
                  const isActive = entry.id === tab;
                  const Icon = entry.icon;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => onTabChange(entry.id)}
                      className={cx(
                        'relative flex h-7 flex-1 items-center justify-center gap-1.5 rounded-pill px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                        isActive ? 'text-accent' : 'text-ink-muted hover:text-ink',
                      )}
                    >
                      {isActive ? (
                        <motion.span
                          layoutId="lens-tab-active"
                          transition={SPRING_SNAPPY}
                          className="absolute inset-0 rounded-pill border border-accent/20 bg-elevated shadow-hairline"
                        />
                      ) : null}
                      <Icon className="relative h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                      <span className="relative hidden sm:inline">{entry.label}</span>
                      <span className="relative sm:hidden">{entry.short}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* body */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-10 pt-3">
              {tab === 'cited' ? (
                <CitedEvidenceTab
                  sources={sources}
                  verification={verification}
                  query={query}
                  highlightedChunkId={highlightedChunkId}
                  flaggedChunkIds={flaggedChunkIds}
                />
              ) : tab === 'lab' ? (
                <RetrievalLabTab defaultQuery={query} />
              ) : (
                <GuardrailTab sampleText={sampleText} />
              )}
            </div>

            {/* footer */}
            <footer className="flex items-center justify-between gap-2 border-t border-hairline bg-subtle/60 px-4 py-2">
              <span className="flex items-center gap-1.5 text-[10px] text-ink-faint">
                <FileText className="h-3 w-3" strokeWidth={2} />
                Every claim should trace to a chunk.
              </span>
              <button
                type="button"
                onClick={onClose}
                className="text-[10.5px] font-medium text-ink-muted transition-colors hover:text-ink"
              >
                Close (esc)
              </button>
            </footer>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export default EvidenceLens;
