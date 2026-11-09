import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, FileText, RefreshCw } from 'lucide-react';

import { MarkdownRenderer } from '../MarkdownRenderer';
import { StatusChip, type StatusChipVariant } from '../StatusChip';
import type { SearchResult } from '../../types/api';
import type { ChatTurn } from './useRagChat';

export interface ChatStreamViewProps {
  turns: ChatTurn[];
  isLoading?: boolean;
  onSelectChunk?: (chunk: SearchResult) => void;
  onRetryQuery?: (query: string) => void;
}

const STAGE_LABELS: Record<'retrieving' | 'generating' | 'verifying', string> = {
  retrieving: 'Retrieving relevant context from dual-memory...',
  generating: 'Generating grounded response...',
  verifying: 'Verifying citations and factual consistency...',
};

const formatLatency = (ms: number): { value: string; unit: string } => {
  if (!Number.isFinite(ms)) return { value: '—', unit: 'ms' };
  const rounded = Math.round(ms);
  if (Math.abs(rounded) < 1000) return { value: String(rounded), unit: 'ms' };
  return { value: (ms / 1000).toFixed(1), unit: 's' };
};

const chunkTitle = (chunk: SearchResult): string =>
  chunk.title || chunk.filename || chunk.document_id || 'Untitled source';

const formatScore = (score: number): string =>
  Number.isFinite(score) ? score.toFixed(2) : '—';

const verdictFor = (turn: ChatTurn): { label: string; variant: StatusChipVariant } => {
  if (turn.verified) return { label: 'VERIFIED GROUNDED', variant: 'ok' };
  if (turn.refusal) return { label: 'REFUSED', variant: 'fail' };
  if (turn.degraded_reason) return { label: 'DEGRADED', variant: 'warn' };
  return { label: 'UNVERIFIED', variant: 'faint' };
};

const CopyAnswerButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied by the browser; the answer stays visible.
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copy answer"
      className="inline-flex items-center gap-1.5 rounded-sm border border-hairline px-2.5 py-1 text-label text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {copied ? (
        <Check className="size-3.5 text-ok" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5 text-muted" aria-hidden="true" />
      )}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
};

const ActiveStage: React.FC<{ stage: 'retrieving' | 'generating' | 'verifying' }> = ({ stage }) => (
  <div
    data-testid="active-stage-indicator"
    role="status"
    aria-live="polite"
    className="flex items-center gap-2 rounded-sm border border-hairline bg-surface-sunken px-2.5 py-1.5"
  >
    <span className="size-1.5 shrink-0 animate-pulse rounded-pill bg-accent" aria-hidden="true" />
    <span className="text-micro font-semibold text-muted">{STAGE_LABELS[stage]}</span>
  </div>
);

const AnswerSkeleton: React.FC = () => (
  <div data-testid="answer-loading" className="animate-pulse space-y-2" aria-hidden="true">
    <div className="h-3 w-3/4 rounded-sm bg-surface-sunken" />
    <div className="h-3 w-full rounded-sm bg-surface-sunken" />
    <div className="h-3 w-2/3 rounded-sm bg-surface-sunken" />
  </div>
);

const EvidenceRecoverySurface: React.FC<{
  turn: ChatTurn;
  onSelectChunk?: (chunk: SearchResult) => void;
}> = ({ turn, onSelectChunk }) => (
  <div
    data-testid="evidence-recovery-surface"
    className="mt-3 rounded border border-warn bg-warn-wash p-3"
  >
    <p className="text-label font-bold text-warn">
      Meridian could not verify a grounded answer, but recovered {turn.sources.length} relevant
      chunks from your index
    </p>

    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {turn.sources.map((chunk, index) => (
        <div
          key={chunk.chunk_id || `${chunk.document_id}-${index}`}
          className="flex min-w-0 flex-col rounded border border-hairline bg-surface-raised p-2.5"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-label font-semibold text-ink">
              {chunkTitle(chunk)}
            </span>
            <span className="num shrink-0 text-micro text-muted">{formatScore(chunk.score)}</span>
          </div>
          <p className="mt-1 max-h-12 overflow-hidden text-micro leading-[1.5] text-muted">
            {chunk.text}
          </p>
          <button
            type="button"
            onClick={() => onSelectChunk?.(chunk)}
            className="mt-2 self-start rounded-sm border border-hairline px-2 py-0.5 text-micro font-semibold text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Inspect
          </button>
        </div>
      ))}
    </div>
  </div>
);

