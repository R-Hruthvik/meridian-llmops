import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Database,
  Eye,
  FileCheck,
  FileCode,
  FileText,
  FileUp,
  Layers,
  Plus,
  Quote,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { StatusChip } from './StatusChip';
import { api } from '../services/api';
import type { DocumentDetail, DocumentListResponse, DocumentSummary, IngestResponse } from '../types/api';

interface IngestionStudioProps {
  tenantId: string;
  /** The document an answer cited, opened here from the Ask spine. */
  focusedDocumentId?: string | null;
  /** The specific chunk within that document. */
  focusedChunkId?: string | null;
  /** Called when the user dismisses the citation focus. */
  onDismissFocus?: () => void;
}

const SAMPLE_DOC = `# High-Performance Distributed Caching
The Distributed Cache Layer uses Redis Cluster with multi-region replication.
Cache invalidation is handled via Kafka events emitted by write operations.
Cache hit ratios are tracked in Prometheus and visualized in Grafana dashboards.
`;

/** §9 — one cell of a dense readout strip: label on top, value in mono below. */
const Readout: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div data-slot="readout" className="border-l border-hairline pl-3 first:border-l-0 first:pl-0">
    <div className="label-section text-faint">{label}</div>
    <div className="num text-readout font-semibold text-ink">{value}</div>
  </div>
);

export const isBinaryLike = (content: string): boolean => {
  if (!content) return false;
  if (content.includes('\0')) return true;
  if (content.startsWith('%PDF') || content.startsWith('PK')) return true;
  // FileReader.readAsText on PDF/DOCX often yields garble without NUL:
  // flag a high non-printable / replacement-char ratio in the head sample.
  const sample = content.slice(0, 4000);
  let bad = 0;
  for (const ch of sample) {
    const code = ch.charCodeAt(0);
    if (ch === '�' || code < 9 || (code >= 14 && code < 32) || code === 127) bad++;
  }
  return sample.length > 0 && bad / sample.length > 0.1;
};

