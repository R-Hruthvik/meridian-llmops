import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  FileText,
  Network,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { api, ApiError } from '../services/api';
import { PROVIDER_FALLBACK_MODELS, PROVIDER_MODELS } from '../constants/providerModels';
import type { QueryResponse, LLMSettings, ProvidersResponse } from '../types/api';

interface RagWorkspaceProps {
  tenantId: string;
}

export const RagWorkspace: React.FC<RagWorkspaceProps> = ({ tenantId }) => {
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(3);
  const [maxCycles, setMaxCycles] = useState(3);
  const [enforceGuardrails, setEnforceGuardrails] = useState(true);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [llmSettings, setLlmSettings] = useState<LLMSettings | null>(null);
  const [providersInfo, setProvidersInfo] = useState<ProvidersResponse | null>(null);
  const [modelSwitching, setModelSwitching] = useState(false);

  // Load active LLM settings & provider status
  const loadSettings = async () => {
    try {
      const [s, provs] = await Promise.all([
        api.getLLMSettings().catch(() => null),
        api.getProviders().catch(() => null),
      ]);
      if (s) setLlmSettings(s);
      if (provs) setProvidersInfo(provs);
    } catch {
      // Fall back
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleQuickModelChange = async (newModel: string) => {
    if (!llmSettings) return;
    setModelSwitching(true);
    try {
      await api.updateLLMSettings({
        active_provider: llmSettings.active_provider,
        default_model: newModel,
      });
      setLlmSettings({
        ...llmSettings,
        default_model: newModel,
      });
      localStorage.setItem('meridian_default_model', newModel);
    } catch {
      // Handled
    } finally {
      setModelSwitching(false);
    }
  };

  const sampleQueries = [
    'What storage engines does Meridian use for dual-memory retrieval?',
    'How does Meridian protect against prompt injections at the gateway?',
    'What is the maximum number of self-healing retry cycles allowed?',
    'What is the secret formula for alchemical immortality?', // Tests refusal
  ];

  const handleQuery = async (queryText?: string) => {
    const textToSubmit = queryText || query;
    if (!textToSubmit.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const res = await api.query({
        query: textToSubmit,
        tenant_id: tenantId,
        top_k: topK,
        max_cycles: maxCycles,
        enforce_guardrails: enforceGuardrails,
      });
      setResponse(res);
      loadSettings();
    } catch (err: any) {
      const status = err instanceof ApiError ? err.status : undefined;
      setError({
        message: err.message || 'An error occurred during query execution',
        status,
      });
    } finally {
      setLoading(false);
    }
  };

  const getAvailableModelsForProvider = (provider: string) => {
    // Primary: use registry from GET /v1/settings/providers
    const prov = providersInfo?.providers.find((p) => p.id === provider);
    if (prov && prov.models && prov.models.length > 0) {
      const list = [...prov.models];
      if (llmSettings?.default_model && !list.includes(llmSettings.default_model)) {
        list.unshift(llmSettings.default_model);
      }
      return list;
    }
    // Fallback: shared PROVIDER_MODELS map (single frontend truth)
    return PROVIDER_MODELS[provider] ?? PROVIDER_FALLBACK_MODELS;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Column: Query Input & Settings (7 cols) */}
      <div className="lg:col-span-7 space-y-5">
        {/* Active Model Governance & Engine Quick-Switch Banner */}
        <div className="bg-white border border-meridian-border rounded-3xl p-4 sm:p-5 shadow-card flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-meridian-blossom border border-meridian-lavender flex items-center justify-center text-meridian-primary shadow-sm">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-meridian-textMuted">
                  Serving Engine
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1" />
                  Live API Active
                </span>
              </div>
              <div className="text-xs font-bold text-meridian-text capitalize flex items-center space-x-1.5 mt-0.5">
                <span>{llmSettings?.active_provider || 'OpenAI'} Cloud</span>
                <span className="text-meridian-textMuted">•</span>
                <span className="font-mono text-meridian-primary font-bold">
                  {llmSettings?.default_model || 'gpt-4o-mini'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <label className="text-[11px] font-bold text-meridian-textMuted">
              Quick Switch:
            </label>
            <select
              value={llmSettings?.default_model || 'gpt-4o-mini'}
              onChange={(e) => handleQuickModelChange(e.target.value)}
              disabled={modelSwitching}
              className="bg-meridian-bg border border-meridian-border rounded-xl px-3 py-1.5 text-xs text-meridian-text font-bold outline-none focus:border-meridian-primary focus:bg-white transition-all cursor-pointer"
            >
              {getAvailableModelsForProvider(llmSettings?.active_provider || 'openai').map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Main Query Box */}
        <div className="bg-white border border-meridian-border rounded-3xl p-6 shadow-card hover:shadow-cardHover transition-all">
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-bold text-meridian-primary flex items-center space-x-1.5">
              <Sparkles className="w-4 h-4 text-meridian-secondary" />
              <span>Ask Agentic RAG Pipeline</span>
            </label>
            <div className="flex items-center space-x-2">
              <label className="text-xs text-meridian-textMuted flex items-center space-x-1.5 cursor-pointer bg-meridian-lavenderLight/60 px-3 py-1 rounded-full border border-meridian-border">
                <input
                  type="checkbox"
                  checked={enforceGuardrails}
                  onChange={(e) => setEnforceGuardrails(e.target.checked)}
                  className="rounded text-meridian-primary focus:ring-0"
                />
                <span className={enforceGuardrails ? 'text-meridian-primary font-bold' : ''}>
                  Guardrails Active
                </span>
              </label>
            </div>
          </div>

          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleQuery();
              }
            }}
            placeholder="Type your question (e.g. 'What is the architecture of Meridian platform?')..."
            className="w-full h-28 bg-meridian-bg border border-meridian-border rounded-2xl p-4 text-xs text-meridian-text placeholder-meridian-textMuted focus:outline-none focus:border-meridian-primary focus:bg-white transition-all resize-none leading-relaxed"
          />

          {/* Quick Preset Buttons */}
          <div className="mt-3 flex flex-wrap gap-2">
            {sampleQueries.map((q, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setQuery(q);
                  handleQuery(q);
                }}
                className="text-[11px] text-meridian-textMuted hover:text-meridian-primary bg-meridian-lavenderLight/40 hover:bg-meridian-blossom px-3 py-1.5 rounded-xl border border-meridian-border transition-all text-left"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Controls Footer */}
          <div className="mt-5 pt-4 border-t border-meridian-border flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center space-x-4 text-xs text-meridian-textMuted">
              <div className="flex items-center space-x-2">
                <span>Top K Chunks:</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={topK}
                  onChange={(e) => setTopK(Number(e.target.value))}
                  className="w-12 bg-meridian-bg border border-meridian-border rounded-lg px-2 py-1 text-center text-meridian-primary text-xs font-bold outline-none"
                />
              </div>
              <div className="flex items-center space-x-2">
                <span>Max Cycles:</span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={maxCycles}
                  onChange={(e) => setMaxCycles(Number(e.target.value))}
                  className="w-12 bg-meridian-bg border border-meridian-border rounded-lg px-2 py-1 text-center text-meridian-primary text-xs font-bold outline-none"
                />
              </div>
            </div>

            <button
              onClick={() => handleQuery()}
              disabled={loading || !query.trim()}
              className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-meridian-primary hover:bg-meridian-primaryHover text-white text-xs font-bold shadow-glow disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Executing Graph...</span>
                </>
              ) : (
                <>
                  <span>Run Agent</span>
                  <Send className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Error Alert — distinct rendering based on HTTP status */}
        {error && (
          <div
            className={`p-4 rounded-2xl text-xs flex items-start space-x-2.5 shadow-sm ${
              error.status === 429
                ? 'bg-amber-50 border border-amber-200 text-amber-800'
                : error.status === 401
                  ? 'bg-rose-50 border border-rose-200 text-rose-800'
                  : error.status && error.status >= 400 && error.status < 500
                    ? 'bg-rose-50 border border-rose-200 text-rose-800'
                    : 'bg-rose-50 border border-rose-200 text-rose-800'
            }`}
          >
            {error.status === 429 ? (
              <Clock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
            )}
            <div>
              <p className="font-bold flex items-center space-x-1.5">
                <span>
                  {error.status === 429
                    ? 'Rate Limit Exceeded'
                    : error.status === 401
                      ? 'Authentication Error'
                      : 'Query Intercepted / Failed'}
                </span>
                {error.status && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-black/5 border border-current/30">
                    HTTP {error.status}
                  </span>
                )}
              </p>
              <p className="text-rose-700 dark:group mt-0.5">
                {error.status === 429
                  ? 'Too many requests in the current time window. Please wait a moment and try again.'
                  : error.message}
              </p>
            </div>
          </div>
        )}

        {/* Response Answer Card */}
        {response && (
          <div className="bg-white border border-meridian-border rounded-3xl p-6 shadow-card space-y-4">
            {/* Telemetry Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3.5 border-b border-meridian-border">
              <div className="flex items-center space-x-2">
                {response.refusal ? (
                  <span className="flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 border border-amber-300 text-amber-800">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                    <span>Safe Refusal Fallback</span>
                  </span>
                ) : response.verified ? (
                  <span className="flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 border border-emerald-300 text-emerald-800">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Critic Verified Grounded</span>
                  </span>
                ) : (
                  <span className="flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-bold bg-meridian-lavenderLight border border-meridian-border text-meridian-primary">
                    <span>Generated Response</span>
                  </span>
                )}

                <span className="flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-semibold bg-meridian-blossom border border-meridian-lavender text-meridian-primary">
                  <Cpu className="w-3.5 h-3.5 text-meridian-secondary" />
                  <span>Cycle {response.cycle_count}/{maxCycles}</span>
                </span>

                {response.serving_model && (
                  <span className="flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-meridian-lavenderLight/80 border border-meridian-border text-meridian-text">
                    <Zap className="w-3 h-3 text-meridian-primary" />
                    <span className="capitalize">{response.serving_provider}</span>
                    <span className="text-meridian-textMuted">•</span>
                    <span className="font-mono text-meridian-primary">{response.serving_model}</span>
                  </span>
                )}
              </div>

              <div className="flex items-center space-x-1.5 text-xs text-meridian-textMuted font-medium">
                <Clock className="w-3.5 h-3.5 text-meridian-secondary" />
                <span>{response.execution_time_ms.toFixed(0)} ms</span>
              </div>
            </div>

            {/* Answer Content */}
            <div className="text-xs leading-relaxed text-meridian-text whitespace-pre-wrap font-normal">
              {response.answer}
            </div>
          </div>
        )}
      </div>

      {/* Right Column: Context Citations & Graph Entities (5 cols) */}
      <div className="lg:col-span-5 space-y-5">
        {/* Source Citations */}
        <div className="bg-white border border-meridian-border rounded-3xl p-6 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-meridian-text flex items-center space-x-1.5">
              <FileText className="w-4 h-4 text-meridian-primary" />
              <span>Retrieved Chunks & Citations</span>
            </h3>
            <span className="text-[11px] font-semibold text-meridian-primary bg-meridian-lavenderLight px-2.5 py-0.5 rounded-full">
              {response?.source_chunks?.length || 0} chunks
            </span>
          </div>

          {!response || response.source_chunks.length === 0 ? (
            <div className="text-center py-12 text-meridian-textMuted text-xs border border-dashed border-meridian-border rounded-2xl bg-meridian-bg/50">
              <Database className="w-8 h-8 mx-auto mb-2 text-meridian-secondary/60" />
              <p className="font-semibold text-meridian-text">No query context retrieved yet</p>
              <p className="text-[11px] text-meridian-textMuted mt-1">
                Run a query to inspect ranked passages from Qdrant and BM25.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
              {response.source_chunks.map((chunk, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-2xl bg-meridian-bg/70 border border-meridian-border hover:border-meridian-primary/50 transition-all"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-meridian-blossom text-meridian-primary border border-meridian-lavender">
                      Chunk {idx + 1} • {chunk.retrieval_method}
                    </span>
                    <span className="text-xs font-bold text-emerald-600">
                      Score: {(chunk.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-xs text-meridian-text leading-relaxed font-mono text-[11px] bg-white/70 p-2.5 rounded-xl border border-meridian-border">
                    {chunk.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Knowledge Graph Entities */}
        <div className="bg-white border border-meridian-border rounded-3xl p-6 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-meridian-text flex items-center space-x-1.5">
              <Network className="w-4 h-4 text-meridian-primary" />
              <span>Knowledge Graph Entity Traversal</span>
            </h3>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-meridian-lavenderLight text-meridian-primary border border-meridian-border">
              Neo4j
            </span>
          </div>

          {!response || response.entities.length === 0 ? (
            <div className="text-center py-10 text-meridian-textMuted text-xs border border-dashed border-meridian-border rounded-2xl bg-meridian-bg/50">
              <p className="text-[11px]">No graph relations traversed for this query.</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {response.entities.map((entity, idx) => (
                <div
                  key={idx}
                  className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-meridian-bg border border-meridian-border text-xs"
                >
                  <span className="font-bold text-meridian-text">{entity.name}</span>
                  <span className="text-[10px] font-semibold text-meridian-primary bg-meridian-blossom px-1.5 py-0.5 rounded">
                    {entity.entity_type}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
