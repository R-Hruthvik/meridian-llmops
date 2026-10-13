import React, { useEffect, useState } from 'react';
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
const formatCost = (usd: number) => `$${usd.toFixed(COST_SCALE)}`;

const KPIS: Array<{ key: string; label: string; unit: string; hint: string; icon: typeof Zap; accent: boolean }> = [
  { key: 'total-requests', label: 'Total requests', unit: 'req', hint: 'Recorded in Langfuse telemetry', icon: Zap, accent: false },
  { key: 'total-tokens', label: 'Token volume', unit: 'tok', hint: 'Prompt + completion tokens', icon: Layers, accent: true },
  { key: 'cost', label: 'Est. cost', unit: 'USD', hint: 'Aggregated upstream model charges', icon: Coins, accent: false },
];

export const MetricsDashboard: React.FC<MetricsDashboardProps> = ({ tenantId }) => {
  const [metrics, setMetrics] = useState<TenantMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Public readiness is the only health signal available without credentials.
  const [healthReady, setHealthReady] = useState<boolean | null>(null);
  // Live /v1/index/status; null means the probe itself failed, so no card
  // sourced from it may claim to be Ready.
  const [indexStatus, setIndexStatus] = useState<IndexStatusResponse | null>(null);
  const [retrievalQuery, setRetrievalQuery] = useState('');
  const [retrievalResponse, setRetrievalResponse] = useState<RetrieveResponse | null>(null);
  const [retrievalLoading, setRetrievalLoading] = useState(false);
  const [retrievalError, setRetrievalError] = useState<string | null>(null);

  const fetchMetrics = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMetrics(tenantId);
      setMetrics(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load telemetry metrics';
      setError(msg);
      // Clear stale metrics on error
      setMetrics(null);
    } finally {
      setLoading(false);
    }
    try {
      setIndexStatus(await api.getIndexStatus(tenantId));
    } catch {
      setIndexStatus(null);
    }
  };

  useEffect(() => {
    fetchMetrics();
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

  // Unmeasured telemetry is not a measurement of zero. `metrics` is null on
  // first paint and after a failed fetch, and the strip used to render 0 req /
  // 0 tok / $0.0000 for both — asserting a number nobody measured. The em-dash
  // is this file's own convention for a count the backend could not observe.
  const kpiValue = (key: string): string => {
    if (!metrics) return '—';
    if (key === 'total-requests') return metrics.total_requests.toLocaleString();
    if (key === 'total-tokens') return metrics.total_tokens.toLocaleString();
    return formatCost(metrics.total_cost_usd);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="label-section flex items-center gap-1.5 text-ink">
            <Gauge className="size-3.5 text-accent" aria-hidden="true" />
            <span>LLMOps observability</span>
          </h2>
          <p className="mt-1 text-micro text-muted">
            Tenant <span className="id-mono text-accent-ink">{tenantId}</span>
          </p>
        </div>

        <button
          onClick={fetchMetrics}
          disabled={loading}
          aria-label="Refresh telemetry metrics"
          className="flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-raised px-2.5 py-1 text-label font-semibold text-muted transition-colors hover:border-accent hover:text-accent-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin text-accent' : ''}`} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div role="alert" aria-live="polite" className="rounded-sm border border-fail/30 bg-fail-wash px-3 py-2 text-label font-semibold text-fail">
          {error}
        </div>
      )}

      <div data-testid="metrics-loading-status" role="status" aria-live="polite" aria-busy={loading} className="min-h-[3rem]">
        {loading && !metrics ? (
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
