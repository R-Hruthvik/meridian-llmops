import React, { Suspense, useRef, useState } from 'react';
import {
  Check,
  Copy,
  FileText,
  ArrowUpRight,
  MessageSquareText,
  RefreshCw,
  Send,
} from 'lucide-react';
import { api, ApiError } from '../services/api';
import { StatusChip, type StatusChipVariant } from './StatusChip';
import { useWorkbench } from '../WorkbenchContext';
import type { DocumentSummary, QueryResponse, RetrieveResponse, SearchResult } from '../types/api';

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

interface ConversationTurn {
  id: number;
  question: string;
  loading: boolean;
  response?: QueryResponse;
  retrieval?: RetrieveResponse;
  error?: { message: string; status?: number };
}

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
  const [topK, setTopK] = useState(6);
  const [maxCycles, setMaxCycles] = useState(3);
  const [enforceGuardrails, setEnforceGuardrails] = useState(true);
  const [retrievalOnly, setRetrievalOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [retrievalResponse, setRetrievalResponse] = useState<RetrieveResponse | null>(null);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const nextTurnId = useRef(0);
  const [copied, setCopied] = useState(false);
  const [openChunkId, setOpenChunkId] = useState<string | null>(null);
  const [recentDocuments, setRecentDocuments] = useState<DocumentSummary[]>([]);
  const [totalDocuments, setTotalDocuments] = useState(0);
  const [recentDocumentsLoaded, setRecentDocumentsLoaded] = useState(false);
  const [recentDocumentsUnavailable, setRecentDocumentsUnavailable] = useState(false);
  const workbench = useWorkbench();

  React.useEffect(() => {
    let active = true;
    setRecentDocumentsLoaded(false);
    setRecentDocumentsUnavailable(false);
    void api.getDocuments(tenantId).then((result) => {
      if (!active) return;
      setTotalDocuments(result.total_documents);
      const recent = [...result.documents]
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .slice(0, 2);
      setRecentDocuments(recent);
    }).catch(() => {
      if (active) {
        setRecentDocuments([]);
        setTotalDocuments(0);
        setRecentDocumentsUnavailable(true);
      }
    }).finally(() => {
      if (active) setRecentDocumentsLoaded(true);
    });
    return () => { active = false; };
  }, [tenantId]);

  const handleQuery = async (queryText?: string) => {
    const textToSubmit = queryText || query;
    if (!textToSubmit.trim()) return;

    const turnId = ++nextTurnId.current;
    const useRetrievalOnly = retrievalOnly;
    setTurns((current) => [...current, { id: turnId, question: textToSubmit.trim(), loading: true }]);
    setQuery('');
    setLoading(true);
    setOpenChunkId(null);
    try {
      if (useRetrievalOnly) {
        const result = await api.retrieve({ query: textToSubmit, top_k: topK }, tenantId);
        setRetrievalResponse(result);
        setResponse(null);
        setTurns((current) => current.map((turn) => turn.id === turnId ? { ...turn, loading: false, retrieval: result } : turn));
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
      setTurns((current) => current.map((turn) => turn.id === turnId ? { ...turn, loading: false, response: res } : turn));
    } catch (err: unknown) {
      const status = err instanceof ApiError ? err.status : undefined;
      const message = err instanceof Error ? err.message : 'An error occurred during query execution';
      setResponse(null);
      setRetrievalResponse(null);
      setTurns((current) => current.map((turn) => turn.id === turnId ? { ...turn, loading: false, error: { message, status } } : turn));
    } finally {
      setLoading(false);
    }
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
  const openChunk = (chunk: SearchResult, index: number) => {
    setOpenChunkId(chunk.chunk_id || `chunk-${index}`);
    workbench?.openOverlay('corpus', {
      breadcrumb: `Ask · chunk ${index + 1}`,
      documentId: chunk.document_id,
      chunkId: chunk.chunk_id,
    });
  };

  const sourceScope = recentDocumentsLoaded && !recentDocumentsUnavailable && totalDocuments > 0
    ? `${totalDocuments} indexed ${totalDocuments === 1 ? 'document' : 'documents'}`
    : 'all indexed workspace documents';

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6">
      <div className="ask-page-heading order-0">
        <div>
          <p className="label-section mb-2 text-muted">Your reference workspace</p>
          <h1>Ask Meridian</h1>
          <p className="mt-2 text-label text-muted">Clear answers, grounded in the documents you trust.</p>
        </div>
        <details className="ask-shortcuts">
          <summary>Shortcuts</summary>
          <div className="ask-shortcut-list">
            {SAMPLE_QUERIES.map(({ label, query: sampleQuery }) => (
              <button key={sampleQuery} type="button" disabled={loading} title={sampleQuery} onClick={() => setQuery(sampleQuery)}>{label}</button>
            ))}
          </div>
        </details>
      </div>

      <section className="ask-composer order-2" aria-label="Ask a question">
        <label htmlFor="rag-query-input" className="ask-prompt-label">What would you like to know?</label>
        <p className="mb-2 text-micro text-muted">
          Search across {sourceScope}. Name both files when asking how they relate; answers show which files supplied evidence.
        </p>
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
          className="ask-question-input w-full resize-none text-base text-ink outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-accent"
        />

        <div className="ask-composer-footer">
          <details className="query-options">
            <summary>Answer settings</summary>
            <div className="query-option-list">
              <label className="flex cursor-pointer items-center gap-1.5 text-label text-muted">
                <input type="checkbox" checked={enforceGuardrails} onChange={(event) => setEnforceGuardrails(event.target.checked)} className="size-3 rounded-sm accent-accent" />
                <span>Apply safety checks</span>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-label text-muted">
                <input type="checkbox" checked={retrievalOnly} onChange={(event) => setRetrievalOnly(event.target.checked)} className="size-3 rounded-sm accent-accent" />
                <span>Retrieval only</span>
              </label>
              <div className="flex items-center gap-2">
                <label htmlFor="top-k-input" className="text-label text-muted">Sources to retrieve:</label>
                <input id="top-k-input" type="number" min={1} max={10} value={topK} onChange={(e) => setTopK(Number(e.target.value))} className="num w-14 rounded-sm border border-hairline bg-surface px-2 py-1 text-center text-body font-semibold text-ink outline-none focus:border-hairline-strong focus-visible:ring-2 focus-visible:ring-accent" />
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="max-cycles-input" className="text-label text-muted">Maximum answer cycles:</label>
                <input id="max-cycles-input" type="number" min={1} max={5} value={maxCycles} onChange={(e) => setMaxCycles(Number(e.target.value))} className="num w-14 rounded-sm border border-hairline bg-surface px-2 py-1 text-center text-body font-semibold text-ink outline-none focus:border-hairline-strong focus-visible:ring-2 focus-visible:ring-accent" />
              </div>
            </div>
          </details>
          <button onClick={() => handleQuery()} disabled={loading || !query.trim()} className="flex min-h-11 items-center gap-2 rounded-md bg-accent px-5 py-2 text-label font-semibold text-white transition-colors hover:bg-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
            {loading ? <><RefreshCw className="size-4 animate-spin"/><span>Working…</span></> : <><span>{retrievalOnly ? 'Find sources' : 'Ask question'}</span><Send className="size-3.5"/></>}
          </button>
        </div>
      </section>

      {turns.length === 0 && <section className="ask-recent order-3" aria-labelledby="recent-sources-title">
        <div className="ask-recent-heading">
          <h2 id="recent-sources-title">Recently added</h2>
          <button type="button" onClick={() => workbench?.openOverlay('corpus')}>
            Browse sources <ArrowUpRight aria-hidden="true"/>
          </button>
        </div>
        {recentDocumentsLoaded && (recentDocuments.length > 0 ? (
          <div className="ask-recent-list">
            {recentDocuments.map((document) => (
              <button key={document.id} type="button" onClick={() => workbench?.openOverlay('corpus', { documentId: document.id, breadcrumb: document.title })}>
                <span className="ask-recent-icon"><FileText aria-hidden="true"/></span>
                <span className="ask-recent-copy"><strong>{document.title}</strong><span>{document.format} · {new Date(document.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {document.chunk_count} passages</span></span>
                <span className="ask-recent-count">{document.chunk_count}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="ask-recent-empty">{recentDocumentsUnavailable ? 'Recent sources are unavailable while the workspace is offline.' : 'No sources yet. Add a document to ground your answers.'}</div>
        ))}
      </section>}

      {turns.length > 0 && <section data-testid="query-result-region" aria-label="Conversation" aria-live="polite" aria-busy={loading} className="order-1 flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-label font-semibold text-ink">Conversation</h2>
          <button type="button" onClick={() => { setTurns([]); setResponse(null); setRetrievalResponse(null); setQuery(''); }} className="text-label font-semibold text-muted underline-offset-4 hover:text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">New conversation</button>
        </div>
        {turns.map((turn, turnIndex) => {
          const turnVerdict = turn.response ? verdictFor(turn.response) : null;
          const turnChunks = turn.response?.source_chunks ?? [];
          const sources = [...new Map(turnChunks.map((chunk) => [chunk.document_id, { chunk, label: chunk.title || chunk.filename || shortId(chunk.document_id) }])).values()];
          const turnLatency = turn.response ? formatLatency(turn.response.execution_time_ms) : null;
          return <article key={turn.id} className="flex flex-col gap-3" aria-label={`Question ${turnIndex + 1}`}>
            <div className="ml-auto max-w-[88%] rounded-md bg-accent px-4 py-3 text-body text-white">{turn.question}</div>
            <div className="w-full rounded-md border border-hairline bg-surface-raised p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-3">
                <div className="flex items-center gap-2 text-label font-semibold text-ink"><MessageSquareText className="size-4 text-accent" aria-hidden="true"/> Meridian</div>
                {turn.response && turnVerdict && <div className="flex flex-wrap items-center gap-3"><StatusChip variant={turnVerdict.variant}>{turnVerdict.state}</StatusChip><Readout value={turnLatency!.value} unit={turnLatency!.unit}/>{turn.response.serving?.fresh && turn.response.serving.model && <span className="id-mono text-micro text-muted">{turn.response.serving.model}</span>}<button type="button" onClick={() => { void navigator.clipboard.writeText(turn.response!.answer).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => undefined); }} aria-label={`Copy answer ${turnIndex + 1}`} className="flex items-center gap-1 text-label text-muted hover:text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{copied ? <Check className="size-3.5 text-ok"/> : <Copy className="size-3.5"/>}<span>{copied ? 'Copied' : 'Copy'}</span></button></div>}
              </div>
              {turn.loading ? <div role="status" className="flex items-center gap-2 py-3 text-label text-muted"><RefreshCw className="size-4 animate-spin"/>Finding passages across your sources…</div> : turn.error ? <div role="alert" className="rounded-sm border border-fail/30 bg-fail-wash px-3 py-2 text-label text-fail"><strong>{turn.error.status === 429 ? 'Rate limit reached' : turn.error.status === 502 ? 'The answer service is unavailable' : 'Could not answer this question'}</strong><p className="mt-1 text-body">{turn.error.message}</p></div> : turn.response ? <>
                {turn.response.degraded_reason && <p className="mb-2 text-label text-warn">{turn.response.degraded_reason}</p>}
                {!turn.response.answer?.trim() ? <p className="answer-prose text-muted">No answer text was returned. Check the service status and try again.</p> : <Suspense fallback={<p className="answer-prose text-ink">{turn.response.answer}</p>}><MarkdownRenderer content={turn.response.answer}/></Suspense>}
                <div className="mt-4 border-t border-hairline pt-3">
                  <p className="mb-2 text-micro font-semibold text-muted">{sources.length ? `Evidence from ${sources.length} ${sources.length === 1 ? 'document' : 'documents'}` : 'No source passages were returned'}</p>
                  {sources.length > 1 && <p className="mb-2 text-label text-muted">This answer connects evidence retrieved from multiple files.</p>}
                  <div className="flex flex-wrap gap-2">{sources.map(({ chunk, label }, sourceIndex) => <button key={chunk.document_id} type="button" onClick={() => openChunk(chunk, sourceIndex)} className="inline-flex min-h-8 items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2.5 py-1 text-left text-label text-accent-ink hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><FileText className="size-3.5" aria-hidden="true"/><span className="max-w-[18rem] truncate">{label}</span><span className="text-micro text-muted">Open evidence</span></button>)}</div>
                </div>
              </> : turn.retrieval ? <div className="text-label text-muted">Found {turn.retrieval.chunks.length} passages. Ranked passages and scores appear below.</div> : null}
            </div>
          </article>;
        })}
      </section>}

      {/* §8 ranked chunk table */}
      {chunks.length > 0 && <div className="order-4 rounded border border-hairline bg-surface-raised">
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
                      onClick={() => openChunk(chunk, idx)}
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
      {response && response.entities.length > 0 && <div className="order-4 rounded border border-hairline bg-surface-raised">
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
