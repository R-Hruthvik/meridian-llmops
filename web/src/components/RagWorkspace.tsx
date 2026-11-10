import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import { useWorkbench } from '../WorkbenchContext';
import type { SearchResult } from '../types/api';
import { ChatStreamView } from '../components/chat/ChatStreamView';
import { CitationInspectorDrawer } from '../components/chat/CitationInspectorDrawer';
import { useRagChat } from '../components/chat/useRagChat';
import type { ChatTurn } from '../components/chat/useRagChat';
import { FluidMembraneInput } from '../components/canvas/FluidMembraneInput';
import { generateAuditLogMarkdown } from './ragFormat';

export interface RagWorkspaceProps {
  tenantId: string;
  /** Turns of the active chat session, used to seed an empty chat. */
  initialTurns: ChatTurn[];
  /** Fired whenever the local turn transcript changes so the workspace can
   *  persist it to the active session. */
  onTurnsUpdate: (turns: ChatTurn[]) => void;
}

export const RagWorkspace: React.FC<RagWorkspaceProps> = ({
  tenantId,
  initialTurns,
  onTurnsUpdate,
}) => {
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(3);
  const [enforceGuardrails, setEnforceGuardrails] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activeChunk, setActiveChunk] = useState<SearchResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const workbench = useWorkbench();
  const chat = useRagChat({ tenantId, initialTurns });

  // Persist the transcript back to the workspace so it can be stored per
  // session (including when the stream completes).
  useEffect(() => {
    onTurnsUpdate(chat.turns);
  }, [chat.turns, onTurnsUpdate]);

  const submitQuery = useCallback((queryText: string) => {
    const text = queryText.trim();
    if (!text) return;
    setQuery('');
    void chat.submitQuery(text, { topK, maxCycles: 3, enforceGuardrails });
  }, [chat, topK, enforceGuardrails]);

  const handleFollowUp = useCallback((turn: ChatTurn) => {
    const context = `Context from previous turn (${turn.sources.length} sources): ${turn.query}`;
    setQuery(context);
  }, []);

  const handleRerun = useCallback((turn: ChatTurn) => {
    setQuery(turn.query);
  }, []);

  const handleExportAuditLog = useCallback(() => {
    if (chat.turns.length === 0) return;
    const md = generateAuditLogMarkdown(tenantId, chat.turns);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `meridian-audit-${tenantId}-${Date.now()}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }, [chat.turns, tenantId]);

  const openInspector = (chunk: SearchResult) => {
    setActiveChunk(chunk);
    setInspectorOpen(true);
  };

  const inspectorTurn = activeChunk
    ? chat.turns.find((turn) =>
        turn.sources.some(
          (source) => source === activeChunk || source.chunk_id === activeChunk.chunk_id,
        ),
      ) ?? null
    : null;
  const inspectorChunks = inspectorTurn?.sources ?? (activeChunk ? [activeChunk] : []);

  const latestTurn = chat.turns[chat.turns.length - 1];
  const error = latestTurn?.status === 'error' ? latestTurn.error ?? null : null;

  const empty = chat.turns.length === 0;

  // Focus the input when it's the primary interaction point.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, [empty]);

  return (
    <div className="relative min-h-[100dvh] overflow-y-auto bg-surface text-ink selection:bg-accent-wash">
      {/* Single persistent membrane input dock. Hero center when empty, springs to
          bottom dock once a conversation starts. Chat renders above with clearance. */}
      <FluidMembraneInput
        inputRef={inputRef}
        isCenter={empty}
        value={query}
        placeholder="Ask Meridian RAG (Cmd+Enter to send)..."
        ariaLabel="Ask Meridian RAG"
        onChange={setQuery}
        onSubmit={() => submitQuery(query)}
        colorRgb="37 99 235"
      />

      {/* Minimal retrieval configurability (topK / guardrails) — no CommandDock. */}
      <div className="mb-2 flex items-center gap-2 border-b border-hairline pb-1">
        <span className="text-[10px] font-mono font-bold text-muted uppercase tracking-wider">
          Retrieval
        </span>
        <span className="text-[10px] text-muted">topK</span>
        <div className="flex gap-1">
          {[3, 5, 8].map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={topK === k}
              onClick={() => setTopK(k)}
              className={`size-5 shrink-0 rounded border px-1 text-[10px] ${
                topK === k
                  ? 'border-accent bg-accent-wash text-accent-ink'
                  : 'border-hairline text-muted hover:bg-surface-sunken'
              }`}
            >
              {k}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={enforceGuardrails}
          onClick={() => setEnforceGuardrails((v) => !v)}
          className="size-5 shrink-0 rounded border px-1 text-[10px] leading-none"
        >
          {enforceGuardrails ? 'guardrails' : 'guardrails off'}
        </button>
      </div>

      {/* CONVERSATION STAGE — fades/springs into view above the docked bar.
          pb-28 reserves clearance under the bottom dock. */}
      <section
        aria-label="Conversation"
        className={`relative z-10 min-h-[100dvh] pb-[260px] transition-opacity duration-500 ${
          empty ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-4 flex items-start gap-2.5 rounded border p-3 ${
              error.status === 429
                ? 'border-hairline bg-warn-wash text-warn'
                : 'border-hairline bg-fail-wash text-fail'
            }"
          >
            {error.status === 429 ? (
              <Clock className="mt-0.5 size-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 text-label font-bold">
                <span>
                  {error.status === 429
                    ? 'Rate Limit Exceeded'
                    : error.status === 401
                      ? 'Authentication Error'
                      : error.status === 422
                        ? 'Validation Error'
                        : 'Query Intercepted / Failed'}
                </span>
                {error.status && (
                  <span className="num rounded-sm border border-hairline px-1.5 py-0.5 text-micro">
                    HTTP {error.status}
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-body text-muted">
                {error.status === 429
                  ? 'Too many requests in the current time window. Please wait a moment and try again.'
                  : error.message}
              </p>
            </div>
          </div>
        )}

        {chat.turns.length > 0 && (
          <div className="mb-4 flex items-center justify-end">
            <button
              type="button"
              onClick={handleExportAuditLog}
              aria-label="Export audit log in markdown format"
              className="inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2.5 py-1 text-label text-ink transition-colors hover:bg-surface-sunken focus-machined"
            >
              <span>Export Audit Log (.md)</span>
            </button>
          </div>
        )}

        <ChatStreamView
          turns={chat.turns}
          isLoading={chat.isLoading}
          onSelectChunk={openInspector}
          onRetryQuery={submitQuery}
          onFollowUp={handleFollowUp}
          onRerun={handleRerun}
        />
      </section>

      <CitationInspectorDrawer
        isOpen={inspectorOpen && activeChunk !== null}
        onClose={() => setInspectorOpen(false)}
        activeChunk={activeChunk}
        chunks={inspectorChunks}
        onSelectChunk={(chunk) => setActiveChunk(chunk)}
        timings={inspectorTurn?.timings_ms}
        verification={inspectorTurn?.verification ?? null}
        onOpenCorpus={(chunk) => {
          const index = inspectorChunks.findIndex(
            (candidate) =>
              candidate === chunk || candidate.chunk_id === chunk.chunk_id,
          );
          workbench?.openOverlay('corpus', {
            breadcrumb: index >= 0 ? `Ask · chunk ${index + 1}` : 'Ask',
            documentId: chunk.document_id,
            chunkId: chunk.chunk_id,
          });
        }}
      />
    </div>
  );
};
