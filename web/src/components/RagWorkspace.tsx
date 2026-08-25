import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
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
import { MarkdownRenderer } from './MarkdownRenderer';
import type { QueryResponse } from '../types/api';

interface RagWorkspaceProps {
  tenantId: string;
}

const SAMPLE_QUERIES = [
  'What storage engines does Meridian use for dual-memory retrieval?',
  'How does Meridian protect against prompt injections at the gateway?',
  'What is the maximum number of self-healing retry cycles allowed?',
  'What is the secret formula for alchemical immortality?', // Tests refusal
];

export const RagWorkspace: React.FC<RagWorkspaceProps> = ({ tenantId }) => {
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(3);
  const [maxCycles, setMaxCycles] = useState(3);
  const [enforceGuardrails, setEnforceGuardrails] = useState(true);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [copied, setCopied] = useState(false);

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
    } catch (err: unknown) {
      const status = err instanceof ApiError ? err.status : undefined;
      const message = err instanceof Error ? err.message : 'An error occurred during query execution';
      setError({ message, status });
      // Clear stale query response on error
      setResponse(null);
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Column: Query Input & Settings (7 cols) */}
      <div className="lg:col-span-7 space-y-5">
        {/* Main Query Box */}
        <div className="bg-white/80 backdrop-blur-md border border-meridian-border rounded-3xl p-6 shadow-card hover:shadow-cardHover transition-all">
          <div className="flex items-center justify-between mb-3">
            <label htmlFor="rag-query-input" className="text-xs font-bold text-meridian-primary flex items-center space-x-1.5">
              <Sparkles className="w-4 h-4 text-meridian-secondary" />
              <span>Ask Agentic RAG Pipeline</span>
            </label>
            <div className="flex items-center space-x-2">
              <label className="text-xs text-meridian-textMuted flex items-center space-x-1.5 cursor-pointer bg-meridian-lavenderLight/60 hover:bg-meridian-lavenderLight px-3 py-1 rounded-full border border-meridian-border transition-colors">
                <input
                  type="checkbox"
                  checked={enforceGuardrails}
                  onChange={(e) => setEnforceGuardrails(e.target.checked)}
                  className="rounded text-meridian-primary focus-visible:ring-2 focus-visible:ring-meridian-primary focus-visible:outline-none cursor-pointer"
                />
                <span className={enforceGuardrails ? 'text-meridian-primary font-bold' : ''}>
                  Guardrails Active
                </span>
              </label>
            </div>
          </div>

          <textarea
            id="rag-query-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleQuery();
              }
            }}
            placeholder="Type your question (e.g. 'What is the architecture of Meridian platform?')..."
            className="w-full h-28 bg-meridian-bg/80 border border-meridian-border rounded-2xl p-4 text-xs text-meridian-text placeholder-meridian-textMuted focus-visible:ring-2 focus-visible:ring-meridian-primary focus:outline-none focus:border-meridian-primary focus:bg-white transition-all resize-none leading-relaxed shadow-inner"
          />

          {/* Quick Preset Buttons */}
          <div className="mt-3.5 flex flex-wrap gap-2">
            {SAMPLE_QUERIES.map((q) => (
              <button
                key={q}
                type="button"
                disabled={loading}
                onClick={() => {
                  setQuery(q);
                  handleQuery(q);
                }}
                className="text-[11px] font-medium text-meridian-textMuted hover:text-meridian-primary bg-meridian-lavenderLight/40 hover:bg-meridian-blossom/60 px-3 py-1.5 rounded-xl border border-meridian-border/80 hover:border-meridian-primary/40 transition-all text-left flex items-center space-x-1 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-meridian-primary focus-visible:outline-none"
              >
                <span>{q}</span>
              </button>
            ))}
          </div>

          {/* Controls Footer */}
          <div className="mt-5 pt-4 border-t border-meridian-border/60 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center space-x-4 text-xs text-meridian-textMuted">
              <div className="flex items-center space-x-2">
                <label htmlFor="top-k-input" className="font-medium">Top K Chunks:</label>
                <input
                  id="top-k-input"
                  type="number"
                  min={1}
                  max={10}
                  value={topK}
                  onChange={(e) => setTopK(Number(e.target.value))}
                  className="w-14 bg-meridian-bg border border-meridian-border rounded-xl px-2 py-1 text-center text-meridian-primary text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-meridian-primary focus:border-meridian-primary focus:bg-white transition-all"
                />
              </div>
              <div className="flex items-center space-x-2">
                <label htmlFor="max-cycles-input" className="font-medium">Max Cycles:</label>
                <input
                  id="max-cycles-input"
                  type="number"
                  min={1}
                  max={5}
                  value={maxCycles}
                  onChange={(e) => setMaxCycles(Number(e.target.value))}
                  className="w-14 bg-meridian-bg border border-meridian-border rounded-xl px-2 py-1 text-center text-meridian-primary text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-meridian-primary focus:border-meridian-primary focus:bg-white transition-all"
                />
              </div>
            </div>

            <button
              onClick={() => handleQuery()}
              disabled={loading || !query.trim()}
              className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-meridian-primary to-meridian-secondary hover:from-meridian-primaryHover hover:to-meridian-primary text-white text-xs font-bold shadow-glow disabled:opacity-50 disabled:cursor-not-allowed transition-all focus-visible:ring-2 focus-visible:ring-meridian-primary focus-visible:outline-none"
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
            role="alert"
            aria-live="polite"
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
              <p className="text-rose-700 mt-0.5">
                {error.status === 429
                  ? 'Too many requests in the current time window. Please wait a moment and try again.'
                  : error.message}
              </p>
            </div>
          </div>
        )}

        {/* Pending Operation Skeleton Loader */}
        {loading && (
          <div className="bg-white/80 backdrop-blur-md border border-meridian-primary/40 rounded-3xl p-6 shadow-glow space-y-4 animate-pulse">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-meridian-lavenderLight flex items-center justify-center">
                <RefreshCw className="w-5 h-5 text-meridian-primary animate-spin" />
              </div>
              <div className="space-y-1.5 flex-1">
                <div className="h-4 bg-meridian-lavenderLight rounded w-1/3" />
                <div className="h-3 bg-meridian-bg rounded w-1/2" />
              </div>
            </div>
            <div className="space-y-2 pt-2">
              <div className="h-3 bg-meridian-bg rounded w-full" />
              <div className="h-3 bg-meridian-bg rounded w-5/6" />
              <div className="h-3 bg-meridian-bg rounded w-2/3" />
            </div>
          </div>
        )}

        {/* Response Answer Card — Major Focus Hero Component */}
        {!loading && response && (
          <div className="bg-gradient-to-b from-white via-white to-meridian-lavenderLight/30 border-2 border-meridian-primary/40 rounded-3xl p-6 md:p-7 shadow-glow ring-1 ring-meridian-primary/20 space-y-5 animate-in fade-in slide-in-from-bottom-3 duration-300">
            {/* Hero Output Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-meridian-border/80">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-meridian-primary via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-glow shrink-0">
                  <Sparkles className="w-5 h-5 text-meridian-blossom" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-sm md:text-base font-extrabold bg-gradient-to-r from-meridian-primary via-indigo-600 to-purple-600 bg-clip-text text-transparent">
                      AI Agent Synthesis Output
                    </h2>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-meridian-blossom text-meridian-text border border-meridian-lavender">
                      Hero Output
                    </span>
                  </div>
                  <p className="text-[11px] text-meridian-textMuted font-medium mt-0.5">
                    Self-healing verified response synthesized from Qdrant vector passages & Neo4j graph nodes
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-white hover:bg-meridian-blossom/60 border border-meridian-border text-meridian-primary text-xs font-bold transition-all shadow-sm group focus-visible:ring-2 focus-visible:ring-meridian-primary focus-visible:outline-none"
                  title="Copy Answer to Clipboard"
                  aria-label="Copy answer text"
                >
                  {copied ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-meridian-primary group-hover:scale-110 transition-transform" />
                  )}
                  <span>{copied ? 'Copied!' : 'Copy Answer'}</span>
                </button>
              </div>
            </div>

            {/* Telemetry & Grounding Verification Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 bg-meridian-bg/80 p-3 rounded-2xl border border-meridian-border/70 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {response.refusal ? (
                  <span className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 border border-amber-300 text-amber-800 shadow-sm">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                    <span>Safe Refusal Fallback</span>
                  </span>
                ) : response.verified ? (
                  <span className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 border border-emerald-300 text-emerald-800 shadow-sm">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Critic Verified Grounded</span>
                  </span>
                ) : (
                  <span className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold bg-meridian-lavenderLight border border-meridian-border text-meridian-primary shadow-sm">
                    <span>Generated Response</span>
                  </span>
                )}

                <span className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold bg-meridian-blossom border border-meridian-lavender text-meridian-text shadow-sm">
                  <Cpu className="w-3.5 h-3.5 text-meridian-primary" />
                  <span>Cycle {response.cycle_count}/{maxCycles}</span>
                </span>

                {response.degraded_reason && (
                  <span
                    className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-50 border border-red-300 text-red-800 shadow-sm"
                    title={response.degraded_reason}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                    <span>Degraded Path</span>
                  </span>
                )}

                {response.serving_model && (
                  <span className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-white border border-meridian-border text-meridian-text shadow-sm">
                    <Zap className="w-3.5 h-3.5 text-meridian-primary" />
                    <span className="capitalize">{response.serving_provider}</span>
                    <span className="text-meridian-textMuted">•</span>
                    <span className="font-mono text-meridian-primary font-bold">{response.serving_model}</span>
                  </span>
                )}
              </div>

              <div className="flex items-center space-x-1.5 text-xs text-meridian-textMuted font-semibold px-2 py-0.5">
                <Clock className="w-3.5 h-3.5 text-meridian-secondary" />
                <span>{response.execution_time_ms.toFixed(0)} ms</span>
              </div>
            </div>

            {/* Major Focus Hero Answer Body */}
            <div className="bg-white border border-meridian-border/80 rounded-2xl p-5 md:p-6 shadow-inner">
              <MarkdownRenderer content={response.answer} />
            </div>
          </div>
        )}
      </div>

      {/* Right Column: Context Citations & Graph Entities (5 cols) */}
      <div className="lg:col-span-5 space-y-5">
        {/* Source Citations */}
        <div className="bg-white/80 backdrop-blur-md border border-meridian-border rounded-3xl p-6 shadow-card">
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
            <div className="text-center py-10 px-4 text-meridian-textMuted text-xs rounded-2xl bg-meridian-bg/60 border border-meridian-borderLight">
              <div className="w-10 h-10 mx-auto mb-2.5 rounded-2xl bg-meridian-lavenderLight/80 border border-meridian-border flex items-center justify-center text-meridian-primary">
                <Database className="w-5 h-5 text-meridian-primary" />
              </div>
              <p className="font-bold text-meridian-text">No query context retrieved yet</p>
              <p className="text-[11px] text-meridian-textMuted mt-1 max-w-xs mx-auto">
                Run a query to inspect ranked passages from Qdrant vector store and BM25 search.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
              {response.source_chunks.map((chunk, idx) => (
                <div
                  key={chunk.chunk_id || `chunk-${idx}`}
                  className="p-3.5 rounded-2xl bg-meridian-bg/70 border border-meridian-border hover:border-meridian-primary/50 transition-all"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md bg-meridian-blossom text-meridian-text border border-meridian-lavender">
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
        <div className="bg-white/80 backdrop-blur-md border border-meridian-border rounded-3xl p-6 shadow-card">
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
            <div className="text-center py-8 px-4 text-meridian-textMuted text-xs rounded-2xl bg-meridian-bg/60 border border-meridian-borderLight">
              <div className="w-9 h-9 mx-auto mb-2 rounded-2xl bg-meridian-lavenderLight/80 border border-meridian-border flex items-center justify-center text-meridian-primary">
                <Network className="w-4 h-4 text-meridian-primary" />
              </div>
              <p className="font-semibold text-meridian-text text-xs">No graph relations traversed yet</p>
              <p className="text-[11px] text-meridian-textMuted mt-1">
                Extracted entities and Neo4j graph relationships will appear here when a query executes.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {response.entities.map((entity) => (
                <div
                  key={entity.name}
                  className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-meridian-bg border border-meridian-border text-xs shadow-sm"
                >
                  <span className="font-bold text-meridian-text">{entity.name}</span>
                  <span className="text-[10px] font-extrabold text-meridian-text bg-meridian-blossom px-1.5 py-0.5 rounded border border-meridian-lavender">
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


