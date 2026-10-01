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
import type { HealthServiceStatus, IndexStatusResponse, TenantMetrics } from '../types/api';

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
    /** Live reachability from the /health services map. */
    | { kind: 'health-map'; key: string }
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
    source: { kind: 'health-map', key: 'litellm' },
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
  // Live /health services map; null = unreachable (sane static fallback).
  const [serviceHealth, setServiceHealth] = useState<Record<string, HealthServiceStatus> | null>(null);
  const [healthReachable, setHealthReachable] = useState(true);
  // Storage counters surfaced from /health where returned.
  const [storageDocuments, setStorageDocuments] = useState<number | null>(null);
  const [vectorChunks, setVectorChunks] = useState<number | null>(null);
  // Live /v1/index/status; null means the probe itself failed, so no card
  // sourced from it may claim to be Ready.
  const [indexStatus, setIndexStatus] = useState<IndexStatusResponse | null>(null);

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
      const h = await api.checkHealth();
      setServiceHealth(h.services ?? {});
      setHealthReachable(true);
      setStorageDocuments(typeof h.storage_documents === 'number' ? h.storage_documents : null);
      setVectorChunks(typeof h.vector_chunks === 'number' ? h.vector_chunks : null);
    } catch {
      setServiceHealth(null);
      setHealthReachable(false);
      setStorageDocuments(null);
      setVectorChunks(null);
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

      {/* One dense readout strip — label, value, unit — not three cards. */}
      <dl data-testid="kpi-strip" className="grid grid-cols-3 divide-x divide-hairline border-y border-hairline">
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

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="label-section flex items-center gap-1.5 text-ink">
            <Server className="size-3.5 text-accent" aria-hidden="true" />
            <span>Infrastructure</span>
          </h3>
          {(storageDocuments !== null || vectorChunks !== null) && (
            <span className="text-micro text-muted">
              From /health ·{' '}
              {/* The count and its unit read as one mono readout so the
                  "unavailable" case shows an em-dash, never a fake 0. */}
              <span className="num text-label font-semibold text-ink">{`${storageDocuments ?? '—'} docs`}</span>
              {' · '}
              <span className="num text-label font-semibold text-ink">{`${vectorChunks ?? '—'} chunks`}</span>
            </span>
          )}
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
              label = healthReachable ? 'Online' : STATIC_LABELS.selfOffline;
              tone = healthReachable ? 'ok' : 'fail';
            } else if (svc.source.kind === 'health-map') {
              const live = serviceHealth?.[svc.source.key];
              if (!serviceHealth) {
                label = STATIC_LABELS.unreached;
                tone = 'warn';
              } else if (!live) {
                label = STATIC_LABELS.unreached;
                tone = 'warn';
              } else {
                label = live.reachable ? 'Online' : 'Degraded';
                tone = live.reachable ? 'ok' : 'warn';
                endpoint = live.endpoint;
              }
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
