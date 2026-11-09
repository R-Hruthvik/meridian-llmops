'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpRight, Shield, Square } from 'lucide-react';

import { DoubleBezelCard } from './DoubleBezelCard';
import { IslandButton } from './IslandButton';

const TOP_K_OPTIONS = [3, 5, 8] as const;

export interface CommandDockProps {
  query: string;
  onQueryChange: (q: string) => void;
  onSubmit: () => void;
  isStreaming?: boolean;
  onCancel?: () => void;
  topK: number;
  onTopKChange: (k: number) => void;
  guardrails: boolean;
  onGuardrailsChange: (g: boolean) => void;
  disabled?: boolean;
  className?: string;
  followUpContext?: { turnId: string; query: string; sourceCount: number } | null;
  onClearFollowUpContext?: () => void;
}

export function CommandDock({
  query,
  onQueryChange,
  onSubmit,
  isStreaming = false,
  onCancel,
  topK,
  onTopKChange,
  guardrails,
  onGuardrailsChange,
  disabled = false,
  className = '',
  followUpContext,
  onClearFollowUpContext,
}: CommandDockProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [query]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!disabled && !isStreaming) {
        onSubmit();
      }
    }
  };

  const handleAction = () => {
    if (isStreaming) {
      onCancel?.();
      return;
    }
    onSubmit();
  };

  return (
    <DoubleBezelCard
      active={isFocused && !disabled}
      className={`w-full ${className}`}
      innerClassName="p-3"
    >
      <div className="flex flex-col gap-2">
        <textarea
          ref={textareaRef}
          rows={1}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="Ask Meridian RAG (Cmd+Enter to send)..."
          aria-label="Ask Meridian RAG"
          disabled={disabled}
          className="w-full resize-none bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 outline-none disabled:opacity-50"
        />

        {followUpContext && onClearFollowUpContext && (
          <div
            data-testid="followup-context-chip"
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-sunken px-3 py-1 text-label text-ink"
          >
            <span className="font-mono text-micro text-muted">
              Context: {followUpContext.sourceCount} sources
            </span>
            <button
              type="button"
              onClick={onClearFollowUpContext}
              aria-label="Clear follow-up context"
              className="inline-flex items-center justify-center size-4 rounded-full text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="Top-K results">
            {TOP_K_OPTIONS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onTopKChange(k)}
                aria-pressed={topK === k}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  topK === k
                    ? 'bg-sky-400 text-zinc-950'
                    : 'border border-white/10 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {k}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onGuardrailsChange(!guardrails)}
            aria-pressed={guardrails}
            aria-label="Toggle guardrails"
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
              guardrails
                ? 'border border-emerald-400/50 bg-emerald-400/10 text-emerald-400'
                : 'border border-white/10 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Shield className="h-4 w-4" />
          </button>

          <div className="ml-auto">
            <IslandButton
              variant="primary"
              onClick={handleAction}
              disabled={disabled}
              aria-label={isStreaming ? 'Stop' : 'Submit'}
              icon={
                isStreaming ? (
                  <Square className="h-3.5 w-3.5" />
                ) : (
                  <ArrowUpRight className="h-3.5 w-3.5" />
                )
              }
            />
          </div>
        </div>
      </div>
    </DoubleBezelCard>
  );
}
