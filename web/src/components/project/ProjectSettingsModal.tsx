'use client';

import { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import type { ThemeName } from './ProjectWorkspace';

interface ProjectSettingsModalProps {
  open: boolean;
  onClose: () => void;
  theme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
}

const THEMES: Array<{
  id: ThemeName;
  label: string;
  swatch: string;
  accent: string;
}> = [
  { id: 'default', label: 'Raw Paper', swatch: '#f6f4ee', accent: '#2d3a29' },
  { id: 'ceramic-concrete', label: 'Ceramic Concrete', swatch: '#f2f4f7', accent: '#344054' },
  { id: 'cold-titanium', label: 'Cold Titanium', swatch: '#f1f5f9', accent: '#0f172a' },
  { id: 'analog-soot', label: 'Analog Soot', swatch: '#18181b', accent: '#f59e0b' },
];

export function ProjectSettingsModal({
  open,
  onClose,
  theme,
  onThemeChange,
}: ProjectSettingsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" aria-hidden="true">
      <div
        className="fixed inset-0 bg-[rgba(15,15,12,0.40)] backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-settings-title"
        tabIndex={-1}
        className="relative z-50 w-full max-w-md rounded-2xl border border-hairline bg-surface-raised shadow-overlay p-6 animate-[overlay-slide-in_180ms_cubic-bezier(0.2,0,0,1)_both] outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div className="flex items-center justify-between border-b border-hairline pb-4 mb-6">
          <div>
            <h3 id="project-settings-title" className="text-readout font-bold text-ink">
              Interface & Theme Settings
            </h3>
            <p className="mt-1 text-micro text-muted">Tailor workspace appearance and typography.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="shrink-0 rounded-sm p-1.5 text-muted transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4">
          <p className="label-section text-muted uppercase tracking-wider text-[10px] font-bold">
            Theme
          </p>
          <div className="grid grid-cols-2 gap-3">
            {THEMES.map((t) => {
              const active = theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onThemeChange(t.id)}
                  aria-pressed={active}
                  className={`relative flex flex-col items-center gap-2 rounded-xl border p-3 text-left transition-colors ${
                    active
                      ? 'border-accent bg-surface-raised'
                      : 'border-hairline bg-surface hover:bg-surface-sunken'
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-lg border border-hairline shrink-0 ${
                      active ? 'ring-2 ring-accent' : ''
                    }`}
                    style={{
                      backgroundColor: t.swatch,
                      borderColor: t.accent,
                    }}
                    aria-hidden="true"
                  />
                  <span className={`text-sm font-semibold ${
                    active ? 'text-accent-ink' : 'text-ink'
                  }`}>{t.label}</span>
                  {active && (
                    <div className="absolute right-2 top-2 size-4 rounded-full border border-accent bg-accent-ink flex items-center justify-center text-[10px] font-bold text-white">
                      <Check className="size-3" aria-hidden="true" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-hairline bg-surface px-4 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-sunken hover:text-accent-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
