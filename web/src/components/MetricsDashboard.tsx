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
import type { HealthServiceStatus, TenantMetrics } from '../types/api';

interface MetricsDashboardProps {
  tenantId: string;
}

interface InfraService {
  name: string;
  port: string;
  status: string;
  type: string;
  icon: typeof Cpu;
  healthKey?: string;
}

const INFRASTRUCTURE_SERVICES: InfraService[] = [
  {
    name: 'Meridian RAG Engine (FastAPI)',
    port: ':8000',
    status: 'Online',
    type: 'Core App',
    icon: Cpu,
  },
  {
    name: 'LiteLLM AI Gateway',
    port: ':4000',
    status: 'Ready',
    type: 'Ingress Proxy',
    icon: Server,
    healthKey: 'litellm',
  },
  {
    name: 'Qdrant Vector Database',
    port: ':6333',
    status: 'Ready',
    type: 'Dense Storage',
    icon: Database,
    healthKey: 'qdrant',
  },
  {
    name: 'Neo4j Knowledge Graph',
    port: ':7474',
    status: 'Ready',
    type: 'Entity Graph',
    icon: Network,
    healthKey: 'neo4j',
  },
  {
    name: 'Langfuse Tracing',
    port: ':3000',
    status: 'Ready',
    type: 'OpenTelemetry',
    icon: Activity,
  },
];
export const MetricsDashboard: React.FC<MetricsDashboardProps> = ({ tenantId }) => {
  const [metrics, setMetrics] = useState<TenantMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live /health services map; null = unreachable (sane static fallback).
  const [serviceHealth, setServiceHealth] = useState<Record<string, HealthServiceStatus> | null>(null);
  const [healthReachable, setHealthReachable] = useState(true);

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
    } catch {
      setServiceHealth(null);
      setHealthReachable(false);
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
        <h3 className="text-xs font-bold text-meridian-text flex items-center space-x-2 mb-4">
          <Server className="w-4 h-4 text-meridian-primary" />
          <span>Multi-Container Infrastructure Topology</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {INFRASTRUCTURE_SERVICES.map((svc) => {
            const Icon = svc.icon;
            // Resolve live status from /health services map; fall back to the
            // static label when health is unreachable or the service has no key.
            // RAG engine card reflects the health fetch itself (same-origin backend).
            let label = svc.status;
            let tone: 'ok' | 'warn' | 'bad' = 'ok';
            if (svc.name.startsWith('Meridian RAG Engine')) {
              if (!healthReachable) {
                label = 'Offline';
                tone = 'bad';
              }
            } else if (svc.healthKey && serviceHealth) {
              const live = serviceHealth[svc.healthKey];
              if (live && !live.reachable) {
                label = 'Degraded';
                tone = 'warn';
              }
            } else if (!healthReachable && !svc.healthKey) {
              label = 'Unknown';
              tone = 'warn';
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
                      {svc.type} • <code className="text-meridian-primary font-bold">{svc.port}</code>
                    </p>
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

