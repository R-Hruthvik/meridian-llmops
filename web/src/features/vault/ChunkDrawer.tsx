/**
 * Meridian — Chunk Inspector.
 *
 * Right-hand slide-over that pages through `GET /v1/documents/{id}/chunks`.
 * Chunks are shown in index order with their section heading, provenance ids and
 * a one-click copy, staggered in as each page lands.
 */
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  FileWarning,
  Layers,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { StatusBadge } from '../../components/shell/StatusBadge';
import { ApiError, apiFetch } from '../../core/api';
import { DRAWER_SLIDE, SPRING_GENTLE, STAGGER_CONTAINER, STAGGER_ITEM } from '../../core/motion';
import type { ChunkItem } from '../../core/types';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.detailMessage ?? error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export interface ChunkPage {
  documentId: string;
  title: string | null;
  chunks: ChunkItem[];
  total: number;
}

/** Tolerant of `{chunks, total_chunks}`, `{items, total}` and bare arrays. */
export function normalizeChunkPage(raw: unknown, fallbackDocumentId: string): ChunkPage {
  const envelope = isRecord(raw) ? raw : {};
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(envelope.chunks)
      ? envelope.chunks
      : Array.isArray(envelope.items)
        ? envelope.items
        : Array.isArray(envelope.results)
          ? envelope.results
          : [];

  const chunks = list.flatMap((item, index): ChunkItem[] => {
    if (!isRecord(item)) return [];
    const text = asString(item.text ?? item.content);
    const id = asString(item.id ?? item.chunk_id);
    if (!text && !id) return [];
    const sectionHeading = item.section_heading ?? item.heading_path ?? item.heading;
    return [
      {
        id: id || `chunk_${index}`,
        document_id: asString(item.document_id, fallbackDocumentId) || fallbackDocumentId,
        text,
        chunk_index: asNumber(item.chunk_index ?? item.index, index),
        section_heading:
          typeof sectionHeading === 'string' && sectionHeading.length > 0 ? sectionHeading : null,
        metadata: isRecord(item.metadata) ? item.metadata : {},
      },
    ];
  });

  const total = asNumber(
    envelope.total_chunks ?? envelope.total ?? envelope.count,
    chunks.length,
  );

  const rawTitle = envelope.title ?? envelope.document_title;

  return {
    documentId: asString(envelope.document_id, fallbackDocumentId) || fallbackDocumentId,
    title: typeof rawTitle === 'string' && rawTitle.length > 0 ? rawTitle : null,
    chunks,
    total: Math.max(total, chunks.length),
  };
}

const PAGE_SIZES = [25, 50, 100] as const;

/* -------------------------------------------------------------------------- */
/* Props                                                                      */
/* -------------------------------------------------------------------------- */

export interface ChunkDrawerProps {
  open: boolean;
  /** Document to inspect. `null` keeps the drawer empty. */
  documentId: string | null;
  /** Shown while the payload (which also carries the title) is in flight. */
  documentTitle?: string;
  onClose: () => void;
  /** Chunks per request. Defaults to 50. */
  pageSize?: number;
}

interface DrawerState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  chunks: ChunkItem[];
  total: number;
  title: string | null;
  error: string | null;
}

const EMPTY_STATE: DrawerState = {
  status: 'idle',
  chunks: [],
  total: 0,
  title: null,
  error: null,
};

/* -------------------------------------------------------------------------- */
/* Chunk card                                                                 */
/* -------------------------------------------------------------------------- */

