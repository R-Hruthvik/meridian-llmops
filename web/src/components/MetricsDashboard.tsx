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

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-extrabold text-meridian-text flex items-center space-x-2">
            <Gauge className="w-5 h-5 text-meridian-primary" />
            <span>LLMOps Observability & Tenant Economics</span>
          </h2>
          <p className="text-xs text-meridian-textMuted mt-0.5 font-medium">
            Active Tenant: <span className="font-bold text-meridian-primary">{tenantId}</span>
          </p>
        </div>

        <button
          onClick={fetchMetrics}
          disabled={loading}
          aria-label="Refresh telemetry metrics"
          className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-white hover:bg-meridian-lavenderLight border border-meridian-border text-xs text-meridian-text font-bold shadow-card transition-all disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-meridian-primary focus-visible:outline-none"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-meridian-primary' : ''}`} />
          <span>Refresh Metrics</span>
        </button>
      </div>

      {error && (
        <div role="alert" aria-live="polite" className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
          {error}
        </div>
      )}

      {/* Primary KPI Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Total Requests */}
        <div className="bg-white/80 backdrop-blur-md border border-meridian-border rounded-3xl p-6 shadow-card hover:shadow-cardHover transition-all">
          <div className="flex items-center justify-between text-meridian-textMuted text-xs font-semibold mb-2">
            <span>Total Requests</span>
            <Zap className="w-4 h-4 text-meridian-primary" />
          </div>
          <div className="text-3xl font-black text-meridian-text">
            {metrics ? metrics.total_requests.toLocaleString() : '0'}
          </div>
          <p className="text-[11px] text-meridian-textMuted mt-1 font-medium">
            Recorded in Langfuse telemetry
          </p>
        </div>

        {/* Total Token Consumption */}
        <div className="bg-white/80 backdrop-blur-md border border-meridian-border rounded-3xl p-6 shadow-card hover:shadow-cardHover transition-all">
          <div className="flex items-center justify-between text-meridian-textMuted text-xs font-semibold mb-2">
            <span>Token Volume</span>
            <Layers className="w-4 h-4 text-meridian-secondary" />
          </div>
          <div className="text-3xl font-black text-meridian-primary">
            {metrics ? metrics.total_tokens.toLocaleString() : '0'}
          </div>
          <p className="text-[11px] text-meridian-textMuted mt-1 font-medium">
            Prompt + Completion tokens
          </p>
        </div>

        {/* Estimated Cost */}
        <div className="bg-white/80 backdrop-blur-md border border-meridian-border rounded-3xl p-6 shadow-card hover:shadow-cardHover transition-all">
          <div className="flex items-center justify-between text-meridian-textMuted text-xs font-semibold mb-2">
            <span>Estimated Operational Cost</span>
            <Coins className="w-4 h-4 text-meridian-primary" />
          </div>
          <div className="text-3xl font-black text-emerald-600">
            ${metrics ? metrics.total_cost_usd.toFixed(4) : '0.0000'}
          </div>
          <p className="text-[11px] text-meridian-textMuted mt-1 font-medium">
            Aggregated upstream model charges
          </p>
        </div>
      </div>

      {/* Multi-Container Infrastructure Status */}
      <div className="bg-white/80 backdrop-blur-md border border-meridian-border rounded-3xl p-6 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className="text-xs font-bold text-meridian-text flex items-center space-x-2">
            <Server className="w-4 h-4 text-meridian-primary" />
            <span>Multi-Container Infrastructure Topology</span>
          </h3>
          {(storageDocuments !== null || vectorChunks !== null) && (
            <span className="text-[11px] font-semibold text-meridian-textMuted">
              Storage (from /health):{' '}
              <span className="font-bold text-meridian-text">{storageDocuments ?? '—'} docs</span>
              {' • '}
              <span className="font-bold text-meridian-text">{vectorChunks ?? '—'} chunks</span>
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {INFRASTRUCTURE_SERVICES.map((svc) => {
            const Icon = svc.icon;
            // Resolve every card from a live source. When a source is missing
            // or failed, the card says so instead of asserting Ready/Online.
            let label: string;
            let tone: 'ok' | 'warn' | 'bad';
            let endpoint: string | null = null;
            let sourceNote: string | null = null;
            if (svc.source.kind === 'self') {
              label = healthReachable ? 'Online' : STATIC_LABELS.selfOffline;
              tone = healthReachable ? 'ok' : 'bad';
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
                tone = live.is_fallback ? 'warn' : live.reachable ? 'ok' : 'bad';
                endpoint = live.endpoint;
              }
            } else {
              label = STATIC_LABELS.staticUnknown;
              tone = 'warn';
              sourceNote = svc.source.note;
            }
            const badgeClass =
              tone === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : tone === 'warn'
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-rose-50 border-rose-200 text-rose-700';
            const dotClass =
              tone === 'ok' ? 'bg-emerald-500 animate-pulse' : tone === 'warn' ? 'bg-amber-500 animate-pulse' : 'bg-rose-500';
            return (
              <div
                key={svc.name}
                className="p-4 rounded-2xl bg-meridian-bg/70 border border-meridian-border flex items-center justify-between hover:border-meridian-primary/50 transition-all"
              >
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 rounded-xl bg-white border border-meridian-border shadow-sm">
                    <Icon className="w-4 h-4 text-meridian-primary" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-meridian-text">{svc.name}</h4>
                    <p className="text-[11px] text-meridian-textMuted font-medium">
                      {svc.type}
                      {endpoint && (
                        <>
                          {' • '}
                          <code className="text-meridian-primary font-bold break-all">{endpoint}</code>
                        </>
                      )}
                    </p>
                    {sourceNote && (
                      <p className="text-[10px] text-meridian-textMuted font-medium mt-0.5">
                        Source: {sourceNote}
                      </p>
                    )}
                  </div>
                </div>

                <span className={`flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${badgeClass}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
                  <span>{label}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

