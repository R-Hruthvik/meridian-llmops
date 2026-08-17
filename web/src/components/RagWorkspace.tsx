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
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            {sampleQueries.map((q, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setQuery(q);
                  handleQuery(q);
                }}
                className="text-[11px] px-3 py-1.5 rounded-xl bg-meridian-lavenderLight/70 border border-meridian-border text-meridian-textMuted hover:text-meridian-primary hover:bg-meridian-blossom transition-all text-left font-medium"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Bottom Bar: Sliders & Submit */}
          <div className="mt-4 pt-3.5 border-t border-meridian-border flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-4 text-xs text-meridian-textMuted font-medium">
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

        {/* Error Alert */}
        {error && (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start space-x-2.5 shadow-sm">
            <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-bold">Query Intercepted / Failed</p>
              <p className="text-rose-700 mt-0.5">{error}</p>
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
                  <p className="text-xs text-meridian-textMuted leading-relaxed line-clamp-4">
                    {chunk.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Knowledge Graph Entities */}
        <div className="bg-white border border-meridian-border rounded-3xl p-6 shadow-card">
          <div className="flex items-center justify-between mb-3.5">
            <h3 className="text-xs font-bold text-meridian-text flex items-center space-x-1.5">
              <Network className="w-4 h-4 text-meridian-secondary" />
              <span>Knowledge Graph Entity Traversal</span>
            </h3>
            <span className="text-[10px] font-bold uppercase text-meridian-primary bg-meridian-blossom px-2 py-0.5 rounded-full">
              Neo4j
            </span>
          </div>

          {!response || !response.entities || response.entities.length === 0 ? (
            <div className="text-center py-6 text-meridian-textMuted text-xs border border-dashed border-meridian-border rounded-2xl bg-meridian-bg/50">
              <p>No graph relations traversed for this query.</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {response.entities.map((entity, idx) => (
                <span
                  key={idx}
                  className="text-xs px-3 py-1 rounded-xl bg-meridian-lavenderLight border border-meridian-border text-meridian-text flex items-center space-x-1 shadow-sm"
                >
                  <span className="font-bold text-meridian-primary">{entity.name}</span>
                  <span className="text-[10px] text-meridian-textMuted">({entity.entity_type})</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