function ChunkCard({
  chunk,
  copied,
  onCopy,
}: {
  chunk: ChunkItem;
  copied: boolean;
  onCopy: (chunk: ChunkItem) => void;
}) {
  const page = typeof chunk.metadata['page'] === 'number' ? chunk.metadata['page'] : null;

  return (
    <motion.li
      variants={STAGGER_ITEM}
      layout
      className="rounded-md border border-hairline bg-elevated px-3 py-2.5 shadow-hairline"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-[5px] border border-hairline bg-subtle px-1 font-mono text-[9.5px] font-semibold tabular text-ink-muted">
            #{chunk.chunk_index}
          </span>
          {chunk.section_heading ? (
            <span className="min-w-0 truncate text-[11px] font-medium text-ink-muted">
              {chunk.section_heading}
            </span>
          ) : (
            <span className="text-[11px] italic text-ink-faint">no heading</span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onCopy(chunk)}
          aria-label={copied ? 'Copied chunk text' : 'Copy chunk text'}
          className={cx(
            'inline-flex h-6 shrink-0 items-center gap-1 rounded-pill border px-1.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            copied
              ? 'border-ok/30 bg-ok-soft text-ok-ink'
              : 'border-hairline bg-subtle/60 text-ink-muted hover:text-ink',
          )}
        >
          {copied ? (
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
          ) : (
            <Copy className="h-2.5 w-2.5" strokeWidth={2.4} />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <p className="mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-[1.65] text-ink">
        {chunk.text || <span className="italic text-ink-faint">empty chunk</span>}
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[9.5px] text-ink-faint">
        <span className="max-w-[14rem] truncate">{chunk.id}</span>
        <span className="opacity-40">·</span>
        <span className="tabular">{chunk.text.length.toLocaleString()} chars</span>
        {page !== null ? (
          <>
            <span className="opacity-40">·</span>
            <span className="tabular">p.{page}</span>
          </>
        ) : null}
      </div>
    </motion.li>
  );
}

/* -------------------------------------------------------------------------- */
/* Drawer                                                                     */
/* -------------------------------------------------------------------------- */

export function ChunkDrawer({
  open,
  documentId,
  documentTitle,
  onClose,
  pageSize: initialPageSize = 50,
}: ChunkDrawerProps) {
  const [pageSize, setPageSize] = useState<number>(initialPageSize);
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState<DrawerState>(EMPTY_STATE);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const closeRef = useRef<HTMLButtonElement>(null);
  const copyTimer = useRef<number | null>(null);

  /** Portals cannot be server rendered, so mount ours only after hydration. */
  const [clientReady, setClientReady] = useState(false);
  /** Stays true after the first open so the exit spring can still play. */
  const [everOpened, setEverOpened] = useState(open);

  useEffect(() => {
    setClientReady(true);
  }, []);

  /* A new document always starts on the first page. */
  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  useEffect(() => {
    setOffset(0);
    setState(EMPTY_STATE);
    setCopyError(null);
    setCopiedId(null);
  }, [documentId]);

  /* Fetch the current page. */
  useEffect(() => {
    if (!open || !documentId) return undefined;

    const controller = new AbortController();
    setState((current) => ({ ...current, status: 'loading', error: null }));

    apiFetch<unknown>(
      `/v1/documents/${encodeURIComponent(documentId)}/chunks?limit=${pageSize}&offset=${offset}`,
      { signal: controller.signal },
    )
      .then((raw) => {
        if (controller.signal.aborted) return;
        const page = normalizeChunkPage(raw, documentId);
        setState({
          status: 'ready',
          chunks: page.chunks,
          total: page.total,
          title: page.title,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          chunks: [],
          total: 0,
          title: null,
          error: errorMessage(error, 'Could not load chunks'),
        });
      });

    return () => controller.abort();
  }, [open, documentId, pageSize, offset, reloadToken]);

  /* Escape to close, lock the page behind the drawer, focus the close button. */
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 60);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [open, onClose]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const copyChunk = useCallback(async (chunk: ChunkItem) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable in this browser');
      await navigator.clipboard.writeText(chunk.text);
      setCopiedId(chunk.id);
      setCopyError(null);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopiedId(null), 1600);
    } catch (error) {
      setCopyError(errorMessage(error, 'Copy failed'));
    }
  }, []);

  const pageNumber = Math.floor(offset / pageSize) + 1;
  const pageCount = Math.max(1, Math.ceil(state.total / pageSize));
  const firstOnPage = state.chunks.length > 0 ? offset + 1 : 0;
  const lastOnPage = offset + state.chunks.length;
  const canPrev = offset > 0;
  const canNext = offset + pageSize < state.total;

  const title = state.title ?? documentTitle ?? 'Document chunks';
  const showStagger = useMemo(() => state.chunks.map((chunk) => chunk.id).join('|'), [state.chunks]);

  if (!clientReady || !everOpened) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="chunk-drawer"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 1 }}
          className="fixed inset-0 z-50"
        >
          <motion.div
            aria-hidden="true"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-ink/25 backdrop-blur-[2px] dark:bg-black/60"
          />

          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Chunk inspector"
            variants={DRAWER_SLIDE}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={SPRING_GENTLE}
            className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col border-l border-hairline bg-elevated/95 shadow-palette backdrop-blur-2xl"
          >
            {/* header */}
            <header className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                  <Layers className="h-3 w-3" strokeWidth={2.2} />
                  Chunk inspector
                </p>
                <h2 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-ink">
                  {title}
                </h2>
                <p className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[10.5px] text-ink-faint">
                  {documentId ?? '—'}
                  {state.status === 'ready' ? (
                    <span className="rounded-pill border border-hairline bg-subtle px-1.5 py-[1px] text-[9.5px] text-ink-muted">
                      {state.total.toLocaleString()} chunks
                    </span>
                  ) : null}
                </p>
              </div>

              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close chunk inspector"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-pill border border-hairline bg-elevated text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
            </header>

            {/* body */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-8 pt-3">
              {state.status === 'loading' ? (
                <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
                  {[0, 1, 2, 3].map((index) => (
                    <div
                      key={index}
                      className="h-[86px] animate-pulse rounded-md border border-hairline bg-subtle/60"
                    />
                  ))}
                  <span className="sr-only">Loading chunks…</span>
                </div>
              ) : state.status === 'error' ? (
                <div className="flex flex-col items-center gap-2 rounded-md border border-fail/30 bg-fail-soft px-4 py-8 text-center">
                  <FileWarning className="h-5 w-5 text-fail-ink" strokeWidth={1.8} />
                  <p className="text-[12px] font-medium text-fail-ink">{state.error}</p>
                  <button
                    type="button"
                    onClick={() => setReloadToken((token) => token + 1)}
                    className="mt-1 inline-flex h-7 items-center gap-1 rounded-pill border border-fail/30 bg-elevated px-2.5 text-[10.5px] font-semibold text-fail-ink transition-colors hover:border-fail/60"
                  >
                    <RefreshCw className="h-3 w-3" strokeWidth={2.4} />
                    Retry
                  </button>
                </div>
              ) : state.chunks.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-hairline px-4 py-10 text-center">
                  <Layers className="h-5 w-5 text-ink-faint" strokeWidth={1.6} />
                  <p className="text-[12.5px] font-medium text-ink">No chunks indexed</p>
                  <p className="max-w-[16rem] text-[11px] leading-relaxed text-ink-muted">
                    This document produced no retrievable chunks. Re-ingest it to rebuild the
                    index.
                  </p>
                </div>
              ) : (
                <motion.ul
                  key={showStagger}
                  variants={STAGGER_CONTAINER}
                  initial="initial"
                  animate="animate"
                  className="flex flex-col gap-2"
                >
                  {state.chunks.map((chunk) => (
                    <ChunkCard
                      key={chunk.id}
                      chunk={chunk}
                      copied={copiedId === chunk.id}
                      onCopy={(target) => void copyChunk(target)}
                    />
                  ))}
                </motion.ul>
              )}

              {copyError ? (
                <p className="mt-2 rounded-[6px] border border-fail/30 bg-fail-soft px-2 py-1.5 text-[10.5px] text-fail-ink">
                  {copyError}
                </p>
              ) : null}
            </div>

            {/* footer / pagination */}
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline bg-subtle/60 px-3 py-2">
              <div className="flex items-center gap-1.5">
                <StatusBadge
                  tone={state.status === 'error' ? 'fail' : state.status === 'ready' ? 'ok' : 'neutral'}
                  size="sm"
                  label={
                    state.status === 'ready'
                      ? `${firstOnPage}–${lastOnPage} of ${state.total.toLocaleString()}`
                      : state.status === 'error'
                        ? 'failed'
                        : 'loading'
                  }
                />
                <label className="flex items-center gap-1 text-[10px] text-ink-faint">
                  <span className="sr-only">Chunks per page</span>
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      setOffset(0);
                      setPageSize(Number(event.target.value));
                    }}
                    className="h-6 rounded-[6px] border border-hairline bg-elevated px-1 font-mono text-[10px] text-ink-muted outline-none focus:border-accent/40"
                  >
                    {PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}/page
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setOffset((current) => Math.max(0, current - pageSize))}
                  disabled={!canPrev || state.status === 'loading'}
                  className="grid h-6 w-6 place-items-center rounded-pill border border-hairline bg-elevated text-ink-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label="Previous page of chunks"
                >
                  <ChevronLeft className="h-3 w-3" strokeWidth={2.6} />
                </button>

                <span className="tabular min-w-[3.5rem] text-center text-[10.5px] font-medium text-ink-muted">
                  {pageNumber} / {pageCount}
                </span>

                <button
                  type="button"
                  onClick={() => setOffset((current) => current + pageSize)}
                  disabled={!canNext || state.status === 'loading'}
                  className="grid h-6 w-6 place-items-center rounded-pill border border-hairline bg-elevated text-ink-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label="Next page of chunks"
                >
                  {state.status === 'loading' ? (
                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.6} />
                  ) : (
                    <ChevronRight className="h-3 w-3" strokeWidth={2.6} />
                  )}
                </button>
              </div>
            </footer>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export default ChunkDrawer;
