/**
 * Meridian — Knowledge Vault.
 *
 * The corpus workspace: ingestion studio, searchable/filterable catalog, sample
 * seeding, destructive actions behind explicit confirmation, and a chunk
 * inspector slide-over.
 *
 * Overlays are portalled to `document.body` on purpose: `StudioShell` renders
 * views inside a `z-10` stacking context, so a `fixed` dialog nested in the tree
 * would paint underneath the shell's header, bottom docks and fade.
 */
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowUpRight,
  Database,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { StatusBadge, type StatusTone } from '../../components/shell/StatusBadge';
import { ApiError, apiFetch } from '../../core/api';
import { useAuth } from '../../core/auth';
import { SPRING_SNAPPY, STAGGER_CONTAINER, STAGGER_ITEM } from '../../core/motion';
import type { DocumentSummary } from '../../core/types';
import ChunkDrawer from './ChunkDrawer';
import UploadZone from './UploadZone';

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

function toCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.detailMessage ?? error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** `markdown` → `md`, `.PDF` → `pdf`, `text/plain` → `txt`. */
export function normalizeFormat(value: string | undefined | null): string {
  if (!value) return 'doc';
  const cleaned = value.toLowerCase().replace(/^\./, '').split(';')[0] ?? '';
  if (cleaned.includes('markdown')) return 'md';
  if (cleaned === 'text/plain' || cleaned === 'text') return 'txt';
  if (cleaned.includes('word') || cleaned.includes('officedocument')) return 'docx';
  return cleaned.slice(0, 8) || 'doc';
}

/** Accepts `DocumentSummary[]` or `{ documents | items | results | data: [...] }`. */
export function normalizeDocuments(raw: unknown): DocumentSummary[] {
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw)
      ? (['documents', 'items', 'results', 'data'] as const).reduce<unknown[]>((found, key) => {
          if (found.length > 0) return found;
          const value = raw[key];
          return Array.isArray(value) ? value : found;
        }, [])
      : [];

  return list.flatMap((item): DocumentSummary[] => {
    if (!isRecord(item)) return [];
    const id = asString(item.id ?? item.document_id ?? item.doc_id);
    if (!id) return [];

    const metadata = isRecord(item.metadata) ? item.metadata : {};
    const createdAt = item.created_at ?? item.createdAt ?? metadata['created_at'];

    return [
      {
        id,
        title: asString(item.title ?? item.name ?? item.filename, 'Untitled document'),
        format: asString(item.format ?? item.file_type ?? item.type, 'doc'),
        source: asString(item.source ?? item.uri ?? item.path, 'Uploaded file'),
        chunk_count: toCount(item.chunk_count ?? item.chunks ?? item.num_chunks),
        created_at: typeof createdAt === 'string' ? createdAt : undefined,
        metadata,
      },
    ];
  });
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/* -------------------------------------------------------------------------- */
/* Format badge                                                               */
/* -------------------------------------------------------------------------- */

const FORMAT_TONES: Record<string, string> = {
  pdf: 'border-fail/25 bg-fail-soft text-fail-ink',
  md: 'border-accent/25 bg-accent-soft text-accent',
  txt: 'border-ok/25 bg-ok-soft text-ok-ink',
  docx: 'border-warn/25 bg-warn-soft text-warn-ink',
  doc: 'border-warn/25 bg-warn-soft text-warn-ink',
  csv: 'border-ok/25 bg-ok-soft text-ok-ink',
  json: 'border-accent/25 bg-accent-soft text-accent',
  html: 'border-warn/25 bg-warn-soft text-warn-ink',
};

