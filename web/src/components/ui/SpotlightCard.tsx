/**
 * Meridian — SpotlightCard
 *
 * Mouse-tracking surface glow: a soft radial accent light follows the pointer
 * across the card. framer-motion motion values drive `--x`/`--y` CSS variables
 * (no state, no rAF loop); the glow itself is a positioned child div whose
 * radial gradient is anchored at `var(--x) var(--y)`.
 *
 * The wrapper renders `motion.div` or `motion.button` so callers keep their
 * existing variants/hover/tap props; all remaining props are spread through.
 * Purely decorative and pointer-driven — reduced-motion handling (global
 * transition kill in tokens.css) needs no extra work here.
 */
import { motion, useMotionValue } from 'framer-motion';
import { useCallback, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export interface SpotlightCardProps {
  as?: 'div' | 'button';
  className?: string;
  children?: ReactNode;
  onMouseMove?: (event: ReactPointerEvent<HTMLElement>) => void;
  [key: string]: unknown;
}

export default function SpotlightCard({
  as = 'div',
  className,
  children,
  onMouseMove,
  ...rest
}: SpotlightCardProps) {
  const x = useMotionValue('50%');
  const y = useMotionValue('50%');

  const handleMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      onMouseMove?.(event);
      const rect = event.currentTarget.getBoundingClientRect();
      x.set(`${((event.clientX - rect.left) / rect.width) * 100}%`);
      y.set(`${((event.clientY - rect.top) / rect.height) * 100}%`);
    },
    [onMouseMove, x, y],
  );

  const Tag = as === 'button' ? motion.button : motion.div;

  return (
    <Tag
      {...(rest as Record<string, unknown>)}
      onPointerMove={handleMove}
      className={cx('group relative isolate overflow-hidden', className)}
      style={{ '--x': x, '--y': y } as CSSProperties}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{
          background:
            'radial-gradient(240px circle at var(--x, 50%) var(--y, 50%), rgb(var(--accent-rgb) / 0.10), transparent 70%)',
        }}
      />
      {children}
    </Tag>
  );
}
