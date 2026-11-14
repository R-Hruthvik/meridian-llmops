/**
 * Meridian — Ask streaming controller.
 *
 * Owns the conversation, the SSE lifecycle and the resilience path:
 *
 *   1. `POST /v1/query/stream` — every frame is folded into the active message
 *      (tokens buffered, stages advanced, terminal envelope adopted).
 *   2. If the stream yields nothing usable (transport error, empty stream),
 *      fall back to `POST /v1/query` so the operator still gets an answer.
 *   3. Abort cancels the request, keeps the partial answer and marks the turn.
 *
 * Tokens are buffered for ~40ms before hitting state, so a fast stream cannot
 * thrash Markdown re-parsing or React rendering.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, apiFetch, streamQuery } from '../../core/api';
import { useAuth } from '../../core/auth';
import type { QueryRequest, QueryResponse } from '../../core/types';
import {
  asNumber,
  asString,
  isRecord,
  normalizeQueryResponse,
  normalizeSearchResults,
  normalizeVerification,
  type AskControls,
  type AskMessage,
  type AskMessageStatus,
  type PipelineStage,
  type PipelineStageId,
} from './types';

/* -------------------------------------------------------------------------- */
/* Pipeline helpers                                                           */
/* -------------------------------------------------------------------------- */

const STAGE_ORDER: readonly PipelineStageId[] = [
  'guardrail',
  'retrieval',
  'rerank',
  'generation',
  'verification',
];

const STAGE_LABELS: Record<PipelineStageId, string> = {
  guardrail: 'Guardrails',
  retrieval: 'Retrieve',
  rerank: 'Rerank',
  generation: 'Generate',
  verification: 'Verify',
};

/** Fresh pipeline with the first stage already live. */
export function createPipeline(): PipelineStage[] {
  return STAGE_ORDER.map((id, index) => ({
    id,
    label: STAGE_LABELS[id],
    status: index === 0 ? 'active' : 'pending',
    detail: null,
    ms: null,
  }));
}

/** Everything before `id` becomes complete, `id` becomes active. */
export function activateStage(stages: PipelineStage[], id: PipelineStageId): PipelineStage[] {
  const target = stages.findIndex((stage) => stage.id === id);
  if (target === -1) return stages;
  return stages.map((stage, index) => {
    if (index < target) return stage.status === 'complete' ? stage : { ...stage, status: 'complete' };
    if (index === target) return stage.status === 'complete' ? stage : { ...stage, status: 'active' };
    return stage;
  });
}

/** Mark `id` complete and hand the baton to the next pending stage. */
export function completeStage(
  stages: PipelineStage[],
  id: PipelineStageId,
  detail?: string | null,
  ms?: number | null,
): PipelineStage[] {
  const target = stages.findIndex((stage) => stage.id === id);
  if (target === -1) return stages;
  const activated = activateStage(stages, id);
  return activated.map((stage, index) => {
    if (index === target) {
      return {
        ...stage,
        status: 'complete',
        detail: detail ?? stage.detail,
        ms: ms ?? stage.ms,
      };
    }
    if (index === target + 1 && stage.status === 'pending') {
      return { ...stage, status: 'active' };
    }
    return stage;
  });
}

/** Close out every stage (used on the terminal frame). */
export function completePipeline(stages: PipelineStage[]): PipelineStage[] {
  return stages.map((stage) => (stage.status === 'failed' ? stage : { ...stage, status: 'complete' }));
}

const TOKEN_EVENTS = new Set(['token', 'delta', 'answer_delta', 'message_delta', 'chunk']);
const TERMINAL_EVENTS = new Set(['final', 'done', 'complete', 'result', 'answer_complete']);
const ERROR_EVENTS = new Set(['error', 'failed', 'failure']);

/** Map an arbitrary event name / stage hint onto our canonical stage ids. */
export function resolveStageId(name: string, hint: string): PipelineStageId | null {
  const haystack = `${name} ${hint}`.toLowerCase();
  if (/guard|policy|safety|sanitiz|input_check/.test(haystack)) return 'guardrail';
  if (/verif|citation|judge|grounded|numeric/.test(haystack)) return 'verification';
  if (/rerank|re-rank|rank/.test(haystack)) return 'rerank';
  if (/retriev|search|dense|sparse|hybrid|recall|expand/.test(haystack)) return 'retrieval';
  if (/gener|synth|answer|compose|llm|draft/.test(haystack)) return 'generation';
  return null;
}

function extractToken(data: unknown): string {
  if (typeof data === 'string') return data;
  if (!isRecord(data)) return '';
  const candidate = data.text ?? data.token ?? data.delta ?? data.content ?? data.chunk;
  if (typeof candidate === 'string') return candidate;
  if (isRecord(candidate) && typeof candidate.text === 'string') return candidate.text;
  return '';
}

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

let messageCounter = 0;

