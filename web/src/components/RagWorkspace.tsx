import React, { useState } from 'react';
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
} from 'lucide-react';
import { api } from '../services/api';
import type { QueryResponse } from '../types/api';

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
  const [error, setError] = useState<string | null>(null);

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
    } catch (err: any) {
      setError(err.message || 'An error occurred during query execution');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Column: Query Input & Settings (7 cols) */}
      <div className="lg:col-span-7 space-y-5">
        {/* Main Query Box */}
        <div className="bg-meridian-card border border-meridian-border rounded-2xl p-5 shadow-glass relative">
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-semibold text-meridian-lavender flex items-center space-x-1.5">
              <Sparkles className="w-3.5 h-3.5 text-meridian-primary" />
              <span>Ask Agentic RAG Pipeline</span>
            </label>
            <div className="flex items-center space-x-2">
              <label className="text-[11px] text-meridian-muted flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enforceGuardrails}
                  onChange={(e) => setEnforceGuardrails(e.target.checked)}
                  className="rounded bg-meridian-bg border-meridian-border text-meridian-primary focus:ring-0"
                />
                <span className={enforceGuardrails ? 'text-meridian-lavender font-medium' : ''}>
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
            className="w-full h-28 bg-meridian-bg/80 border border-meridian-border rounded-xl p-3.5 text-xs text-meridian-text placeholder-meridian-muted focus:outline-none focus:border-meridian-primary transition-all resize-none"
          />

          {/* Quick Preset Buttons */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {sampleQueries.map((q, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setQuery(q);
                  handleQuery(q);
                }}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-meridian-bg border border-meridian-border/70 text-meridian-muted hover:text-meridian-lavender hover:border-meridian-secondary/50 transition-all text-left"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Bottom Bar: Sliders & Submit */}
          <div className="mt-4 pt-3 border-t border-meridian-border flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-4 text-xs text-meridian-muted">
              <div className="flex items-center space-x-2">
                <span>Top K Chunks:</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={topK}
                  onChange={(e) => setTopK(Number(e.target.value))}
                  className="w-12 bg-meridian-bg border border-meridian-border rounded-lg px-2 py-1 text-center text-meridian-lavender text-xs font-semibold outline-none"
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
                  className="w-12 bg-meridian-bg border border-meridian-border rounded-lg px-2 py-1 text-center text-meridian-lavender text-xs font-semibold outline-none"
                />
              </div>
            </div>

            <button
              onClick={() => handleQuery()}
              disabled={loading || !query.trim()}
              className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-meridian-primary hover:bg-meridian-secondary text-white text-xs font-semibold shadow-glow disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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

        {/* Error Alert */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Query Intercepted / Failed</p>
              <p className="text-rose-200/80 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Response Answer Card */}
        {response && (
          <div className="bg-meridian-card border border-meridian-border rounded-2xl p-5 shadow-glass space-y-4">
            {/* Telemetry Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-meridian-border">
              <div className="flex items-center space-x-2">
                {response.refusal ? (
                  <span className="flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-950/40 border border-amber-500/40 text-amber-400">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Safe Refusal Fallback</span>
                  </span>
                ) : response.verified ? (
                  <span className="flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-950/40 border border-emerald-500/40 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Critic Verified Grounded</span>
                  </span>
                ) : (
                  <span className="flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-indigo-950/40 border border-indigo-500/40 text-indigo-400">
                    <span>Generated</span>
                  </span>
                )}

                <span className="flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-meridian-bg border border-meridian-border text-meridian-lavender">
                  <Cpu className="w-3 h-3 text-meridian-secondary" />
                  <span>Cycle {response.cycle_count}/{maxCycles}</span>
                </span>
              </div>

              <div className="flex items-center space-x-1.5 text-xs text-meridian-muted">
                <Clock className="w-3.5 h-3.5" />
                <span>{response.execution_time_ms.toFixed(0)} ms</span>
              </div>
            </div>

            {/* Answer Content */}
            <div className="prose prose-invert max-w-none text-xs leading-relaxed text-meridian-text whitespace-pre-wrap">
              {response.answer}
            </div>
          </div>
        )}
      </div>

      {/* Right Column: Context Citations & Graph Entities (5 cols) */}
      <div className="lg:col-span-5 space-y-5">
        {/* Source Citations */}
        <div className="bg-meridian-card border border-meridian-border rounded-2xl p-5 shadow-glass">
          <div className="flex items-center justify-between mb-3.5">
            <h3 className="text-xs font-semibold text-meridian-lavender flex items-center space-x-1.5">
              <FileText className="w-4 h-4 text-meridian-primary" />
              <span>Retrieved Chunks & Citations</span>
            </h3>
            <span className="text-[11px] text-meridian-muted">
              {response?.source_chunks?.length || 0} chunks
            </span>
          </div>

          {!response || response.source_chunks.length === 0 ? (
            <div className="text-center py-10 text-meridian-muted text-xs border border-dashed border-meridian-border rounded-xl">
              <Database className="w-8 h-8 mx-auto mb-2 text-meridian-border" />
              <p>No query context retrieved yet.</p>
              <p className="text-[11px] text-meridian-muted/70 mt-1">
                Run a query to inspect ranked passages from Qdrant and BM25.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
              {response.source_chunks.map((chunk, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-meridian-bg/80 border border-meridian-border hover:border-meridian-secondary/40 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-meridian-primary/20 text-meridian-lavender border border-meridian-primary/30">
                      Chunk {idx + 1} • {chunk.retrieval_method}
                    </span>
                    <span className="text-[11px] font-semibold text-emerald-400">
                      Score: {(chunk.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-xs text-meridian-muted leading-relaxed line-clamp-4">
                    {chunk.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Knowledge Graph Entities */}
        <div className="bg-meridian-card border border-meridian-border rounded-2xl p-5 shadow-glass">
          <div className="flex items-center justify-between mb-3.5">
            <h3 className="text-xs font-semibold text-meridian-lavender flex items-center space-x-1.5">
              <Network className="w-4 h-4 text-meridian-blossom" />
              <span>Knowledge Graph Entity Traversal</span>
            </h3>
            <span className="text-[11px] text-meridian-muted">Neo4j</span>
          </div>

          {!response || !response.entities || response.entities.length === 0 ? (
            <div className="text-center py-6 text-meridian-muted text-xs border border-dashed border-meridian-border rounded-xl">
              <p>No graph relations traversed for this query.</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {response.entities.map((entity, idx) => (
                <span
                  key={idx}
                  className="text-xs px-2.5 py-1 rounded-lg bg-meridian-bg border border-meridian-border text-meridian-text flex items-center space-x-1"
                >
                  <span className="font-semibold text-meridian-secondary">{entity.name}</span>
                  <span className="text-[10px] text-meridian-muted">({entity.entity_type})</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
