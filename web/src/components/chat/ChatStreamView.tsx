import React, { Suspense, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Check, Copy, FileText, RefreshCw, ArrowLeft, RotateCcw } from 'lucide-react';

import { StatusChip, type StatusChipVariant } from '../StatusChip';
import { DoubleBezelCard } from './DoubleBezelCard';
import type { SearchResult } from '../../types/api';
import type { ChatTurn } from './useRagChat';

// The markdown parser is the heaviest dependency in the app and there is nothing
// to parse until an answer exists. Deferring it keeps it out of first paint.
const MarkdownRenderer = React.lazy(() =>
  import('../MarkdownRenderer').then((m) => ({ default: m.MarkdownRenderer })),
);

export interface ChatStreamViewProps {
  turns: ChatTurn[];
  isLoading?: boolean;
  onSelectChunk?: (chunk: SearchResult) => void;
  onRetryQuery?: (query: string) => void;
  onFollowUp?: (turn: ChatTurn) => void;
  onRerun?: (turn: ChatTurn) => void;
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

const formatTimingBadge = (key: string, value: number): string => {
  const rounded = Math.round(value);
  const engine = key.toLowerCase();
  if (engine.includes('dense') || engine.includes('vector') || engine.includes('qdrant') || engine.includes('chroma')) {
    return `[VEC:CHROMA ${rounded}ms]`;
  }
  if (engine.includes('graph') || engine.includes('neo4j') || engine.includes('kg')) {
    return `[KG:SQLITE ${rounded}ms]`;
  }
  if (engine.includes('sparse') || engine.includes('bm25') || engine.includes('redis') || engine.includes('kv')) {
    return `[KV:REDIS ${rounded}ms]`;
  }
  if (engine.includes('llm') || engine.includes('generat') || engine.includes('synth')) {
    return `[LLM ${rounded}ms]`;
  }
  if (engine.includes('verify') || engine.includes('guard') || engine.includes('audit')) {
    return `[VERIFY ${rounded}ms]`;
  }
  return `[${key.toUpperCase()} ${rounded}ms]`;
};

const chunkTitle = (chunk: SearchResult): string =>
  chunk.title || chunk.filename || chunk.document_id || 'Untitled source';

const formatScore = (score: number): string =>
  Number.isFinite(score) ? score.toFixed(2) : '—';

const verdictFor = (turn: ChatTurn): { label: string; variant: StatusChipVariant } => {
  if (turn.refusal) return { label: 'REFUSED', variant: 'fail' };
  if (turn.degraded_reason) return { label: 'DEGRADED', variant: 'warn' };
  if (turn.verified) return { label: 'VERIFIED GROUNDED', variant: 'ok' };
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
  onRetryQuery?: (query: string) => void;
}> = ({ turn, onSelectChunk, onRetryQuery }) => {
  const [passStatus, setPassStatus] = useState<'idle' | 'running' | 'complete' | 'failed'>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  const handleGroundingPass = () => {
    // Re-submit via the existing submit flow; the failed turn is never mutated.
    onRetryQuery?.(turn.query);
    setPassStatus('running');
    setElapsedMs(0);
    startTimeRef.current = Date.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsedMs(Date.now() - startTimeRef.current), 100);
  };

  const passLabel =
    passStatus === 'running'
      ? 'Grounding pass running'
      : passStatus === 'complete'
        ? 'Pass complete'
        : 'Pass failed';

