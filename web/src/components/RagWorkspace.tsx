import React, { Suspense, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  RefreshCw,
  Send,
} from 'lucide-react';
import { api, ApiError } from '../services/api';
import { StatusChip, type StatusChipVariant } from './StatusChip';
import { useWorkbench } from '../WorkbenchContext';
import type { QueryResponse, RetrieveResponse, SearchResult } from '../types/api';

// The markdown parser is the single heaviest dependency in the app and there is
// nothing to parse until an answer exists. Deferring it keeps it out of first
// paint; the answer body falls back to the raw text for the frame or two it
// takes to arrive, so the box is never empty.
const MarkdownRenderer = React.lazy(() =>
  import('./MarkdownRenderer').then((m) => ({ default: m.MarkdownRenderer })),
);

interface RagWorkspaceProps {
  tenantId: string;
}

const SAMPLE_QUERIES = [
  { label: 'Dual-memory retrieval', query: 'What storage engines does Meridian use for dual-memory retrieval?' },
  { label: 'Prompt injection controls', query: 'How does Meridian protect against prompt injections at the gateway?' },
  { label: 'Retry limits', query: 'What is the maximum number of self-healing retry cycles allowed?' },
];

const NO_MODEL_TITLE =
  'No upstream LLM call returned content for this request (greeting/bypass, refusal, generation failure, or empty completion)';

interface Verdict {
  state: string;
  variant: StatusChipVariant;
}

/**
 * §7 — the one state the answer is in. Precedence is refusal > degraded >
 * verified; "no model served" only speaks when nothing stronger does, and
 * unverified is the floor. The bar can never claim more than the body.
 *
 * Refusal outranks degraded because a refusal is a fact about the answer while
 * `degraded_reason` is only a cause. When the LLM is unreachable the backend
 * returns `refusal: true` *and* a generation error, and the old order labelled
 * that "DEGRADED" above a body that answered nothing at all. The cause is still
 * printed next to the chip, so nothing is lost by naming the state first.
 */
const verdictFor = (response: QueryResponse): Verdict => {
  if (response.refusal) return { state: 'REFUSED', variant: 'fail' };
  if (response.degraded_reason) return { state: 'DEGRADED', variant: 'warn' };
  if (response.verified) return { state: 'VERIFIED GROUNDED', variant: 'ok' };
  if (response.serving && !response.serving.fresh)
    return { state: 'NO MODEL SERVED', variant: 'faint' };
  return { state: 'UNVERIFIED', variant: 'faint' };
};

/**
 * §9 — the latency readout is an instrument, not a JSON dump. A raw float
 * (`6197.359323501587 ms`) is unreadable, and every digit shifting as the value
 * changes defeats the tabular figures it is set in. Under a second reads as
 * whole milliseconds; a second or more reads as seconds with one decimal, so
 * the digits hold still as the value moves.
 */
export const formatLatency = (ms: number): { value: string; unit: string } => {
  if (!Number.isFinite(ms)) return { value: '—', unit: 'ms' };
  const rounded = Math.round(ms);
  if (Math.abs(rounded) < 1000) return { value: String(rounded), unit: 'ms' };
  return { value: (ms / 1000).toFixed(1), unit: 's' };
};

/**
 * A 32-char hash in a 12rem column is a hard mid-character clip, not an
 * abbreviation: the reader cannot tell it is cut. Shorten it to a readable head
 * plus an ellipsis, and keep the full id in the `title` so it stays hoverable
 * and copyable.
 */
export const shortId = (id: string | undefined | null, keep = 8): string => {
  if (!id) return '—';
  return id.length > keep ? `${id.slice(0, keep)}…` : id;
};

/** §9 — one numeric readout: value in mono/tabular, unit in faint sans. */
const Readout: React.FC<{ value: string; unit: string }> = ({ value, unit }) => (
  <span className="flex items-baseline gap-1 border-l border-hairline pl-3 first:border-l-0 first:pl-0">
    <span className="num text-readout font-semibold text-ink">{value}</span>
    <span className="text-micro text-faint">{unit}</span>
  </span>
);

