import React, { useState } from 'react';
import {
  CheckCircle2,
  Database,
  FileCheck,
  FileCode,
  FileUp,
  Layers,
  Network,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { api } from '../services/api';
import type { IngestResponse } from '../types/api';

interface IngestionStudioProps {
  tenantId: string;
}

export const IngestionStudio: React.FC<IngestionStudioProps> = ({ tenantId }) => {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sampleDoc = `# High-Performance Distributed Caching
The Distributed Cache Layer uses Redis Cluster with multi-region replication.
Cache invalidation is handled via Kafka events emitted by write operations.
Cache hit ratios are tracked in Prometheus and visualized in Grafana dashboards.
`;

  const handleIngest = async () => {
    if (!text.trim() || !title.trim()) {
      setError('Please provide both document title and text content.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await api.ingest(
        {
          title: title.trim(),
          text: text.trim(),
        },
        tenantId
      );
      setResult(res);
    } catch (err: any) {
      setError(err.message || 'Ingestion failed');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setTitle(file.name.replace(/\.[^/.]+$/, ''));
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setText(content || '');
    };
    reader.readAsText(file);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Column: Editor & Uploader (7 cols) */}
      <div className="lg:col-span-7 space-y-5">
        <div className="bg-white border border-meridian-border rounded-3xl p-6 shadow-card hover:shadow-cardHover transition-all space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-meridian-text flex items-center space-x-1.5">
              <Database className="w-4 h-4 text-meridian-primary" />
              <span>Document Ingestion & Structural Chunking</span>
            </h3>
            <button
              onClick={() => {
                setTitle('Distributed Caching Architecture');
                setText(sampleDoc);
              }}
              className="text-xs text-meridian-primary font-semibold hover:text-meridian-primaryHover flex items-center space-x-1 bg-meridian-lavenderLight px-3 py-1 rounded-full border border-meridian-border"
            >
              <Sparkles className="w-3.5 h-3.5 text-meridian-secondary" />
              <span>Load Sample Doc</span>
            </button>
          </div>

          {/* Document Title */}
          <div>
            <label className="block text-xs font-semibold text-meridian-text mb-1">
              Document Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Enterprise Security Policy 2026"
              className="w-full bg-meridian-bg border border-meridian-border rounded-xl px-3.5 py-2 text-xs text-meridian-text font-medium outline-none focus:border-meridian-primary focus:bg-white transition-all"
            />
          </div>

          {/* File Upload Trigger */}
          <div className="border-2 border-dashed border-meridian-lavender rounded-2xl p-6 text-center bg-meridian-lavenderLight/40 hover:bg-meridian-blossom/50 transition-all relative">
            <input
              type="file"
              onChange={handleFileUpload}
              accept=".txt,.md,.markdown,.json,.html"
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
            <FileUp className="w-7 h-7 mx-auto mb-1 text-meridian-primary" />
            <p className="text-xs font-bold text-meridian-text">
              Click or drag file to upload
            </p>
            <p className="text-[11px] text-meridian-textMuted mt-0.5 font-medium">
              Supports Markdown, Text, HTML, JSON, DOCX
            </p>
          </div>

          {/* Document Body Textarea */}
          <div>
            <label className="block text-xs font-semibold text-meridian-text mb-1">
              Document Content (Markdown / Text)
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste or write structured documentation with # headings, sections, and paragraphs..."
              className="w-full h-48 bg-meridian-bg border border-meridian-border rounded-2xl p-4 text-xs text-meridian-text font-mono placeholder-meridian-textMuted outline-none focus:border-meridian-primary focus:bg-white resize-none transition-all leading-relaxed"
            />
          </div>

          {/* Action Button */}
          <div className="flex justify-end pt-2">
            <button
              onClick={handleIngest}
              disabled={loading || !text.trim() || !title.trim()}
              className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-meridian-primary hover:bg-meridian-primaryHover text-white text-xs font-bold shadow-glow disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Processing & Indexing...</span>
                </>
              ) : (
                <>
                  <FileCheck className="w-4 h-4" />
                  <span>Index into Qdrant & Neo4j</span>
                </>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
            {error}
          </div>
        )}
      </div>

      {/* Right Column: Ingestion Status & Statistics (5 cols) */}
      <div className="lg:col-span-5 space-y-5">
        <div className="bg-white border border-meridian-border rounded-3xl p-6 shadow-card space-y-4">
          <h3 className="text-xs font-bold text-meridian-text flex items-center space-x-1.5">
            <Layers className="w-4 h-4 text-meridian-primary" />
            <span>Dual-Memory Ingestion Pipeline</span>
          </h3>

          {!result ? (
            <div className="text-center py-14 text-meridian-textMuted text-xs border border-dashed border-meridian-border rounded-2xl bg-meridian-bg/50">
              <FileCode className="w-8 h-8 mx-auto mb-2 text-meridian-secondary/60" />
              <p className="font-semibold text-meridian-text">No document indexed in this session</p>
              <p className="text-[11px] text-meridian-textMuted mt-1">
                Upload or paste documentation on the left to extract structural chunks and knowledge graph entities.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-900 flex items-center space-x-3">
                <CheckCircle2 className="w-6 h-6 shrink-0 text-emerald-600" />
                <div>
                  <h4 className="text-xs font-bold text-emerald-950">
                    Ingestion Successfully Completed
                  </h4>
                  <p className="text-[11px] text-emerald-800 mt-0.5">
                    Doc ID: <code className="font-mono bg-white px-2 py-0.5 rounded border border-emerald-200">{result.document_id}</code>
                  </p>
                </div>
              </div>

              {/* Statistics Breakdown */}
              <div className="grid grid-cols-2 gap-3.5">
                <div className="p-4 rounded-2xl bg-meridian-lavenderLight/60 border border-meridian-border">
                  <div className="flex items-center space-x-2 text-meridian-textMuted text-[11px] font-semibold mb-1">
                    <Database className="w-3.5 h-3.5 text-meridian-primary" />
                    <span>Qdrant Vectors</span>
                  </div>
                  <div className="text-2xl font-black text-meridian-text">
                    {result.chunks_indexed}
                  </div>
                  <span className="text-[10px] font-medium text-meridian-textMuted">
                    Structural Chunks
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-meridian-blossom/60 border border-meridian-lavender">
                  <div className="flex items-center space-x-2 text-meridian-textMuted text-[11px] font-semibold mb-1">
                    <Network className="w-3.5 h-3.5 text-meridian-primary" />
                    <span>Neo4j Entities</span>
                  </div>
                  <div className="text-2xl font-black text-meridian-text">
                    {result.entities_extracted}
                  </div>
                  <span className="text-[10px] font-medium text-meridian-textMuted">
                    {result.relationships_extracted} Relationships
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-meridian-lavenderLight/40 border border-meridian-border text-xs text-meridian-textMuted leading-relaxed font-medium">
                <span className="font-bold text-meridian-primary">Next Steps:</span> Head over to the <span className="text-meridian-primary font-bold">Agentic RAG</span> tab to immediately query the newly indexed knowledge.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
