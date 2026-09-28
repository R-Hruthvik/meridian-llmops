import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';
import { X } from 'lucide-react';

const OVERLAY_MIN_WIDTH = 520;
const OVERLAY_MAX_WIDTH = 680;
const OVERLAY_DEFAULT_WIDTH = 600;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const cn = (...parts: Array<string | false | undefined>) => twMerge(clsx(parts));

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  /** Surface name, e.g. "Corpus". Becomes the dialog's accessible name. */
  title: string;
  /** Where this overlay was opened from, e.g. "ASK · VERIFIED GROUNDED". */
  breadcrumb?: React.ReactNode;
  children: React.ReactNode;
  /** Optional sticky footer, e.g. pagination or a primary action. */
  footer?: React.ReactNode;
  /** Clamped to 520–680px per §6. */
  width?: number;
  className?: string;
}

/**
 * The shared overlay shell: slides in from the right over a scrim, dismisses on
 * Escape and on scrim click, traps focus and returns it on close. Below 768px it
 * is a full-screen sheet. Motion is skipped under prefers-reduced-motion.
 */
export const Overlay: React.FC<OverlayProps> = ({
  open,
  onClose,
  title,
  breadcrumb,
  children,
  footer,
  width = OVERLAY_DEFAULT_WIDTH,
  className,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    returnFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [open, onClose]);

  const panelWidth = Math.min(Math.max(width, OVERLAY_MIN_WIDTH), OVERLAY_MAX_WIDTH);

  const onPanelClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) return;
    event.stopPropagation();
  }, []);

  if (!open) return null;

  return createPortal(
    <>
      <div data-testid="overlay-scrim" className="overlay-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={onPanelClick}
        style={{ '--overlay-w': `${panelWidth}px` } as React.CSSProperties}
        className={cn(
          'overlay-panel w-full md:w-[var(--overlay-w)] outline-none',
          className,
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            {breadcrumb ? (
              <div
                data-slot="breadcrumb"
                className="num truncate text-[11px] font-medium uppercase tracking-[0.12em] text-faint"
              >
                {breadcrumb}
              </div>
            ) : null}
            <h2 className="truncate text-[15px] font-semibold text-ink">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="-mr-1 shrink-0 rounded-sm p-1 text-muted transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer ? <div className="border-t border-hairline px-4 py-3">{footer}</div> : null}
      </div>
    </>,
    document.body,
  );
};