  return (
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

      <div className="mt-3 flex items-center gap-3">
        {passStatus === 'idle' && onRetryQuery ? (
          <button
            type="button"
            onClick={handleGroundingPass}
            className="inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-raised px-2.5 py-1 text-label font-semibold text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <RotateCcw className="size-3.5 text-muted" aria-hidden="true" />
            <span>Autonomous Grounding Pass</span>
          </button>
        ) : null}
        {passStatus !== 'idle' ? (
          <div className="flex items-center gap-2">
            <span className="text-micro text-muted">{passLabel}</span>
            <span className="num text-micro text-muted">{`${(elapsedMs / 1000).toFixed(1)}s`}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

interface TurnFooterProps {
  turn: ChatTurn;
  onSelectChunk?: (chunk: SearchResult) => void;
  onFollowUp?: (turn: ChatTurn) => void;
  onRerun?: (turn: ChatTurn) => void;
}

const TurnFooter: React.FC<TurnFooterProps> = ({
  turn,
  onSelectChunk,
  onFollowUp,
  onRerun,
}) => {
  const verdict = verdictFor(turn);
  const latency = formatLatency(turn.execution_time_ms);
  const sourceCount = turn.sources.length;
  const timingBadges = useMemo(() => {
    return Object.entries(turn.timings_ms)
      .filter(([, value]) => Number.isFinite(value))
      .map(([key, value]) => formatTimingBadge(key, value));
  }, [turn.timings_ms]);

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

      {timingBadges.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5 border-l border-hairline pl-3">
          {timingBadges.map((badge, idx) => (
            <span key={idx} className="id-mono text-micro text-muted">
              {badge}
            </span>
          ))}
        </span>
      )}

      {turn.answer.trim() ? (
        <span className="ml-auto flex items-center gap-2">
          <CopyAnswerButton text={turn.answer} />
          {onFollowUp && (
            <button
              type="button"
              onClick={() => onFollowUp?.(turn)}
              aria-label="Ask follow-up with this context"
              className="inline-flex items-center gap-1.5 rounded-sm border border-hairline px-2.5 py-1 text-label text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ArrowLeft className="size-3.5 text-muted" aria-hidden="true" />
              <span>Follow-up</span>
            </button>
          )}
          {onRerun && (
            <button
              type="button"
              onClick={() => onRerun?.(turn)}
              aria-label="Re-run with parameter tuning"
              className="inline-flex items-center gap-1.5 rounded-sm border border-hairline px-2.5 py-1 text-label text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <RotateCcw className="size-3.5 text-muted" aria-hidden="true" />
              <span>Re-run</span>
            </button>
          )}
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
  onFollowUp,
  onRerun,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [completionAnnouncement, setCompletionAnnouncement] = useState<string>('');

  const latestTurn = turns[turns.length - 1];
  const announcedStage =
    latestTurn &&
    (latestTurn.status === 'retrieving' ||
      latestTurn.status === 'generating' ||
      latestTurn.status === 'verifying')
      ? latestTurn.activeStage?.name ?? latestTurn.status
      : null;

  // Announce final verified status and answer summary when a turn completes
  useEffect(() => {
    if (!latestTurn || latestTurn.status !== 'complete') {
      setCompletionAnnouncement('');
      return;
    }

    const verdict = verdictFor(latestTurn);
    const latency = formatLatency(latestTurn.execution_time_ms);
    const sourceCount = latestTurn.sources.length;
    const answerPreview = latestTurn.answer.trim()
      ? latestTurn.answer.trim().slice(0, 200)
      : 'No answer text';

    setCompletionAnnouncement(
      `Answer complete. Status: ${verdict.label}, ${latency.value}${latency.unit}, ${sourceCount} citation${sourceCount === 1 ? '' : 's'}. ${answerPreview}`,
    );
  }, [latestTurn?.id, latestTurn?.status, latestTurn?.verified, latestTurn?.refusal, latestTurn?.degraded_reason, latestTurn?.answer, latestTurn?.sources.length, latestTurn?.execution_time_ms]);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const { scrollTop, scrollHeight, clientHeight } = node;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 8;
    if (!isAtBottom && isLoading) {
      setIsUserScrolledUp(true);
    } else if (isAtBottom) {
      setIsUserScrolledUp(false);
    }
  }, [isLoading]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.addEventListener('scroll', handleScroll, { passive: true });
    node.addEventListener('wheel', handleScroll, { passive: true });
    return () => {
      node.removeEventListener('scroll', handleScroll);
      node.removeEventListener('wheel', handleScroll);
    };
  }, [handleScroll]);

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-label="Conversation"
      aria-busy={isLoading}
      data-testid="chat-stream-view"
      className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto px-4 py-6"
    >
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="stage-announcer"
      >
        {announcedStage ? `Stage: ${STAGE_LABELS[announcedStage]}` : ''}
      </div>

      {completionAnnouncement && (
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="completion-announcer"
        >
          {completionAnnouncement}
        </div>
      )}

      <ol className="flex flex-col gap-6">
        {turns.map((turn) => {
          const activeStage =
            turn.status === 'retrieving' ||
            turn.status === 'generating' ||
            turn.status === 'verifying'
              ? turn.activeStage?.name ?? turn.status
              : null;
          const isComplete = turn.status === 'complete';

          return (
            <li
              key={turn.id}
              data-testid={`chat-turn-${turn.id}`}
              className="flex flex-col gap-3"
            >
              <div className="max-w-[85%] self-end rounded-sm border border-hairline bg-surface-sunken px-4 py-2.5 text-ink">
                <p className="whitespace-pre-wrap break-words text-body">{turn.query}</p>
              </div>

              <DoubleBezelCard
                className="border border-hairline bg-surface rounded p-1.5"
                innerClassName="rounded-sm bg-surface-raised p-4 border-t border-white/[80] dark:border-white/[8] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
              >
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
                    <Suspense
                      fallback={
                        <p className="whitespace-pre-wrap break-words text-body text-ink">
                          {turn.answer}
                        </p>
                      }
                    >
                      <MarkdownRenderer
                        content={turn.answer}
                        onCitationClick={(citationNumber) => {
                          const chunk = turn.sources[citationNumber - 1];
                          if (chunk && onSelectChunk) {
                            onSelectChunk(chunk);
                          }
                        }}
                      />
                    </Suspense>
                  ) : activeStage ? (
                    <AnswerSkeleton />
                  ) : (
                    <p className="text-body text-muted">No answer text was returned for this turn.</p>
                  )}

                  {(turn.refusal || Boolean(turn.degraded_reason)) && turn.sources.length > 0 ? (
                    <EvidenceRecoverySurface
                      turn={turn}
                      onSelectChunk={onSelectChunk}
                      onRetryQuery={onRetryQuery}
                    />
                  ) : null}

                  <div
                    className={`turn-wrapper grid${isComplete ? ' complete' : ''}`}
                    style={{ gridTemplateRows: isComplete ? '1fr 1fr' : '0fr 1fr' }}
                  >
                    <div className="turn-footer">
                      <TurnFooter
                        turn={turn}
                        onSelectChunk={onSelectChunk}
                        onFollowUp={onFollowUp}
                        onRerun={onRerun}
                      />
                    </div>
                  </div>
              </DoubleBezelCard>
            </li>
          );
        })}
      </ol>

      {isLoading && isUserScrolledUp && (
        <button
          type="button"
          onClick={() => {
            const node = scrollRef.current;
            if (node) {
              node.scrollTop = node.scrollHeight;
              setIsUserScrolledUp(false);
            }
          }}
          data-testid="resume-stream-pill"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2 text-label font-semibold text-ink transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Resume live stream"
        >
          <span aria-hidden="true">↓</span>
          <span>Resume Live Stream</span>
        </button>
      )}

      <div
        data-testid="chat-bottom-sentinel"
        style={{ overflowAnchor: 'auto', height: 1 }}
        aria-hidden="true"
      />
    </div>
  );
};