export const RagWorkspace: React.FC<RagWorkspaceProps> = ({ tenantId }) => {
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(3);
  const [maxCycles, setMaxCycles] = useState(3);
  const [enforceGuardrails, setEnforceGuardrails] = useState(true);
  const [retrievalOnly, setRetrievalOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [retrievalResponse, setRetrievalResponse] = useState<RetrieveResponse | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [openChunkId, setOpenChunkId] = useState<string | null>(null);
  const workbench = useWorkbench();

  const handleQuery = async (queryText?: string) => {
    const textToSubmit = queryText || query;
    if (!textToSubmit.trim()) return;

    setLoading(true);
    setError(null);
    setOpenChunkId(null);
    try {
      if (retrievalOnly) {
        const result = await api.retrieve({ query: textToSubmit, top_k: topK }, tenantId);
        setRetrievalResponse(result);
        setResponse(null);
        return;
      }
      setRetrievalResponse(null);
      const res = await api.query({
        query: textToSubmit,
        tenant_id: tenantId,
        top_k: topK,
        max_cycles: maxCycles,
        enforce_guardrails: enforceGuardrails,
      });
      setResponse(res);
    } catch (err: unknown) {
      const status = err instanceof ApiError ? err.status : undefined;
      const message = err instanceof Error ? err.message : 'An error occurred during query execution';
      setError({ message, status });
      // Clear stale query response on error
      setResponse(null);
      setRetrievalResponse(null);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!response?.answer) return;
    navigator.clipboard
      .writeText(response.answer)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Silently catch clipboard failures
      });
  };

  // An answer must be able to reach the source that produced it: the ranked row
  // hands the document and chunk ids to the Corpus overlay, which names the row
  // it was opened from in its breadcrumb.
  const chunks: SearchResult[] = retrievalResponse
    ? retrievalResponse.chunks.map((chunk) => {
        const finalScore = chunk.scores.final;
        const score = Number.isFinite(finalScore)
          ? finalScore
          : Number.isFinite(chunk.scores.rrf)
            ? chunk.scores.rrf
            : 0;
        return { ...chunk, score, retrieval_method: 'HYBRID_RRF' };
      })
    : response?.source_chunks ?? [];
  const openChunk = (index: number) => {
    const chunk = chunks[index];
    if (!chunk) return;
    setOpenChunkId(chunk.chunk_id || `chunk-${index}`);
    workbench?.openOverlay('corpus', {
      breadcrumb: `Ask · chunk ${index + 1}`,
      documentId: chunk.document_id,
      chunkId: chunk.chunk_id,
    });
  };

  const verdict = response ? verdictFor(response) : null;
  const latency = formatLatency(response?.execution_time_ms ?? 0);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {/* Composer */}
      <div className="rounded-lg border border-hairline bg-surface-raised p-4 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="mr-auto text-xl font-semibold tracking-tight text-ink">Ask a question</h1>
          <label className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-label transition-colors ${enforceGuardrails ? 'border-hairline bg-accent-wash text-accent-ink' : 'border-hairline text-muted'}`}>
            <input
              type="checkbox"
              checked={enforceGuardrails}
              onChange={(event) => setEnforceGuardrails(event.target.checked)}
              className="size-3 rounded-sm accent-accent"
            />
            <span>Apply safety rules</span>
          </label>
        </div>

        <textarea
          id="rag-query-input"
          aria-label="Question"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleQuery();
            }
          }}
          placeholder="Ask about your sources…"
          className="min-h-28 w-full resize-none rounded-md border border-hairline bg-surface p-4 text-base text-ink outline-none transition-colors placeholder:text-faint focus:border-hairline-strong focus:bg-surface-raised focus-visible:ring-2 focus-visible:ring-accent"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-micro text-muted">Try:</span>
          {SAMPLE_QUERIES.map(({ label, query: sampleQuery }) => (
            <button key={sampleQuery} type="button" disabled={loading} title={sampleQuery} onClick={() => { setQuery(sampleQuery); handleQuery(sampleQuery); }} className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-left text-micro text-muted transition-colors hover:border-hairline-strong hover:bg-accent-wash hover:text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50">
              {label}
            </button>
          ))}
        </div>

        <details className="query-options mt-4 border-t border-hairline pt-3">
          <summary className="w-fit cursor-pointer text-label font-medium text-muted hover:text-ink">Query options</summary>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-1.5 text-label text-muted">
              <input type="checkbox" checked={retrievalOnly} onChange={(event) => setRetrievalOnly(event.target.checked)} className="size-3 rounded-sm accent-accent" />
              <span>Retrieval only</span>
            </label>
            <div className="flex items-center gap-2">
              <label htmlFor="top-k-input" className="text-label text-muted">
                Sources to retrieve:
              </label>
              <input
                id="top-k-input"
                type="number"
                min={1}
                max={10}
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                className="num w-14 rounded-sm border border-hairline bg-surface px-2 py-1 text-center text-body font-semibold text-ink outline-none focus:border-hairline-strong focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="max-cycles-input" className="text-label text-muted">
                Maximum answer cycles:
              </label>
              <input
                id="max-cycles-input"
                type="number"
                min={1}
                max={5}
                value={maxCycles}
                onChange={(e) => setMaxCycles(Number(e.target.value))}
                className="num w-14 rounded-sm border border-hairline bg-surface px-2 py-1 text-center text-body font-semibold text-ink outline-none focus:border-hairline-strong focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
          </div>

        </div>
        </details>

        <div className="mt-4 flex justify-end">
          <button onClick={() => handleQuery()} disabled={loading || !query.trim()} className="flex min-h-11 items-center gap-2 rounded-md bg-accent px-5 py-2 text-label font-semibold text-white transition-colors hover:bg-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
            {loading ? <><RefreshCw className="size-4 animate-spin"/><span>Working…</span></> : <><span>{retrievalOnly ? 'Find sources' : 'Ask'}</span><Send className="size-3.5"/></>}
          </button>
        </div>
      </div>

      {/* Error Alert — distinct rendering based on HTTP status */}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className={`flex items-start gap-2.5 rounded border p-3 ${
            error.status === 429
              ? 'border-hairline bg-warn-wash text-warn'
              : 'border-hairline bg-fail-wash text-fail'
          }`}
        >
          {error.status === 429 ? (
            <Clock className="mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5 text-label font-bold">
              <span>
                {error.status === 429
                  ? 'Rate Limit Exceeded'
                  : error.status === 401
                    ? 'Authentication Error'
                    : error.status === 422
                      ? 'Validation Error'
                      : 'Query Intercepted / Failed'}
              </span>
              {error.status && (
                <span className="num rounded-sm border border-hairline px-1.5 py-0.5 text-micro">
                  HTTP {error.status}
                </span>
              )}
            </p>
            <p className="mt-0.5 text-body text-muted">
              {error.status === 429
                ? 'Too many requests in the current time window. Please wait a moment and try again.'
                : error.message}
            </p>
          </div>
        </div>
      )}

      {(loading || response || retrievalResponse || error) && <div data-testid="query-result-region" aria-live="polite" aria-busy={loading} className={loading && !response ? 'min-h-[12rem]' : undefined}>
        {/* Keep the previous answer mounted during a follow-up request; first-query
            loading uses the same reserved result area so the canvas does not jump. */}
        {loading && !response && (
          <div role="status" className="min-h-[12rem] animate-pulse rounded border border-hairline bg-surface-raised p-4">
            <div className="mb-3 flex items-center gap-3">
              <RefreshCw className="size-5 animate-spin text-muted" />
              <div className="h-3 w-1/3 rounded-sm bg-surface-sunken" />
            </div>
            <div className="space-y-2">
              <div className="h-3 w-full rounded-sm bg-surface-sunken" />
              <div className="h-3 w-5/6 rounded-sm bg-surface-sunken" />
              <div className="h-3 w-2/3 rounded-sm bg-surface-sunken" />
            </div>
          </div>
        )}

      {/* §7 verdict bar + answer body */}
      {response && verdict && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded border border-hairline bg-surface-raised px-3 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <StatusChip variant={verdict.variant}>{verdict.state}</StatusChip>

              {response.degraded_reason && (
                <span
                  className="min-w-0 truncate text-micro text-warn"
                  title={response.degraded_reason}
                >
                  {response.degraded_reason}
                </span>
              )}

              {/* Serving provenance (issue #35): when the backend reports
                  `serving`, it is authoritative. `fresh: false` means no model
                  answered, so the bar goes quiet rather than naming one. The
                  deprecated config echo is never a fallback. */}
              {response.serving ? (
                response.serving.fresh && response.serving.model ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="text-id text-muted">{response.serving.provider}</span>
                    <span className="text-faint">·</span>
                    <span className="id-mono truncate text-ink">{response.serving.model}</span>
                  </span>
                ) : (
                  <span className="text-micro text-muted" title={NO_MODEL_TITLE}>
                    — no model served
                  </span>
                )
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-x-3">
              <Readout value={`${response.cycle_count}/${maxCycles}`} unit="cycle" />
              <Readout value={latency.value} unit={latency.unit} />
              <Readout value={String(chunks.length)} unit="chunks" />
              <Readout value={String(response.entities.length)} unit="entities" />
              <button
                onClick={handleCopy}
                title="Copy Answer to Clipboard"
                aria-label="Copy answer text"
                className="flex items-center gap-1.5 rounded-sm border border-hairline px-2.5 py-1 text-label text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {copied ? (
                  <Check className="size-3.5 text-ok" />
                ) : (
                  <Copy className="size-3.5 text-muted" />
                )}
                <span>{copied ? 'Copied!' : 'Copy Answer'}</span>
              </button>
            </div>
          </div>

          <div data-testid="answer-card" className="min-h-[12rem] rounded border border-hairline bg-surface-raised p-4">
            <p data-testid="answer-refresh-status" role="status" aria-live="polite" className="mb-2 min-h-4 text-micro font-semibold text-muted">
              {loading ? 'Refreshing answer…' : null}
            </p>
            {!response.answer || !response.answer.trim() ? (
              <p className="answer-prose text-muted">
                The pipeline returned an empty answer on a degraded path
                {response.degraded_reason ? `: ${response.degraded_reason}` : ' (generation_error/placeholder).'}
              </p>
            ) : (
              <Suspense
                fallback={<p className="answer-prose text-ink">{response.answer}</p>}
              >
                <MarkdownRenderer content={response.answer} />
              </Suspense>
            )}
          </div>
        </>
      )}

      </div>}

      {/* §8 ranked chunk table */}
      {chunks.length > 0 && <div className="rounded border border-hairline bg-surface-raised">
        <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
          <h3 className="label-section text-muted">Retrieved Chunks &amp; Citations</h3>
          {chunks.length > 0 && <span className="num text-micro text-faint">{chunks.length}</span>}
        </div>

        <div className="overflow-x-auto" tabIndex={0} aria-label="Retrieved chunks table; scroll horizontally to see all columns">
            <table className="w-full min-w-[640px] border-collapse text-left">
            <caption className="sr-only">Retrieved chunks, ranked by score</caption>
            <thead>
              <tr className="border-b border-hairline-strong">
                <th scope="col" className="label-section w-10 px-3 py-1.5 font-normal text-faint">
                  #
                </th>
                <th scope="col" className="label-section px-2 py-1.5 font-normal text-faint">
                  SOURCE
                </th>
                <th
                  scope="col"
                  className="label-section w-20 px-2 py-1.5 text-right font-normal text-faint"
                >
                  SCORE
                </th>
                <th scope="col" className="label-section w-32 px-2 py-1.5 font-normal text-faint">
                  METHOD
                </th>
                <th scope="col" className="label-section w-48 px-3 py-1.5 font-normal text-faint">
                  ID
                </th>
              </tr>
            </thead>
            <tbody>
              {chunks.map((chunk, idx) => {
                const chunkKey = chunk.chunk_id || `chunk-${idx}`;
                const percent = `${(chunk.score * 100).toFixed(0)}%`;
                return (
                  <tr
                    key={chunkKey}
                    className={`group h-8 border-b border-hairline last:border-b-0 hover:bg-accent-wash ${
                      openChunkId === chunkKey ? 'bg-accent-wash' : ''
                    }`}
                  >
                    <td
                      className={`border-l-2 px-3 py-1 group-hover:border-accent ${
                        openChunkId === chunkKey ? 'border-accent' : 'border-transparent'
                      }`}
                    >
                      <button
                        type="button"
                        aria-label={`Chunk ${idx + 1} • ${chunk.retrieval_method} · ${percent} · ${chunk.document_id} · ${chunk.chunk_id}`}
                        title={chunk.text}
                        onClick={() => openChunk(idx)}
                        className="num w-full text-left text-micro text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                      >
                        {idx + 1}
                      </button>
                    </td>
                    <td className="px-2 py-1 text-ink" title={chunk.document_id}>
                      <span className="id-mono block truncate" title={chunk.document_id}>
                        {chunk.title || chunk.filename || shortId(chunk.document_id)}
                      </span>
                      {(chunk.page_start != null || chunk.heading_path) && (
                        <span className="block truncate text-micro text-muted">
                          {chunk.page_start != null && <span>Page {chunk.page_start}</span>}
                          {chunk.page_start != null && chunk.heading_path && <span> · </span>}
                          {chunk.heading_path}
                        </span>
                      )}
                    </td>
                    <td className="num px-2 text-right text-micro font-semibold text-ink">
                      {percent}
                    </td>
                    <td className="id-mono truncate px-2 text-muted">{chunk.retrieval_method}</td>
                    <td className="id-mono truncate px-3 text-muted" title={chunk.chunk_id}>
                      {shortId(chunk.chunk_id)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            </table>
        </div>
      </div>}

      {/* Knowledge graph entities */}
      {response && response.entities.length > 0 && <div className="rounded border border-hairline bg-surface-raised">
        <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
          <h3 className="label-section text-muted">Knowledge Graph Entity Traversal</h3>
          {response && response.entities.length > 0 && (
            <span className="num text-micro text-faint">
              <span className="sr-only">entity count </span>
              {response.entities.length}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2 p-3">
            {response.entities.map((entity) => (
              <span
                key={entity.name}
                className="flex items-center gap-2 rounded-sm border border-hairline bg-surface px-2.5 py-1 text-label"
              >
                <span className="text-ink">{entity.name}</span>
                <span className="id-mono text-faint">{entity.entity_type}</span>
              </span>
            ))}
        </div>
      </div>}
    </div>
  );
};