export function FormatBadge({ format }: { format: string }) {
  const normalized = normalizeFormat(format);
  return (
    <span
      className={cx(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-[6px] border px-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-wide',
        FORMAT_TONES[normalized] ?? 'border-hairline bg-subtle text-ink-muted',
      )}
    >
      <FileText className="h-2.5 w-2.5" strokeWidth={2.4} />
      {normalized}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Document card                                                              */
/* -------------------------------------------------------------------------- */

function DocumentCard({
  document,
  onInspect,
  onDelete,
}: {
  document: DocumentSummary;
  onInspect: () => void;
  onDelete: () => void;
}) {
  return (
    <motion.article
      variants={STAGGER_ITEM}
      whileHover={{ y: -2 }}
      transition={SPRING_SNAPPY}
      className="group relative flex flex-col gap-2.5 rounded-lg border border-hairline bg-elevated/80 p-3.5 shadow-hairline backdrop-blur-xl transition-colors hover:border-accent/30 transition-opacity duration-200 group-hover:opacity-60 hover:!opacity-100"
    >
      <div className="flex items-start justify-between gap-2">
        <FormatBadge format={document.format} />
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${document.title}`}
          title="Delete document"
          className="relative grid h-6 w-6 place-items-center rounded-pill border border-transparent text-ink-faint opacity-100 transition-all hover:border-fail/30 hover:bg-fail-soft hover:text-fail-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fail/40 sm:opacity-0 sm:group-hover:opacity-100 before:absolute before:-inset-2 before:content-['']"
        >
          <Trash2 className="h-3 w-3" strokeWidth={2.2} />
        </button>
      </div>

      <button type="button" onClick={onInspect} className="min-w-0 text-left">
        <h3 className="line-clamp-2 text-[13.5px] font-medium leading-snug text-ink transition-colors group-hover:text-accent">
          {document.title}
        </h3>
        <p className="mt-0.5 truncate font-mono text-[10px] text-ink-faint">{document.source}</p>
      </button>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-hairline pt-2">
        <span className="tabular text-[10.5px] text-ink-muted">
          {document.chunk_count === undefined ? '—' : document.chunk_count.toLocaleString()} chunks
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-ink-faint">{formatDate(document.created_at)}</span>
          <button
            type="button"
            onClick={onInspect}
            className="inline-flex items-center gap-0.5 text-[10.5px] font-medium text-ink-muted transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Inspect
            <ArrowUpRight className="h-2.5 w-2.5" strokeWidth={2.6} />
          </button>
        </div>
      </div>
    </motion.article>
  );
}

/* -------------------------------------------------------------------------- */
/* Toasts                                                                     */
/* -------------------------------------------------------------------------- */

type ToastTone = Extract<StatusTone, 'ok' | 'warn' | 'fail' | 'neutral'>;

interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
}

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  const [clientReady, setClientReady] = useState(false);

  useEffect(() => {
    setClientReady(true);
  }, []);

  if (!clientReady) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed right-4 top-16 z-40 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-1.5"
      role="region"
      aria-label="Notifications"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, x: 18, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 18, scale: 0.98 }}
            transition={SPRING_SNAPPY}
            className="pointer-events-auto flex items-start gap-2 rounded-md border border-hairline bg-elevated/95 px-2.5 py-2 shadow-card backdrop-blur-xl"
          >
            <div className="min-w-0 flex-1 pt-[1px]">
              <StatusBadge tone={toast.tone} size="sm" label={toast.message} />
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="relative grid h-5 w-5 shrink-0 place-items-center rounded-pill text-ink-faint transition-colors hover:text-ink before:absolute before:-inset-[10px] before:content-['']"
            >
              <X className="h-3 w-3" strokeWidth={2.6} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

/* -------------------------------------------------------------------------- */
/* Confirm dialog                                                             */
/* -------------------------------------------------------------------------- */

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  /** When set, the operator must type this string before confirming. */
  requiredText?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy = false,
  requiredText,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  /** Portals cannot be server rendered, so mount ours only after hydration. */
  const [clientReady, setClientReady] = useState(false);
  /** Stays true after the first open so the exit spring can still play. */
  const [everOpened, setEverOpened] = useState(open);

  useEffect(() => {
    setClientReady(true);
  }, []);

  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setTyped('');
    const timer = window.setTimeout(() => {
      /* Focus always lands inside the dialog: the input when there is one,
         otherwise the cancel button. */
      const target = requiredText
        ? inputRef.current
        : cancelRef.current && !cancelRef.current.disabled
          ? cancelRef.current
          : confirmRef.current;
      target?.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [open, requiredText]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, busy, onCancel]);

  if (!clientReady || !everOpened) return null;

  const unlocked = !requiredText || typed.trim().toUpperCase() === requiredText.toUpperCase();

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div key="confirm" className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <motion.div
            aria-hidden="true"
            onClick={() => {
              if (!busy) onCancel();
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="absolute inset-0 bg-ink/30 backdrop-blur-[3px] dark:bg-black/65"
          />

          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              const node = dialogRef.current;
              if (!node) return;
              const focusable = Array.from(
                node.querySelectorAll<HTMLElement>(
                  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
                ),
              );
              if (focusable.length === 0) return;
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (!first || !last) return;
              const active = document.activeElement;
              if (!node.contains(active)) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
                return;
              }
              if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
              }
            }}
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={SPRING_SNAPPY}
            className="relative w-full max-w-[420px] overflow-hidden rounded-lg border border-hairline bg-elevated shadow-palette"
          >
            <div className="flex items-start gap-2.5 p-4">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-fail/30 bg-fail-soft text-fail-ink">
                <AlertCircle className="h-4 w-4" strokeWidth={2.2} />
              </span>
              <div className="min-w-0">
                <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
                <div className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">{description}</div>
              </div>
            </div>

            {requiredText ? (
              <div className="px-4 pb-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-ink-faint">
                    Type <span className="font-mono text-fail-ink">{requiredText}</span> to confirm
                  </span>
                  <input
                    ref={inputRef}
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-8 rounded-[7px] border border-hairline bg-subtle/60 px-2 font-mono text-[12px] uppercase tracking-[0.12em] text-ink outline-none placeholder:text-ink-faint focus:border-fail/50"
                    placeholder={requiredText}
                  />
                </label>
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-1.5 border-t border-hairline bg-subtle/60 px-3 py-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="inline-flex h-7 items-center rounded-pill border border-hairline bg-elevated px-2.5 text-[11px] font-medium text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                ref={confirmRef}
                type="button"
                onClick={onConfirm}
                disabled={busy || !unlocked}
                className="inline-flex h-7 items-center gap-1 rounded-pill bg-fail px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-fail/90 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fail/40"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.6} />
                ) : (
                  <Trash2 className="h-3 w-3" strokeWidth={2.4} />
                )}
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/* -------------------------------------------------------------------------- */
/* Filter chip                                                                */
/* -------------------------------------------------------------------------- */

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'relative inline-flex h-7 shrink-0 items-center gap-1 rounded-pill border px-2 font-mono text-[10px] font-medium uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        active
          ? 'border-accent/30 bg-accent-soft text-accent'
          : 'border-hairline bg-elevated/60 text-ink-muted hover:text-ink',
      )}
    >
      {active ? (
        <motion.span
          layoutId="vault-filter-pill"
          transition={SPRING_SNAPPY}
          className="absolute inset-0 -z-10 rounded-pill border border-accent/30 bg-accent-soft/60"
        />
      ) : null}
      {label}
      <span className={cx('tabular', active ? 'text-accent/70' : 'text-ink-faint')}>{count}</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Vault                                                                      */
/* -------------------------------------------------------------------------- */

type ConfirmState = { kind: 'delete'; document: DocumentSummary } | { kind: 'clear' } | null;

export function VaultView() {
  const { tenantId } = useAuth();

  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<string>('all');

  const [seeding, setSeeding] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  const [drawer, setDrawer] = useState<{ open: boolean; documentId: string | null; title?: string }>(
    { open: false, documentId: null },
  );

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastTimers = useRef<number[]>([]);
  const toastCounter = useRef(0);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    (tone: ToastTone, message: string) => {
      toastCounter.current += 1;
      const id = `toast_${toastCounter.current}`;
      setToasts((current) => [...current.slice(-3), { id, tone, message }]);
      const timer = window.setTimeout(() => dismissToast(id), 4800);
      toastTimers.current.push(timer);
    },
    [dismissToast],
  );

  useEffect(
    () => () => {
      for (const timer of toastTimers.current) window.clearTimeout(timer);
      toastTimers.current = [];
    },
    [],
  );

  /* ---- load ------------------------------------------------------------- */
  const load = useCallback(async (options?: { quiet?: boolean }) => {
    if (!options?.quiet) setStatus('loading');
    setError(null);
    try {
      const raw = await apiFetch<unknown>('/v1/documents');
      setDocuments(normalizeDocuments(raw));
      setStatus('ready');
    } catch (cause) {
      setError(errorMessage(cause, 'Could not load documents'));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, tenantId]);

  /* ---- derived ---------------------------------------------------------- */
  const formats = useMemo(() => {
    const seen = new Set<string>();
    for (const document of documents) seen.add(normalizeFormat(document.format));
    return [...seen].sort();
  }, [documents]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return documents.filter((document) => {
      if (formatFilter !== 'all' && normalizeFormat(document.format) !== formatFilter) return false;
      if (!needle) return true;
      return `${document.title} ${document.source} ${normalizeFormat(document.format)}`
        .toLowerCase()
        .includes(needle);
    });
  }, [documents, formatFilter, query]);

  const totalChunks = useMemo(
    () => documents.reduce((sum, document) => sum + (document.chunk_count ?? 0), 0),
    [documents],
  );

  const countsByFormat = useMemo(() => {
    const counts = new Map<string, number>();
    for (const document of documents) {
      const format = normalizeFormat(document.format);
      counts.set(format, (counts.get(format) ?? 0) + 1);
    }
    return counts;
  }, [documents]);

  /* ---- actions ---------------------------------------------------------- */
  const seedSamples = useCallback(async () => {
    setSeeding(true);
    try {
      const result = await apiFetch<unknown>('/v1/documents/seed-samples', { method: 'POST' });
      const reported = isRecord(result)
        ? toCount(result.seeded ?? result.count ?? result.total)
        : undefined;
      const seeded =
        reported ??
        (isRecord(result) && Array.isArray(result.documents) ? result.documents.length : undefined);
      pushToast('ok', seeded ? `Seeded ${seeded} sample documents` : 'Sample corpus seeded');
      await load({ quiet: true });
    } catch (cause) {
      pushToast('fail', errorMessage(cause, 'Seeding failed'));
    } finally {
      setSeeding(false);
    }
  }, [load, pushToast]);

  const handleIngested = useCallback(
    (count: number) => {
      pushToast('ok', count === 1 ? '1 document ingested' : `${count} documents ingested`);
      void load({ quiet: true });
    },
    [load, pushToast],
  );

  const handleIngestError = useCallback(
    (message: string) => pushToast('fail', message),
    [pushToast],
  );

  const runConfirmedAction = useCallback(async () => {
    if (!confirm) return;
    setBusyAction(true);
    try {
      if (confirm.kind === 'delete') {
        const target = confirm.document;
        await apiFetch<unknown>(`/v1/documents/${encodeURIComponent(target.id)}`, {
          method: 'DELETE',
        });
        pushToast('ok', `Deleted “${target.title}”`);
        if (drawer.documentId === target.id) setDrawer({ open: false, documentId: null });
      } else {
        await apiFetch<unknown>('/v1/documents', { method: 'DELETE' });
        pushToast('ok', 'Vault cleared');
        setDrawer({ open: false, documentId: null });
      }
      setConfirm(null);
      await load({ quiet: true });
    } catch (cause) {
      pushToast('fail', errorMessage(cause, 'Action failed'));
      setConfirm(null);
    } finally {
      setBusyAction(false);
    }
  }, [confirm, drawer.documentId, load, pushToast]);

  const inspect = useCallback((document: DocumentSummary) => {
    setDrawer({ open: true, documentId: document.id, title: document.title });
  }, []);

  const empty = documents.length === 0 && status === 'ready';
  const noMatches = status === 'ready' && documents.length > 0 && filtered.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {/* ---------------- header ---------------- */}
      <motion.header
        variants={STAGGER_ITEM}
        initial="initial"
        animate="animate"
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.035em] text-ink">
            Corpus
          </h1>
          <p className="max-w-xl text-[12.5px] leading-relaxed text-ink-muted">
            Ingest, inspect and retire the documents Meridian retrieves from.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => void seedSamples()}
            disabled={seeding}
            className="inline-flex h-8 items-center gap-1.5 rounded-pill border border-hairline bg-elevated/80 px-3 text-[11px] font-semibold text-ink-muted shadow-hairline backdrop-blur-xl transition-colors hover:border-accent/30 hover:text-ink disabled:cursor-progress disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {seeding ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />
            ) : (
              <Sparkles className="h-3 w-3 text-accent" strokeWidth={2.4} />
            )}
            {seeding ? 'Seeding…' : 'Seed sample corpus'}
          </button>

          {documents.length > 0 ? (
            <button
              type="button"
              onClick={() => setConfirm({ kind: 'clear' })}
              className="inline-flex h-8 items-center gap-1.5 rounded-pill border border-hairline bg-elevated/80 px-2.5 text-[11px] font-semibold text-ink-muted shadow-hairline backdrop-blur-xl transition-colors hover:border-fail/30 hover:bg-fail-soft hover:text-fail-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fail/40"
            >
              <Trash2 className="h-3 w-3" strokeWidth={2.4} />
              Clear all
            </button>
          ) : null}
        </div>
      </motion.header>

      {/* ---------------- ingestion ---------------- */}
      <motion.div variants={STAGGER_ITEM} initial="initial" animate="animate">
        <UploadZone onIngested={handleIngested} onError={handleIngestError} />
      </motion.div>

      {/* ---------------- error banner ---------------- */}
      <AnimatePresence initial={false}>
        {status === 'error' ? (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={SPRING_SNAPPY}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-fail/30 bg-fail-soft px-3 py-2"
          >
            <p className="flex items-center gap-1.5 text-[11.5px] text-fail-ink">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
              {error ?? 'Could not load documents'}
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex h-6 items-center gap-1 rounded-pill border border-fail/30 bg-elevated px-2 text-[10.5px] font-semibold text-fail-ink transition-colors hover:border-fail/60"
            >
              <RefreshCw className="h-2.5 w-2.5" strokeWidth={2.6} />
              Retry
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ---------------- toolbar ---------------- */}
      {documents.length > 0 ? (
        <motion.div
          variants={STAGGER_ITEM}
          initial="initial"
          animate="animate"
          className="flex flex-wrap items-center gap-2"
        >
          <div className="relative min-w-[13rem] flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint"
              strokeWidth={2.2}
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, source or format…"
              aria-label="Search documents"
              className="h-8 w-full rounded-pill border border-hairline bg-elevated/70 pl-8 pr-7 text-[12px] text-ink outline-none backdrop-blur-xl transition-colors placeholder:text-ink-faint focus:border-accent/40"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 grid h-4 w-4 -translate-y-1/2 place-items-center rounded-full text-ink-faint transition-colors hover:text-ink"
              >
                <X className="h-3 w-3" strokeWidth={2.6} />
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
            <FilterChip
              label="all"
              count={documents.length}
              active={formatFilter === 'all'}
              onClick={() => setFormatFilter('all')}
            />
            {formats.map((format) => (
              <FilterChip
                key={format}
                label={format}
                count={countsByFormat.get(format) ?? 0}
                active={formatFilter === format}
                onClick={() => setFormatFilter(format === formatFilter ? 'all' : format)}
              />
            ))}
          </div>
        </motion.div>
      ) : null}

      {/* ---------------- catalog ---------------- */}
      {status === 'loading' && documents.length === 0 ? (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div
              key={index}
              className="h-[116px] animate-pulse rounded-lg border border-hairline bg-subtle/50"
            />
          ))}
          <span className="sr-only">Loading documents…</span>
        </div>
      ) : empty ? (
        <motion.div
          variants={STAGGER_ITEM}
          initial="initial"
          animate="animate"
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-hairline bg-elevated/40 px-6 py-12 text-center"
        >
          <span className="grid h-11 w-11 place-items-center rounded-full border border-hairline bg-elevated text-ink-muted shadow-hairline">
            <Database className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
              Your vault is empty
            </h2>
            <p className="mx-auto max-w-sm text-[12px] leading-relaxed text-ink-muted">
              Drop a few documents above to build the index, or start from a sample corpus of
              contract and policy material.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <button
              type="button"
              onClick={() => void seedSamples()}
              disabled={seeding}
              className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-accent px-3.5 text-[11px] font-semibold text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-progress disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {seeding ? (
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.6} />
              ) : (
                <Sparkles className="h-3 w-3" strokeWidth={2.6} />
              )}
              Seed sample corpus
            </button>
            <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-faint">
              <Plus className="h-2.5 w-2.5" strokeWidth={2.6} />
              or upload your own above
            </span>
          </div>
        </motion.div>
      ) : noMatches ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-hairline px-6 py-10 text-center">
          <Search className="h-5 w-5 text-ink-faint" strokeWidth={1.8} />
          <p className="text-[12.5px] font-medium text-ink">No documents match</p>
          <p className="text-[11px] text-ink-muted">
            {query ? `Nothing matched “${query}”` : 'Nothing in this format'}
            {formatFilter !== 'all' ? ` in ${formatFilter}` : ''}.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setFormatFilter('all');
            }}
            className="mt-1 inline-flex h-7 items-center rounded-pill border border-hairline bg-elevated px-2.5 text-[10.5px] font-medium text-ink-muted transition-colors hover:text-ink"
          >
            Clear filters
          </button>
        </div>
      ) : ( /* container-query candidate deferred: grids live in fixed main region (max-w-shell), so viewport ≈ container; needs @tailwindcss/container-queries plugin to do properly. */
        <motion.div
          key={`${query}|${formatFilter}`}
          variants={STAGGER_CONTAINER}
          initial="initial"
          animate="animate"
          className="group grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3"
        >
          {filtered.map((document) => (
            <DocumentCard
              key={document.id}
              document={document}
              onInspect={() => inspect(document)}
              onDelete={() => setConfirm({ kind: 'delete', document })}
            />
          ))}
        </motion.div>
      )}

      {/* ---------------- overlays ---------------- */}
      <ChunkDrawer
        open={drawer.open}
        documentId={drawer.documentId}
        documentTitle={drawer.title}
        onClose={() => setDrawer((current) => ({ ...current, open: false }))}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'delete' ? 'Delete this document?' : 'Clear the entire vault?'}
        description={
          confirm?.kind === 'delete' ? (
            <>
              <span className="font-medium text-ink">{confirm.document.title}</span> and its{' '}
              {confirm.document.chunk_count ?? 0} indexed chunks will be removed from this tenant.
              Retrieval will no longer return them. This cannot be undone.
            </>
          ) : confirm?.kind === 'clear' ? (
            <>
              All <span className="font-medium text-ink">{documents.length} documents</span> and{' '}
              <span className="font-medium text-ink">{totalChunks.toLocaleString()} chunks</span> in
              tenant <span className="font-mono">{tenantId}</span> will be deleted. This cannot be
              undone.
            </>
          ) : null
        }
        confirmLabel={confirm?.kind === 'delete' ? 'Delete document' : 'Clear vault'}
        requiredText={confirm?.kind === 'clear' ? 'DELETE' : undefined}
        busy={busyAction}
        onCancel={() => {
          if (!busyAction) setConfirm(null);
        }}
        onConfirm={() => void runConfirmedAction()}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default VaultView;
