import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Pencil, RefreshCw, X } from 'lucide-react';
import { api } from '../services/api';
import type { ReviewItem } from '../types/api';

interface ReviewQueueProps {
  tenantId: string;
}

/** Ids are UUIDs; the leading 8 chars are enough to name a row. */
const shortId = (id: string) => `${id.slice(0, 8)}…`;

export const ReviewQueue: React.FC<ReviewQueueProps> = ({ tenantId }) => {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctedValue, setCorrectedValue] = useState('');
  const [notes, setNotes] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (toastTimer.current !== null) {
      clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
  }, []);

  const actionPastTense: Record<string, string> = {
    approve: 'approved',
    reject: 'rejected',
    correct: 'corrected',
  };

  const fetchItems = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listReviewItems(tenantId);
      setItems(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load review queue');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [tenantId]);

  const handleAction = async (itemId: string, action: string, corrected?: string, note?: string) => {
    setActingId(itemId);
    try {
      await api.reviewItemAction(
        itemId,
        { action, corrected_value: corrected, notes: note },
        tenantId,
      );
      setToast(`Item ${actionPastTense[action] ?? `${action}d`} successfully.`);
      setCorrectingId(null);
      setCorrectedValue('');
      setNotes('');
      await fetchItems();
    } catch (err: unknown) {
      setToast(err instanceof Error ? err.message : 'Review action failed');
    } finally {
      setActingId(null);
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(null), 3500);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {toast && (
        <div role="alert" aria-live="polite" className="rounded-sm border border-ok/30 bg-ok-wash px-3 py-2 text-label font-semibold text-ok">
          {toast}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="size-3.5 text-accent" aria-hidden="true" />
          <h3 className="label-section text-ink">
            Pending review · <span className="num">{items.length}</span>
          </h3>
          <span
            className="rounded-sm border border-hairline bg-surface-sunken px-1.5 py-0.5 text-micro font-bold uppercase tracking-[0.12em] text-accent-ink"
            title="The review queue is shared across tenants"
          >
            Global
          </span>
        </div>
        <button
          onClick={() => void fetchItems()}
          disabled={loading}
          aria-label="Refresh review queue"
          className="flex cursor-pointer items-center gap-1.5 rounded-sm border border-hairline bg-surface-raised px-2 py-1 text-label font-semibold text-muted transition-colors hover:border-accent hover:text-accent-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin text-accent' : ''}`} aria-hidden="true" />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {error && (
        <div role="alert" aria-live="polite" className="rounded-sm border border-fail/30 bg-fail-wash px-3 py-2 text-label text-fail">
          {error}
        </div>
      )}

      {items.length === 0 && !loading && !error ? (
        <div className="rounded-sm border border-dashed border-hairline bg-surface-sunken px-4 py-10 text-center">
          <CheckCircle2 className="mx-auto mb-2 size-5 text-ok" aria-hidden="true" />
          <h4 className="text-label font-bold text-ink">Review queue is clear</h4>
          <p className="mt-1 text-micro text-muted">No pending low-confidence extractions need human review.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-hairline">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Pending low-confidence extractions awaiting human approval, rejection or correction
            </caption>
            <thead>
              <tr className="border-b border-hairline bg-surface-sunken">
                <th scope="col" className="px-3 py-2 label-section text-muted">Item</th>
                <th scope="col" className="px-3 py-2 label-section text-muted">Entity</th>
                <th scope="col" className="px-3 py-2 label-section text-muted">Confidence</th>
                <th
                  scope="col"
                  className="px-3 py-2 label-section text-muted"
                  title="The review API returns no timestamp, so age is unavailable"
                >
                  Age
                </th>
                <th scope="col" className="px-3 py-2 text-right label-section text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const pct = Math.round(item.confidence * 100);
                return (
                  <React.Fragment key={item.id}>
                    <tr className="border-b border-hairline transition-colors last:border-b-0 hover:bg-accent-wash/50">
                      <td className="id-mono whitespace-nowrap px-3 py-2 text-faint" title={item.id}>
                        {shortId(item.id)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-label font-semibold text-ink">{item.field_name}</div>
                        <div className="id-mono truncate text-faint" title={item.document_id}>
                          {item.document_id}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="num w-9 text-label font-semibold text-ink">{pct}%</span>
                          <span
                            role="progressbar"
                            aria-label={`Confidence for ${item.field_name}`}
                            aria-valuenow={pct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            className="h-1 w-14 overflow-hidden rounded-pill bg-surface-sunken"
                          >
                            <span
                              className="block h-full rounded-pill bg-accent"
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {/* No timestamp exists on the review response; age reads
                            as unavailable rather than a fabricated duration. */}
                        <span
                          data-testid="review-age-unavailable"
                          className="num text-label text-faint"
                          title="The review API returns no timestamp, so age is unavailable"
                        >
                          —
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => void handleAction(item.id, 'approve')}
                            disabled={actingId === item.id}
                            aria-label={`Approve ${item.field_name}`}
                            className="flex items-center gap-1 rounded-sm border border-ok/30 bg-ok-wash px-2 py-1 text-micro font-bold text-ok transition-colors hover:bg-ok hover:text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <CheckCircle2 className="size-3" aria-hidden="true" />
                            <span>Approve</span>
                          </button>
                          <button
                            onClick={() => void handleAction(item.id, 'reject')}
                            disabled={actingId === item.id}
                            aria-label={`Reject ${item.field_name}`}
                            className="flex items-center gap-1 rounded-sm border border-fail/30 bg-fail-wash px-2 py-1 text-micro font-bold text-fail transition-colors hover:bg-fail hover:text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <X className="size-3" aria-hidden="true" />
                            <span>Reject</span>
                          </button>
                          <button
                            onClick={() => {
                              setCorrectingId(correctingId === item.id ? null : item.id);
                              setCorrectedValue(item.value);
                              setNotes('');
                            }}
                            className="flex items-center gap-1 rounded-sm border border-hairline bg-surface-raised px-2 py-1 text-micro font-bold text-accent-ink transition-colors hover:border-accent hover:bg-accent-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <Pencil className="size-3" aria-hidden="true" />
                            <span>Correct</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                    {correctingId === item.id && (
                      <tr className="border-b border-hairline bg-surface-sunken last:border-b-0">
                        <td colSpan={5} className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={correctedValue}
                              onChange={(e) => setCorrectedValue(e.target.value)}
                              placeholder="Corrected value"
                              aria-label="Corrected value"
                              className="min-w-[200px] flex-1 rounded-sm border border-hairline bg-surface-raised px-2 py-1 text-label text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
                            />
                            <input
                              type="text"
                              value={notes}
                              onChange={(e) => setNotes(e.target.value)}
                              placeholder="Note (optional)"
                              aria-label="Review note"
                              className="min-w-[160px] flex-1 rounded-sm border border-hairline bg-surface-raised px-2 py-1 text-label text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
                            />
                            <button
                              onClick={() => void handleAction(item.id, 'correct', correctedValue, notes || undefined)}
                              disabled={actingId === item.id || !correctedValue.trim()}
                              className="rounded-sm bg-accent px-3 py-1 text-micro font-bold text-white transition-colors hover:bg-accent-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                              Submit correction
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
