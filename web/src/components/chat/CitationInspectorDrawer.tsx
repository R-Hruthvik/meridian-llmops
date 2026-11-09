import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, X } from 'lucide-react';

import { StatusChip } from '../StatusChip';
import type { SearchResult, VerificationSummary } from '../../types/api';

export interface CitationInspectorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeChunk: SearchResult | null;
  chunks: SearchResult[];
  onSelectChunk?: (chunk: SearchResult) => void;
  timings?: Record<string, number>;
  verification?: VerificationSummary | null;
  onOpenCorpus?: (chunk: SearchResult) => void;
}

type InspectorTab = 'chunks' | 'waterfall' | 'health';

const TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: 'chunks', label: 'Evidence Chunks' },
  { id: 'waterfall', label: 'Latency Waterfall' },
  { id: 'health', label: 'Dual-Memory Health' },
];

const MEMORY_ENGINES = [
  {
    token: 'V',
    name: 'Qdrant Dense Vector Index',
    detail: 'Semantic similarity over embedded passages.',
  },
  {
    token: 'G',
    name: 'Neo4j Knowledge Graph',
    detail: 'Entity relationships and graph traversal.',
  },
  {
    token: 'R',
    name: 'SQLite Provenance & Relational Index',
    detail: 'Document ledger, provenance, and structured records.',
  },
] as const;

const chunkTitle = (chunk: SearchResult): string =>
  chunk.title || chunk.filename || chunk.document_id || 'Untitled source';

const formatScore = (score: number): string =>
  Number.isFinite(score) ? score.toFixed(2) : '—';

const formatMs = (value: number): string =>
  Number.isFinite(value) ? `${Math.round(value)} ms` : '—';

const formatVerification = (verification: VerificationSummary): string =>
  verification.status.replace(/_/g, ' ');

const isSelected = (activeChunk: SearchResult | null, chunk: SearchResult): boolean =>
  activeChunk === chunk || (activeChunk != null && activeChunk.chunk_id === chunk.chunk_id);

/**
 * Right-hand evidence inspector for one conversation. The drawer never owns
 * citation state: it renders the chunk the workspace selected and reports
 * selection/navigation through callbacks, so the transcript stays authoritative.
 */
