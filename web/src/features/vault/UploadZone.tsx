/**
 * Meridian — Ingestion Studio.
 *
 * A tactile dropzone that feeds two backend paths:
 *   • files  → `POST /v1/documents` (multipart/form-data, `file` field)
 *   • paste  → `POST /v1/ingest` (raw text + chunk_size / chunk_overlap)
 *
 * Drag state is tracked with a depth counter so dragging over nested children
 * doesn't strobe the highlight, and uploads run sequentially so a burst of
 * drops can't swamp the ingest queue.
 */
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  ClipboardPaste,
  CloudUpload,
  FileText,
  Loader2,
  Upload,
} from 'lucide-react';
import { useCallback, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';

import { apiFetch } from '../../core/api';
import { FADE_UP, SPRING_SNAPPY } from '../../core/motion';

/* -------------------------------------------------------------------------- */
/* Constants & helpers                                                        */
/* -------------------------------------------------------------------------- */

const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'doc', 'md', 'markdown', 'txt', 'csv', 'html', 'json'];

const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const INGEST_LIMITS = {
  chunk_size: { min: 128, max: 4096, step: 64 },
  chunk_overlap: { min: 0, max: 1024, step: 16 },
} as const;

const FORMAT_OPTIONS = ['txt', 'md', 'pdf', 'html', 'json'] as const;

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function isSupportedFile(file: File): boolean {
  return SUPPORTED_EXTENSIONS.includes(fileExtension(file.name));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** Title fallback for pasted text: first meaningful line, trimmed. */
export function derivePasteTitle(text: string): string {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return 'Untitled paste';
  const cleaned = firstLine.replace(/^#+\s*/, '');
  return cleaned.length > 0 ? cleaned.slice(0, 72) : 'Untitled paste';
}

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type IngestMode = 'file' | 'text';

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error';

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  status: UploadStatus;
  error?: string;
}

export interface UploadZoneProps {
  /** Called once per batch that created at least one document. */
  onIngested: (count: number) => void;
  /** Human-readable failures (rejected files, ingest errors). */
  onError?: (message: string) => void;
  className?: string;
}

let uploadCounter = 0;

function nextUploadId(): string {
  uploadCounter += 1;
  return `upl_${Date.now().toString(36)}_${uploadCounter}`;
}

/* -------------------------------------------------------------------------- */
/* Numeric control                                                            */
/* -------------------------------------------------------------------------- */

function NumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-[10.5px] font-medium text-ink-muted">
        <span className="font-mono">{label}</span>
        <span className="tabular text-[11px] font-semibold text-ink">
          {value}
          {suffix ? <span className="ml-0.5 font-normal text-ink-muted">{suffix}</span> : null}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-hairline [accent-color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Upload zone                                                                */
/* -------------------------------------------------------------------------- */

export function UploadZone({ onIngested, onError, className }: UploadZoneProps) {
  const [mode, setMode] = useState<IngestMode>('file');
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);

  const dragDepth = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  /* paste mode ------------------------------------------------------------- */
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [format, setFormat] = useState<string>('txt');
  const [chunkSize, setChunkSize] = useState(800);
  const [chunkOverlap, setChunkOverlap] = useState(120);
  const [textError, setTextError] = useState<string | null>(null);

  const patchQueueItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setQueue((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const uploadOne = useCallback(
    async (file: File, itemId: string): Promise<boolean> => {
      patchQueueItem(itemId, { status: 'uploading' });
      try {
        const form = new FormData();
        form.append('file', file, file.name);
        await apiFetch<unknown>('/v1/documents', { method: 'POST', body: form });
        patchQueueItem(itemId, { status: 'done' });
        return true;
      } catch (error) {
        patchQueueItem(itemId, {
          status: 'error',
          error: errorMessage(error, 'Upload failed'),
        });
        return false;
      }
    },
    [patchQueueItem],
  );

  const uploadFiles = useCallback(
    async (incoming: File[]) => {
      if (incoming.length === 0 || busy) return;

      const oversized: string[] = [];
      const unsupported: string[] = [];
      const accepted: File[] = [];

      for (const file of incoming) {
        if (file.size > MAX_FILE_BYTES) oversized.push(file.name);
        else if (!isSupportedFile(file)) unsupported.push(file.name);
        else accepted.push(file);
      }

      if (unsupported.length > 0) {
        onError?.(
          `Unsupported file type: ${unsupported.slice(0, 3).join(', ')}${
            unsupported.length > 3 ? ` +${unsupported.length - 3} more` : ''
          }`,
        );
      }
      if (oversized.length > 0) {
        onError?.(
          `Over ${formatBytes(MAX_FILE_BYTES)}: ${oversized.slice(0, 3).join(', ')}${
            oversized.length > 3 ? ` +${oversized.length - 3} more` : ''
          }`,
        );
      }
      if (accepted.length === 0) return;

      const items: UploadItem[] = accepted.map((file) => ({
        id: nextUploadId(),
        name: file.name,
        size: file.size,
        status: 'queued',
      }));
      setQueue((current) => [...current, ...items]);
      setBusy(true);

      let created = 0;
      for (const [index, file] of accepted.entries()) {
        const item = items[index];
        if (!item) continue;
        const ok = await uploadOne(file, item.id);
        if (ok) created += 1;
      }

      setBusy(false);
      if (created > 0) onIngested(created);
    },
    [busy, onError, onIngested, uploadOne],
  );

  const openPicker = () => {
    if (!busy) inputRef.current?.click();
  };

  const submitText = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setTextError('Paste some text to ingest.');
      return;
    }
    if (chunkOverlap >= chunkSize) {
      setTextError('Chunk overlap must be smaller than chunk size.');
      return;
    }

    setBusy(true);
    setTextError(null);
    try {
      await apiFetch<unknown>('/v1/ingest', {
        method: 'POST',
        body: JSON.stringify({
          text: trimmed,
          title: title.trim() || derivePasteTitle(trimmed),
          source: source.trim() || 'manual://paste',
          format,
          chunk_size: chunkSize,
          chunk_overlap: chunkOverlap,
        }),
      });
      setText('');
      setTitle('');
      setSource('');
      onIngested(1);
    } catch (error) {
      setTextError(errorMessage(error, 'Ingest failed'));
    } finally {
      setBusy(false);
    }
  };

  /* drag & drop ------------------------------------------------------------ */
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current += 1;
    setDragging(true);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    void uploadFiles(files);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  };

  const completedCount = queue.filter((item) => item.status === 'done').length;
  const failedCount = queue.filter((item) => item.status === 'error').length;

  return (
    <section
      className={cx(
        'rounded-lg border border-hairline bg-elevated/70 p-3 shadow-hairline backdrop-blur-xl',
        className,
      )}
    >
      {/* header */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Ingestion studio
        </p>

        <div
          role="tablist"
          aria-label="Ingestion mode"
          className="flex gap-0.5 rounded-pill bg-subtle p-0.5"
        >
          {(
            [
              { id: 'file', label: 'Upload files', icon: Upload },
              { id: 'text', label: 'Paste raw text', icon: ClipboardPaste },
            ] as const
          ).map((entry) => {
            const isActive = mode === entry.id;
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setMode(entry.id)}
                className={cx(
                  'relative flex h-6 items-center gap-1 rounded-pill px-2 text-[10.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  isActive ? 'text-accent' : 'text-ink-muted hover:text-ink',
                )}
              >
                {isActive ? (
                  <motion.span
                    layoutId="vault-ingest-mode"
                    transition={SPRING_SNAPPY}
                    className="absolute inset-0 rounded-pill border border-accent/20 bg-elevated shadow-hairline"
                  />
                ) : null}
                <Icon className="relative h-3 w-3" strokeWidth={2.2} />
                <span className="relative">{entry.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {mode === 'file' ? (
          <motion.div
            key="file"
            variants={FADE_UP}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={SPRING_SNAPPY}
          >
            <motion.div
              role="button"
              tabIndex={0}
              aria-label="Drop files here or open the file browser"
              aria-busy={busy}
              onClick={openPicker}
              onKeyDown={onKeyDown}
              onDragEnter={onDragEnter}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              animate={{
                scale: dragging ? 1.008 : 1,
                borderColor: dragging
                  ? 'rgb(var(--accent-rgb))'
                  : 'rgb(var(--border-hairline-rgb))',
                backgroundColor: dragging ? 'var(--accent-soft)' : 'var(--bg-subtle)',
              }}
              transition={SPRING_SNAPPY}
              className={cx(
                'relative flex cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-md border border-dashed px-4 py-7 text-center outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-accent/40',
                dragging && 'shadow-card',
                busy && 'cursor-progress',
              )}
            >
              {dragging ? (
                <motion.span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-md bg-[radial-gradient(circle_at_50%_0%,var(--accent-soft),transparent_70%)]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                />
              ) : null}

              <motion.span
                animate={{ y: dragging ? -2 : 0, scale: dragging ? 1.06 : 1 }}
                transition={SPRING_SNAPPY}
                className={cx(
                  'relative grid h-10 w-10 place-items-center rounded-full border',
                  dragging
                    ? 'border-accent/40 bg-elevated text-accent'
                    : 'border-hairline bg-elevated text-ink-muted',
                )}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
                ) : (
                  <CloudUpload className="h-4 w-4" strokeWidth={1.9} />
                )}
              </motion.span>

              <p className="relative text-[13px] font-medium text-ink">
                {dragging ? 'Release to ingest' : 'Drop files here, or click to browse'}
              </p>
              <p className="relative text-[10.5px] text-ink-muted">
                PDF · DOCX · MD · TXT · CSV · HTML — up to {formatBytes(MAX_FILE_BYTES)} each
              </p>

              <input
                ref={inputRef}
                type="file"
                multiple
                accept={SUPPORTED_EXTENSIONS.map((extension) => `.${extension}`).join(',')}
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  void uploadFiles(files);
                }}
              />
            </motion.div>
          </motion.div>
        ) : (
          <motion.div
            key="text"
            variants={FADE_UP}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={SPRING_SNAPPY}
            className="flex flex-col gap-2"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-ink-faint">
                  Title <span className="font-normal normal-case tracking-normal">(optional)</span>
                </span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Q3 Vendor Addendum"
                  className="h-8 rounded-[7px] border border-hairline bg-elevated px-2 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-accent/40"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-ink-faint">
                  Source <span className="font-normal normal-case tracking-normal">(optional)</span>
                </span>
                <input
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="confluence://legal/q3-addendum"
                  className="h-8 rounded-[7px] border border-hairline bg-elevated px-2 font-mono text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-accent/40"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.1em] text-ink-faint">
                <span>Text</span>
                <span className="tabular font-normal normal-case tracking-normal text-ink-muted">
                  {text.length.toLocaleString()} chars
                </span>
              </span>
              <textarea
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  if (textError) setTextError(null);
                }}
                rows={4}
                placeholder="Paste the document text to chunk and embed…"
                className="w-full resize-y rounded-[7px] border border-hairline bg-elevated p-2 text-[12px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-accent/40"
              />
            </label>

            <div className="grid gap-2 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-ink-faint">
                  Format
                </span>
                <select
                  value={format}
                  onChange={(event) => setFormat(event.target.value)}
                  className="h-8 rounded-[7px] border border-hairline bg-elevated px-1.5 font-mono text-[11px] text-ink outline-none focus:border-accent/40"
                >
                  {FORMAT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <NumberField
                label="chunk_size"
                value={chunkSize}
                min={INGEST_LIMITS.chunk_size.min}
                max={INGEST_LIMITS.chunk_size.max}
                step={INGEST_LIMITS.chunk_size.step}
                onChange={setChunkSize}
                disabled={busy}
              />
              <NumberField
                label="chunk_overlap"
                value={chunkOverlap}
                min={INGEST_LIMITS.chunk_overlap.min}
                max={Math.min(INGEST_LIMITS.chunk_overlap.max, chunkSize - 1)}
                step={INGEST_LIMITS.chunk_overlap.step}
                onChange={setChunkOverlap}
                disabled={busy}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <span
                className={cx(
                  'text-[10.5px]',
                  textError ? 'text-fail-ink' : 'text-ink-faint',
                )}
                role={textError ? 'alert' : undefined}
              >
                {textError ?? `≈ ${Math.max(1, Math.ceil(text.length / chunkSize))} chunks`}
              </span>
              <button
                type="button"
                onClick={() => void submitText()}
                disabled={busy || text.trim().length === 0}
                className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-[11px] font-semibold text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />
                ) : (
                  <ClipboardPaste className="h-3 w-3" strokeWidth={2.4} />
                )}
                Ingest text
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* upload queue */}
      <AnimatePresence initial={false}>
        {queue.length > 0 ? (
          <motion.div
            key="queue"
            variants={FADE_UP}
            initial="initial"
            animate="animate"
            exit="exit"
            className="mt-2.5 border-t border-hairline pt-2"
          >
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                Queue · {completedCount}/{queue.length} ingested
                {failedCount > 0 ? ` · ${failedCount} failed` : ''}
              </p>
              <button
                type="button"
                onClick={() => setQueue([])}
                disabled={busy}
                className="text-[10px] font-medium text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
              >
                Clear
              </button>
            </div>

            <ul className="flex flex-col gap-1" aria-live="polite">
              <AnimatePresence initial={false}>
                {queue.map((item) => (
                  <motion.li
                    key={item.id}
                    variants={FADE_UP}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    layout
                    className="flex items-center gap-2 rounded-[6px] border border-hairline bg-subtle/50 px-2 py-1.5"
                  >
                    <FileText className="h-3 w-3 shrink-0 text-ink-faint" strokeWidth={2} />
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">
                      {item.name}
                    </span>
                    <span className="tabular shrink-0 text-[10px] text-ink-faint">
                      {formatBytes(item.size)}
                    </span>
                    {item.status === 'error' ? (
                      <span className="flex min-w-0 shrink-0 items-center gap-1 text-[10px] text-fail-ink">
                        <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2.4} />
                        <span className="max-w-[10rem] truncate">{item.error ?? 'failed'}</span>
                      </span>
                    ) : item.status === 'done' ? (
                      <Check className="h-3 w-3 shrink-0 text-ok-ink" strokeWidth={3} />
                    ) : (
                      <Loader2
                        className={cx(
                          'h-3 w-3 shrink-0',
                          item.status === 'uploading' ? 'animate-spin text-accent' : 'text-ink-faint',
                        )}
                        strokeWidth={2.4}
                      />
                    )}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <span className="sr-only" role="status">
        {busy ? 'Ingesting' : 'Idle'}
      </span>
    </section>
  );
}

export default UploadZone;
