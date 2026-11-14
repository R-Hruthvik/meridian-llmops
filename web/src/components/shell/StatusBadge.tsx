/**
 * Meridian — StatusBadge
 *
 * The one status pill used across the shell (health, backend reachability,
 * verification verdicts, review queue states). Tone-driven, hairline-bordered,
 * with an optional breathing dot for "live" signals.
 */
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { prefersReducedMotion } from '../../core/motion';

export type StatusTone = 'ok' | 'warn' | 'fail' | 'neutral';

export type StatusBadgeSize = 'sm' | 'md';

/** Tone → class recipe. Exported so tables/lists stay visually identical. */
export const STATUS_TONE_CLASSES: Record<
  StatusTone,
  { pill: string; dot: string; halo: string; label: string }
> = {
  ok: {
    pill: 'bg-ok-soft text-ok-ink border-ok/30',
    dot: 'bg-ok',
    halo: 'bg-ok/50',
    label: 'text-ok-ink',
  },
  warn: {
    pill: 'bg-warn-soft text-warn-ink border-warn/30',
    dot: 'bg-warn',
    halo: 'bg-warn/50',
    label: 'text-warn-ink',
  },
  fail: {
    pill: 'bg-fail-soft text-fail-ink border-fail/30',
    dot: 'bg-fail',
    halo: 'bg-fail/50',
    label: 'text-fail-ink',
  },
  neutral: {
    pill: 'bg-subtle text-neutral-ink border-hairline',
    dot: 'bg-neutral',
    halo: 'bg-neutral/40',
    label: 'text-neutral-ink',
  },
};

const SIZE_CLASSES: Record<StatusBadgeSize, { pill: string; dot: string; text: string }> = {
  sm: { pill: 'h-6 gap-1.5 px-2 text-[11px]', dot: 'h-1.5 w-1.5', text: 'leading-none' },
  md: { pill: 'h-8 gap-2 px-2.5 text-xs', dot: 'h-[7px] w-[7px]', text: 'leading-none' },
};

export interface StatusBadgeProps {
  /** Semantic tone of the signal. */
  tone: StatusTone;
  /** Visible text. Omit for a bare dot. */
  label?: ReactNode;
  /** Emit a breathing halo behind the dot ("live" signal). */
  pulse?: boolean;
  size?: StatusBadgeSize;
  /** Native tooltip — use for "last checked 12:04:31" style context. */
  title?: string;
  className?: string;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function StatusBadge({
  tone,
  label,
  pulse = false,
  size = 'md',
  title,
  className,
}: StatusBadgeProps) {
  const toneClasses = STATUS_TONE_CLASSES[tone];
  const sizeClasses = SIZE_CLASSES[size];
  const reduced = prefersReducedMotion();

  return (
    <span
      role="status"
      aria-live="polite"
      title={title}
      className={cx(
        'inline-flex select-none items-center rounded-pill border font-medium tracking-[-0.01em]',
        toneClasses.pill,
        sizeClasses.pill,
        className,
      )}
    >
      <span className="relative grid place-items-center" aria-hidden="true">
        {pulse && !reduced ? (
          <motion.span
            className={cx('absolute rounded-full', sizeClasses.dot, toneClasses.halo)}
            initial={{ scale: 1, opacity: 0.55 }}
            animate={{ scale: [1, 2.6, 1], opacity: [0.55, 0, 0.55] }}
            transition={{
              duration: 2.4,
              repeat: Infinity,
              ease: 'easeOut',
              times: [0, 0.55, 1],
            }}
          />
        ) : null}
        <span className={cx('relative rounded-full', sizeClasses.dot, toneClasses.dot)} />
      </span>

      {label !== undefined && label !== null && label !== '' ? (
        <span className={cx('whitespace-nowrap', sizeClasses.text)}>{label}</span>
      ) : null}
    </span>
  );
}

export default StatusBadge;