function uid(prefix: string): string {
  messageCounter += 1;
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}_${messageCounter}`;
}

const TOKEN_FLUSH_MS = 40;

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

export interface UseAskStreamResult {
  messages: AskMessage[];
  isStreaming: boolean;
  submit: (query: string, controls: AskControls) => void;
  abort: () => void;
  reset: () => void;
}

function createAssistantMessage(id: string, startedAt: number): AskMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    createdAt: startedAt,
    startedAt,
    completedAt: null,
    status: 'streaming',
    response: null,
    sources: [],
    verification: null,
    pipeline: createPipeline(),
    elapsedMs: null,
    error: null,
    degradedReason: null,
    refusal: false,
    usedFallback: false,
  };
}

export function useAskStream(): UseAskStreamResult {
  const { tenantId } = useAuth();
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const streamingRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const bufferRef = useRef('');
  const flushTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, []);

  const patch = useCallback((id: string, updater: (message: AskMessage) => AskMessage) => {
    if (!mountedRef.current) return;
    setMessages((previous) => previous.map((message) => (message.id === id ? updater(message) : message)));
  }, []);

  const run = useCallback(
    async (query: string, controls: AskControls) => {
      const startedAt = Date.now();
      const assistantId = uid('assistant');

      const userMessage: AskMessage = {
        id: uid('user'),
        role: 'user',
        content: query,
        createdAt: startedAt,
        startedAt: null,
        completedAt: startedAt,
        status: 'complete',
        response: null,
        sources: [],
        verification: null,
        pipeline: [],
        elapsedMs: null,
        error: null,
        degradedReason: null,
        refusal: false,
        usedFallback: false,
      };

      setMessages((previous) => [...previous, userMessage, createAssistantMessage(assistantId, startedAt)]);
      streamingRef.current = true;
      setIsStreaming(true);
      activeIdRef.current = assistantId;
      bufferRef.current = '';

      const controller = new AbortController();
      controllerRef.current = controller;

      // Mutable stream-local state (object avoids closure narrowing pitfalls).
      const stream = { response: null as QueryResponse | null, sawToken: false, failure: null as Error | null };

      const setStages = (updater: (stages: PipelineStage[]) => PipelineStage[]) => {
        patch(assistantId, (message) => ({ ...message, pipeline: updater(message.pipeline) }));
      };

      const flush = () => {
        if (flushTimerRef.current !== null) {
          window.clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        const buffered = bufferRef.current;
        if (!buffered) return;
        bufferRef.current = '';
        patch(assistantId, (message) => ({ ...message, content: message.content + buffered }));
      };

      const pushToken = (text: string) => {
        if (!text) return;
        stream.sawToken = true;
        bufferRef.current += text;
        if (flushTimerRef.current === null) {
          flushTimerRef.current = window.setTimeout(() => {
            flushTimerRef.current = null;
            flush();
          }, TOKEN_FLUSH_MS);
        }
      };

      /** Adopt a full envelope; returns false when the payload isn't one. */
      const adopt = (payload: unknown): boolean => {
        const normalized = normalizeQueryResponse(payload);
        if (!normalized) return false;
        stream.response = normalized;
        patch(assistantId, (message) => ({
          ...message,
          // The envelope is authoritative for the turn: keep it on the message so
          // views can read serving/timing/trace data without re-parsing events.
          response: normalized,
          content:
            normalized.answer.length > 0 && normalized.answer.length >= message.content.length
              ? normalized.answer
              : message.content,
          sources:
            normalized.source_chunks.length > 0 ? normalized.source_chunks : normalized.sources,
          verification: normalized.verification,
          refusal: normalized.refusal,
          degradedReason: normalized.degraded_reason ?? null,
        }));
        return true;
      };

      const finish = (status: AskMessageStatus, extra?: Partial<AskMessage>) => {
        flush();
        patch(assistantId, (message) => {
          const wallClock = Date.now() - (message.startedAt ?? startedAt);
          const reported = stream.response?.execution_time_ms ?? 0;
          return {
            ...message,
            status,
            completedAt: Date.now(),
            elapsedMs: reported > 0 ? reported : wallClock,
            pipeline: status === 'complete' ? completePipeline(message.pipeline) : message.pipeline,
            ...extra,
          };
        });
      };

      const handleEvent = (event: string, data: unknown) => {
        const name = event.toLowerCase();
        const payload = isRecord(data) ? data : {};
        const hint = asString(payload.name ?? payload.stage ?? payload.step).toLowerCase();

        if (TOKEN_EVENTS.has(name)) {
          setStages((stages) => activateStage(stages, 'generation'));
          pushToken(extractToken(data));
          return;
        }

        if (TERMINAL_EVENTS.has(name)) {
          adopt(data);
          setStages(completePipeline);
          finish('complete');
          return;
        }

        if (ERROR_EVENTS.has(name)) {
          const message = asString(payload.detail ?? payload.message ?? payload.error, 'Stream error');
          stream.failure = new Error(message);
          patch(assistantId, (current) => ({ ...current, status: 'error', error: message }));
          return;
        }

        const stageId = resolveStageId(name, hint);
        if (!stageId) {
          // Unknown frame that still carries an answer — take it.
          if (typeof payload.answer === 'string' && payload.answer.length > 0) adopt(payload);
          return;
        }

        const detail = asString(payload.detail ?? payload.action_taken ?? payload.status);
        const reportedMs = asNumber(payload.ms ?? payload.duration_ms ?? payload.elapsed_ms, Number.NaN);
        setStages((stages) =>
          completeStage(
            stages,
            stageId,
            detail.length > 0 ? detail : null,
            Number.isFinite(reportedMs) ? reportedMs : null,
          ),
        );

        if (stageId === 'retrieval') {
          const results = normalizeSearchResults(payload);
          const cycles = asNumber(payload.cycle_count ?? payload.cycles, Number.NaN);
          if (results.length > 0) {
            patch(assistantId, (message) => ({ ...message, sources: results }));
          }
          if (Number.isFinite(cycles)) {
            setStages((stages) =>
              stages.map((stage) => (stage.id === 'retrieval' ? { ...stage, detail: `${cycles} cycles` } : stage)),
            );
          }
        }

        if (stageId === 'verification') {
          const verdict = normalizeVerification(payload.verification ?? payload);
          patch(assistantId, (message) => ({ ...message, verification: verdict }));
        }
      };

      const shutdown = () => {
        if (activeIdRef.current !== assistantId) return; // superseded by reset()
        activeIdRef.current = null;
        controllerRef.current = null;
        streamingRef.current = false;
        if (flushTimerRef.current !== null) {
          window.clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        if (mountedRef.current) setIsStreaming(false);
      };

      const request: QueryRequest = {
        query,
        tenant_id: tenantId,
        top_k: controls.top_k,
        max_cycles: controls.max_cycles,
        enforce_guardrails: controls.enforce_guardrails,
      };

      try {
        await streamQuery(request, {
          signal: controller.signal,
          onEvent: handleEvent,
          onError: (error) => {
            stream.failure = error;
          },
        });

        if (controller.signal.aborted) {
          flush();
          patch(assistantId, (message) => ({
            ...message,
            status: 'aborted',
            completedAt: Date.now(),
            elapsedMs: Date.now() - (message.startedAt ?? startedAt),
          }));
          return;
        }

        if (stream.response || stream.sawToken) {
          finish('complete');
          return;
        }

        // ── Fallback: the stream produced nothing usable → non-streaming query.
        try {
          const fallback = await apiFetch<unknown>('/v1/query', {
            method: 'POST',
            body: JSON.stringify(request),
            signal: controller.signal,
          });
          patch(assistantId, (message) => ({ ...message, usedFallback: true }));
          if (!adopt(fallback)) throw new Error('Fallback response was not a query envelope');
          finish('complete');
        } catch (error) {
          if (controller.signal.aborted) {
            patch(assistantId, (message) => ({ ...message, status: 'aborted', completedAt: Date.now() }));
            return;
          }
          const rawMessage =
            error instanceof ApiError
              ? (error.detailMessage ?? error.message)
              : error instanceof Error
                ? error.message
                : 'Query failed';
          patch(assistantId, (current) => {
            // A 5xx/network failure before any SSE stage completed means the
            // backend is unreachable — not a guardrail policy block. Keep the
            // pipeline neutral and tell the operator what to do. A failure
            // after stages have run is a real pipeline error: the in-flight
            // stage goes red.
            const disconnected =
              !current.pipeline.some((stage) => stage.status === 'complete') &&
              error instanceof ApiError &&
              (error.status === 0 || error.isServerError);
            return {
              ...current,
              status: 'error',
              error: disconnected
                ? 'Backend unreachable — check the RAG engine on http://localhost:8000, then retry.'
                : rawMessage,
              completedAt: Date.now(),
              pipeline: current.pipeline.map((stage) => {
                if (disconnected) {
                  return stage.status === 'active' || stage.status === 'failed'
                    ? { ...stage, status: 'pending', detail: null }
                    : stage;
                }
                return stage.status === 'active' ? { ...stage, status: 'failed' } : stage;
              }),
            };
          });
        }
      } finally {
        shutdown();
      }
    },
    [patch, tenantId],
  );

  const submit = useCallback(
    (query: string, controls: AskControls) => {
      const trimmed = query.trim();
      if (!trimmed || streamingRef.current) return;
      void run(trimmed, controls);
    },
    [run],
  );

  const abort = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    activeIdRef.current = null;
    streamingRef.current = false;
    bufferRef.current = '';
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    setMessages([]);
    setIsStreaming(false);
  }, []);

  return { messages, isStreaming, submit, abort, reset };
}

export default useAskStream;