const TurnFooter: React.FC<{ turn: ChatTurn; onSelectChunk?: (chunk: SearchResult) => void }> = ({
  turn,
  onSelectChunk,
}) => {
  const verdict = verdictFor(turn);
  const latency = formatLatency(turn.execution_time_ms);
  const sourceCount = turn.sources.length;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline pt-2.5">
      <StatusChip variant={verdict.variant}>{verdict.label}</StatusChip>

      <span className="flex items-baseline gap-1 border-l border-hairline pl-3">
        <span className="num text-micro font-semibold text-ink">{latency.value}</span>
        <span className="text-micro text-faint">{latency.unit}</span>
      </span>

      {sourceCount > 0 ? (
        <button
          type="button"
          onClick={() => onSelectChunk?.(turn.sources[0])}
          className="flex items-center gap-1 border-l border-hairline pl-3 text-micro font-semibold text-ink transition-colors hover:text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <FileText className="size-3.5 text-muted" aria-hidden="true" />
          <span>
            {sourceCount} {sourceCount === 1 ? 'source' : 'sources'}
          </span>
        </button>
      ) : (
        <span className="flex items-center gap-1 border-l border-hairline pl-3 text-micro text-faint">
          <FileText className="size-3.5" aria-hidden="true" />
          <span>
            {sourceCount} {sourceCount === 1 ? 'source' : 'sources'}
          </span>
        </span>
      )}

      {turn.answer.trim() ? (
        <span className="ml-auto">
          <CopyAnswerButton text={turn.answer} />
        </span>
      ) : null}
    </div>
  );
};

/**
 * The conversation transcript. Each turn is a user island plus one assistant
 * bezel; evidence never disappears on a refusal, so the recovered chunks stay
 * inspectable even when Meridian could not ground an answer.
 */
export const ChatStreamView: React.FC<ChatStreamViewProps> = ({
  turns,
  isLoading = false,
  onSelectChunk,
  onRetryQuery,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns]);

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-label="Conversation"
      aria-busy={isLoading}
      data-testid="chat-stream-view"
      className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto px-4 py-6"
    >
      {turns.length === 0 ? (
        <section className="mx-auto flex w-full max-w-2xl flex-col items-start gap-3 rounded border border-hairline bg-surface-raised p-6">
          <p className="label-section text-muted">Grounded answers</p>
          <h2 className="text-xl font-bold text-ink">Meridian Dual-Memory RAG Cockpit</h2>
          <p className="max-w-prose text-body text-muted">
            Ask a question and Meridian will answer from the documents you trust — returning
            verified, grounded answers with every citation inspectable. Dense vectors, the
            knowledge graph, and the provenance ledger all stay one click away.
          </p>
        </section>
      ) : (
        <ol className="flex flex-col gap-6">
          {turns.map((turn) => {
            const activeStage =
              turn.status === 'retrieving' ||
              turn.status === 'generating' ||
              turn.status === 'verifying'
                ? turn.activeStage?.name ?? turn.status
                : null;

            return (
              <li
                key={turn.id}
                data-testid={`chat-turn-${turn.id}`}
                className="flex flex-col gap-3"
              >
                <div className="max-w-[85%] self-end rounded-lg border border-hairline bg-surface-sunken px-4 py-2.5 text-ink">
                  <p className="whitespace-pre-wrap break-words text-body">{turn.query}</p>
                </div>

                <div className="relative w-full rounded-2xl border border-hairline bg-surface p-1.5">
                  <div className="rounded-xl border border-hairline bg-surface-raised p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="label-verdict text-muted">Meridian</span>
                      {activeStage ? <ActiveStage stage={activeStage} /> : null}
                    </div>

                    {turn.status === 'error' ? (
                      <div className="rounded border border-fail bg-fail-wash p-3">
                        <p className="text-label font-bold text-fail">Query failed</p>
                        <p className="mt-0.5 break-words text-body text-fail">
                          {turn.error?.message ?? 'The query could not be completed.'}
                        </p>
                        {onRetryQuery ? (
                          <button
                            type="button"
                            onClick={() => onRetryQuery(turn.query)}
                            className="mt-2 inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-raised px-2.5 py-1 text-label font-semibold text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <RefreshCw className="size-3.5" aria-hidden="true" />
                            <span>Retry</span>
                          </button>
                        ) : null}
                      </div>
                    ) : turn.answer.trim() ? (
                      <MarkdownRenderer content={turn.answer} />
                    ) : activeStage ? (
                      <AnswerSkeleton />
                    ) : (
                      <p className="text-body text-muted">No answer text was returned for this turn.</p>
                    )}

                    {(turn.refusal || Boolean(turn.degraded_reason)) && turn.sources.length > 0 ? (
                      <EvidenceRecoverySurface turn={turn} onSelectChunk={onSelectChunk} />
                    ) : null}

                    {turn.status === 'complete' ? (
                      <TurnFooter turn={turn} onSelectChunk={onSelectChunk} />
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div
        data-testid="chat-bottom-sentinel"
        style={{ overflowAnchor: 'auto', height: 1 }}
        aria-hidden="true"
      />
    </div>
  );
};
