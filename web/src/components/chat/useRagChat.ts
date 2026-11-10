import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../../services/api';
import type { QueryResponse, SearchResult, VerificationSummary } from '../../types/api';

export interface ChatTurn {
  id: string;
  query: string;
  createdAt: number;
  status: 'idle' | 'retrieving' | 'generating' | 'verifying' | 'complete' | 'error';
  activeStage?: {
    name: 'retrieving' | 'generating' | 'verifying';
    status: 'started' | 'complete';
    timings_ms?: Record<string, number>;
  };
  answer: string;
  sources: SearchResult[];
  verified: boolean;
  refusal: boolean;
  degraded_reason?: string | null;
  answer_status?: 'answered' | 'insufficient_context' | 'unverified' | 'refused';
  timings_ms: Record<string, number>;
  execution_time_ms: number;
  verification?: VerificationSummary | null;
  error?: { message: string; status?: number };
}

export interface UseRagChatOptions {
  tenantId?: string;
  initialTurns?: ChatTurn[];
}

export interface SubmitQueryOptions {
  topK?: number;
  maxCycles?: number;
  enforceGuardrails?: boolean;
}

interface StreamEvent {
  event: string;
  data: Record<string, unknown>;
}

interface UseRagChatResult {
  turns: ChatTurn[];
  activeTurnId: string | null;
  activeTurn: ChatTurn | null;
  isLoading: boolean;
  submitQuery: (queryText: string, queryOptions?: SubmitQueryOptions) => Promise<void>;
  abortCurrentQuery: () => void;
  clearTurns: () => void;
  removeTurn: (id: string) => void;
}

const ACTIVE_STATUSES: ReadonlySet<ChatTurn['status']> = new Set([
  'retrieving',
  'generating',
  'verifying',
]);

const createTurnId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const toTimings = (value: unknown): Record<string, number> | undefined => {
  const record = asRecord(value);
  const timings: Record<string, number> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) timings[key] = raw;
  }
  return Object.keys(timings).length > 0 ? timings : undefined;
};

const readError = (error: unknown): { message: string; status?: number } => {
  if (error instanceof Error) {
    const status = (error as Error & { status?: number }).status;
    return typeof status === 'number' ? { message: error.message, status } : { message: error.message };
  }
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const message =
      typeof record.message === 'string' && record.message.trim()
        ? record.message
        : 'The query could not be completed.';
    return typeof record.status === 'number'
      ? { message, status: record.status }
      : { message };
  }
  return { message: 'The query could not be completed.' };
};

const isStageName = (value: unknown): value is 'retrieving' | 'generating' | 'verifying' =>
  value === 'retrieving' || value === 'generating' || value === 'verifying';

/**
 * Read a `text/event-stream` body one `event:`/`data:` frame at a time.
 *
 * Frames are separated by a blank line and can split across arbitrary network
 * reads, so the buffer is only drained when the terminator is present. Aborting
 * cancels the reader, which resolves the pending `read()` as done instead of
 * leaking a suspended promise.
 */
async function consumeEventStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flush = (rawFrame: string) => {
    const lines = rawFrame.split('\n');
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }

    if (dataLines.length === 0) return;

    const rawData = dataLines.join('\n');
    let data: Record<string, unknown> = {};
    try {
      data = asRecord(JSON.parse(rawData));
    } catch {
      data = { message: rawData };
    }
    onEvent({ event: eventName, data });
  };

  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = `${buffer}${decoder.decode(value, { stream: true })}`.replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawFrame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (rawFrame.trim()) flush(rawFrame);
        boundary = buffer.indexOf('\n\n');
      }
    }

    buffer = `${buffer}${decoder.decode()}`.replace(/\r\n/g, '\n');
    if (buffer.trim()) flush(buffer);
  } finally {
    signal?.removeEventListener('abort', onAbort);

    if (reader) {
      try {
        await reader.cancel('Stream lifecycle terminated');
      } catch {
        // Ignore errors if stream was already closed by network abort
      }
      try {
        reader.releaseLock();
      } catch {
        // Ignore if lock already released
      }
    }
  }
}

