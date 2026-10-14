import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Coins,
  Cpu,
  Database,
  Gauge,
  Layers,
  Network,
  RefreshCw,
  Server,
  Zap,
} from 'lucide-react';
import { api } from '../services/api';
import { StatusChip, type StatusChipVariant } from './StatusChip';
import type { IndexStatusResponse, RetrieveResponse, TenantMetrics } from '../types/api';

interface MetricsDashboardProps {
  tenantId: string;
}

interface InfraService {
  name: string;
  type: string;
  icon: typeof Cpu;
  /**
   * Where this card's status actually comes from. Every card names a live
   * source; only cards with `kind: 'static'` have none, and those say so
   * on their face rather than asserting a fabricated Ready/Online.
   */
  source:
    /** The health poll itself answering proves the RAG engine is up. */
    | { kind: 'self' }
    /** Live reachability observed by an actual index read. */
    | { kind: 'index'; key: 'vector' | 'graph' }
    /** No probe exists for this service — the card admits it. */
    | { kind: 'static'; note: string };
}

const INFRASTRUCTURE_SERVICES: InfraService[] = [
  {
    name: 'Meridian RAG Engine (FastAPI)',
    type: 'Core App',
    icon: Cpu,
    source: { kind: 'self' },
  },
  {
    name: 'LiteLLM AI Gateway',
    type: 'Ingress Proxy',
    icon: Server,
    source: { kind: 'static', note: 'Public readiness does not report gateway reachability' },
  },
  {
    name: 'Qdrant Vector Database',
    type: 'Dense Storage',
    icon: Database,
    source: { kind: 'index', key: 'vector' },
  },
  {
    name: 'Neo4j Knowledge Graph',
    type: 'Entity Graph',
    icon: Network,
    source: { kind: 'index', key: 'graph' },
  },
  {
    name: 'Langfuse Tracing',
    type: 'OpenTelemetry',
    icon: Activity,
    // No endpoint exposes Langfuse — label the source explicitly.
    source: { kind: 'static', note: 'Static config — no live /health probe' },
  },
];

const STATIC_LABELS = {
  selfOffline: 'Offline',
  unreached: 'Unprobed',
  staticUnknown: 'Unknown',
  staticNote: 'Static config — no live /health probe',
} as const;

/** Cost is a small fraction of a dollar; a raw float is not a readout. */
const COST_SCALE = 4;
const formatCost = (usd: number | null) => usd === null ? '—' : `$${usd.toFixed(COST_SCALE)}`;
const formatLatency = (milliseconds: number | null | undefined) =>
  milliseconds == null ? '—' : `${milliseconds.toFixed(1)} ms`;

const KPIS: Array<{ key: string; label: string; unit: string; hint: string; icon: typeof Zap; accent: boolean }> = [
  { key: 'total-requests', label: 'Total requests', unit: 'req', hint: 'Current API process', icon: Zap, accent: false },
  { key: 'total-tokens', label: 'Token volume', unit: 'tok', hint: 'Observed and estimated usage', icon: Layers, accent: true },
  { key: 'cost', label: 'Est. cost', unit: 'USD', hint: 'Current API process', icon: Coins, accent: false },
];

