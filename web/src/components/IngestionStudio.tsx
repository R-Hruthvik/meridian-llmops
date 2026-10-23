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
import type {
  DocumentDetail,
  DocumentListResponse,
  DocumentSummary,
  DocumentUploadResponse,
  IngestResponse,
} from '../types/api';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

/** Compact processing statistics shown after a document has been indexed. */
const Readout: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div data-slot="readout" className="border-l border-hairline pl-3 first:border-l-0 first:pl-0">
    <div className="label-section text-faint">{label}</div>
    <div className="num text-readout font-semibold text-ink">{value}</div>
  </div>
);

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
  const [uploadResult, setUploadResult] = useState<DocumentUploadResponse | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
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
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [focusError, setFocusError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const focusedDocRef = useRef<HTMLElement | null>(null);
  const focusedChunkRef = useRef<HTMLElement | null>(null);
  const inspectorRef = useRef<HTMLDivElement | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The citation markers now live on table rows / chunk rows, so the refs are
  // typed as plain elements and attached through stable callbacks.
  const attachFocusedDoc = useCallback((el: HTMLElement | null) => {
    focusedDocRef.current = el;
  }, []);
  const attachFocusedChunk = useCallback((el: HTMLElement | null) => {
    focusedChunkRef.current = el;
  }, []);

  const fetchDocuments = useCallback(async (retry = true) => {
    setLoadingDocs(true);
    setCatalogError(null);
    try {
      const res = await api.getDocuments(tenantId);
      setDocList(res);
    } catch (err: unknown) {
      // Backend may still be booting — retry the initial load once before giving up
      if (retry) {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          void fetchDocuments(false);
        }, 2000);
      } else {
        const msg = err instanceof Error ? err.message : 'Failed to load document catalog';
        setCatalogError(msg);
      }
    } finally {
      setLoadingDocs(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void fetchDocuments();
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [fetchDocuments]);

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

  // Focus trap + restoration for Chunk Inspector Modal
  useEffect(() => {
    if (!selectedDocDetail) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = inspectorRef.current;
    panel?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeInspector();
        return;
      }
      if (e.key !== 'Tab') return;
      const p = inspectorRef.current;
      if (!p) return;
      const focusables = Array.from(p.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === p)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [selectedDocDetail, closeInspector]);

  const showToast = (toastText: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text: toastText, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 3500);
  };

  const handleIngest = async () => {
    if (selectedFiles.length > 0) {
      setLoading(true);
      setError(null);
      setResult(null);
      setUploadResult(null);
      try {
        const response = await api.uploadDocuments(selectedFiles, tenantId);
        setUploadResult(response);
        const indexedCount = response.results.filter(
          (item) => item.status === 'indexed' || item.status === 'indexed_with_warnings',
        ).length;
        showToast(`Processed ${response.results.length} files; ${indexedCount} indexed.`);
        setSelectedFiles([]);
        await fetchDocuments();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Document upload failed';
        setError(msg);
      } finally {
        setLoading(false);
      }
      return;
    }

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
      setUploadResult(null);
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

  const handleFileSelection = (files: FileList | null) => {
    if (!files?.length) return;
    setSelectedFiles(Array.from(files));
    setResult(null);
    setUploadResult(null);
    setError(null);
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
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
          <button type="button"
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

      <header className="flex flex-col gap-3 border-b border-hairline pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-normal tracking-tight text-ink sm:text-4xl">
            {activeTab === 'catalog' ? 'Sources' : 'Add sources'}
          </h1>
          <p className="mt-2 max-w-2xl text-body leading-relaxed text-muted">
            {activeTab === 'catalog'
              ? 'Documents Meridian can use to answer your questions.'
              : 'Upload files or add text documents to your source library.'}
          </p>
        </div>
        {activeTab === 'upload' && (
          <button
            type="button"
            onClick={() => setActiveTab('catalog')}
            className="self-start rounded-sm px-2 py-2 text-label font-semibold text-accent-ink hover:bg-accent-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:self-auto"
          >
            Back to sources
          </button>
        )}
      </header>

      {/* Sources catalog */}
      {activeTab === 'catalog' && (
        <div className="flex flex-col gap-3">
          {/* Search & Filter Bar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, source, or content"
                aria-label="Search sources"
                className="w-full rounded-sm border border-hairline bg-surface-raised py-2.5 pl-9 pr-3 text-body text-ink outline-none transition-colors placeholder:text-faint focus:border-hairline-strong focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('upload')}
                className="flex min-h-10 items-center justify-center gap-2 rounded-sm bg-accent px-4 text-label font-semibold text-white transition-colors hover:bg-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                <Plus className="size-4" aria-hidden="true" />
                Add sources
              </button>
              <span className="num px-1 text-micro text-muted">
                <span className="sr-only">showing </span>
                {filteredDocs.length} <span className="text-faint">of</span> {docList.total_documents}{' '}
                <span className="font-sans text-faint">documents</span>
              </span>
              <button
                type="button"
                onClick={() => void fetchDocuments(false)}
                disabled={loadingDocs}
                aria-label="Refresh sources"
                className="flex size-10 items-center justify-center rounded-sm border border-hairline bg-surface-raised text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                title="Refresh sources"
              >
                <RefreshCw className={`size-4 ${loadingDocs ? 'animate-spin text-accent-ink' : ''}`} />
              </button>
              <details className="relative">
                <summary className="flex min-h-10 cursor-pointer list-none items-center rounded-sm px-2 text-label font-semibold text-muted hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  More
                </summary>
                <div className="absolute right-0 top-full z-10 mt-1 flex min-w-40 flex-col rounded-sm border border-hairline bg-surface-raised p-1 shadow-overlay">
                  <button
                    type="button"
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
                    className="flex min-h-10 items-center gap-2 rounded-sm px-2 text-left text-label text-ink hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Sparkles className="size-3.5" /> Seed samples
                  </button>
                  {docList.total_documents > 0 && (
                    <button
                      type="button"
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
                      className="flex min-h-10 items-center gap-2 rounded-sm px-2 text-left text-label text-fail hover:bg-fail-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Trash2 className="size-3.5" /> Clear all sources
                    </button>
                  )}
                </div>
              </details>
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
          {loadingDocs && docList.documents.length === 0 ? (
            <div role="status" aria-live="polite" className="rounded border border-hairline bg-surface-raised px-3 py-10 text-center text-label font-semibold text-muted">
              Loading sources…
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="rounded border border-dashed border-hairline px-3 py-10 text-center">
              <FileText className="mx-auto mb-2 size-6 text-faint" />
              <h3 className="text-body font-semibold text-ink">
                {searchQuery ? 'No sources match your search' : 'No sources yet'}
              </h3>
              <p className="mx-auto mt-1 max-w-md text-micro text-muted">
                {searchQuery
                  ? 'Try another search or clear the search field.'
                  : 'Add a document to let Meridian answer from your material.'}
              </p>
              {searchQuery ? (
                <button type="button"
                  onClick={() => setSearchQuery('')}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 text-label font-semibold text-ink transition-colors hover:bg-accent-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <RefreshCw className="size-3.5" />
                  <span>Clear search</span>
                </button>
              ) : null}
            </div>
          ) : (
            <div className="overflow-x-auto rounded border border-hairline bg-surface-raised" tabIndex={0} aria-label="Sources table; scroll horizontally for more details">
              <table className="w-full min-w-full border-collapse text-left sm:min-w-[640px]">
                <caption className="sr-only">Indexed documents with chunk, entity and relationship counts</caption>
                <thead>
                  <tr className="border-b border-hairline-strong">
                    <th scope="col" className="label-section hidden w-8 px-3 py-1.5 font-normal text-faint sm:table-cell">
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
                      className="label-section hidden w-14 px-2 py-1.5 text-right font-normal text-faint md:table-cell"
                    >
                      ENTS
                    </th>
                    <th
                      scope="col"
                      className="label-section hidden w-14 px-2 py-1.5 text-right font-normal text-faint md:table-cell"
                    >
                      RELS
                    </th>
                    <th scope="col" className="label-section hidden w-24 px-2 py-1.5 font-normal text-faint md:table-cell">
                      SOURCE
                    </th>
                    <th scope="col" className="label-section hidden w-16 px-2 py-1.5 font-normal text-faint md:table-cell">
                      FORMAT
                    </th>
                    <th scope="col" className="label-section hidden w-32 px-2 py-1.5 font-normal text-faint md:table-cell">
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
                        <td className="hidden border-l-2 border-transparent px-3 py-1.5 group-hover:border-accent sm:table-cell">
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
                        <td className="num hidden px-2 py-1.5 text-right text-readout text-muted md:table-cell">
                          {doc.entities_count.toLocaleString()}
                        </td>
                        <td className="num hidden px-2 py-1.5 text-right text-readout text-muted md:table-cell">
                          {doc.relationships_count.toLocaleString()}
                        </td>
                        <td className="id-mono hidden truncate px-2 text-muted md:table-cell" title={doc.source}>
                          {doc.source}
                        </td>
                        <td className="id-mono hidden truncate px-2 text-muted md:table-cell">{doc.format || 'MD'}</td>
                        <td className="id-mono hidden truncate px-2 text-faint md:table-cell" title={doc.created_at ?? undefined}>
                          {added}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <button type="button"
                              onClick={() => handleViewDetails(doc)}
                              className="flex items-center gap-1.5 rounded-sm border border-hairline px-2 py-1 text-label font-semibold text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                              <Eye className="size-3.5" />
                              <span className="hidden sm:inline">Inspect chunks</span>
                            </button>
                            <button type="button"
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
                <button type="button"
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
              <div
                className="relative rounded-sm border border-dashed border-hairline-strong bg-surface p-5 text-center transition-colors hover:bg-accent-wash"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  handleFileSelection(event.dataTransfer.files);
                }}
              >
                <input
                  type="file"
                  onChange={(event) => handleFileSelection(event.target.files)}
                  multiple
                  disabled={loading}
                  accept=".md,.txt,.pdf,.docx,.html"
                  aria-label="Upload document file"
                  className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                />
                <FileUp className="mx-auto mb-1 size-5 text-accent-ink" />
                <p className="text-body font-semibold text-ink">Click or drag files to upload</p>
                <p className="mt-0.5 text-micro text-muted">
                  Markdown, Text, PDF, DOCX, and HTML files
                </p>
                {selectedFiles.length > 0 && (
                  <ul aria-label="Selected files" className="mt-2 text-left text-micro text-muted">
                    {selectedFiles.map((file, index) => (
                      <li key={`${file.name}-${index}`} className="truncate">{file.name}</li>
                    ))}
                  </ul>
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
                <button type="button"
                  onClick={handleIngest}
                  disabled={loading || (!selectedFiles.length && (!text.trim() || !title.trim()))}
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
                      <span>{selectedFiles.length ? 'Upload & Index Files' : 'Index & Store Permanently'}</span>
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
              ) : !result && !uploadResult ? (
                <div className="rounded-sm border border-dashed border-hairline bg-surface px-3 py-8 text-center">
                  <FileCode className="mx-auto mb-2 size-6 text-faint" />
                  <p className="text-body font-semibold text-ink">Ready for Document Upload</p>
                  <p className="mx-auto mt-1 max-w-sm text-micro text-muted">
                    Uploaded documents are parsed, split by markdown structural headers, embedded as 1024-dim
                    dense vectors, and persisted to disk catalog.
                  </p>
                </div>
              ) : uploadResult ? (
                <div className="flex flex-col gap-3" aria-label="Upload results">
                  {uploadResult.results.map((fileResult, index) => (
                    <div
                      key={`${fileResult.filename}-${index}`}
                      className="rounded-sm border border-hairline bg-surface p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="truncate text-label font-bold text-ink">{fileResult.filename}</p>
                        <StatusChip variant={fileResult.status === 'rejected' ? 'fail' : 'ok'}>
                          {fileResult.status}
                        </StatusChip>
                      </div>
                      <p className="mt-1 text-micro text-muted">
                        {fileResult.pages} {fileResult.pages === 1 ? 'page' : 'pages'} · {fileResult.chunks}{' '}
                        {fileResult.chunks === 1 ? 'chunk' : 'chunks'}
                        {fileResult.format ? ` · ${fileResult.format.toUpperCase()}` : ''}
                      </p>
                      {fileResult.document_id && (
                        <p className="mt-1 text-micro text-muted">
                          Doc ID: <span className="id-mono text-ink">{fileResult.document_id}</span>
                        </p>
                      )}
                      {fileResult.duplicate_of && (
                        <p className="mt-1 text-micro font-semibold text-warn">
                          Duplicate of {fileResult.duplicate_of}
                        </p>
                      )}
                      {fileResult.error && (
                        <p className="mt-1 text-micro font-semibold text-fail">{fileResult.error}</p>
                      )}
                      {fileResult.warnings.map((warning) => (
                        <p key={warning} className="mt-1 text-micro text-warn">{warning}</p>
                      ))}
                    </div>
                  ))}
                  <button type="button"
                    onClick={() => setActiveTab('catalog')}
                    className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-label font-semibold text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <BookOpen className="size-3.5" />
                    <span>View all sources</span>
                  </button>
                </div>
              ) : result ? (
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

                  <button type="button"
                    onClick={() => setActiveTab('catalog')}
                    className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-label font-semibold text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <BookOpen className="size-3.5" />
                    <span>View all sources</span>
                  </button>
                </div>
              ) : null}
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
            ref={inspectorRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="chunk-inspector-modal-title"
            tabIndex={-1}
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded border border-hairline bg-surface-raised shadow-overlay outline-none"
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
              <button type="button"
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
              <button type="button"
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