export const CitationInspectorDrawer: React.FC<CitationInspectorDrawerProps> = ({
  isOpen,
  onClose,
  activeChunk,
  chunks,
  onSelectChunk,
  timings,
  verification,
  onOpenCorpus,
}) => {
  const [tab, setTab] = useState<InspectorTab>('chunks');
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  if (!isOpen) return null;

  const handleCopySnippet = async () => {
    if (!activeChunk?.text) return;
    try {
      await navigator.clipboard?.writeText(activeChunk.text);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied by the browser; the snippet stays visible.
    }
  };

  const timingEntries = Object.entries(timings ?? {}).filter(([, value]) =>
    Number.isFinite(value),
  );
  const maxTiming = timingEntries.reduce((max, [, value]) => Math.max(max, value), 0) || 1;

  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-label="Citation Inspector"
      data-testid="citation-inspector-drawer"
      className="fixed inset-y-0 right-0 z-40 flex w-[380px] max-w-full flex-col border-l border-hairline bg-surface-raised shadow-none"
    >
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="min-w-0">
          <p className="label-section text-muted">Dual-memory evidence</p>
          <h2 className="text-body font-bold text-ink">Citation Inspector</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close citation inspector"
          className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-hairline text-muted transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      <div role="tablist" aria-label="Citation inspector views" className="flex border-b border-hairline">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`citation-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`citation-panel-${id}`}
            onClick={() => setTab(id)}
            className={`min-w-0 flex-1 border-b-2 px-2 py-2 text-micro font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
              tab === id
                ? 'border-accent text-accent-ink'
                : 'border-transparent text-muted hover:bg-surface-sunken hover:text-ink'
            }`}
          >
            {label}
            {id === 'chunks' ? <span className="num ml-1 text-faint">({chunks.length})</span> : null}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'chunks' ? (
          <section
            role="tabpanel"
            id="citation-panel-chunks"
            aria-labelledby="citation-tab-chunks"
            className="flex flex-col gap-4 p-4"
          >
            {verification ? (
              <div className="flex items-center justify-between gap-2 border-b border-hairline pb-3">
                <span className="text-micro text-muted">Verification</span>
                <StatusChip
                  variant={
                    verification.status === 'citations_ok' || verification.status === 'supported'
                      ? 'ok'
                      : 'warn'
                  }
                >
                  {formatVerification(verification)}
                </StatusChip>
              </div>
            ) : null}

            {activeChunk ? (
              <div className="rounded border border-hairline bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 text-body font-bold text-ink">{chunkTitle(activeChunk)}</h3>
                  <span className="num shrink-0 text-label font-semibold text-ink" title="Relevance score">
                    {formatScore(activeChunk.score)}
                  </span>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-muted">
                  {activeChunk.heading_path ? <span>{activeChunk.heading_path}</span> : null}
                  {activeChunk.page_start != null ? (
                    <span className="num">p. {activeChunk.page_start}</span>
                  ) : null}
                </div>

                <div className="mt-3 border border-hairline bg-surface-sunken p-3 font-mono text-xs text-ink">
                  <p className="whitespace-pre-wrap break-words">{activeChunk.text}</p>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopySnippet}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-raised px-2.5 py-1 text-label text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {copied ? (
                      <Check className="size-3.5 text-ok" aria-hidden="true" />
                    ) : (
                      <Copy className="size-3.5 text-muted" aria-hidden="true" />
                    )}
                    <span>{copied ? 'Copied' : 'Copy snippet'}</span>
                  </button>

                  {onOpenCorpus ? (
                    <button
                      type="button"
                      onClick={() => onOpenCorpus(activeChunk)}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-raised px-2.5 py-1 text-label text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <ExternalLink className="size-3.5 text-muted" aria-hidden="true" />
                      <span>Open in Corpus</span>
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="rounded border border-hairline bg-surface p-3 text-body text-muted">
                Select an evidence chunk to inspect its source, passage, and score.
              </p>
            )}

            <div>
              <h3 className="label-section mb-2 text-muted">Ranked evidence</h3>
              <ul className="flex flex-col gap-2">
                {chunks.map((chunk, index) => {
                  const selected = isSelected(activeChunk, chunk);
                  return (
                    <li key={chunk.chunk_id || `${chunk.document_id}-${index}`}>
                      <button
                        type="button"
                        data-testid={`citation-chunk-${chunk.chunk_id}`}
                        aria-pressed={selected}
                        onClick={() => onSelectChunk?.(chunk)}
                        className={`w-full rounded border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                          selected
                            ? 'border-accent bg-accent-wash'
                            : 'border-hairline bg-surface-raised hover:bg-surface-sunken'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="num shrink-0 text-micro text-faint">{chunk.rank ?? index + 1}</span>
                          <span className="min-w-0 flex-1 truncate text-label font-semibold text-ink">
                            {chunkTitle(chunk)}
                          </span>
                          <span className="num shrink-0 text-micro text-muted">{formatScore(chunk.score)}</span>
                        </span>
                        <span className="mt-1 block max-h-10 overflow-hidden text-micro leading-[1.5] text-muted">
                          {chunk.text}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        ) : null}

        {tab === 'waterfall' ? (
          <section
            role="tabpanel"
            id="citation-panel-waterfall"
            aria-labelledby="citation-tab-waterfall"
            className="flex flex-col gap-3 p-4"
          >
            <div className="flex items-baseline justify-between border-b border-hairline pb-2">
              <h3 className="label-section text-muted">Pipeline latency</h3>
              <span className="num text-micro text-faint">{timingEntries.length} stages</span>
            </div>

            {timingEntries.length === 0 ? (
              <p className="text-body text-muted">No pipeline timings were reported for this turn.</p>
            ) : (
              timingEntries.map(([key, value]) => {
                const width = Math.max(2, Math.round((value / maxTiming) * 100));
                return (
                  <div key={key} data-testid={`timing-${key}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="id-mono text-ink">{key}</span>
                      <span className="num text-micro text-muted">{formatMs(value)}</span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-sm border border-hairline bg-surface-sunken">
                      <div
                        className="h-full rounded-sm bg-accent"
                        style={{ width: `${width}%` }}
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                );
              })
            )}
          </section>
        ) : null}

        {tab === 'health' ? (
          <section
            role="tabpanel"
            id="citation-panel-health"
            aria-labelledby="citation-tab-health"
            className="flex flex-col gap-3 p-4"
          >
            <div className="border-b border-hairline pb-2">
              <h3 className="label-section text-muted">Storage engines</h3>
            </div>

            <ul className="flex flex-col gap-2">
              {MEMORY_ENGINES.map((engine) => (
                <li
                  key={engine.token}
                  className="flex items-start gap-3 rounded border border-hairline bg-surface p-3"
                >
                  <span className="id-mono shrink-0 rounded-sm border border-hairline bg-surface-sunken px-1.5 py-0.5 text-ink">
                    [{engine.token}]
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-label font-semibold text-ink">{engine.name}</span>
                    <span className="mt-0.5 block text-micro text-muted">{engine.detail}</span>
                  </span>
                  <StatusChip variant="ok">Indexed</StatusChip>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </aside>
  );
};
