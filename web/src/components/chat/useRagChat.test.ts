import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { api } from '../../services/api';
import type { QueryResponse, SearchResult, VerificationSummary } from '../../types/api';
import { useRagChat, type ChatTurn } from './useRagChat';

const encoder = new TextEncoder();

const CITATIONS_OK: VerificationSummary = {
  status: 'citations_ok',
  scope: 'format_and_numeric_consistency',
  invalid_citations: [],
  uncited_claims: [],
  numeric_mismatches: [],
  unsupported_claims: [],
  contradictions: [],
};

const CHUNK: SearchResult = {
  chunk_id: 'chunk-1',
  document_id: 'doc-1',
  text: 'Meridian stores vectors in Qdrant and structure in Neo4j.',
  score: 0.91,
  retrieval_method: 'hybrid',
  filename: 'architecture.md',
  title: 'Architecture',
  page_start: 4,
  heading_path: 'Storage > Dual memory',
};

function streamFrom(parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

function sseResponse(parts: string[]): Response {
  return { ok: true, status: 200, body: streamFrom(parts) } as unknown as Response;
}

function makeQueryResponse(overrides: Partial<QueryResponse> = {}): QueryResponse {
  return {
    query: 'fallback question',
    answer: 'A fallback answer grounded in Qdrant.',
    source_chunks: [CHUNK],
    entities: [],
    cycle_count: 1,
    verified: true,
    refusal: false,
    execution_time_ms: 42,
    answer_status: 'answered',
    verification: CITATIONS_OK,
    debug: {},
    sources: [CHUNK],
    timings_ms: { dense: 5, llm: 20 },
    ...overrides,
  };
}

function makeTurn(overrides: Partial<ChatTurn> = {}): ChatTurn {
  return {
    id: overrides.id ?? 'turn-existing',
    query: overrides.query ?? 'Existing question',
    createdAt: Date.now(),
    status: 'complete',
    answer: 'Existing answer',
    sources: [],
    verified: false,
    refusal: false,
    timings_ms: {},
    execution_time_ms: 0,
    ...overrides,
  };
}

describe('useRagChat', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('streams stage progression and answer tokens over SSE', async () => {
    // The token payload is split across two network reads on purpose: the
    // parser must buffer until the terminating blank line arrives.
    fetchMock.mockResolvedValue(
      sseResponse([
        'event: stage\ndata: {"name":"retrieving","status":"started","timings_ms":{"dense":12}}\n\n',
        'event: token\ndata: {"delta":"Hel',
        'lo"}\n\n',
        'event: stage\ndata: {"name":"generating","status":"started"}\n\n',
        'event: token\ndata: {"delta":" world"}\n\n',
        'event: stage\ndata: {"name":"verifying","status":"started"}\n\n',
        `event: verification_complete\ndata: ${JSON.stringify({
          status: 'citations_ok',
          verification: CITATIONS_OK,
        })}\n\n`,
        `event: done\ndata: ${JSON.stringify({
          answer: 'Hello world',
          answer_status: 'answered',
          sources: [CHUNK],
          timings_ms: { dense: 12, llm: 90 },
          execution_time_ms: 180,
        })}\n\n`,
      ]),
    );

    const { result } = renderHook(() => useRagChat({ tenantId: 'tenant-1' }));

    await act(async () => {
      await result.current.submitQuery('What is Meridian?');
    });

    expect(result.current.turns).toHaveLength(1);
    const turn = result.current.turns[0];
    expect(turn.query).toBe('What is Meridian?');
    expect(turn.status).toBe('complete');
    expect(turn.answer).toBe('Hello world');
    expect(turn.verified).toBe(true);
    expect(turn.verification).toEqual(CITATIONS_OK);
    expect(turn.sources).toEqual([CHUNK]);
    expect(turn.answer_status).toBe('answered');
    expect(turn.timings_ms).toEqual({ dense: 12, llm: 90 });
    expect(turn.execution_time_ms).toBe(180);
    expect(turn.activeStage).toMatchObject({ name: 'verifying', status: 'started' });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.activeTurn?.id).toBe(turn.id);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/v1/query/stream');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Tenant-Id']).toBe('tenant-1');
    expect(JSON.parse(String(init.body))).toMatchObject({ query: 'What is Meridian?' });
  });

  it('reports each streaming stage while the stream is still open', async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200, body } as unknown as Response);

    const { result } = renderHook(() => useRagChat());

    let submitPromise!: Promise<void>;
    act(() => {
      submitPromise = result.current.submitQuery('Stage check');
    });

    await waitFor(() => expect(result.current.turns).toHaveLength(1));
    expect(result.current.turns[0].status).toBe('retrieving');
    expect(result.current.isLoading).toBe(true);

    act(() => {
      streamController.enqueue(
        encoder.encode('event: stage\ndata: {"name":"generating","status":"started"}\n\n'),
      );
    });
    await waitFor(() => expect(result.current.turns[0].status).toBe('generating'));

    act(() => {
      streamController.enqueue(encoder.encode('event: token\ndata: {"delta":"partial"}\n\n'));
    });
    await waitFor(() => expect(result.current.turns[0].answer).toBe('partial'));

    act(() => {
      streamController.enqueue(
        encoder.encode('event: stage\ndata: {"name":"verifying","status":"started"}\n\n'),
      );
    });
    await waitFor(() => expect(result.current.turns[0].status).toBe('verifying'));

    act(() => {
      streamController.close();
    });
    await act(async () => {
      await submitPromise;
    });

    expect(result.current.turns[0].status).toBe('complete');
    expect(result.current.isLoading).toBe(false);
  });

  it('falls back to api.query when the SSE endpoint is unavailable', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, body: null } as unknown as Response);
    const querySpy = vi.spyOn(api, 'query').mockResolvedValue(makeQueryResponse());

    const { result } = renderHook(() => useRagChat({ tenantId: 'tenant-9' }));

    await act(async () => {
      await result.current.submitQuery('fallback question', {
        topK: 7,
        maxCycles: 2,
        enforceGuardrails: false,
      });
    });

    expect(querySpy).toHaveBeenCalledWith({
      query: 'fallback question',
      tenant_id: 'tenant-9',
      top_k: 7,
      max_cycles: 2,
      enforce_guardrails: false,
    });

    const turn = result.current.turns[0];
    expect(turn.status).toBe('complete');
    expect(turn.answer).toBe('A fallback answer grounded in Qdrant.');
    expect(turn.sources).toEqual([CHUNK]);
    expect(turn.verified).toBe(true);
    expect(turn.refusal).toBe(false);
    expect(turn.answer_status).toBe('answered');
    expect(turn.execution_time_ms).toBe(42);
    expect(turn.timings_ms).toEqual({ dense: 5, llm: 20 });
    expect(result.current.isLoading).toBe(false);
  });

  it('marks the turn as errored when both the stream and the fallback fail', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    vi.spyOn(api, 'query').mockRejectedValue(
      Object.assign(new Error('backend unavailable'), { status: 502 }),
    );

    const { result } = renderHook(() => useRagChat());

    await act(async () => {
      await result.current.submitQuery('will fail');
    });

    const turn = result.current.turns[0];
    expect(turn.status).toBe('error');
    expect(turn.error?.message).toBe('backend unavailable');
    expect(turn.error?.status).toBe(502);
    expect(result.current.isLoading).toBe(false);
  });

  it('aborts an in-flight stream without falling back to api.query', async () => {
    const body = new ReadableStream<Uint8Array>({
      start() {
        // Stay open: the abort is the only thing that ends this request.
      },
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200, body } as unknown as Response);
    const querySpy = vi.spyOn(api, 'query');

    const { result } = renderHook(() => useRagChat());

    let submitPromise!: Promise<void>;
    act(() => {
      submitPromise = result.current.submitQuery('abort me');
    });
    await waitFor(() => expect(result.current.turns).toHaveLength(1));

    act(() => {
      result.current.abortCurrentQuery();
    });
    await act(async () => {
      await submitPromise;
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal?.aborted).toBe(true);
    expect(result.current.turns[0].status).toBe('complete');
    expect(result.current.isLoading).toBe(false);
    expect(querySpy).not.toHaveBeenCalled();
  });

  it('clears all turns and the active turn', async () => {
    const { result } = renderHook(() =>
      useRagChat({
        initialTurns: [makeTurn({ id: 'a' }), makeTurn({ id: 'b', query: 'Second' })],
      }),
    );

    expect(result.current.turns).toHaveLength(2);

    act(() => {
      result.current.clearTurns();
    });

    expect(result.current.turns).toEqual([]);
    expect(result.current.activeTurnId).toBeNull();
    expect(result.current.activeTurn).toBeNull();
  });

  it('removes a single turn by id', () => {
    const { result } = renderHook(() =>
      useRagChat({
        initialTurns: [makeTurn({ id: 'keep' }), makeTurn({ id: 'drop' })],
      }),
    );

    act(() => {
      result.current.removeTurn('drop');
    });

    expect(result.current.turns.map((turn) => turn.id)).toEqual(['keep']);
  });
});
