import React, { useCallback, useRef, useState } from 'react';
import { Copy, RefreshCw, Send } from 'lucide-react';

import { api, ApiError } from '../../services/api';
import { StatusChip, type StatusChipVariant } from '../StatusChip';
import type { QueryResponse } from '../../types/api';

export interface ChatProps {
  tenantId: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  response?: QueryResponse;
  error?: { message: string; status?: number };
}

const formatLatency = (ms: number): string => {
  if (!Number.isFinite(ms)) return '—';
  const rounded = Math.round(ms);
  if (Math.abs(rounded) < 1000) return `${rounded} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
};

const verdictFor = (response: QueryResponse): { label: string; variant: StatusChipVariant } => {
  if (response.refusal) return { label: 'REFUSED', variant: 'fail' };
  if (response.degraded_reason) return { label: 'DEGRADED', variant: 'warn' };
  if (response.verified) return { label: 'VERIFIED', variant: 'ok' };
  return { label: 'UNVERIFIED', variant: 'faint' };
};

const shortId = (id: string | undefined | null, keep = 8): string => {
  if (!id) return '—';
  return id.length > keep ? `${id.slice(0, keep)}…` : id;
};

export const Chat: React.FC<ChatProps> = ({ tenantId }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);

  const createId = (): string =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const send = useCallback(
    async (text: string) => {
      const query = text.trim();
      if (!query || streaming) return;

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const seq = ++requestSeqRef.current;

      const userId = createId();
      setMessages((previous) => [...previous, { id: userId, role: 'user', content: query }]);
      const assistantId = createId();
      setMessages((previous) => [...previous, { id: assistantId, role: 'assistant', content: '', status: 'complete' }]);
      setInput('');
      setStreaming(true);

      try {
        const response = await api.query({
          query,
          tenant_id: tenantId,
          top_k: 3,
          max_cycles: 3,
          enforce_guardrails: true,
        });

        if (controller.signal.aborted || seq !== requestSeqRef.current) return;
        setMessages((previous) =>
          previous.map((message) =>
            message.id === assistantId ? { ...message, content: response.answer, response } : message,
          ),
        );
      } catch (error) {
        if (controller.signal.aborted || seq !== requestSeqRef.current) return;
        setMessages((previous) =>
          previous.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  status: 'error' as const,
                  error: error instanceof ApiError ? { message: error.message, status: error.status } : { message: String(error ?? 'Request failed') },
                }
              : message,
          ),
        );
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
        setStreaming(false);
      }
    },
    [tenantId, streaming],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send(input);
      }
    },
    [input, send],
  );

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => undefined);
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="flex h-[calc(100vh-200px)] flex-col">
        <div className="flex-1 overflow-y-auto pb-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} `}
            >
              {message.role === 'user' ? (
                <div className="max-w-[80%] rounded-lg border border-hairline bg-accent p-3 text-accent-ink">
                  <p className="whitespace-pre-wrap break-words text-body">{message.content}</p>
                </div>
              ) : (
                <DoubleBubble message={message} handleCopy={handleCopy} />
              )}
            </div>
          ))}
          {streaming && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-lg border border-hairline bg-surface-raised p-3 animate-pulse">
                <span className="text-micro text-muted">Meridian is thinking…</span>
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            send(input);
          }}
          className="sticky bottom-0 z-10 w-full border-t border-hairline bg-surface pt-3 pb-2"
        >
          <div className="mx-auto max-w-[34rem] flex gap-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Ask Meridian…"
              className="flex-1 resize-none rounded-lg border border-hairline bg-transparent px-3 py-2 text-ink outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50"
              disabled={streaming}
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="rounded-lg bg-accent px-4 py-2 text-accent-ink transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              {streaming ? (
                <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <>
                  <Send className="size-4" aria-hidden="true" />
                  <span className="ml-1 text-[12px]">Send</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface DoubleBubbleProps {
  message: ChatMessage;
  handleCopy: (text: string) => void;
}

const DoubleBubble: React.FC<DoubleBubbleProps> = ({ message, handleCopy }) => {
  const response = message.response;
  const verdict = response ? verdictFor(response) : null;
  const latency = response ? formatLatency(response.execution_time_ms) : null;
  const sources = response?.sources ?? response?.source_chunks ?? [];

  return (
    <div className="max-w-[80%] flex flex-col gap-2">
      <div className="rounded-lg border border-hairline bg-surface-raised p-3">
        <p className="whitespace-pre-wrap break-words text-ink">{message.content}</p>
        {message.error && (
          <div className="mt-2 rounded border border-fail bg-fail-wash p-2">
            <p className="text-[12px] font-bold text-fail">{message.error.message}</p>
          </div>
        )}
      </div>
      {response && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2">
          <div className="flex items-center gap-2">
            <StatusChip variant={verdict!.variant}>{verdict!.label}</StatusChip>
            {latency && <span className="id-mono text-micro text-muted">{latency}</span>}
            {response.request_id && (
              <span className="id-mono text-micro text-muted">#{shortId(response.request_id)}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleCopy(response.answer)}
              className="rounded-sm border border-hairline px-2 py-1 text-micro text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              title="Copy answer"
            >
              <Copy className="size-3.5" aria-hidden="true" />
            </button>
            {sources.length > 0 && (
              <button
                type="button"
                className="rounded-sm border border-hairline px-2 py-1 text-micro text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                title="Sources"
              >
                {sources.length} src
              </button>
            )}
          </div>
        </div>
      )}
      {sources.length > 0 && (
        <details className="rounded border border-hairline bg-surface p-2">
          <summary className="cursor-pointer text-[12px] font-semibold text-muted">
            Sources ({sources.length})
          </summary>
          <ul className="mt-2 space-y-1 text-[12px] text-muted">
            {sources.map((chunk, index) => (
              <li key={chunk.chunk_id ?? index} className="truncate">
                {chunk.title || chunk.filename || shortId(chunk.document_id)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

export default Chat;
