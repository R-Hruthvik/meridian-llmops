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
import type { TenantMetrics } from '../types/api';

interface MetricsDashboardProps {
  tenantId: string;
}

export const MetricsDashboard: React.FC<MetricsDashboardProps> = ({ tenantId }) => {
  const [metrics, setMetrics] = useState<TenantMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMetrics(tenantId);
      setMetrics(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load telemetry metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, [tenantId]);

  const infrastructureServices = [
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
    },
    {
      name: 'Qdrant Vector Database',
      port: ':6333',
      status: 'Ready',
      type: 'Dense Storage',
      icon: Database,
    },
    {
      name: 'Neo4j Knowledge Graph',
      port: ':7474',
      status: 'Ready',
      type: 'Entity Graph',
      icon: Network,
    },
    {
      name: 'Langfuse Tracing',
      port: ':3000',
      status: 'Ready',
      type: 'OpenTelemetry',
      icon: Activity,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-meridian-text flex items-center space-x-2">
            <Gauge className="w-5 h-5 text-meridian-primary" />
            <span>LLMOps Observability & Tenant Economics</span>
          </h2>
          <p className="text-xs text-meridian-muted mt-0.5">
            Active Tenant: <span className="font-semibold text-meridian-lavender">{tenantId}</span>
          </p>
        </div>

        <button
          onClick={fetchMetrics}
          disabled={loading}
          className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-meridian-card hover:bg-meridian-cardHover border border-meridian-border text-xs text-meridian-text font-medium transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-meridian-primary' : ''}`} />
          <span>Refresh Metrics</span>
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs">
          {error}
        </div>
      )}

      {/* Primary KPI Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Total Requests */}
        <div className="bg-meridian-card border border-meridian-border rounded-2xl p-5 shadow-glass">
          <div className="flex items-center justify-between text-meridian-muted text-xs mb-2">
            <span>Total Requests</span>
            <Zap className="w-4 h-4 text-meridian-primary" />
          </div>
          <div className="text-2xl font-black text-meridian-text">
            {metrics ? metrics.total_requests.toLocaleString() : '0'}
          </div>
          <p className="text-[11px] text-meridian-muted/80 mt-1">
            Recorded in Langfuse telemetry
          </p>
        </div>

        {/* Total Token Consumption */}
        <div className="bg-meridian-card border border-meridian-border rounded-2xl p-5 shadow-glass">
          <div className="flex items-center justify-between text-meridian-muted text-xs mb-2">
            <span>Token Volume</span>
            <Layers className="w-4 h-4 text-meridian-secondary" />
          </div>
          <div className="text-2xl font-black text-meridian-lavender">
            {metrics ? metrics.total_tokens.toLocaleString() : '0'}
          </div>
          <p className="text-[11px] text-meridian-muted/80 mt-1">
            Prompt + Completion tokens
          </p>
        </div>

        {/* Estimated Cost */}
        <div className="bg-meridian-card border border-meridian-border rounded-2xl p-5 shadow-glass">
          <div className="flex items-center justify-between text-meridian-muted text-xs mb-2">
            <span>Estimated Operational Cost</span>
            <Coins className="w-4 h-4 text-meridian-blossom" />
          </div>
          <div className="text-2xl font-black text-emerald-400">
            ${metrics ? metrics.total_cost_usd.toFixed(4) : '0.0000'}
          </div>
          <p className="text-[11px] text-meridian-muted/80 mt-1">
            Aggregated upstream model charges
          </p>
        </div>
      </div>

      {/* Multi-Container Infrastructure Status */}
      <div className="bg-meridian-card border border-meridian-border rounded-2xl p-5 shadow-glass">
        <h3 className="text-xs font-semibold text-meridian-lavender flex items-center space-x-2 mb-4">
          <Server className="w-4 h-4 text-meridian-primary" />
          <span>Multi-Container Infrastructure Topology</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {infrastructureServices.map((svc, idx) => {
            const Icon = svc.icon;
            return (
              <div
                key={idx}
                className="p-4 rounded-xl bg-meridian-bg/80 border border-meridian-border flex items-center justify-between"
              >
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 rounded-lg bg-meridian-card border border-meridian-border">
                    <Icon className="w-4 h-4 text-meridian-secondary" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-meridian-text">{svc.name}</h4>
                    <p className="text-[11px] text-meridian-muted">
                      {svc.type} • <code className="text-meridian-lavender">{svc.port}</code>
                    </p>
                  </div>
                </div>

                <span className="flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-950/40 border border-emerald-500/30 text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{svc.status}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