const LatencyChart: React.FC<{ requests: TenantMetrics['recent_requests'] }> = ({ requests }) => {
  const ordered = [...requests].reverse();
  if (!ordered.length) return null;

  const left = 58;
  const right = 628;
  const top = 16;
  const bottom = 174;
  const max = Math.max(100, Math.ceil(Math.max(...ordered.map(({ duration_ms }) => duration_ms)) / 100) * 100);
  const points = ordered.map((request, index) => {
    const x = ordered.length === 1 ? (left + right) / 2 : left + index * (right - left) / (ordered.length - 1);
    const y = bottom - (request.duration_ms / max) * (bottom - top);
    return { x, y, request };
  });
  const line = points.map(({ x, y }) => `${x},${y}`).join(' ');

  return <div className="min-w-0">
    <h4 className="mb-1 text-label font-semibold text-ink">Request latency · last {ordered.length}</h4>
    <svg viewBox="0 0 640 210" role="img" aria-label={`Latency chart for the last ${ordered.length} requests, from earlier to latest`} className="h-48 w-full overflow-visible text-muted">
      {[0, 0.5, 1].map((ratio) => {
        const y = bottom - ratio * (bottom - top);
        return <g key={ratio}><line x1={left} y1={y} x2={right} y2={y} stroke="currentColor" strokeOpacity=".18"/><text x={left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="currentColor">{Math.round(max * ratio)} ms</text></g>;
      })}
      {points.length > 1 && <polyline points={line} fill="none" stroke="rgb(var(--accent))" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>}
      {points.map(({ x, y, request }, index) => <circle key={`${request.query}-${index}`} cx={x} cy={y} r="4" fill="rgb(var(--accent))"><title>{`${request.duration_ms.toFixed(1)} ms · ${request.query}`}</title></circle>)}
      <text x={left} y="202" fontSize="11" fill="currentColor">Earlier</text>
      <text x={right} y="202" textAnchor="end" fontSize="11" fill="currentColor">Latest</text>
    </svg>
  </div>;
};

const StageDurations: React.FC<{ request: TenantMetrics['recent_requests'][number] | undefined }> = ({ request }) => {
  const stages = Object.entries(request?.timings_ms ?? {}).filter(([, duration]) => duration > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!stages.length) return null;
  const max = Math.max(...stages.map(([, duration]) => duration));

  return <div className="flex flex-col gap-2">
    <div><h4 className="text-label font-semibold text-ink">Latest request · stage timings</h4><p className="text-micro text-muted">Span durations can overlap; these bars do not add up to total time.</p></div>
    {stages.map(([name, duration]) => <div key={name} className="grid grid-cols-[minmax(5rem,9rem)_1fr_auto] items-center gap-2">
      <span className="truncate text-micro text-muted" title={name}>{name}</span>
      <span className="h-2 overflow-hidden rounded-full bg-surface-sunken"><span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, duration / max * 100)}%` }}/></span>
      <span className="num text-micro text-ink">{formatLatency(duration)}</span>
    </div>)}
  </div>;
};

export const MetricsDashboard: React.FC<MetricsDashboardProps> = ({ tenantId }) => {
  const [metrics, setMetrics] = useState<TenantMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorTenantId, setErrorTenantId] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const metricsRequestId = useRef(0);
  const metricsRequestBusy = useRef(false);
  const currentTenantId = useRef(tenantId);
  currentTenantId.current = tenantId;
  // Public readiness is the only health signal available without credentials.
  const [healthReady, setHealthReady] = useState<boolean | null>(null);
  // Live /v1/index/status; null means the probe itself failed, so no card
  // sourced from it may claim to be Ready.
  const [indexStatus, setIndexStatus] = useState<IndexStatusResponse | null>(null);
  const [retrievalQuery, setRetrievalQuery] = useState('');
  const [retrievalResponse, setRetrievalResponse] = useState<RetrieveResponse | null>(null);
  const [retrievalLoading, setRetrievalLoading] = useState(false);
  const [retrievalError, setRetrievalError] = useState<string | null>(null);

  const fetchMetrics = async (requestedTenantId: string = tenantId, showLoading = true) => {
    if (!showLoading && metricsRequestBusy.current) return;
    metricsRequestBusy.current = true;
    const requestId = ++metricsRequestId.current;
    if (showLoading) setLoading(true);
    if (showLoading) {
      setError(null);
      setErrorTenantId(null);
    }
    try {
      const res = await api.getMetrics(requestedTenantId);
      if (requestId !== metricsRequestId.current || requestedTenantId !== currentTenantId.current) return;
      if (res.tenant_id !== requestedTenantId) {
        setMetrics(null);
        setErrorTenantId(requestedTenantId);
        setError('Metrics response tenant did not match requested tenant');
        return;
      }
      setMetrics(res);
      setRefreshedAt(new Date());
      setError(null);
      setErrorTenantId(null);
    } catch (err: unknown) {
      if (requestId !== metricsRequestId.current || requestedTenantId !== currentTenantId.current) return;
      const msg = err instanceof Error ? err.message : 'Failed to load telemetry metrics';
      setError(msg);
      setErrorTenantId(requestedTenantId);
      // Clear stale metrics on error
      setMetrics(null);
    } finally {
      if (requestId === metricsRequestId.current) {
        metricsRequestBusy.current = false;
        if (requestedTenantId === currentTenantId.current) setLoading(false);
      }
    }
  };

  useEffect(() => {
    setMetrics(null);
    setRefreshedAt(null);
    void fetchMetrics(tenantId);
    const interval = window.setInterval(() => {
      if (!document.hidden) void fetchMetrics(tenantId, false);
    }, 5000);
    return () => { window.clearInterval(interval); metricsRequestId.current += 1; metricsRequestBusy.current = false; };
  }, [tenantId]);

  const currentMetrics = metrics?.tenant_id === tenantId ? metrics : null;
  const currentError = errorTenantId === tenantId ? error : null;
  const currentLoading = loading || (!currentMetrics && !currentError);

  useEffect(() => {
    const refreshIndexStatus = async () => {
      try {
        setIndexStatus(await api.getIndexStatus(tenantId));
      } catch {
        setIndexStatus(null);
      }
    };
    refreshIndexStatus();
    const interval = setInterval(refreshIndexStatus, 15000);
    return () => clearInterval(interval);
  }, [tenantId]);

  useEffect(() => {
    const refreshHealth = async () => {
      try {
        const health = await api.checkHealth();
        setHealthReady(health.ready);
      } catch {
        setHealthReady(null);
      }
    };
    refreshHealth();
    const interval = setInterval(refreshHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  const runRetrieval = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = retrievalQuery.trim();
    if (!query) return;

    setRetrievalLoading(true);
    setRetrievalError(null);
    setRetrievalResponse(null);
    try {
      setRetrievalResponse(await api.retrieve({ query, top_k: 5 }, tenantId));
    } catch (err: unknown) {
      setRetrievalError(err instanceof Error ? err.message : 'Retrieval failed');
    } finally {
      setRetrievalLoading(false);
    }
  };

  // Unmeasured telemetry is not a measurement of zero. `currentMetrics` is null on
  // first paint and after a failed fetch, and the strip used to render 0 req /
  // 0 tok / $0.0000 for both — asserting a number nobody measured. The em-dash
  // is this file's own convention for a count the backend could not observe.
  const kpiValue = (key: string): string => {
    if (!currentMetrics) return '—';
    if (key === 'total-requests') return currentMetrics.total_requests.toLocaleString();
    if (key === 'total-tokens') return currentMetrics.total_tokens.toLocaleString();
    return formatCost(currentMetrics.total_cost_usd);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="label-section flex items-center gap-1.5 text-ink">
            <Gauge className="size-3.5 text-accent" aria-hidden="true" />
            <span>LLMOps observability</span>
          </h2>
          <p className="mt-1 text-micro text-muted">Auto-refreshes every 5 seconds · process-local telemetry</p>
        </div>

        <div className="flex items-center gap-3">
        {refreshedAt && <span className="text-micro text-muted">Updated {refreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
        <button
          onClick={() => void fetchMetrics()}
          disabled={loading}
          aria-label="Refresh telemetry metrics"
          className="flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-raised px-2.5 py-1 text-label font-semibold text-muted transition-colors hover:border-accent hover:text-accent-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin text-accent' : ''}`} aria-hidden="true" />
          <span>Refresh</span>
        </button>
        </div>
      </div>

      {currentError && (
        <div role="alert" aria-live="polite" className="rounded-sm border border-fail/30 bg-fail-wash px-3 py-2 text-label font-semibold text-fail">
          {currentError}
        </div>
      )}

      <div data-testid="metrics-loading-status" role="status" aria-live="polite" aria-busy={currentLoading} className="min-h-[3rem]">
        {currentLoading && !currentMetrics ? (
          <div className="rounded-sm border border-hairline bg-surface-raised px-3 py-3 text-label font-semibold text-muted">
            Loading telemetry metrics…
          </div>
        ) : null}
      </div>

      {/* One dense readout strip — label, value, unit — not three cards. */}
      <dl data-testid="kpi-strip" className="grid grid-cols-1 divide-y divide-hairline border-y border-hairline sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {KPIS.map(({ key, label, unit, hint, icon: Icon, accent }) => (
          <div key={key} data-slot="kpi" className="px-3 py-2.5">
            <dt className="flex items-center gap-1.5 text-micro uppercase tracking-[0.12em] text-muted">
              <Icon className="size-3 text-faint" aria-hidden="true" />
              <span>{label}</span>
            </dt>
            <dd className="mt-0.5 flex items-baseline gap-1.5">
              <span
                data-testid="kpi-value"
                data-kpi={key}
                className={`num text-readout font-semibold ${accent ? 'text-accent-ink' : 'text-ink'}`}
              >
                <span data-testid={`kpi-${key}`} className="contents">
                  {kpiValue(key)}
                </span>
              </span>
              <span className="text-micro text-faint">{unit}</span>
            </dd>
            <p className="mt-0.5 truncate text-micro text-faint" title={hint}>
              {hint}
            </p>
          </div>
        ))}
      </dl>

      <section aria-labelledby="request-telemetry-title" className="flex flex-col gap-3 rounded-sm border border-hairline bg-surface-raised p-3">
        <div>
          <h3 id="request-telemetry-title" className="label-section text-ink">Live request feed</h3>
          <p className="mt-1 text-micro text-muted">Latest 20 requests captured by this running API process.</p>
        </div>

        {currentMetrics ? (
          <>
            {currentMetrics.recent_requests?.length ? <div className="grid gap-5 border-b border-hairline pb-3 lg:grid-cols-2">
              <LatencyChart requests={currentMetrics.recent_requests.slice(0, 20)}/>
              <StageDurations request={currentMetrics.recent_requests[0]}/>
            </div> : <p className="text-label text-muted">Charts will appear after this API process records requests.</p>}
            <dl className="grid grid-cols-1 divide-y divide-hairline border-y border-hairline sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <div className="px-3 py-2.5">
                <dt className="text-micro uppercase tracking-[0.12em] text-muted">Errors</dt>
                <dd data-testid="error-count" className="num mt-0.5 text-readout font-semibold text-ink">{currentMetrics.error_count?.toLocaleString() ?? '—'}</dd>
              </div>
              <div className="px-3 py-2.5">
                <dt className="text-micro uppercase tracking-[0.12em] text-muted">Retrieval p50</dt>
                <dd data-testid="retrieval-p50" className="num mt-0.5 text-readout font-semibold text-ink">{formatLatency(currentMetrics.retrieval_latency_ms?.p50)}</dd>
              </div>
              <div className="px-3 py-2.5">
                <dt className="text-micro uppercase tracking-[0.12em] text-muted">Retrieval p95</dt>
                <dd data-testid="retrieval-p95" className="num mt-0.5 text-readout font-semibold text-ink">{formatLatency(currentMetrics.retrieval_latency_ms?.p95)}</dd>
              </div>
            </dl>

            {currentMetrics.recent_requests?.length ? (
              <ol aria-label="Recent tenant requests" className="flex flex-col divide-y divide-hairline border-y border-hairline">
                {currentMetrics.recent_requests.slice(0, 20).map((request, index) => (
                  <li key={`${request.query}-${index}`} className="flex flex-col gap-1.5 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="min-w-0 break-words text-label font-semibold text-ink"><span className="mr-2 text-micro font-normal text-faint">{index === 0 ? 'Latest' : `Earlier · ${index}`}</span>{request.query}</p>
                      <span className="num shrink-0 text-micro text-muted">{formatLatency(request.duration_ms)}</span>
                    </div>
                    <dl className="flex flex-wrap gap-x-4 gap-y-1">
                      {Object.entries(request.timings_ms ?? {}).map(([name, duration]) => (
                        <div key={name} className="flex items-baseline gap-1">
                          <dt className="text-micro text-faint">{name}</dt>
                          <dd className="num text-micro text-muted">{formatLatency(duration)}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-label text-muted">No recent requests recorded for this tenant.</p>
            )}
          </>
        ) : currentLoading ? (
          <p className="text-label text-muted">Loading recent tenant telemetry…</p>
        ) : currentError ? (
          <p className="rounded-sm border border-fail/30 bg-fail-wash px-3 py-2 text-label font-semibold text-fail">Recent tenant telemetry is unavailable.</p>
        ) : null}
      </section>

      <section aria-labelledby="retrieval-playground-title" className="flex flex-col gap-3 rounded-sm border border-hairline bg-surface-raised p-3">
        <div>
          <h3 id="retrieval-playground-title" className="label-section text-ink">Retrieval Playground</h3>
          <p className="mt-1 text-micro text-muted">Run retrieval for this tenant and inspect the ranked chunk scores.</p>
        </div>

        <form onSubmit={runRetrieval} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="diagnostics-retrieval-query" className="sr-only">Retrieval query</label>
          <input
            id="diagnostics-retrieval-query"
            value={retrievalQuery}
            onChange={(event) => setRetrievalQuery(event.target.value)}
            placeholder="Type a query to inspect retrieval…"
            className="min-w-0 flex-1 rounded-sm border border-hairline bg-surface px-3 py-2 text-label text-ink placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <button
            type="submit"
            disabled={retrievalLoading || !retrievalQuery.trim()}
            className="rounded-sm border border-accent bg-accent px-3 py-2 text-label font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {retrievalLoading ? 'Retrieving…' : 'Run retrieval'}
          </button>
        </form>

        <div role={retrievalLoading ? 'status' : undefined} aria-live="polite" aria-busy={retrievalLoading} className="text-label text-muted">
          {retrievalLoading ? 'Searching ranked chunks…' : null}
        </div>
        {retrievalError && (
          <div role="alert" className="rounded-sm border border-fail/30 bg-fail-wash px-3 py-2 text-label font-semibold text-fail">
            {retrievalError}
          </div>
        )}
        {retrievalResponse && (
          retrievalResponse.chunks.length === 0 ? (
            <p className="text-label text-muted">No chunks found for this query.</p>
          ) : (
            <ol aria-label="Ranked retrieval chunks" className="flex flex-col divide-y divide-hairline border-y border-hairline">
              {retrievalResponse.chunks.map((chunk) => (
                <li key={chunk.chunk_id} aria-label={`Rank ${chunk.rank} result`} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0 text-label font-semibold text-ink">
                      <span className="num mr-2 text-accent-ink">#{chunk.rank}</span>
                      <span>{chunk.filename || chunk.title || chunk.document_id}</span>
                      {chunk.page_start !== null && <span className="ml-2 text-micro font-normal text-muted">p. {chunk.page_start}</span>}
                    </div>
                    {chunk.heading_path && <span className="text-micro text-muted">{chunk.heading_path}</span>}
                  </div>
                  <p className="whitespace-pre-wrap text-label leading-relaxed text-muted">{chunk.text}</p>
                  <dl className="grid grid-cols-3 gap-2 border-t border-hairline pt-2">
                    {([
                      ['Dense', chunk.scores.dense],
                      ['BM25', chunk.scores.bm25],
                      ['RRF', chunk.scores.rrf],
                    ] as const).map(([label, score]) => (
                      <div key={label}>
                        <dt className="text-micro uppercase tracking-[0.1em] text-faint">{label}</dt>
                        <dd className="num mt-0.5 text-label font-semibold text-ink">{score == null ? '—' : String(score)}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ol>
          )
        )}
      </section>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="label-section flex items-center gap-1.5 text-ink">
            <Server className="size-3.5 text-accent" aria-hidden="true" />
            <span>Infrastructure</span>
          </h3>
        </div>

        <ul className="flex flex-col border-t border-hairline">
          {INFRASTRUCTURE_SERVICES.map((svc) => {
            const Icon = svc.icon;
            // Resolve every card from a live source. When a source is missing
            // or failed, the card says so instead of asserting Ready/Online.
            let label: string;
            let tone: StatusChipVariant;
            let endpoint: string | null = null;
            let sourceNote: string | null = null;
            if (svc.source.kind === 'self') {
              label = healthReady === null ? STATIC_LABELS.selfOffline : healthReady ? 'Online' : 'Degraded';
              tone = healthReady === null ? 'fail' : healthReady ? 'ok' : 'warn';
            } else if (svc.source.kind === 'index') {
              const live = indexStatus?.backends?.[svc.source.key];
              if (!live) {
                label = STATIC_LABELS.unreached;
                tone = 'warn';
              } else {
                // Fallback strictly implies the persisted store is not being
                // used, so it is the more specific (and more alarming) truth
                // than a bare Offline when a backend is down.
                label = live.is_fallback ? 'Fallback' : live.reachable ? 'Online' : 'Offline';
                tone = live.is_fallback ? 'warn' : live.reachable ? 'ok' : 'fail';
                endpoint = live.endpoint;
              }
            } else {
              label = STATIC_LABELS.staticUnknown;
              tone = 'warn';
              sourceNote = svc.source.note;
            }
            return (
              <li
                key={svc.name}
                data-testid="infra-card"
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-hairline py-2.5 transition-colors last:border-b-0 hover:bg-accent-wash/40"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-label font-semibold text-ink">{svc.name}</div>
                    <div className="id-mono truncate text-faint" title={endpoint ?? undefined}>
                      {endpoint ?? svc.type}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {sourceNote && (
                    <span className="text-micro text-faint" title={sourceNote}>
                      Source: {sourceNote}
                    </span>
                  )}
                  <StatusChip variant={tone}>{label}</StatusChip>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};