const responseToTurn = (response: QueryResponse): Partial<ChatTurn> => ({
  answer: response.answer,
  sources:
    response.sources && response.sources.length > 0 ? response.sources : response.source_chunks ?? [],
  verified: response.verified,
  refusal: response.refusal,
  degraded_reason: response.degraded_reason ?? null,
  answer_status: response.answer_status,
  timings_ms: response.timings_ms ?? {},
  execution_time_ms: response.execution_time_ms,
  verification: response.verification ?? null,
});

/**
 * Owns the conversational RAG transcript. Each submission is one turn whose
 * progress is driven by the SSE stream when available and by the plain JSON
 * query endpoint as a degraded fallback.
 */
export function useRagChat(options: UseRagChatOptions = {}): UseRagChatResult {
  const { tenantId, initialTurns } = options;

  const [turns, setTurns] = useState<ChatTurn[]>(() => initialTurns ?? []);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const tenantRef = useRef(tenantId);
  const currentRequestIdRef = useRef<number>(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  // Transcripts are tenant-scoped: never show one workspace's turns in another.
  useEffect(() => {
    if (tenantRef.current === tenantId) return;
    tenantRef.current = tenantId;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setTurns([]);
    setActiveTurnId(null);
    setIsLoading(false);
  }, [tenantId]);

  const updateTurn = useCallback(
    (id: string, updater: (turn: ChatTurn) => ChatTurn) => {
      if (!mountedRef.current) return;
      setTurns((previous) => previous.map((turn) => (turn.id === id ? updater(turn) : turn)));
    },
    [],
  );

  const applyStreamEvent = useCallback(
    (id: string, { event, data }: StreamEvent) => {
      if (event === 'stage') {
        const name = data.name ?? data.stage;
        if (!isStageName(name)) return;
        const timings = toTimings(data.timings_ms);
        updateTurn(id, (turn) => ({
          ...turn,
          status: name,
          activeStage: {
            name,
            status: data.status === 'complete' ? 'complete' : 'started',
            timings_ms: timings ?? turn.activeStage?.timings_ms,
          },
        }));
        return;
      }

      if (event === 'token') {
        const delta = data.delta ?? data.token ?? data.content;
        if (typeof delta !== 'string') return;
        updateTurn(id, (turn) => ({
          ...turn,
          status: 'generating',
          answer: `${turn.answer}${delta}`,
        }));
        return;
      }

      if (event === 'retrieval_complete') {
        const timings = toTimings(data.timings_ms) ?? toTimings(data);
        if (!timings) return;
        updateTurn(id, (turn) => ({ ...turn, timings_ms: { ...turn.timings_ms, ...timings } }));
        return;
      }

      if (event === 'verification_complete') {
        const verification =
          typeof data.verification === 'object' && data.verification !== null
            ? (data.verification as VerificationSummary)
            : null;
        const status = typeof data.status === 'string' ? data.status : verification?.status;
        updateTurn(id, (turn) => ({
          ...turn,
          verified: status === 'citations_ok' || status === 'supported',
          verification: verification ?? turn.verification ?? null,
        }));
        return;
      }

      if (event === 'error') {
        const message =
          typeof data.message === 'string' && data.message.trim()
            ? data.message
            : 'The query stream failed.';
        const status = typeof data.status === 'number' ? data.status : undefined;
        updateTurn(id, (turn) => ({ ...turn, status: 'error', error: { message, status } }));
        return;
      }

      if (event === 'done') {
        updateTurn(id, (turn) => {
          const sources = Array.isArray(data.sources)
            ? (data.sources as SearchResult[])
            : Array.isArray(data.source_chunks)
              ? (data.source_chunks as SearchResult[])
              : turn.sources;
          const timings = toTimings(data.timings_ms);
          const executionTime =
            typeof data.execution_time_ms === 'number' ? data.execution_time_ms : turn.execution_time_ms;

          return {
            ...turn,
            answer: typeof data.answer === 'string' && data.answer ? data.answer : turn.answer,
            answer_status:
              typeof data.answer_status === 'string'
                ? (data.answer_status as ChatTurn['answer_status'])
                : turn.answer_status,
            sources,
            verified: typeof data.verified === 'boolean' ? data.verified : turn.verified,
            refusal: typeof data.refusal === 'boolean' ? data.refusal : turn.refusal,
            degraded_reason:
              typeof data.degraded_reason === 'string' || data.degraded_reason === null
                ? (data.degraded_reason as string | null)
                : turn.degraded_reason,
            timings_ms: timings ? { ...turn.timings_ms, ...timings } : turn.timings_ms,
            execution_time_ms: executionTime,
            status: 'complete',
          };
        });
      }
    },
    [updateTurn],
  );

  const submitQuery = useCallback(
    async (queryText: string, queryOptions: SubmitQueryOptions = {}) => {
      const query = queryText.trim();
      if (!query) return;

      controllerRef.current?.abort();

      const reqId = ++currentRequestIdRef.current;

      const id = createTurnId();
      const turn: ChatTurn = {
        id,
        query,
        createdAt: Date.now(),
        status: 'retrieving',
        answer: '',
        sources: [],
        verified: false,
        refusal: false,
        timings_ms: {},
        execution_time_ms: 0,
      };

      setTurns((previous) => [...previous, turn]);
      setActiveTurnId(id);
      setIsLoading(true);

      const controller = new AbortController();
      controllerRef.current = controller;

      const topK = queryOptions.topK ?? 3;
      const maxCycles = queryOptions.maxCycles ?? 3;
      const enforceGuardrails = queryOptions.enforceGuardrails ?? true;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (tenantId) headers['X-Tenant-Id'] = tenantId;

      try {
        const response = await fetch('/v1/query/stream', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query,
            tenant_id: tenantId,
            top_k: topK,
            max_cycles: maxCycles,
            enforce_guardrails: enforceGuardrails,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Streaming endpoint unavailable (HTTP ${response.status})`);
        }

        await consumeEventStream(response.body, controller.signal, (event) => {
          if (reqId !== currentRequestIdRef.current) return;
          applyStreamEvent(id, event);
        });

        if (reqId !== currentRequestIdRef.current) return;

        updateTurn(id, (current) =>
          ACTIVE_STATUSES.has(current.status) ? { ...current, status: 'complete' } : current,
        );
      } catch {
        if (controller.signal.aborted || reqId !== currentRequestIdRef.current) {
          updateTurn(id, (current) => ({ ...current, status: 'complete' }));
          return;
        }

        try {
          const fallback = await api.query({
            query,
            tenant_id: tenantId,
            top_k: topK,
            max_cycles: maxCycles,
            enforce_guardrails: enforceGuardrails,
          });

          if (controller.signal.aborted || reqId !== currentRequestIdRef.current) return;

          updateTurn(id, (current) => ({
            ...current,
            ...responseToTurn(fallback),
            status: 'complete',
          }));
        } catch (fallbackError) {
          if (controller.signal.aborted || reqId !== currentRequestIdRef.current) return;
          updateTurn(id, (current) => ({
            ...current,
            status: 'error',
            error: readError(fallbackError),
          }));
        }
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
        if (mountedRef.current) setIsLoading(false);
      }
    },
    [tenantId, applyStreamEvent, updateTurn],
  );

  const abortCurrentQuery = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (activeTurnId) {
      updateTurn(activeTurnId, (turn) =>
        ACTIVE_STATUSES.has(turn.status) ? { ...turn, status: 'complete' } : turn,
      );
    }
    setIsLoading(false);
  }, [activeTurnId, updateTurn]);

  const clearTurns = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setTurns([]);
    setActiveTurnId(null);
    setIsLoading(false);
  }, []);

  const removeTurn = useCallback((id: string) => {
    setTurns((previous) => previous.filter((turn) => turn.id !== id));
    setActiveTurnId((current) => (current === id ? null : current));
  }, []);

  const activeTurn = useMemo(
    () => turns.find((turn) => turn.id === activeTurnId) ?? null,
    [turns, activeTurnId],
  );

  return {
    turns,
    activeTurnId,
    activeTurn,
    isLoading,
    submitQuery,
    abortCurrentQuery,
    clearTurns,
    removeTurn,
  };
}
