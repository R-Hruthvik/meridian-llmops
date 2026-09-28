import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ClipboardCheck, RefreshCw, XCircle } from 'lucide-react';
import { api } from '../services/api';
import type { ReviewItem } from '../types/api';

interface ReviewQueueProps {
  tenantId: string;
}

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
    <div className="space-y-4">
      {toast && (
        <div role="alert" aria-live="polite" className="px-4 py-3 rounded-2xl bg-emerald-600 text-white text-xs font-bold shadow-2xl">
          {toast}
        </div>
      )}

      <div className="bg-white/80 backdrop-blur-md border border-meridian-border rounded-3xl p-4 shadow-card flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-2">
          <ClipboardCheck className="w-4 h-4 text-meridian-primary" />
          <h3 className="text-xs font-bold text-meridian-text">Pending Review Items ({items.length})</h3>
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-meridian-lavenderLight border border-meridian-border text-meridian-primary"
            title="The review queue is shared across tenants"
          >
            Global
          </span>
        </div>
        <button
          onClick={() => void fetchItems()}
          disabled={loading}
          aria-label="Refresh review queue"
          className="p-2 rounded-xl bg-white border border-meridian-border text-meridian-textMuted hover:text-meridian-primary hover:bg-meridian-bg transition-all text-xs font-semibold flex items-center space-x-1.5 shadow-sm cursor-pointer focus-visible:ring-2 focus-visible:ring-meridian-primary focus-visible:outline-none"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-meridian-primary' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {error && (
        <div role="alert" aria-live="polite" className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
          {error}
        </div>
      )}

      {items.length === 0 && !loading && !error ? (
        <div className="text-center py-16 bg-white/80 backdrop-blur-md border border-dashed border-meridian-border rounded-3xl shadow-card">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-emerald-500" />
          <h4 className="text-sm font-bold text-meridian-text">Review queue is clear</h4>
          <p className="text-xs text-meridian-textMuted mt-1">No pending low-confidence extractions need human review.</p>
        </div>
      ) : (
        <div className="bg-white/80 backdrop-blur-md border border-meridian-border rounded-3xl shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-meridian-border text-left text-meridian-textMuted">
                  <th className="px-4 py-3 font-bold">Field</th>
                  <th className="px-4 py-3 font-bold">Value</th>
                  <th className="px-4 py-3 font-bold">Confidence</th>
                  <th className="px-4 py-3 font-bold">Document</th>
                  <th className="px-4 py-3 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <React.Fragment key={item.id}>
                    <tr className="border-b border-meridian-border/60 hover:bg-meridian-bg/50">
                      <td className="px-4 py-3 font-bold text-meridian-text">{item.field_name}</td>
                      <td className="px-4 py-3 font-mono text-meridian-text max-w-xs truncate" title={item.value}>
                        {item.value}
                      </td>
                      <td className="px-4 py-3 text-meridian-textMuted">{(item.confidence * 100).toFixed(0)}%</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-meridian-textMuted max-w-[140px] truncate" title={item.document_id}>
                        {item.document_id}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end space-x-1.5">
                          <button
                            onClick={() => void handleAction(item.id, 'approve')}
                            disabled={actingId === item.id}
                            aria-label={`Approve ${item.field_name}`}
                            className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-[11px] font-bold flex items-center space-x-1 transition-all disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-meridian-primary focus-visible:outline-none"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Approve</span>
                          </button>
                          <button
                            onClick={() => void handleAction(item.id, 'reject')}
                            disabled={actingId === item.id}
                            aria-label={`Reject ${item.field_name}`}
                            className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-[11px] font-bold flex items-center space-x-1 transition-all disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-meridian-primary focus-visible:outline-none"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Reject</span>
                          </button>
                          <button
                            onClick={() => {
                              setCorrectingId(correctingId === item.id ? null : item.id);
                              setCorrectedValue(item.value);
                              setNotes('');
                            }}
                            className="px-3 py-1.5 rounded-xl bg-meridian-lavenderLight hover:bg-meridian-blossom border border-meridian-border text-meridian-primary text-[11px] font-bold transition-all focus-visible:ring-2 focus-visible:ring-meridian-primary focus-visible:outline-none"
                          >
                            Correct
                          </button>
                        </div>
                      </td>
                    </tr>
                    {correctingId === item.id && (
                      <tr className="border-b border-meridian-border/60 bg-meridian-bg/40">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={correctedValue}
                              onChange={(e) => setCorrectedValue(e.target.value)}
                              placeholder="Corrected value"
                              aria-label="Corrected value"
                              className="flex-1 min-w-[200px] bg-white border border-meridian-border rounded-xl px-3 py-1.5 text-xs text-meridian-text outline-none focus-visible:ring-2 focus-visible:ring-meridian-primary focus:border-meridian-primary"
                            />
                            <input
                              type="text"
                              value={notes}
                              onChange={(e) => setNotes(e.target.value)}
                              placeholder="Note (optional)"
                              aria-label="Review note"
                              className="flex-1 min-w-[160px] bg-white border border-meridian-border rounded-xl px-3 py-1.5 text-xs text-meridian-text outline-none focus-visible:ring-2 focus-visible:ring-meridian-primary focus:border-meridian-primary"
                            />
                            <button
                              onClick={() => void handleAction(item.id, 'correct', correctedValue, notes || undefined)}
                              disabled={actingId === item.id || !correctedValue.trim()}
                              className="px-4 py-1.5 rounded-xl bg-meridian-primary hover:bg-meridian-primaryHover text-white text-[11px] font-bold shadow-glow disabled:opacity-50 transition-all focus-visible:ring-2 focus-visible:ring-meridian-primary focus-visible:outline-none"
                            >
                              Submit correction
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
