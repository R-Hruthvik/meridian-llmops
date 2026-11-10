import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, ArrowUpRight, Clock, FileText } from 'lucide-react';
import { api } from '../services/api';
import { useWorkbench } from '../WorkbenchContext';
import type { DocumentSummary, SearchResult } from '../types/api';
import { ChatStreamView } from './chat/ChatStreamView';
import { CitationInspectorDrawer } from './chat/CitationInspectorDrawer';
import { CommandDock } from './chat/CommandDock';
import { useRagChat } from './chat/useRagChat';
import type { ChatTurn } from './chat/useRagChat';
import { generateAuditLogMarkdown } from './ragFormat';

interface RagWorkspaceProps {
  tenantId: string;
}

const SAMPLE_QUERIES = [
  { label: 'Dual-memory retrieval', query: 'What storage engines does Meridian use for dual-memory retrieval?' },
  { label: 'Prompt injection controls', query: 'How does Meridian protect against prompt injections at the gateway?' },
  { label: 'Retry limits', query: 'What is the maximum number of self-healing retry cycles allowed?' },
];

export const RagWorkspace: React.FC<RagWorkspaceProps> = ({ tenantId }) => {
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(3);
  const [enforceGuardrails, setEnforceGuardrails] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activeChunk, setActiveChunk] = useState<SearchResult | null>(null);
  const [recentDocuments, setRecentDocuments] = useState<DocumentSummary[]>([]);
  const [recentDocumentsLoaded, setRecentDocumentsLoaded] = useState(false);
  const [recentDocumentsUnavailable, setRecentDocumentsUnavailable] = useState(false);
  const [followUpContext, setFollowUpContext] = useState<{ turnId: string; query: string; sourceCount: number } | null>(null);
  const workbench = useWorkbench();
  const chat = useRagChat({ tenantId });

  useEffect(() => {
    let active = true;
    setRecentDocumentsLoaded(false);
    setRecentDocumentsUnavailable(false);
    void api.getDocuments(tenantId).then((result) => {
      if (!active) return;
      const recent = [...result.documents]
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .slice(0, 2);
      setRecentDocuments(recent);
    }).catch(() => {
      if (active) {
        setRecentDocuments([]);
        setRecentDocumentsUnavailable(true);
      }
    }).finally(() => {
      if (active) setRecentDocumentsLoaded(true);
    });
    return () => { active = false; };
  }, [tenantId]);

  const submitQuery = useCallback((queryText: string) => {
    const text = queryText.trim();
    if (!text) return;
    setQuery('');
    setFollowUpContext(null);
    void chat.submitQuery(text, { topK, maxCycles: 3, enforceGuardrails });
  }, [chat, topK, enforceGuardrails]);

  const handleFollowUp = useCallback((turn: ChatTurn) => {
    const context = `Context from previous turn (${turn.sources.length} sources): ${turn.query}`;
    setFollowUpContext({ turnId: turn.id, query: turn.query, sourceCount: turn.sources.length });
    setQuery(context);
  }, []);

  const handleRerun = useCallback((turn: ChatTurn) => {
    setFollowUpContext({ turnId: turn.id, query: turn.query, sourceCount: turn.sources.length });
    setQuery(turn.query);
  }, []);

  const handleClearFollowUpContext = useCallback(() => {
    setFollowUpContext(null);
    setQuery('');
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

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6">
      <div className="ask-page-heading">
        <div>
          <p className="label-section mb-2 text-muted">Your reference workspace</p>
          <h1>Ask Meridian</h1>
          <p className="mt-2 text-label text-muted">Clear answers, grounded in the documents you trust.</p>
        </div>
        <details className="ask-shortcuts">
          <summary>Shortcuts</summary>
          <div className="ask-shortcut-list">
            {SAMPLE_QUERIES.map(({ label, query: sampleQuery }) => (
              <button key={sampleQuery} type="button" disabled={chat.isLoading} title={sampleQuery} onClick={() => setQuery(sampleQuery)}>{label}</button>
            ))}
          </div>
        </details>
      </div>

      <section className="ask-recent" aria-labelledby="recent-sources-title">
        <div className="ask-recent-heading">
          <h2 id="recent-sources-title">Recently added</h2>
          <button type="button" onClick={() => workbench?.openOverlay('corpus')}>
            Browse sources <ArrowUpRight aria-hidden="true"/>
          </button>
        </div>
        {recentDocumentsLoaded && (recentDocuments.length > 0 ? (
          <div className="ask-recent-list">
            {recentDocuments.map((document) => (
              <button key={document.id} type="button" onClick={() => workbench?.openOverlay('corpus', { documentId: document.id, breadcrumb: document.title })}>
                <span className="ask-recent-icon"><FileText aria-hidden="true"/></span>
                <span className="ask-recent-copy"><strong>{document.title}</strong><span>{document.format} · {new Date(document.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {document.chunk_count} passages</span></span>
                <span className="ask-recent-count">{document.chunk_count}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="ask-recent-empty">{recentDocumentsUnavailable ? 'Recent sources are unavailable while the workspace is offline.' : 'No sources yet. Add a document to ground your answers.'}</div>
        ))}
      </section>

      {/* Error Alert — distinct rendering based on HTTP status */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className={`flex items-start gap-2.5 rounded border p-3 ${
            error.status === 429
              ? 'border-hairline bg-warn-wash text-warn'
              : 'border-hairline bg-fail-wash text-fail'
          }`}
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
        <div className="flex items-center justify-end">
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

      <section
        aria-label="Conversation"
        className="h-[55vh] min-h-[20rem] overflow-hidden rounded border border-hairline bg-surface-raised"
      >
        <ChatStreamView
          turns={chat.turns}
          isLoading={chat.isLoading}
          onSelectChunk={openInspector}
          onRetryQuery={submitQuery}
          onFollowUp={handleFollowUp}
          onRerun={handleRerun}
        />
      </section>

      <div className="sticky bottom-0 z-20 border-t border-hairline bg-surface px-1 py-3">
        <CommandDock
          query={query}
          onQueryChange={setQuery}
          onSubmit={() => submitQuery(query)}
          isStreaming={chat.isLoading}
          onCancel={chat.abortCurrentQuery}
          topK={topK}
          onTopKChange={setTopK}
          guardrails={enforceGuardrails}
          onGuardrailsChange={setEnforceGuardrails}
          followUpContext={followUpContext}
          onClearFollowUpContext={handleClearFollowUpContext}
        />
      </div>

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