export const IngestionStudio: React.FC<IngestionStudioProps> = ({
  tenantId,
  focusedDocumentId = null,
  focusedChunkId = null,
  onDismissFocus,
}) => {
  const [activeTab, setActiveTab] = useState<'catalog' | 'upload'>('catalog');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileWarning, setFileWarning] = useState<string | null>(null);

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
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [focusError, setFocusError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const focusedDocRef = useRef<HTMLElement | null>(null);
  const focusedChunkRef = useRef<HTMLElement | null>(null);

  // The citation markers now live on table rows / chunk rows, so the refs are
  // typed as plain elements and attached through stable callbacks.
  const attachFocusedDoc = useCallback((el: HTMLElement | null) => {
    focusedDocRef.current = el;
  }, []);
  const attachFocusedChunk = useCallback((el: HTMLElement | null) => {
    focusedChunkRef.current = el;
  }, []);

  const fetchDocuments = async (retry = true) => {
    setLoadingDocs(true);
    setCatalogError(null);
    try {
      const res = await api.getDocuments(tenantId);
      setDocList(res);
    } catch (err: unknown) {
      // Backend may still be booting — retry the initial load once before giving up
      if (retry) {
        setTimeout(() => {
          void fetchDocuments(false);
        }, 2000);
      } else {
        const msg = err instanceof Error ? err.message : 'Failed to load document catalog';
        setCatalogError(msg);
      }
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [tenantId]);

  // Citation drill-through: when the Ask spine hands us a document, reveal it
  // in the catalog and expand it, with the cited chunk highlighted.
  useEffect(() => {
    if (!focusedDocumentId) return;
    // A stale search filter must not hide the document we were sent to.
    setActiveTab('catalog');
    setSearchQuery('');

    let cancelled = false;
    const open = async () => {
      try {
        const detail = await api.getDocument(focusedDocumentId, tenantId);
        if (cancelled) return;
        setSelectedDocDetail(detail);
        setFocusError(null);
      } catch (err: unknown) {
        if (cancelled) return;
        setFocusError(
          err instanceof Error ? err.message : 'Could not load the cited document'
        );
      }
    };
    void open();
    return () => {
      cancelled = true;
    };
  }, [focusedDocumentId, tenantId]);

  // Bring the cited document/chunk into view once it is on screen.
  useEffect(() => {
    if (!focusedDocumentId && !focusedChunkId) return;
    focusedDocRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    focusedChunkRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [focusedDocumentId, focusedChunkId, selectedDocDetail]);

  const handleDismissFocus = () => {
    onDismissFocus?.();
    setFocusError(null);
    if (selectedDocDetail?.id === focusedDocumentId) {
      setSelectedDocDetail(null);
    }
  };

  // Citation focus is one-shot. Every close path runs through here so the
  // App-level focus is consumed too — otherwise the B5 lazy-mount re-runs the
  // drill-through effect and pops the inspector open on every Corpus visit.
  const closeInspector = useCallback(() => {
    setSelectedDocDetail(null);
    setFocusError(null);
    onDismissFocus?.();
  }, [onDismissFocus]);

  // Escape key handler for Chunk Inspector Modal
  useEffect(() => {
    if (!selectedDocDetail) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeInspector();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDocDetail, closeInspector]);

  const showToast = (toastText: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text: toastText, type });
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ingestion failed';
      setError(msg);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileWarning(null);
    setTitle(file.name.replace(/\.[^/.]+$/, ''));
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = (event.target?.result as string) || '';
      // Backend /v1/ingest accepts text JSON only (no file endpoint) —
      // binary files (PDF/DOCX) read as text garble. Warn when content
      // looks binary so the user pastes extracted text instead.
      if (isBinaryLike(content)) {
        setFileWarning(
          `"${file.name}" looks like a binary file (PDF/DOCX are not supported). The ingest API accepts text only — please paste extracted text instead.`,
        );
      }
      setText(content);
    };
    reader.readAsText(file);
  };

  const handleViewDetails = async (doc: DocumentSummary) => {
    try {
      const detail = await api.getDocument(doc.id, tenantId);
      setSelectedDocDetail(detail);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not load document chunks';
      showToast(msg, 'error');
    }
  };

  const handleDelete = async (docId: string, docTitle: string) => {
    if (!window.confirm(`Are you sure you want to delete "${docTitle}" and all its indexed chunks?`)) {
      return;
    }

    setDeletingId(docId);
    try {
      await api.deleteDocument(docId, tenantId);
      showToast(`Deleted document "${docTitle}" from knowledge base.`);
      if (selectedDocDetail?.id === docId) {
        setSelectedDocDetail(null);
      }
      await fetchDocuments();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete document';
      showToast(msg, 'error');
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
    <div className="flex flex-col gap-4">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="alert"
          aria-live="polite"
          className={`fixed bottom-6 right-6 z-[60] flex items-center gap-2 rounded px-3 py-2 text-label font-semibold shadow-overlay ${
            toastMessage.type === 'success'
              ? 'border border-hairline bg-ok-wash text-ok'
              : 'border border-hairline bg-fail-wash text-fail'
          }`}
        >
          <CheckCircle2 className="size-3.5" />
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Citation focus banner — explains why this document is open and how to leave it */}
      {focusedDocumentId && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-hairline bg-accent-wash px-3 py-2"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Quote className="size-3.5 shrink-0 text-accent-ink" />
            <p className="min-w-0 truncate text-label font-semibold text-ink">
              Opened from a citation
              {focusedChunkId ? (
                <>
                  {' '}— chunk <span className="id-mono text-accent-ink">{focusedChunkId}</span>
                </>
              ) : null}{' '}
              of document{' '}
              <span className="id-mono text-accent-ink">{focusedDocumentId}</span>
            </p>
          </div>
          <button
            onClick={handleDismissFocus}
            aria-label="Dismiss source focus"
            className="rounded-sm border border-hairline bg-surface-raised px-2.5 py-1 text-label font-semibold text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Dismiss
          </button>
        </div>
      )}

      {focusError && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded border border-hairline bg-fail-wash p-3 text-label text-fail"
        >
          {focusError}
        </div>
      )}

      {/* §4/§9 readout strip — replaces the four stat cards */}
      <div
        data-testid="corpus-readout-strip"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-hairline bg-surface-raised px-3 py-2"
      >
        <h2 className="label-section text-muted">Corpus Readout</h2>
        <Readout label="Documents" value={docList.total_documents.toLocaleString()} />
        <Readout label="Chunks" value={docList.total_chunks.toLocaleString()} />
        <Readout label="Entities" value={docList.total_entities.toLocaleString()} />
        <p className="ml-auto text-micro text-faint">
          Dual in-memory + disk ·{' '}
          <span className="id-mono">.meridian_knowledge_base.json</span>
        </p>
      </div>

      {/* Navigation Tabs Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-2">
        <div role="tablist" aria-label="Ingestion Studio Navigation" className="flex items-center gap-1">
          <button
            role="tab"
            aria-selected={activeTab === 'catalog'}
            onClick={() => setActiveTab('catalog')}
            className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-label font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              activeTab === 'catalog'
                ? 'bg-accent-wash text-accent-ink'
                : 'text-muted hover:bg-surface-sunken hover:text-ink'
            }`}
          >
            <BookOpen className="size-3.5" />
            <span>Document Catalog</span>
            <span className="num text-micro text-faint">
              <span className="sr-only">document count </span>
              {docList.total_documents}
            </span>
          </button>

          <button
            role="tab"
            aria-selected={activeTab === 'upload'}
            onClick={() => setActiveTab('upload')}
            className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-label font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              activeTab === 'upload'
                ? 'bg-accent-wash text-accent-ink'
                : 'text-muted hover:bg-surface-sunken hover:text-ink'
            }`}
          >
            <Plus className="size-3.5" />
            <span>Ingest New Document</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void fetchDocuments(false)}
            disabled={loadingDocs}
            aria-label="Refresh document catalog"
            className="flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-raised px-2.5 py-1 text-label text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            title="Refresh Knowledge Base"
          >
            <RefreshCw className={`size-3.5 ${loadingDocs ? 'animate-spin text-accent-ink' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            onClick={async () => {
              try {
                const res = await api.seedSampleDocuments(tenantId);
                showToast(`Seeded ${res.documents_seeded} sample architecture documents.`);
                await fetchDocuments();
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Failed to seed sample docs';
                showToast(msg, 'error');
              }
            }}
            className="flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-raised px-2.5 py-1 text-label text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title="Seed sample architecture documents"
          >
            <Sparkles className="size-3.5" />
            <span className="hidden md:inline">Seed Samples</span>
          </button>

          {docList.total_documents > 0 && (
            <button
              onClick={async () => {
                if (!window.confirm('Are you sure you want to delete ALL documents from the Knowledge Base?')) {
                  return;
                }
                try {
                  const res = await api.clearAllDocuments(tenantId);
                  showToast(`Cleared all ${res.deleted_count} documents from storage.`);
                  await fetchDocuments();
                } catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : 'Failed to clear documents';
                  showToast(msg, 'error');
                }
              }}
              className="flex items-center gap-1.5 rounded-sm border border-hairline bg-fail-wash px-2.5 py-1 text-label text-fail transition-colors hover:border-fail focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              title="Clear entire Knowledge Base"
            >
              <Trash2 className="size-3.5" />
              <span className="hidden md:inline">Clear All</span>
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: Document Catalog View */}
      {activeTab === 'catalog' && (
        <div className="flex flex-col gap-3">
          {/* Search & Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search documents by title, source, or content..."
                aria-label="Search documents catalog"
                className="w-full rounded-sm border border-hairline bg-surface py-1.5 pl-8 pr-2.5 text-body text-ink outline-none transition-colors placeholder:text-faint focus:border-hairline-strong focus:bg-surface-raised focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="num text-micro text-muted">
                <span className="sr-only">showing </span>
                {filteredDocs.length} <span className="text-faint">of</span> {docList.total_documents}{' '}
                <span className="font-sans text-faint">documents</span>
              </span>
              <span
                className="rounded-pill bg-surface-sunken px-2 py-0.5 text-micro font-semibold text-muted"
                title="The document catalog is shared across tenants"
              >
                Global
              </span>
            </div>
          </div>

          {catalogError && (
            <div
              role="alert"
              aria-live="polite"
              className="rounded border border-hairline bg-fail-wash p-3 text-label text-fail"
            >
              {catalogError}
            </div>
          )}

          {/* Document catalog — §8 table language, matching the chunk table */}
          {filteredDocs.length === 0 ? (
            <div className="rounded border border-dashed border-hairline px-3 py-10 text-center">
              <FileText className="mx-auto mb-2 size-6 text-faint" />
              <h3 className="text-body font-semibold text-ink">
                {searchQuery ? 'No matching documents found' : 'No documents in Knowledge Base'}
              </h3>
              <p className="mx-auto mt-1 max-w-md text-micro text-muted">
                {searchQuery
                  ? 'Try searching with different keywords or reset your filter.'
                  : 'Start by ingesting your first document to enable dual-memory search and semantic retrieval.'}
              </p>
              {searchQuery ? (
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 text-label font-semibold text-ink transition-colors hover:bg-accent-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <RefreshCw className="size-3.5" />
                  <span>Reset Search</span>
                </button>
              ) : (
                <button
                  onClick={() => setActiveTab('upload')}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-label font-semibold text-white transition-colors hover:bg-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Plus className="size-3.5" />
                  <span>Ingest Your First Document</span>
                </button>
              )}
            </div>
          ) : (
            <div className="rounded border border-hairline bg-surface-raised">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Indexed documents with chunk, entity and relationship counts</caption>
                <thead>
                  <tr className="border-b border-hairline-strong">
                    <th scope="col" className="label-section w-8 px-3 py-1.5 font-normal text-faint">
                      #
                    </th>
                    <th scope="col" className="label-section px-2 py-1.5 font-normal text-faint">
                      TITLE
                    </th>
                    <th
                      scope="col"
                      className="label-section w-16 px-2 py-1.5 text-right font-normal text-faint"
                    >
                      CHUNKS
                    </th>
                    <th
                      scope="col"
                      className="label-section w-14 px-2 py-1.5 text-right font-normal text-faint"
                    >
                      ENTS
                    </th>
                    <th
                      scope="col"
                      className="label-section w-14 px-2 py-1.5 text-right font-normal text-faint"
                    >
                      RELS
                    </th>
                    <th scope="col" className="label-section w-24 px-2 py-1.5 font-normal text-faint">
                      SOURCE
                    </th>
                    <th scope="col" className="label-section w-16 px-2 py-1.5 font-normal text-faint">
                      FORMAT
                    </th>
                    <th scope="col" className="label-section w-32 px-2 py-1.5 font-normal text-faint">
                      ADDED
                    </th>
                    <th scope="col" className="label-section w-24 px-3 py-1.5 text-right font-normal text-faint">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocs.map((doc, idx) => {
                    const added = doc.created_at
                      ? new Date(doc.created_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : 'Pre-seeded';
                    return (
                      <tr
                        key={doc.id}
                        ref={doc.id === focusedDocumentId ? attachFocusedDoc : undefined}
                        data-focused-document={doc.id === focusedDocumentId ? doc.id : undefined}
                        className={`group border-b border-hairline last:border-b-0 hover:bg-accent-wash ${
                          doc.id === focusedDocumentId ? 'bg-accent-wash' : ''
                        }`}
                      >
                        <td className="border-l-2 border-transparent px-3 py-1.5 group-hover:border-accent">
                          <span className="num text-micro text-faint">{idx + 1}</span>
                        </td>
                        <td className="max-w-[220px] px-2 py-1.5">
                          <div className="truncate text-body font-semibold text-ink" title={doc.title}>
                            {doc.title}
                          </div>
                          <div className="truncate text-micro text-faint" title={doc.snippet}>
                            {doc.snippet}
                          </div>
                        </td>
                        <td className="num px-2 py-1.5 text-right text-readout font-semibold text-ink">
                          {doc.chunk_count.toLocaleString()}
                        </td>
                        <td className="num px-2 py-1.5 text-right text-readout text-muted">
                          {doc.entities_count.toLocaleString()}
                        </td>
                        <td className="num px-2 py-1.5 text-right text-readout text-muted">
                          {doc.relationships_count.toLocaleString()}
                        </td>
                        <td className="id-mono truncate px-2 text-muted" title={doc.source}>
                          {doc.source}
                        </td>
                        <td className="id-mono truncate px-2 text-muted">{doc.format || 'MD'}</td>
                        <td className="id-mono truncate px-2 text-faint" title={doc.created_at ?? undefined}>
                          {added}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleViewDetails(doc)}
                              className="flex items-center gap-1.5 rounded-sm border border-hairline px-2 py-1 text-label font-semibold text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                              <Eye className="size-3.5" />
                              <span>Inspect Chunks</span>
                            </button>
                            <button
                              onClick={() => handleDelete(doc.id, doc.title)}
                              disabled={deletingId === doc.id}
                              aria-label={`Delete ${doc.title}`}
                              className="rounded-sm border border-hairline p-1.5 text-fail transition-colors hover:bg-fail-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                              title="Delete document and chunks"
                            >
                              {deletingId === doc.id ? (
                                <RefreshCw className="size-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="size-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Upload / Ingest Form View */}
      {activeTab === 'upload' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Left: Input Form (7 cols) */}
          <div className="flex flex-col gap-4 lg:col-span-7">
            <div className="flex flex-col gap-3 rounded border border-hairline bg-surface-raised p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="label-section flex items-center gap-1.5 text-muted">
                  <Database className="size-3.5" />
                  <span>Document Ingestion &amp; Structural Chunking</span>
                </h3>
                <button
                  disabled={loading}
                  onClick={() => {
                    setTitle('Distributed Caching Architecture');
                    setText(SAMPLE_DOC);
                  }}
                  className="flex items-center gap-1.5 rounded-sm border border-hairline px-2.5 py-1 text-label font-semibold text-ink transition-colors hover:bg-accent-wash disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Sparkles className="size-3.5" />
                  <span>Load Sample Doc</span>
                </button>
              </div>

              {/* Document Title */}
              <div>
                <label htmlFor="doc-title-input" className="label-section mb-1 block text-muted">
                  Document Title
                </label>
                <input
                  id="doc-title-input"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Enterprise Security Policy 2026"
                  className="w-full rounded-sm border border-hairline bg-surface px-3 py-1.5 text-body text-ink outline-none transition-colors placeholder:text-faint focus:border-hairline-strong focus:bg-surface-raised focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              {/* File Upload Trigger */}
              <div className="relative rounded-sm border border-dashed border-hairline-strong bg-surface p-5 text-center transition-colors hover:bg-accent-wash">
                <input
                  type="file"
                  onChange={handleFileUpload}
                  disabled={loading}
                  accept=".txt,.md,.markdown,.json,.html,.csv,.yaml,.yml,.xml,.log,text/plain,text/markdown,text/html,application/json"
                  aria-label="Upload document file"
                  className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                />
                <FileUp className="mx-auto mb-1 size-5 text-accent-ink" />
                <p className="text-body font-semibold text-ink">Click or drag file to upload</p>
                <p className="mt-0.5 text-micro text-muted">
                  Text only: Markdown, Text, HTML, JSON, CSV, YAML (binary PDF/DOCX are not supported)
                </p>
                {fileWarning && (
                  <p
                    role="alert"
                    className="mt-2 rounded-sm border border-hairline bg-warn-wash px-2.5 py-1.5 text-micro font-semibold text-warn"
                  >
                    {fileWarning}
                  </p>
                )}
              </div>

              {/* Document Body Textarea */}
              <div>
                <label htmlFor="doc-body-input" className="label-section mb-1 block text-muted">
                  Document Content (Markdown / Text)
                </label>
                <textarea
                  id="doc-body-input"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste or write structured documentation with # headings, sections, and paragraphs..."
                  className="h-48 w-full resize-none rounded-sm border border-hairline bg-surface-sunken p-3 text-body text-ink outline-none transition-colors placeholder:text-faint focus:border-hairline-strong focus:bg-surface-raised focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              {/* Action Button */}
              <div className="flex justify-end pt-1">
                <button
                  onClick={handleIngest}
                  disabled={loading || !text.trim() || !title.trim()}
                  className="flex items-center gap-2 rounded bg-accent px-4 py-1.5 text-label font-bold text-white transition-colors hover:bg-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="size-3.5 animate-spin" />
                      <span>Processing &amp; Indexing...</span>
                    </>
                  ) : (
                    <>
                      <FileCheck className="size-3.5" />
                      <span>Index &amp; Store Permanently</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                aria-live="polite"
                className="rounded border border-hairline bg-fail-wash p-3 text-label text-fail"
              >
                {error}
              </div>
            )}
          </div>

          {/* Right: Ingestion Status & Statistics (5 cols) */}
          <div className="flex flex-col gap-4 lg:col-span-5">
            <div className="flex flex-col gap-3 rounded border border-hairline bg-surface-raised p-4">
              <h3 className="label-section flex items-center gap-1.5 text-muted">
                <Layers className="size-3.5" />
                <span>Dual-Memory Ingestion Pipeline</span>
              </h3>

              {loading ? (
                <div className="animate-pulse rounded-sm border border-hairline bg-surface p-4 text-center">
                  <RefreshCw className="mx-auto size-5 animate-spin text-accent-ink" />
                  <p className="text-body font-semibold text-ink">Parsing &amp; Splitting Document Chunks...</p>
                  <p className="mt-0.5 text-micro text-muted">
                    Generating dense vector embeddings &amp; extracting Neo4j entities
                  </p>
                </div>
              ) : !result ? (
                <div className="rounded-sm border border-dashed border-hairline bg-surface px-3 py-8 text-center">
                  <FileCode className="mx-auto mb-2 size-6 text-faint" />
                  <p className="text-body font-semibold text-ink">Ready for Document Upload</p>
                  <p className="mx-auto mt-1 max-w-sm text-micro text-muted">
                    Uploaded documents are parsed, split by markdown structural headers, embedded as 1024-dim
                    dense vectors, and persisted to disk catalog.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-2.5 rounded-sm border border-hairline bg-ok-wash p-3">
                    <StatusChip variant="ok">Indexed</StatusChip>
                    <div className="min-w-0">
                      <p className="text-label font-bold text-ink">Ingestion Successfully Completed</p>
                      <p className="mt-0.5 text-micro text-muted">
                        Doc ID: <span className="id-mono text-ink">{result.document_id}</span>
                      </p>
                      {result.filename && (
                        <p className="mt-0.5 text-micro text-muted">
                          File: <span className="id-mono text-ink">{result.filename}</span>
                        </p>
                      )}
                      {result.created_at && (
                        <p className="mt-0.5 text-micro text-muted">
                          Created:{' '}
                          <span className="num">{new Date(result.created_at).toLocaleString()}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Statistics Breakdown */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sm border border-hairline bg-surface px-3 py-2">
                    <Readout label="Qdrant Vectors" value={result.chunks_indexed.toLocaleString()} />
                    <Readout label="Neo4j Entities" value={result.entities_extracted.toLocaleString()} />
                    <Readout
                      label="Relationships"
                      value={result.relationships_extracted.toLocaleString()}
                    />
                  </div>

                  <button
                    onClick={() => setActiveTab('catalog')}
                    className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-label font-semibold text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <BookOpen className="size-3.5" />
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
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(22,21,15,0.32)] p-4"
          onClick={closeInspector}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="chunk-inspector-modal-title"
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded border border-hairline bg-surface-raised shadow-overlay"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-2.5">
              <div className="min-w-0 flex-1 pr-4">
                <h3 id="chunk-inspector-modal-title" className="flex items-center gap-1.5 text-body font-bold text-ink">
                  <FileText className="size-3.5 shrink-0 text-accent-ink" />
                  <span className="truncate">
                    Document Chunk Inspector: {selectedDocDetail.title}
                  </span>
                </h3>
                <p className="mt-0.5 text-micro text-muted">
                  <span className="id-mono">{selectedDocDetail.id}</span>
                  <span className="text-faint"> · </span>
                  <span className="num">{selectedDocDetail.chunks.length}</span>{' '}
                  <span>structural chunks</span>
                  <span className="text-faint"> · </span>
                  <span className="num">{selectedDocDetail.char_count.toLocaleString()}</span>{' '}
                  <span>characters</span>
                </p>
              </div>
              <button
                onClick={closeInspector}
                aria-label="Close Chunk Inspector"
                className="shrink-0 rounded-sm p-1.5 text-muted transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                title="Close Inspector"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Modal Body: chunk rows */}
            <div className="flex-1 overflow-y-auto">
              {selectedDocDetail.chunks.map((chunk, idx) => (
                <div
                  key={chunk.id}
                  ref={chunk.id === focusedChunkId ? attachFocusedChunk : undefined}
                  data-focused-chunk={chunk.id === focusedChunkId ? chunk.id : undefined}
                  className={`border-b border-hairline px-4 py-2.5 last:border-b-0 ${
                    chunk.id === focusedChunkId ? 'bg-accent-wash' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="num text-micro font-semibold text-faint">
                      #{idx + 1}
                    </span>
                    {chunk.section_heading && (
                      <span
                        className="truncate text-label font-semibold text-ink"
                        title={chunk.section_heading}
                      >
                        {chunk.section_heading}
                      </span>
                    )}
                    <span className="id-mono shrink-0 text-faint" title={chunk.id}>
                      {chunk.id.slice(0, 8)}…
                    </span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap rounded-sm border border-hairline bg-surface-sunken p-2.5 text-body text-ink">
                    {chunk.text}
                  </p>
                </div>
              ))}
            </div>

            {/* Modal Footer (Streamlined single close section) */}
            <div className="flex shrink-0 items-center justify-between border-t border-hairline px-4 py-2">
              <span className="text-micro text-muted">
                <span className="num text-ink">{selectedDocDetail.chunks.length}</span> structural chunks
                from vector store
              </span>
              <button
                onClick={closeInspector}
                className="rounded-sm border border-hairline px-3 py-1 text-label font-semibold text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
