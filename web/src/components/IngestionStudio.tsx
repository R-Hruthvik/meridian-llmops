import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Clock,
  Database,
  Eye,
  FileCheck,
  FileCode,
  FileText,
  FileUp,
  HardDrive,
  Layers,
  Network,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../services/api';
import type { DocumentDetail, DocumentListResponse, DocumentSummary, IngestResponse } from '../types/api';

interface IngestionStudioProps {
  tenantId: string;
}

export const IngestionStudio: React.FC<IngestionStudioProps> = ({ tenantId }) => {
  const [activeTab, setActiveTab] = useState<'catalog' | 'upload'>('catalog');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Catalog State
  const [docList, setDocList] = useState<DocumentListResponse>({
    total_documents: 0,
    total_chunks: 0,
    total_entities: 0,
    documents: [],
  });
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDocDetail, setSelectedDocDetail] = useState<DocumentDetail | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const sampleDoc = `# High-Performance Distributed Caching
The Distributed Cache Layer uses Redis Cluster with multi-region replication.
Cache invalidation is handled via Kafka events emitted by write operations.
Cache hit ratios are tracked in Prometheus and visualized in Grafana dashboards.
`;

  const fetchDocuments = async () => {
    setLoadingDocs(true);
    try {
      const res = await api.getDocuments();
      setDocList(res);
    } catch (err: any) {
      // Handled silently
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

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
      showToast(`Successfully indexed "${title}" with ${res.chunks_indexed} chunks!`);
      setTitle('');
      setText('');
      await fetchDocuments();
      setActiveTab('catalog');
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

  const handleViewDetails = async (doc: DocumentSummary) => {
    try {
      const detail = await api.getDocument(doc.id);
      setSelectedDocDetail(detail);
    } catch (err: any) {
      showToast(err.message || 'Could not load document chunks', 'error');
    }
  };

  const handleDelete = async (docId: string, docTitle: string) => {
    if (!window.confirm(`Are you sure you want to delete "${docTitle}" and all its indexed chunks?`)) {
      return;
    }

    setDeletingId(docId);
    try {
      await api.deleteDocument(docId);
      showToast(`Deleted document "${docTitle}" from knowledge base.`);
      if (selectedDocDetail?.id === docId) {
        setSelectedDocDetail(null);
      }
      await fetchDocuments();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete document', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const filteredDocs = docList.documents.filter(
    (d) =>
      d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.source.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.snippet.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl shadow-2xl text-xs font-bold flex items-center space-x-2 animate-in fade-in slide-in-from-bottom-4 duration-200 ${
            toastMessage.type === 'success'
              ? 'bg-emerald-600 text-white border border-emerald-500'
              : 'bg-rose-600 text-white border border-rose-500'
          }`}
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Top Banner & Overview Statistics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-meridian-border rounded-3xl p-5 shadow-card flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-meridian-textMuted uppercase tracking-wider block mb-1">
              Knowledge Base Documents
            </span>
            <div className="text-2xl font-black text-meridian-text">
              {docList.total_documents}
            </div>
            <span className="text-[10px] font-medium text-emerald-600 flex items-center space-x-1 mt-0.5">
              <HardDrive className="w-3 h-3" />
              <span>Persisted Permanently</span>
            </span>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-meridian-blossom border border-meridian-lavender flex items-center justify-center text-meridian-primary shadow-sm">
            <BookOpen className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-meridian-border rounded-3xl p-5 shadow-card flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-meridian-textMuted uppercase tracking-wider block mb-1">
              Vector Chunks (Qdrant)
            </span>
            <div className="text-2xl font-black text-meridian-text">
              {docList.total_chunks}
            </div>
            <span className="text-[10px] font-medium text-meridian-textMuted mt-0.5 block">
              1024-dim dense embeddings
            </span>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm">
            <Database className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-meridian-border rounded-3xl p-5 shadow-card flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-meridian-textMuted uppercase tracking-wider block mb-1">
              Graph Entities (Neo4j)
            </span>
            <div className="text-2xl font-black text-meridian-text">
              {docList.total_entities}
            </div>
            <span className="text-[10px] font-medium text-meridian-textMuted mt-0.5 block">
              Dual-memory Knowledge Graph
            </span>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 shadow-sm">
            <Network className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-meridian-border rounded-3xl p-5 shadow-card flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-meridian-textMuted uppercase tracking-wider block mb-1">
              Storage Engine
            </span>
            <div className="text-sm font-bold text-meridian-text">
              Dual In-Memory + Disk
            </div>
            <span className="text-[10px] font-medium text-meridian-textMuted mt-0.5 block">
              File: <code className="font-mono text-[9px] bg-meridian-bg px-1 py-0.5 rounded">.meridian_knowledge_base.json</code>
            </span>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm">
            <Layers className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Navigation Tabs Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-meridian-border pb-3">
        <div className="flex space-x-2">
          <button
            onClick={() => setActiveTab('catalog')}
            className={`px-4 py-2 rounded-2xl text-xs font-bold flex items-center space-x-2 transition-all cursor-pointer ${
              activeTab === 'catalog'
                ? 'bg-meridian-primary text-white shadow-glow'
                : 'bg-white text-meridian-textMuted hover:text-meridian-text hover:bg-meridian-bg border border-meridian-border'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Document Catalog ({docList.total_documents})</span>
          </button>

          <button
            onClick={() => setActiveTab('upload')}
            className={`px-4 py-2 rounded-2xl text-xs font-bold flex items-center space-x-2 transition-all cursor-pointer ${
              activeTab === 'upload'
                ? 'bg-meridian-primary text-white shadow-glow'
                : 'bg-white text-meridian-textMuted hover:text-meridian-text hover:bg-meridian-bg border border-meridian-border'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>Ingest New Document</span>
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={fetchDocuments}
            disabled={loadingDocs}
            className="p-2 rounded-xl bg-white border border-meridian-border text-meridian-textMuted hover:text-meridian-primary hover:bg-meridian-bg transition-all text-xs font-semibold flex items-center space-x-1.5 shadow-sm cursor-pointer"
            title="Refresh Knowledge Base"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingDocs ? 'animate-spin text-meridian-primary' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            onClick={async () => {
              try {
                const res = await api.seedSampleDocuments();
                showToast(`Seeded ${res.documents_seeded} sample architecture documents.`);
                await fetchDocuments();
              } catch (err: any) {
                showToast(err.message || 'Failed to seed sample docs', 'error');
              }
            }}
            className="px-3 py-2 rounded-xl bg-white border border-meridian-border text-meridian-textMuted hover:text-meridian-primary hover:bg-meridian-bg transition-all text-xs font-semibold flex items-center space-x-1.5 shadow-sm cursor-pointer"
            title="Seed sample architecture documents"
          >
            <Sparkles className="w-3.5 h-3.5 text-meridian-secondary" />
            <span className="hidden md:inline">Seed Samples</span>
          </button>

          {docList.total_documents > 0 && (
            <button
              onClick={async () => {
                if (!window.confirm('Are you sure you want to delete ALL documents from the Knowledge Base?')) {
                  return;
                }
                try {
                  const res = await api.clearAllDocuments();
                  showToast(`Cleared all ${res.deleted_count} documents from storage.`);
                  await fetchDocuments();
                } catch (err: any) {
                  showToast(err.message || 'Failed to clear documents', 'error');
                }
              }}
              className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 transition-all text-xs font-semibold flex items-center space-x-1.5 shadow-sm cursor-pointer"
              title="Clear entire Knowledge Base"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Clear All</span>
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: Document Catalog View */}
      {activeTab === 'catalog' && (
        <div className="space-y-4">
          {/* Search & Filter Bar */}
          <div className="bg-white border border-meridian-border rounded-3xl p-4 shadow-card flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[260px]">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-meridian-textMuted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search documents by title, source, or content..."
                className="w-full bg-meridian-bg border border-meridian-border rounded-xl pl-9 pr-3.5 py-2 text-xs text-meridian-text outline-none focus:border-meridian-primary focus:bg-white transition-all font-medium"
              />
            </div>
            <div className="text-[11px] font-semibold text-meridian-textMuted">
              Showing {filteredDocs.length} of {docList.total_documents} documents
            </div>
          </div>

          {/* Document Table / Card Grid */}
          {filteredDocs.length === 0 ? (
            <div className="text-center py-16 bg-white border border-dashed border-meridian-border rounded-3xl shadow-card">
              <FileText className="w-10 h-10 mx-auto mb-2 text-meridian-secondary/50" />
              <h4 className="text-sm font-bold text-meridian-text">
                {searchQuery ? 'No matching documents found' : 'No documents in Knowledge Base'}
              </h4>
              <p className="text-xs text-meridian-textMuted mt-1 max-w-md mx-auto">
                {searchQuery
                  ? 'Try searching with different keywords or clear the filter.'
                  : 'Start by ingesting your first document to enable dual-memory search and semantic retrieval.'}
              </p>
              {!searchQuery && (
                <button
                  onClick={() => setActiveTab('upload')}
                  className="mt-4 px-4 py-2 rounded-xl bg-meridian-primary text-white text-xs font-bold shadow-glow hover:bg-meridian-primaryHover transition-all inline-flex items-center space-x-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Ingest Your First Document</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="bg-white border border-meridian-border rounded-3xl p-5 shadow-card hover:shadow-cardHover transition-all flex flex-col justify-between space-y-4 group"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center space-x-2">
                        <span className="w-8 h-8 rounded-xl bg-meridian-blossom border border-meridian-lavender flex items-center justify-center text-meridian-primary font-bold text-[10px] uppercase">
                          {doc.format || 'MD'}
                        </span>
                        <div>
                          <h4 className="text-xs font-bold text-meridian-text group-hover:text-meridian-primary transition-colors line-clamp-1">
                            {doc.title}
                          </h4>
                          <span className="text-[10px] font-medium text-meridian-textMuted flex items-center space-x-1">
                            <Clock className="w-2.5 h-2.5" />
                            <span>
                              {doc.created_at
                                ? new Date(doc.created_at).toLocaleDateString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : 'Pre-seeded'}
                            </span>
                          </span>
                        </div>
                      </div>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-meridian-lavenderLight border border-meridian-border text-meridian-primary uppercase shrink-0">
                        {doc.source}
                      </span>
                    </div>

                    <p className="text-[11px] text-meridian-textMuted leading-relaxed line-clamp-3 bg-meridian-bg/50 p-2.5 rounded-xl border border-meridian-border/60">
                      {doc.snippet}
                    </p>
                  </div>

                  <div className="space-y-3 pt-2 border-t border-meridian-border/60">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-meridian-textMuted">
                      <span className="flex items-center space-x-1">
                        <Database className="w-3 h-3 text-meridian-primary" />
                        <span className="font-bold text-meridian-text">{doc.chunk_count}</span>
                        <span>chunks</span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <Network className="w-3 h-3 text-purple-600" />
                        <span className="font-bold text-meridian-text">{doc.entities_count}</span>
                        <span>entities</span>
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleViewDetails(doc)}
                        className="flex-1 px-3 py-1.5 rounded-xl bg-meridian-lavenderLight hover:bg-meridian-blossom border border-meridian-border text-meridian-primary text-xs font-bold flex items-center justify-center space-x-1.5 transition-all shadow-sm"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Inspect Chunks</span>
                      </button>

                      <button
                        onClick={() => handleDelete(doc.id, doc.title)}
                        disabled={deletingId === doc.id}
                        className="p-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 transition-all text-xs"
                        title="Delete document and chunks"
                      >
                        {deletingId === doc.id ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Upload / Ingest Form View */}
      {activeTab === 'upload' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Input Form (7 cols) */}
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
                  accept=".txt,.md,.markdown,.json,.html,.pdf,.docx"
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                <FileUp className="w-7 h-7 mx-auto mb-1 text-meridian-primary" />
                <p className="text-xs font-bold text-meridian-text">
                  Click or drag file to upload
                </p>
                <p className="text-[11px] text-meridian-textMuted mt-0.5 font-medium">
                  Supports Markdown, Text, HTML, JSON, PDF, DOCX
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
                      <span>Index & Store Permanently</span>
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

          {/* Right: Ingestion Status & Statistics (5 cols) */}
          <div className="lg:col-span-5 space-y-5">
            <div className="bg-white border border-meridian-border rounded-3xl p-6 shadow-card space-y-4">
              <h3 className="text-xs font-bold text-meridian-text flex items-center space-x-1.5">
                <Layers className="w-4 h-4 text-meridian-primary" />
                <span>Dual-Memory Ingestion Pipeline</span>
              </h3>

              {!result ? (
                <div className="text-center py-14 text-meridian-textMuted text-xs border border-dashed border-meridian-border rounded-2xl bg-meridian-bg/50">
                  <FileCode className="w-8 h-8 mx-auto mb-2 text-meridian-secondary/60" />
                  <p className="font-semibold text-meridian-text">Ready for Document Upload</p>
                  <p className="text-[11px] text-meridian-textMuted mt-1 px-4">
                    Uploaded documents are parsed, split by markdown structural headers, embedded as 1024-dim dense vectors, and persisted to disk catalog.
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

                  <button
                    onClick={() => setActiveTab('catalog')}
                    className="w-full py-2.5 rounded-xl bg-meridian-lavenderLight border border-meridian-border text-xs font-bold text-meridian-primary hover:bg-meridian-blossom transition-all flex items-center justify-center space-x-1.5"
                  >
                    <BookOpen className="w-4 h-4" />
                    <span>View in Document Catalog</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Chunk Inspector Modal */}
      {selectedDocDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1E2050]/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white border border-meridian-border rounded-3xl w-full max-w-3xl max-h-[85vh] shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-meridian-border flex items-center justify-between bg-white shrink-0">
              <div>
                <h3 className="text-sm font-bold text-meridian-text flex items-center space-x-2">
                  <Database className="w-4 h-4 text-meridian-primary" />
                  <span>Document Chunk Inspector: {selectedDocDetail.title}</span>
                </h3>
                <p className="text-[11px] text-meridian-textMuted mt-0.5">
                  ID: <code className="font-mono text-[10px]">{selectedDocDetail.id}</code> • {selectedDocDetail.chunks.length} structural chunks • {selectedDocDetail.char_count} characters
                </p>
              </div>
              <button
                onClick={() => setSelectedDocDetail(null)}
                className="p-1.5 rounded-xl text-meridian-textMuted hover:text-meridian-text hover:bg-meridian-bg transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body: Chunk Stream */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1 bg-meridian-bg/40">
              {selectedDocDetail.chunks.map((chunk, idx) => (
                <div
                  key={chunk.id}
                  className="bg-white border border-meridian-border rounded-2xl p-4 shadow-sm space-y-2.5"
                >
                  <div className="flex items-center justify-between text-[11px] font-bold text-meridian-text">
                    <span className="px-2.5 py-0.5 rounded-full bg-meridian-lavenderLight text-meridian-primary border border-meridian-border">
                      Chunk #{idx + 1}
                    </span>
                    {chunk.section_heading && (
                      <span className="text-meridian-textMuted font-mono text-[10px]">
                        Section: {chunk.section_heading}
                      </span>
                    )}
                    <span className="text-[10px] text-meridian-textMuted font-mono">
                      ID: {chunk.id.slice(0, 8)}...
                    </span>
                  </div>

                  <div className="p-3 bg-meridian-bg rounded-xl border border-meridian-border/60 text-xs font-mono text-meridian-text whitespace-pre-wrap leading-relaxed">
                    {chunk.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-meridian-border flex justify-end bg-white shrink-0">
              <button
                onClick={() => setSelectedDocDetail(null)}
                className="px-5 py-2 rounded-xl bg-meridian-primary text-white text-xs font-bold shadow-glow hover:bg-meridian-primaryHover transition-all"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
