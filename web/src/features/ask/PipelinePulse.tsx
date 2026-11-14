/**
 * Meridian — Live Pipeline Pulse.
 *
 * The stage ribbon that sits above a streaming answer. It reads the pipeline
 * state folded from SSE events (`retrieval_complete`, `token`,
 * `verification_complete`, `done`), ticks its own elapsed readout so the
 * message tree never re-renders for a clock, and offers the abort affordance.
 */
import { motion } from 'framer-motion';
import { AlertTriangle, Check, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { SPRING_SNAPPY, prefersReducedMotion } from '../../core/motion';
import type { PipelineStage, PipelineStageStatus } from './types';

export interface PipelinePulseProps {
  stages: PipelineStage[];
  streaming: boolean;
  /** Epoch ms when the run started — the clock is derived from this. */
  startedAt: number | null;
  /** Authoritative duration once the run is finished. */
  elapsedMs?: number | null;
  cycles?: number | null;
  degradedReason?: string | null;
  onAbort?: () => void;
  className?: string;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const STAGE_TONE: Record<PipelineStageStatus, { ring: string; text: string; label: string }> = {
  pending: { ring: 'border-hairline text-ink-faint', text: 'text-ink-faint', label: 'text-ink-faint' },
  active: { ring: 'border-accent/60 text-accent', text: 'text-accent', label: 'text-ink' },
  complete: { ring: 'border-ok/40 bg-ok-soft text-ok-ink', text: 'text-ok-ink', label: 'text-ink-muted' },
  failed: { ring: 'border-fail/40 bg-fail-soft text-fail-ink', text: 'text-fail-ink', label: 'text-fail-ink' },
};

function StageNode({ stage, index }: { stage: PipelineStage; index: number }) {
  const tone = STAGE_TONE[stage.status];
  const reduced = prefersReducedMotion();

  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cx(
          'relative grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full border transition-colors',
          tone.ring,
        )}
      >
        {stage.status === 'complete' ? (
          <Check className="h-[9px] w-[9px]" strokeWidth={3.2} />
        ) : stage.status === 'failed' ? (
          <X className="h-[9px] w-[9px]" strokeWidth={3.2} />
        ) : stage.status === 'active' ? (
          <>
            <motion.span
              aria-hidden="true"
              className="absolute inset-0 rounded-full border border-accent/60"
              animate={reduced ? undefined : { scale: [1, 1.7], opacity: [0.7, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
            />
            <motion.span
              className="h-[5px] w-[5px] rounded-full bg-accent"
              animate={reduced ? undefined : { opacity: [1, 0.45, 1] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
            />
          </>
        ) : (
          <span className="h-[3px] w-[3px] rounded-full bg-current opacity-60" />
        )}
      </span>

      <span className={cx('hidden text-[11px] font-medium tracking-[-0.01em] sm:inline', tone.label)}>
        {stage.label}
      </span>

      {stage.ms !== null && index >= 0 ? (
        <span className="tabular hidden text-[10px] text-ink-faint lg:inline">{stage.ms}ms</span>
      ) : null}
    </span>
  );
}

export function PipelinePulse({
  stages,
  streaming,
  startedAt,
  elapsedMs = null,
  cycles = null,
  degradedReason = null,
  onAbort,
  className,
}: PipelinePulseProps) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!streaming) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [streaming]);

  const liveElapsed = startedAt !== null ? Math.max(0, now - startedAt) : 0;
  const total = streaming ? liveElapsed : elapsedMs;
  const active = stages.find((stage) => stage.status === 'active');
  const failed = stages.some((stage) => stage.status === 'failed');
  const showRibbon = stages.length > 0;

  if (!showRibbon) return null;

  return (
    <motion.div
      layout
      transition={SPRING_SNAPPY}
      className={cx(
        'glass-panel inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-pill px-2.5 py-1.5 shadow-hairline',
        className,
      )}
    >
      {/* Only the stage machine is a live region — the abort button stays outside it. */}
      <span
        role="status"
        aria-live="polite"
        aria-label={
          streaming
            ? `Pipeline running: ${active?.label ?? 'working'}`
            : failed
              ? 'Pipeline finished with an error'
              : 'Pipeline complete'
        }
        className="flex flex-wrap items-center gap-x-2 gap-y-1"
      >
        {stages.map((stage, index) => (
          <span key={stage.id} className="flex items-center gap-2">
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={cx(
                  'h-px w-2.5 rounded-full transition-colors',
                  stage.status === 'pending' ? 'bg-hairline' : 'bg-accent/35',
                )}
              />
            ) : null}
            <StageNode stage={stage} index={index} />
          </span>
        ))}
      </span>

      {cycles !== null && cycles > 1 ? (
        <span className="ml-0.5 rounded-pill border border-hairline bg-subtle px-1.5 py-0.5 text-[10px] font-medium tabular text-ink-muted">
          {cycles} cycles
        </span>
      ) : null}

      {degradedReason ? (
        <span
          title={degradedReason}
          className="inline-flex max-w-[14rem] items-center gap-1 rounded-pill border border-warn/30 bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn-ink"
        >
          <AlertTriangle className="h-2.5 w-2.5 shrink-0" strokeWidth={2.4} />
          <span className="truncate">{degradedReason}</span>
        </span>
      ) : null}

      <span className="ml-auto flex items-center gap-2 pl-1">
        {total !== null ? (
          <span className="tabular text-[10.5px] font-medium text-ink-muted">
            {(total / 1000).toFixed(total < 10_000 ? 1 : 0)}s
          </span>
        ) : null}

        {streaming && onAbort ? (
          <button
            type="button"
            onClick={onAbort}
            className="inline-flex h-5 items-center gap-1 rounded-pill border border-fail/30 bg-fail-soft px-1.5 text-[10px] font-semibold text-fail-ink transition-colors hover:border-fail/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fail/40"
          >
            <Square className="h-2 w-2 fill-current" strokeWidth={0} />
            Abort
          </button>
        ) : null}
      </span>
    </motion.div>
  );
}

export default PipelinePulse;
