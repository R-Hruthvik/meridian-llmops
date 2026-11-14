/**
 * Contract tests for the API layer: the fetch wrapper's header/error rules and
 * the SSE frame reader. These are the two places where a silent regression
 * would be invisible in the UI until production, so they are pinned here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  API_KEY_STORAGE_KEY,
  ApiError,
  apiFetch,
  buildUrl,
  parseSseFrame,
  setApiBaseUrl,
  streamQuery,
} from '../src/core/api';
import type { QueryRequest, QueryResponse } from '../src/core/types';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const REQUEST: QueryRequest = { query: 'remediation window', tenant_id: 'acme' };

/* -------------------------------------------------------------------------- */
/* apiFetch                                                                   */
/* -------------------------------------------------------------------------- */

describe('apiFetch', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setApiBaseUrl('');
  });

  it('attaches a JSON content type and parses the body', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ status: 'ok' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const data = await apiFetch<{ status: string }>('/health');

    expect(data.status).toBe('ok');
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(new Headers(init?.headers).get('X-API-Key')).toBeNull();
  });

  it('sends X-API-Key when an override is stored', async () => {
    window.localStorage.setItem(API_KEY_STORAGE_KEY, '  sk-live-123  ');
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/v1/documents');

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get('X-API-Key')).toBe('sk-live-123');
  });

  it('never sets a content type on FormData (the browser owns the boundary)', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const form = new FormData();
    form.append('file', new Blob(['hello']), 'notes.txt');
    await apiFetch('/v1/documents/upload', { method: 'POST', body: form });

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get('Content-Type')).toBeNull();
  });

  it('throws a structured ApiError with status and FastAPI detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ detail: 'tenant not found' }, 404)),
    );

    const error = await apiFetch('/v1/query').catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(404);
    expect(apiError.detail).toBe('tenant not found');
    expect(apiError.message).toBe('tenant not found');
    expect(apiError.detailMessage).toBe('tenant not found');
    expect(apiError.isServerError).toBe(false);
  });

  it('renders validation-error arrays from FastAPI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { detail: [{ loc: ['body', 'query'], msg: 'field required', type: 'missing' }] },
          422,
        ),
      ),
    );

    const error = (await apiFetch('/v1/query').catch((cause: unknown) => cause)) as ApiError;

    expect(error.status).toBe(422);
    expect(error.detailMessage).toBe('field required');
  });

  it('resolves undefined for 204 responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(apiFetch('/v1/documents/x')).resolves.toBeUndefined();
  });

  it('joins a configured base URL without doubling slashes', async () => {
    setApiBaseUrl('https://api.meridian.test/');
    expect(buildUrl('/health')).toBe('https://api.meridian.test/health');
    expect(buildUrl('health')).toBe('https://api.meridian.test/health');
    expect(buildUrl('https://other.test/x')).toBe('https://other.test/x');
    setApiBaseUrl('');
  });
});

/* -------------------------------------------------------------------------- */
/* SSE parsing                                                                */
/* -------------------------------------------------------------------------- */

describe('parseSseFrame', () => {
  it('parses a JSON payload with its event name', () => {
    expect(parseSseFrame('event: stage\ndata: {"name":"retrieval"}')).toEqual({
      event: 'stage',
      data: { name: 'retrieval' },
    });
  });

  it('joins multi-line data with newlines', () => {
    expect(parseSseFrame('data: line one\ndata: line two')).toEqual({
      event: 'message',
      data: 'line one\nline two',
    });
  });

  it('ignores comment and keep-alive frames', () => {
    expect(parseSseFrame(': keep-alive')).toBeNull();
    expect(parseSseFrame('')).toBeNull();
  });

  it('forwards non-JSON payloads verbatim', () => {
    expect(parseSseFrame('event: token\ndata: not json')).toEqual({
      event: 'token',
      data: 'not json',
    });
  });
});

describe('streamQuery', () => {
  it('dispatches every frame across awkward chunk boundaries', async () => {
    // CRLF separators, a keep-alive comment, a raw payload and a final frame
    // with no trailing blank line — all split mid-frame.
    const raw =
      ': keep-alive\n\n' +
      'event: stage\r\ndata: {"name":"guardrail","status":"passed"}\r\n\r\n' +
      'event: token\ndata: {"text":"Hel"}\n\n' +
      'event: token\ndata: {"text":"lo"}\n\n' +
      'event: note\ndata: plain text payload\n\n' +
      'event: final\ndata: {"answer":"done","verified":true}';

    const slices: string[] = [];
    let cursor = 0;
    for (const size of [7, 3, 29, 1, 64, 13, raw.length]) {
      slices.push(raw.slice(cursor, cursor + size));
      cursor += size;
    }
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(slices.filter(Boolean))));

    const seen: Array<[string, unknown]> = [];
    await streamQuery(REQUEST, {
      onEvent: (event, data) => seen.push([event, data]),
      onError: (error) => seen.push(['error', error.message]),
    });

    expect(seen).toEqual([
      ['stage', { name: 'guardrail', status: 'passed' }],
      ['token', { text: 'Hel' }],
      ['token', { text: 'lo' }],
      ['note', 'plain text payload'],
      ['final', { answer: 'done', verified: true }],
    ]);
  });

  it('never narrows SSE payloads with an unsafe cast', async () => {
    const finalPayload: QueryResponse = {
      query: 'q',
      answer: 'a',
      source_chunks: [],
      entities: [],
      cycle_count: 1,
      verified: true,
      refusal: false,
      execution_time_ms: 12,
      serving: { provider: 'openai', model: 'gpt-4.1-mini', fresh: true },
      answer_status: 'answered',
      verification: {
        status: 'citations_ok',
        scope: 'format_and_numeric_consistency',
        invalid_citations: [],
        uncited_claims: [],
        numeric_mismatches: [],
        unsupported_claims: [],
        contradictions: [],
      },
      sources: [],
      review_status: { flagged_chunk_ids: [] },
      timings_ms: { generate: 12 },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse([`event: final\ndata: ${JSON.stringify(finalPayload)}\n\n`])),
    );

    let resolved: QueryResponse | null = null;
    await streamQuery(REQUEST, {
      onEvent: (event, data) => {
        if (event === 'final') resolved = data as QueryResponse;
      },
      onError: (error) => {
        throw error;
      },
    });

    expect(resolved).toEqual(finalPayload);
  });

  it('reports HTTP failures through onError with the parsed detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'tenant suspended' }, 403)));

    const errors: ApiError[] = [];
    await streamQuery(REQUEST, {
      onEvent: () => undefined,
      onError: (error) => errors.push(error as ApiError),
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ApiError);
    expect(errors[0]?.status).toBe(403);
    expect(errors[0]?.detail).toBe('tenant suspended');
  });

  it('sends the request body and tenant scope', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      sseResponse(['event: done\ndata: {"ok":true}\n\n']),
    );
    vi.stubGlobal('fetch', fetchMock);

    await streamQuery(REQUEST, { onEvent: () => undefined, onError: () => undefined });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/v1/query/stream');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({ query: 'remediation window', tenant_id: 'acme' });
    expect(new Headers(init?.headers).get('Accept')).toBe('text/event-stream');
  });
});

/* -------------------------------------------------------------------------- */
/* Abort                                                                      */
/* -------------------------------------------------------------------------- */

describe('aborting a stream', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves quietly and never calls onError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );

    const onEvent = vi.fn();
    const onError = vi.fn();
    const controller = new AbortController();

    const pending = streamQuery(REQUEST, {
      onEvent,
      onError,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).resolves.toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });
});
