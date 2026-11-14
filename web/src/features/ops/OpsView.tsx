/**
 * Meridian — Operations & Review Studio.
 *
 * A single surface with a segmented pill switcher over two very different jobs:
 *   • System & Index — liveness, index stores, rebuild, raw metrics
 *   • Review Queue — low-confidence extractions, golden-set export
 *
 * The switcher is a real tablist (roving tabindex + arrow keys) with a shared
 * `layoutId="ops-tab"` pill so the selection glides instead of cutting.
 */
import { motion } from 'framer-motion';
import { Activity, CheckCheck, Layers } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { apiFetch } from '../../core/api';
import { SPRING_SNAPPY, STAGGER_ITEM } from '../../core/motion';
import IndexTelemetryPanel from './IndexTelemetryPanel';
import ReviewQueuePanel, { normalizeReviewItems } from './ReviewQueuePanel';

/* -------------------------------------------------------------------------- */
/* Tabs                                                                       */
/* -------------------------------------------------------------------------- */

export type OpsTab = 'system' | 'review';

export const OPS_TABS: Array<{ id: OpsTab; label: string; hint: string }> = [
  { id: 'system', label: 'System & Index', hint: 'health · stores · reindex · metrics' },
  { id: 'review', label: 'Review Queue', hint: 'extractions waiting on a human' },
];

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* -------------------------------------------------------------------------- */
/* View                                                                       */
/* -------------------------------------------------------------------------- */

export function OpsView() {
  const [tab, setTab] = useState<OpsTab>('system');
  const [pending, setPending] = useState<number | null>(null);
  const tabRefs = useRef<Partial<Record<OpsTab, HTMLButtonElement | null>>>({});

  /* One cheap read so the tab can badge its depth before it is ever opened. */
  useEffect(() => {
    let cancelled = false;
    apiFetch<unknown>('/v1/review/items')
      .then((raw) => {
        if (cancelled) return;
        const items = normalizeReviewItems(raw);
        setPending(items.filter((item) => item.status === 'pending').length);
      })
      .catch(() => {
        if (!cancelled) setPending(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleStats = useCallback((stats: { total: number; pending: number }) => {
    setPending(stats.pending);
  }, []);

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const order = OPS_TABS.map((entry) => entry.id);
    const index = order.indexOf(tab);
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') nextIndex = (index + 1) % order.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + order.length) % order.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = order.length - 1;

    if (nextIndex === null) return;
    event.preventDefault();
    const next = order[nextIndex];
    if (!next) return;
    setTab(next);
    tabRefs.current[next]?.focus();
  };

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
            Operations
          </h1>
          <p className="max-w-xl text-[12.5px] leading-relaxed text-ink-muted">
            Watch the stores, rebuild the index, and settle the extractions the model was unsure
            about.
          </p>
        </div>

        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {pending !== null && pending > 0 ? (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-pill border border-warn/30 bg-warn-soft px-2.5 text-[10.5px] font-semibold text-warn-ink">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn/60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-warn" />
              </span>
              {pending} awaiting review
            </span>
          ) : pending === 0 ? (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-pill border border-ok/30 bg-ok-soft px-2.5 text-[10.5px] font-semibold text-ok-ink">
              <CheckCheck className="h-3 w-3" strokeWidth={2.6} />
              queue clear
            </span>
          ) : null}
        </div>
      </motion.header>

      {/* ---------------- segmented switcher ---------------- */}
      <motion.div
        variants={STAGGER_ITEM}
        initial="initial"
        animate="animate"
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <div
          role="tablist"
          aria-label="Operations sections"
          onKeyDown={onTabKeyDown}
          className="inline-flex items-center gap-0.5 rounded-pill border border-hairline bg-elevated/70 p-0.5 shadow-hairline backdrop-blur-xl"
        >
          {OPS_TABS.map((entry) => {
            const active = tab === entry.id;
            const Icon = entry.id === 'system' ? Layers : Activity;
            return (
              <button
                key={entry.id}
                ref={(node) => {
                  tabRefs.current[entry.id] = node;
                }}
                type="button"
                role="tab"
                id={`ops-tab-${entry.id}`}
                aria-selected={active}
                aria-controls={`ops-panel-${entry.id}`}
                tabIndex={active ? 0 : -1}
                title={entry.hint}
                onClick={() => setTab(entry.id)}
                className={cx(
                  'relative flex h-8 items-center gap-1.5 rounded-pill px-3 text-[11.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  active ? 'text-accent' : 'text-ink-muted hover:text-ink',
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="ops-tab"
                    transition={SPRING_SNAPPY}
                    className="absolute inset-0 rounded-pill border border-accent/25 bg-accent-soft shadow-hairline"
                  />
                ) : null}
                <Icon className="relative h-3 w-3" strokeWidth={2.4} />
                <span className="relative whitespace-nowrap">{entry.label}</span>
                {entry.id === 'review' && pending !== null && pending > 0 ? (
                  <span
                    className={cx(
                      'tabular relative grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9.5px] font-bold',
                      active ? 'bg-accent text-accent-contrast' : 'bg-warn-soft text-warn-ink',
                    )}
                  >
                    {pending}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* ---------------- panels ---------------- */}
      {/* Plain conditional swap: an `AnimatePresence mode="wait"` exit gate left
          the incoming panel unmounted for ~250-600ms, so a tab switch could
          render nothing below the pills. Mount the active panel immediately. */}
      {tab === 'system' ? (
        <section
          role="tabpanel"
          id="ops-panel-system"
          aria-labelledby="ops-tab-system"
          tabIndex={-1}
          className="outline-none"
        >
          <IndexTelemetryPanel />
        </section>
      ) : (
        <section
          role="tabpanel"
          id="ops-panel-review"
          aria-labelledby="ops-tab-review"
          tabIndex={-1}
          className="outline-none"
        >
          <ReviewQueuePanel onStats={handleStats} />
        </section>
      )}
    </div>
  );
}

export default OpsView;
