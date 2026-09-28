import React from 'react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

export type StatusChipVariant = 'ok' | 'warn' | 'fail' | 'faint' | 'accent';

export interface StatusChipProps {
  /** Drives the dot colour. Defaults to the quietest state. */
  variant?: StatusChipVariant;
  /** The state itself. Always rendered as text — never colour-only. */
  children: React.ReactNode;
  className?: string;
}

const DOT_CLASS: Record<StatusChipVariant, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  fail: 'bg-fail',
  faint: 'bg-faint',
  accent: 'bg-accent',
};

const TINT_CLASS: Record<StatusChipVariant, string> = {
  ok: 'bg-ok-wash text-ok',
  warn: 'bg-warn-wash text-warn',
  fail: 'bg-fail-wash text-fail',
  faint: 'bg-surface-sunken text-muted',
  accent: 'bg-accent-wash text-accent-ink',
};

const cn = (...parts: Array<string | false | undefined>) => twMerge(clsx(parts));

/**
 * The shared state chip: one dot plus one mono, uppercase, letterspaced label.
 * Used by the health badge, the verdict bar and the Index & Storage fallback
 * labels. The dot is decorative; the label carries the meaning.
 */
export const StatusChip: React.FC<StatusChipProps> = ({ variant = 'faint', children, className }) => (
  <span
    data-variant={variant}
    className={cn(
      'inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5',
      TINT_CLASS[variant],
      className,
    )}
  >
    <span data-slot="dot" aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-pill', DOT_CLASS[variant])} />
    <span data-slot="label" className="font-mono text-[13px] font-bold uppercase leading-[1.3] tracking-[0.08em]">
      {children}
    </span>
  </span>
);
