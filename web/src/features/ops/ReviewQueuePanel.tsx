/**
 * Meridian — HITL review queue.
 *
 * Low-confidence extracted fields land here for a human decision:
 *   • `GET  /v1/review/items`                     → the queue
 *   • `POST /v1/review/items/{id}/action`         → approve / reject / correct
 *   • `GET  /v1/review/golden-export`             → regression cases → `.json`
 *
 * Items are updated optimistically from the action response, but the row keeps
 * the reviewer's input if the backend echoes a partial object back.
 */
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  ChevronDown,
  Download,
  FileJson,
  Loader2,
  PencilLine,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Undo2,
  X,
} from 'lucide-react';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { StatusBadge, type StatusTone } from '../../components/shell/StatusBadge';
import { ApiError, apiFetch } from '../../core/api';
import { AuthContext } from '../../core/auth';
import { FADE_UP, SPRING_SNAPPY, STAGGER_CONTAINER, STAGGER_ITEM } from '../../core/motion';
import type { GoldenCase, ReviewItemResponse } from '../../core/types';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad|ipod/i.test(`${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return /^(true|1|yes)$/i.test(value.trim());
  return fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.detailMessage ?? error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/* -------------------------------------------------------------------------- */
/* Review items                                                               */
/* -------------------------------------------------------------------------- */

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'corrected';

export const REVIEW_STATUSES: ReviewStatus[] = ['pending', 'approved', 'rejected', 'corrected'];

export const STATUS_META: Record<ReviewStatus, { label: string; tone: StatusTone }> = {
  pending: { label: 'pending', tone: 'warn' },
  approved: { label: 'approved', tone: 'ok' },
  rejected: { label: 'rejected', tone: 'fail' },
  corrected: { label: 'corrected', tone: 'neutral' },
};

export function canonicalStatus(value: string | null | undefined): ReviewStatus {
  const text = (value ?? '').trim().toLowerCase();
  const match = REVIEW_STATUSES.find((status) => status === text);
  if (match) return match;
  if (text.startsWith('correct') || text === 'edited') return 'corrected';
  if (text.startsWith('approv') || text === 'accepted') return 'approved';
  if (text.startsWith('reject') || text === 'declined') return 'rejected';
  return 'pending';
}

/** `0.42` and `42` both mean 42%. Everything is normalised to 0–1. */
export function normalizeConfidence(value: unknown): number {
  const numeric = asNumber(value, 0);
  const ratio = numeric > 1 ? numeric / 100 : numeric;
  return Math.min(Math.max(ratio, 0), 1);
}

export function confidenceTone(confidence: number): StatusTone {
  if (confidence < 0.6) return 'fail';
  if (confidence < 0.8) return 'warn';
  return 'ok';
}

export function normalizeReviewItem(raw: unknown): ReviewItemResponse | null {
  if (!isRecord(raw)) return null;

  const id = asString(raw['id'] ?? raw['item_id']);
  if (!id) return null;

  const corrected = raw['corrected_value'];
  const notes = raw['notes'];

  return {
    id,
    extracted_field_id: asString(raw['extracted_field_id'] ?? raw['field_id'], ''),
    document_id: asString(raw['document_id'] ?? raw['doc_id'], ''),
    field_name: asString(raw['field_name'] ?? raw['field'], 'unknown_field'),
    value: asString(raw['value'] ?? raw['extracted_value'], ''),
    confidence: normalizeConfidence(raw['confidence'] ?? raw['score']),
    provenance_page: asNumber(raw['provenance_page'] ?? raw['page'], 0),
    status: canonicalStatus(asString(raw['status'], 'pending')),
    corrected_value: typeof corrected === 'string' && corrected.length > 0 ? corrected : null,
    notes: typeof notes === 'string' && notes.length > 0 ? notes : null,
  };
}

/** Accepts `ReviewItemResponse[]` or `{ items | results | data: [...] }`. */
export function normalizeReviewItems(raw: unknown): ReviewItemResponse[] {
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw)
      ? (['items', 'results', 'data', 'review_items'] as const).reduce<unknown[]>((found, key) => {
          if (found.length > 0) return found;
          const value = raw[key];
          return Array.isArray(value) ? value : found;
        }, [])
      : [];

  return list.flatMap((entry) => {
    const item = normalizeReviewItem(entry);
    return item ? [item] : [];
  });
}

export function countByStatus(items: ReviewItemResponse[]): Record<ReviewStatus, number> {
  const counts: Record<ReviewStatus, number> = {
    pending: 0,
    approved: 0,
    rejected: 0,
    corrected: 0,
  };
  for (const item of items) counts[canonicalStatus(item.status)] += 1;
  return counts;
}

/**
 * Turns a raw field id into a readable label: `liability_cap_usd` →
 * "Liability cap usd". The raw id stays on the payload; only the display
 * label changes.
 */
export function humanizeFieldName(fieldName: string): string {
  const cleaned = fieldName.replace(/[_\-.]+/g, ' ').trim();
  if (!cleaned) return 'Unknown field';
  return cleaned
    .split(' ')
    .map((word, index) => {
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      /* Keep acronyms as written (`USD`), everything else reads as a word. */
      if (word.length > 1 && word === word.toUpperCase()) return word;
      return word.toLowerCase();
    })
    .join(' ');
}

/** Reviewer notes and corrected text, kept per review item. */
interface ReviewDraft {
  value: string;
  notes: string;
}

const EMPTY_DRAFT: ReviewDraft = { value: '', notes: '' };

/* -------------------------------------------------------------------------- */
/* Golden export                                                              */
/* -------------------------------------------------------------------------- */

export function normalizeGoldenCases(raw: unknown): GoldenCase[] {
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw)
      ? (['cases', 'items', 'results', 'golden_cases'] as const).reduce<unknown[]>((found, key) => {
          if (found.length > 0) return found;
          const value = raw[key];
          return Array.isArray(value) ? value : found;
        }, [])
      : [];

  return list.flatMap((entry, index): GoldenCase[] => {
    if (!isRecord(entry)) return [];
    const phrases = entry['expected_phrases'] ?? entry['phrases'];
    return [
      {
        id: asString(entry['id'], `case_${index}`),
        category: asString(entry['category'], 'uncategorised'),
        question: asString(entry['question'], ''),
        answerable: asBool(entry['answerable'], true),
        expected_doc:
          typeof entry['expected_doc'] === 'string' && entry['expected_doc'].length > 0
            ? entry['expected_doc']
            : null,
        expected_phrases: Array.isArray(phrases)
          ? phrases.filter((phrase): phrase is string => typeof phrase === 'string')
          : [],
        notes: asString(entry['notes'], ''),
      },
    ];
  });
}

export function buildGoldenDownload(
  cases: GoldenCase[],
  today: Date = new Date(),
): { filename: string; json: string } {
  const stamp = today.toISOString().slice(0, 10);
  return {
    filename: `meridian-golden-cases-${stamp}.json`,
    json: `${JSON.stringify(cases, null, 2)}\n`,
  };
}

/** Blob download with a data-URI fallback (jsdom / older browsers). */
export function downloadJsonFile(filename: string, json: string): boolean {
  if (typeof document === 'undefined') return false;

  const canObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  let href = '';
  if (canObjectUrl) {
    href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  } else {
    href = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  }

  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  if (canObjectUrl) {
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

function ConfidenceMeter({ value }: { value: number }) {
  const tone = confidenceTone(value);
  const percent = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-[68px] shrink-0 text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
        confidence
      </span>
      <div
        className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-subtle"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Extraction confidence"
      >
        <motion.span
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={SPRING_SNAPPY}
          className={cx(
            'absolute inset-y-0 left-0 rounded-full',
            tone === 'fail' ? 'bg-fail' : tone === 'warn' ? 'bg-warn' : 'bg-ok',
          )}
        />
      </div>
      <span
        className={cx(
          'tabular w-8 shrink-0 text-right font-mono text-[10px] font-semibold',
          tone === 'fail' ? 'text-fail-ink' : tone === 'warn' ? 'text-warn-ink' : 'text-ok-ink',
        )}
      >
        {percent}%
      </span>
    </div>
  );
}

interface ReviewCardProps {
  item: ReviewItemResponse;
  busy: boolean;
  editing: boolean;
  draft: ReviewDraft;
  onDraftChange: (patch: Partial<ReviewDraft>) => void;
  onStartCorrect: () => void;
  onCancelCorrect: () => void;
  onAction: (action: 'approve' | 'reject' | 'correct') => void;
}

function ReviewCard({
  item,
  busy,
  editing,
  draft,
  onDraftChange,
  onStartCorrect,
  onCancelCorrect,
  onAction,
}: ReviewCardProps) {
  const status = canonicalStatus(item.status);
  const meta = STATUS_META[status];
  const reviewed = status !== 'pending';
  const percent = Math.round(item.confidence * 100);

  return (
    <motion.li
      variants={STAGGER_ITEM}
      layout
      className={cx(
        'group relative flex flex-col gap-2.5 overflow-hidden rounded-lg border bg-elevated/80 p-3.5 shadow-hairline backdrop-blur-xl transition-colors',
        reviewed ? 'border-hairline/70' : 'border-hairline hover:border-accent/25',
      )}
    >
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <StatusBadge tone={meta.tone} size="sm" label={meta.label} />
          <span
            className="min-w-0 truncate text-[11.5px] font-semibold tracking-[-0.01em] text-ink"
            title={item.field_name}
          >
            {humanizeFieldName(item.field_name)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 font-mono text-[9.5px] text-ink-faint">
          <span className="max-w-[9rem] truncate" title={item.document_id}>
            {item.document_id || 'Unknown document'}
          </span>
          <span className="opacity-40">·</span>
          <span className="tabular">
            {item.provenance_page ? `Page ${item.provenance_page}` : 'Page unknown'}
          </span>
        </div>
      </div>

      {/* value */}
      <div className="flex flex-col gap-1">
        <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
          extracted value
        </p>
        <p
          className={cx(
            'break-words rounded-[6px] border border-hairline bg-subtle/50 px-2 py-1.5 text-[12.5px] leading-relaxed',
            item.corrected_value ? 'text-ink-muted line-through decoration-fail/40' : 'text-ink',
          )}
        >
          {item.value || <span className="italic text-ink-faint">empty extraction</span>}
        </p>

        {item.corrected_value ? (
          <div className="flex flex-col gap-0.5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-accent">
              corrected value
            </p>
            <p className="break-words rounded-[6px] border border-accent/25 bg-accent-soft px-2 py-1.5 text-[12.5px] leading-relaxed text-ink">
              {item.corrected_value}
            </p>
          </div>
        ) : null}

        {item.notes ? (
          <p className="flex items-start gap-1 text-[10.5px] leading-relaxed text-ink-muted">
            <PencilLine className="mt-[2px] h-2.5 w-2.5 shrink-0 text-ink-faint" strokeWidth={2.2} />
            {item.notes}
          </p>
        ) : null}
      </div>

      <ConfidenceMeter value={item.confidence} />

      {/* actions */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onAction('approve')}
          disabled={busy}
          className="inline-flex h-7 items-center gap-1 rounded-pill border border-ok/30 bg-ok-soft px-2.5 text-[10.5px] font-semibold text-ok-ink transition-colors hover:border-ok/60 disabled:cursor-progress disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ok/40"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.6} />
          ) : (
            <ThumbsUp className="h-3 w-3" strokeWidth={2.4} />
          )}
          Approve
        </button>

        <button
          type="button"
          onClick={() => onAction('reject')}
          disabled={busy}
          className="inline-flex h-7 items-center gap-1 rounded-pill border border-fail/30 bg-fail-soft px-2.5 text-[10.5px] font-semibold text-fail-ink transition-colors hover:border-fail/60 disabled:cursor-progress disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fail/40"
        >
          <ThumbsDown className="h-3 w-3" strokeWidth={2.4} />
          Reject
        </button>

        <button
          type="button"
          onClick={editing ? onCancelCorrect : onStartCorrect}
          disabled={busy}
          aria-expanded={editing}
          className={cx(
            'inline-flex h-7 items-center gap-1 rounded-pill border px-2.5 text-[10.5px] font-semibold transition-colors disabled:cursor-progress disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            editing
              ? 'border-hairline bg-subtle text-ink-muted hover:text-ink'
              : 'border-accent/25 bg-accent-soft text-accent hover:border-accent/50',
          )}
        >
          {editing ? (
            <Undo2 className="h-3 w-3" strokeWidth={2.4} />
          ) : (
            <PencilLine className="h-3 w-3" strokeWidth={2.4} />
          )}
          {editing ? 'Cancel edit' : 'Correct'}
        </button>

        <span className="ml-auto flex items-center gap-1 font-mono text-[9.5px] text-ink-faint">
          {status === 'pending' ? `${percent}% · needs review` : `reviewed · ${meta.label}`}
        </span>
      </div>

      {/* inline correction editor */}
      <AnimatePresence initial={false}>
        {editing ? (
          <motion.div
            key="editor"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING_SNAPPY}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 rounded-[7px] border border-accent/25 bg-accent-soft/60 p-2.5">
              <label className="flex flex-col gap-1">
                <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-accent">
                  corrected value
                </span>
                <textarea
                  value={draft.value}
                  onChange={(event) => onDraftChange({ value: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      onAction('correct');
                    }
                  }}
                  rows={2}
                  autoFocus
                  aria-label="Corrected value"
                  placeholder="The value a reviewer would trust…"
                  className="w-full resize-y rounded-[6px] border border-accent/30 bg-elevated px-2 py-1.5 text-[12px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-accent/60"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                  notes <span className="font-normal normal-case tracking-normal">(optional)</span>
                </span>
                <input
                  value={draft.notes}
                  onChange={(event) => onDraftChange({ notes: event.target.value })}
                  aria-label="Review notes"
                  placeholder="Why is the extraction wrong?"
                  className="h-7 w-full rounded-[6px] border border-hairline bg-elevated px-2 text-[11.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent/40"
                />
              </label>

              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[9.5px] text-ink-faint">
                  {IS_MAC ? '⌘' : 'Ctrl'} + Enter to save
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onCancelCorrect}
                    disabled={busy}
                    className="inline-flex h-6 items-center rounded-pill border border-hairline bg-elevated px-2 text-[10px] font-medium text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => onAction('correct')}
                    disabled={busy || draft.value.trim().length === 0}
                    className="inline-flex h-6 items-center gap-1 rounded-pill bg-accent px-2.5 text-[10px] font-semibold text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    {busy ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={2.8} />
                    ) : (
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    )}
                    Save correction
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

type FilterKey = 'all' | ReviewStatus;

const FILTER_ORDER: FilterKey[] = ['all', 'pending', 'approved', 'rejected', 'corrected'];

const ACTION_STATUS: Record<'approve' | 'reject' | 'correct', ReviewStatus> = {
  approve: 'approved',
  reject: 'rejected',
  correct: 'corrected',
};

const ACTION_VERB: Record<'approve' | 'reject' | 'correct', string> = {
  approve: 'Approved',
  reject: 'Rejected',
  correct: 'Corrected',
};

export interface ReviewQueuePanelProps {
  className?: string;
  /** Reports queue counts so a host view can badge its tab. */
  onStats?: (stats: { total: number; pending: number }) => void;
  /** Fired after a successful golden export. */
  onExported?: (count: number, filename: string) => void;
}

export function ReviewQueuePanel({ className, onStats, onExported }: ReviewQueuePanelProps) {
  const { tenantId } = useContext(AuthContext) ?? { tenantId: 'default' };
  const [items, setItems] = useState<ReviewItemResponse[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [filter, setFilter] = useState<FilterKey>('pending');
  const [editingId, setEditingId] = useState<string | null>(null);
  /** One draft per review item, so notes can never cross between cards. */
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  /** Ids of the items with an action in flight. */
  const [actingIds, setActingIds] = useState<ReadonlySet<string>>(() => new Set());

  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ tone: StatusTone; message: string } | null>(null);

  const noticeTimer = useRef<number | null>(null);

  const flash = useCallback((tone: StatusTone, message: string) => {
    setNotice({ tone, message });
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 5200);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  const load = useCallback(async (mode: 'initial' | 'manual' = 'initial') => {
    if (mode === 'initial') setStatus('loading');
    else setRefreshing(true);
    setError(null);
    try {
      const raw = await apiFetch<unknown>('/v1/review/items');
      setItems(normalizeReviewItems(raw));
      setStatus('ready');
    } catch (cause) {
      setError(errorMessage(cause, 'Could not load the review queue'));
      setStatus('error');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('initial');
  }, [load, tenantId]);

  const counts = useMemo(() => countByStatus(items), [items]);

  useEffect(() => {
    onStats?.({ total: items.length, pending: counts.pending });
  }, [counts.pending, items.length, onStats]);

  const visible = useMemo(
    () =>
      filter === 'all' ? items : items.filter((item) => canonicalStatus(item.status) === filter),
    [filter, items],
  );

  const startCorrect = useCallback((item: ReviewItemResponse) => {
    setEditingId(item.id);
    setDrafts((current) => ({
      ...current,
      [item.id]: { value: item.corrected_value ?? item.value, notes: item.notes ?? '' },
    }));
  }, []);

  const cancelCorrect = useCallback((id: string) => {
    setEditingId((current) => (current === id ? null : current));
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const changeDraft = useCallback((id: string, patch: Partial<ReviewDraft>) => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] ?? EMPTY_DRAFT), ...patch },
    }));
  }, []);

  const act = useCallback(
    async (item: ReviewItemResponse, action: 'approve' | 'reject' | 'correct') => {
      /* Only this item's draft may travel with this item's decision. */
      const draft = drafts[item.id] ?? EMPTY_DRAFT;
      const correctedValue = action === 'correct' ? draft.value.trim() : null;
      if (action === 'correct' && !correctedValue) return;

      setActingIds((current) => new Set(current).add(item.id));
      try {
        const raw = await apiFetch<unknown>(
          `/v1/review/items/${encodeURIComponent(item.id)}/action`,
          {
            method: 'POST',
            body: JSON.stringify({
              action,
              corrected_value: correctedValue,
              notes: draft.notes.trim() || null,
            }),
          },
        );

        const echoed = normalizeReviewItem(raw);
        const nextStatus = ACTION_STATUS[action];
        const merged: ReviewItemResponse = {
          ...item,
          ...(echoed ?? {}),
          id: item.id,
          status: canonicalStatus(echoed?.status ?? nextStatus),
          corrected_value:
            action === 'correct' ? (correctedValue ?? item.corrected_value ?? null) : item.corrected_value ?? null,
          notes: draft.notes.trim() || item.notes || null,
        };

        setItems((current) => current.map((entry) => (entry.id === item.id ? merged : entry)));
        setEditingId((current) => (current === item.id ? null : current));
        setDrafts((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
        flash(
          action === 'reject' ? 'warn' : 'ok',
          `${ACTION_VERB[action]} “${humanizeFieldName(item.field_name)}” · ${item.document_id || item.id}`,
        );
      } catch (cause) {
        flash('fail', errorMessage(cause, `${ACTION_VERB[action]} failed`));
      } finally {
        setActingIds((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      }
    },
    [drafts, flash],
  );

  const exportGolden = useCallback(async () => {
    setExporting(true);
    try {
      const raw = await apiFetch<unknown>('/v1/review/golden-export');
      const cases = normalizeGoldenCases(raw);
      if (cases.length === 0) {
        flash('warn', 'Golden export is empty — nothing to download yet');
        return;
      }
      const { filename, json } = buildGoldenDownload(cases);
      downloadJsonFile(filename, json);
      onExported?.(cases.length, filename);
      flash(
        'ok',
        `Exported ${cases.length} golden case${cases.length === 1 ? '' : 's'} → ${filename}`,
      );
    } catch (cause) {
      flash('fail', errorMessage(cause, 'Golden export failed'));
    } finally {
      setExporting(false);
    }
  }, [flash, onExported]);

  const pendingTotal = counts.pending;
  const allReviewed = status === 'ready' && items.length > 0 && pendingTotal === 0;

  return (
    <div className={cx('flex flex-col gap-3.5', className)}>
      {/* ---------------- header ---------------- */}
      <motion.section
        variants={FADE_UP}
        initial={false}
        animate="animate"
        className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-hairline bg-elevated/70 px-3 py-2.5 shadow-hairline backdrop-blur-xl"
      >
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            Human in the loop
            <span className="opacity-40">·</span>
            <span className="tabular">{pendingTotal} pending</span>
            <span className="opacity-40">·</span>
            <span className="tabular">{items.length} total</span>
          </p>
          <h2 className="mt-1 text-[15px] font-semibold tracking-[-0.02em] text-ink">
            Review queue
          </h2>
          <p className="mt-0.5 max-w-lg text-[11.5px] leading-relaxed text-ink-muted">
            Low-confidence extractions that need a human decision before they reach the knowledge
            graph.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => void load('manual')}
            disabled={refreshing || status === 'loading'}
            aria-label="Refresh review queue"
            className="inline-flex h-8 items-center gap-1.5 rounded-pill border border-hairline bg-elevated px-2.5 text-[11px] font-semibold text-ink-muted transition-colors hover:text-ink disabled:cursor-progress disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {refreshing ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.6} />
            ) : (
              <RefreshCw className="h-3 w-3" strokeWidth={2.6} />
            )}
            Refresh
          </button>

          <button
            type="button"
            onClick={() => void exportGolden()}
            disabled={exporting}
            className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-accent px-3 text-[11px] font-semibold text-accent-contrast shadow-hairline transition-colors hover:bg-accent-hover disabled:cursor-progress disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {exporting ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.6} />
            ) : (
              <Download className="h-3 w-3" strokeWidth={2.6} />
            )}
            {exporting ? 'Exporting…' : 'Download Golden JSON'}
          </button>
        </div>
      </motion.section>

      {/* ---------------- notice ---------------- */}
      <AnimatePresence initial={false}>
        {notice ? (
          <motion.div
            key="notice"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={SPRING_SNAPPY}
            role="status"
            aria-live="polite"
            className={cx(
              'flex items-center gap-2 rounded-[7px] border px-2.5 py-1.5',
              notice.tone === 'ok'
                ? 'border-ok/30 bg-ok-soft'
                : notice.tone === 'fail'
                  ? 'border-fail/30 bg-fail-soft'
                  : 'border-warn/30 bg-warn-soft',
            )}
          >
            {notice.tone === 'ok' ? (
              <CheckCheck className="h-3 w-3 shrink-0 text-ok-ink" strokeWidth={2.6} />
            ) : (
              <AlertTriangle
                className={cx(
                  'h-3 w-3 shrink-0',
                  notice.tone === 'fail' ? 'text-fail-ink' : 'text-warn-ink',
                )}
                strokeWidth={2.4}
              />
            )}
            <p
              className={cx(
                'min-w-0 flex-1 truncate text-[11px] font-medium',
                notice.tone === 'ok'
                  ? 'text-ok-ink'
                  : notice.tone === 'fail'
                    ? 'text-fail-ink'
                    : 'text-warn-ink',
              )}
              title={notice.message}
            >
              {notice.message}
            </p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss notification"
              className="relative grid h-4 w-4 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:text-ink before:absolute before:-inset-[12px] before:content-['']"
            >
              <X className="h-3 w-3" strokeWidth={2.6} />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ---------------- filters ---------------- */}
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter review items">
        {FILTER_ORDER.map((key) => {
          const active = filter === key;
          const count = key === 'all' ? items.length : counts[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={active}
              className={cx(
                'relative inline-flex h-7 items-center gap-1 rounded-pill border px-2 text-[10px] font-medium uppercase tracking-[0.06em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                active
                  ? 'border-accent/30 bg-accent-soft text-accent'
                  : 'border-hairline bg-elevated/60 text-ink-muted hover:text-ink',
              )}
            >
              {active ? (
                <motion.span
                  layoutId="review-filter-pill"
                  transition={SPRING_SNAPPY}
                  className="absolute inset-0 -z-10 rounded-pill border border-accent/30 bg-accent-soft/60"
                />
              ) : null}
              {key === 'all' ? 'all' : STATUS_META[key].label}
              <span className={cx('tabular', active ? 'text-accent/70' : 'text-ink-faint')}>
                {count}
              </span>
            </button>
          );
        })}

        <span className="ml-auto font-mono text-[9.5px] text-ink-faint">
          {visible.length} shown
        </span>
      </div>

      {/* ---------------- body ---------------- */}
      {status === 'loading' ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((key) => (
            <div
              key={key}
              className="h-[168px] animate-pulse rounded-lg border border-hairline bg-subtle/50"
            />
          ))}
          <span className="sr-only">Loading review items…</span>
        </div>
      ) : status === 'error' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-fail/30 bg-fail-soft px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[11.5px] text-fail-ink">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
            {error}
          </p>
          <button
            type="button"
            onClick={() => void load('manual')}
            className="inline-flex h-6 items-center gap-1 rounded-pill border border-fail/30 bg-elevated px-2 text-[10.5px] font-semibold text-fail-ink transition-colors hover:border-fail/60"
          >
            <RefreshCw className="h-2.5 w-2.5" strokeWidth={2.6} />
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <motion.div
          variants={FADE_UP}
          initial={false}
          animate="animate"
          className="flex flex-col items-center gap-2.5 rounded-lg border border-dashed border-hairline bg-elevated/40 px-6 py-10 text-center"
        >
          <span className="grid h-10 w-10 place-items-center rounded-full border border-ok/30 bg-ok-soft text-ok-ink">
            <CheckCheck className="h-4 w-4" strokeWidth={2} />
          </span>
          <div>
            <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">
              Review queue is clear
            </h3>
            <p className="mx-auto mt-0.5 max-w-sm text-[11.5px] leading-relaxed text-ink-muted">
              Nothing is waiting on a human. Low-confidence extractions will appear here as new
              documents are ingested.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void exportGolden()}
            disabled={exporting}
            className="inline-flex h-7 items-center gap-1.5 rounded-pill border border-hairline bg-elevated px-2.5 text-[10.5px] font-semibold text-ink-muted transition-colors hover:text-ink disabled:opacity-60"
          >
            <FileJson className="h-3 w-3" strokeWidth={2.4} />
            Download golden set
          </button>
        </motion.div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-hairline px-6 py-9 text-center">
          <p className="text-[12.5px] font-medium text-ink">
            Nothing is {filter === 'all' ? 'queued' : filter}
          </p>
          <p className="text-[11px] text-ink-muted">
            {allReviewed
              ? 'Every item has been reviewed. Nice.'
              : 'Try another status filter to see reviewed items.'}
          </p>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className="mt-1 inline-flex h-7 items-center gap-1 rounded-pill border border-hairline bg-elevated px-2.5 text-[10.5px] font-medium text-ink-muted transition-colors hover:text-ink"
          >
            <ChevronDown className="h-3 w-3" strokeWidth={2.4} />
            Show all {items.length}
          </button>
        </div>
      ) : (
        <motion.ul
          variants={STAGGER_CONTAINER}
          initial={false}
          animate="animate"
          className="flex flex-col gap-2"
        >
          {/* no key: filter changes reuse the list so ReviewCard's `layout` reflows instead of remounting. */}
          {visible.map((item) => (
            <ReviewCard
              key={item.id}
              item={item}
              busy={actingIds.has(item.id)}
              editing={editingId === item.id}
              draft={drafts[item.id] ?? EMPTY_DRAFT}
              onDraftChange={(patch) => changeDraft(item.id, patch)}
              onStartCorrect={() => startCorrect(item)}
              onCancelCorrect={() => cancelCorrect(item.id)}
              onAction={(action) => void act(item, action)}
            />
          ))}
        </motion.ul>
      )}
    </div>
  );
}

export default ReviewQueuePanel;
