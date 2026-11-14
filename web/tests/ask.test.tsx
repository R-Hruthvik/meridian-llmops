/**
 * Session 2 contract tests — the Ask workspace.
 *
 * Covers the streaming controller end to end (SSE → stages → tokens → envelope,
 * plus fallback and abort), the sanitizing Markdown/citation pipeline, and that
 * every new component renders server-side without touching the DOM.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../src/core/auth';
import { AskView, renderAnswerMarkdown } from '../src/features/ask/AskView';
import EvidenceLens from '../src/features/ask/EvidenceLens';
import PipelinePulse from '../src/features/ask/PipelinePulse';
import {
  DEFAULT_ASK_CONTROLS,
  normalizeGuardrailResult,
  normalizeQueryResponse,
  normalizeSearchResults,
  normalizeVerification,
} from '../src/features/ask/types';
import {
  completeStage,
  createPipeline,
  resolveStageId,
  useAskStream,
  type UseAskStreamResult,
} from '../src/features/ask/useAskStream';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const CHUNK = {
  chunk_id: 'ch_1',
  document_id: 'doc_1',
  text: 'Provider shall remediate within thirty (30) days of written notice.',
  score: 0.91,
  retrieval_method: 'hybrid',
  metadata: { page: 12 },
  rank: 1,
  filename: 'msa.pdf',
  title: 'MSA',
  page_start: 12,
  heading_path: '4.2',
  scores: { vector: 0.9 },
  chunk_index: 4,
};

const ENVELOPE = {
  query: 'window?',
  answer: 'Thirty days [1].',
  source_chunks: [CHUNK],
  entities: [],
  cycle_count: 2,
  verified: true,
  refusal: false,
  execution_time_ms: 2140,
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
  review_status: { flagged_chunk_ids: ['ch_1'] },
  timings_ms: { retrieve: 288 },
};

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

interface ControlledStream {
  response: Response;
  send: (event: string, data: unknown) => void;
  close: () => void;
}

function controlledStream(): ControlledStream {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  return {
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    send: (event, data) => controller?.enqueue(encoder.encode(sseFrame(event, data))),
    close: () => controller?.close(),
  };
}

const tick = (ms = 60) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------------------------------------- */
/* Hook harness                                                               */
/* -------------------------------------------------------------------------- */

let container: HTMLDivElement;
let root: Root;
let latest: UseAskStreamResult | null = null;

function Probe() {
  latest = useAskStream();
  return null;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  latest = null;
  act(() => {
    root.render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

describe('pipeline helpers', () => {
  it('starts with the guardrail stage live', () => {
    const pipeline = createPipeline();
    expect(pipeline.map((stage) => stage.id)).toEqual([
      'guardrail',
      'retrieval',
      'rerank',
      'generation',
      'verification',
    ]);
    expect(pipeline[0]?.status).toBe('active');
    expect(pipeline.slice(1).every((stage) => stage.status === 'pending')).toBe(true);
  });

  it('completes a stage and hands the baton to the next one', () => {
    const pipeline = completeStage(createPipeline(), 'retrieval', 'hybrid · 24', 288);
    const retrieval = pipeline.find((stage) => stage.id === 'retrieval');
    const rerank = pipeline.find((stage) => stage.id === 'rerank');
    expect(retrieval?.status).toBe('complete');
    expect(retrieval?.detail).toBe('hybrid · 24');
    expect(retrieval?.ms).toBe(288);
    expect(rerank?.status).toBe('active');
  });

  it('maps arbitrary SSE stage names onto canonical stages', () => {
    expect(resolveStageId('retrieval_complete', '')).toBe('retrieval');
    expect(resolveStageId('verification_complete', '')).toBe('verification');
    expect(resolveStageId('stage', 'dense search')).toBe('retrieval');
    expect(resolveStageId('stage', 'guardrail_input')).toBe('guardrail');
    expect(resolveStageId('stage', 'synthesize')).toBe('generation');
    expect(resolveStageId('unknown', '')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Normalizers                                                                */
/* -------------------------------------------------------------------------- */

describe('wire normalizers', () => {
  it('accepts envelopes, bare arrays and single chunks', () => {
    expect(normalizeSearchResults({ results: [CHUNK] })).toHaveLength(1);
    expect(normalizeSearchResults([CHUNK])).toHaveLength(1);
    expect(normalizeSearchResults({ dense: [CHUNK] })[0]?.chunk_id).toBe('ch_1');
    expect(normalizeSearchResults(CHUNK)[0]?.rank).toBe(1);
    expect(normalizeSearchResults(null)).toEqual([]);
  });

  it('degrades unknown verification payloads to unchecked', () => {
    expect(normalizeVerification(undefined).status).toBe('unchecked');
    expect(normalizeVerification({ status: 'nonsense' }).status).toBe('unchecked');
    expect(normalizeVerification({ status: 'citations_failed', invalid_citations: [2] })).toMatchObject({
      status: 'citations_failed',
      invalid_citations: [2],
    });
  });

  it('produces a complete QueryResponse from a partial payload', () => {
    const response = normalizeQueryResponse({ answer: 'hi', cycle_count: '3' });
    expect(response).not.toBeNull();
    expect(response?.answer).toBe('hi');
    expect(response?.cycle_count).toBe(3);
    expect(response?.verification.status).toBe('unchecked');
    expect(response?.source_chunks).toEqual([]);
    expect(response?.serving).toEqual({ provider: null, model: null, fresh: false });
    expect(normalizeQueryResponse({ unrelated: true })).toBeNull();
  });

  it('normalizes guardrail results', () => {
    const result = normalizeGuardrailResult({
      allowed: false,
      sanitized_text: 'x',
      policy_violations: ['pii'],
      action_taken: 'block',
    });
    expect(result).toEqual({
      allowed: false,
      sanitized_text: 'x',
      policy_violations: ['pii'],
      action_taken: 'block',
    });
    expect(normalizeGuardrailResult('nope')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Streaming                                                                  */
/* -------------------------------------------------------------------------- */

describe('useAskStream', () => {
  it('folds SSE frames into a completed turn', async () => {
    const stream = controlledStream();
    vi.stubGlobal('fetch', vi.fn(async () => stream.response));

    act(() => {
      latest?.submit('What is the remediation window?', DEFAULT_ASK_CONTROLS);
    });

    expect(latest?.isStreaming).toBe(true);
    expect(latest?.messages).toHaveLength(2);
    expect(latest?.messages[0]?.role).toBe('user');
    expect(latest?.messages[1]?.status).toBe('streaming');

    await act(async () => {
      stream.send('guardrail_input', { status: 'passed', ms: 41 });
      stream.send('retrieval_complete', { detail: 'hybrid · 18', cycle_count: 2, results: [CHUNK] });
      stream.send('token', { text: 'Thirty ' });
      stream.send('token', { text: 'days [1].' });
      await tick(70);
    });

    const assistant = latest?.messages[1];
    expect(assistant?.content).toBe('Thirty days [1].');
    expect(assistant?.sources).toHaveLength(1);
    expect(assistant?.pipeline.find((stage) => stage.id === 'retrieval')?.status).toBe('complete');
    expect(assistant?.pipeline.find((stage) => stage.id === 'generation')?.status).toBe('active');

    await act(async () => {
      stream.send('verification_complete', {
        verification: ENVELOPE.verification,
        detail: 'citations_ok',
      });
      stream.send('done', ENVELOPE);
      stream.close();
      await tick(90);
    });

    const finished = latest?.messages[1];
    expect(latest?.isStreaming).toBe(false);
    expect(finished?.status).toBe('complete');
    expect(finished?.content).toBe('Thirty days [1].');
    expect(finished?.verification?.status).toBe('citations_ok');
    expect(finished?.response?.serving.model).toBe('gpt-4.1-mini');
    expect(finished?.elapsedMs).toBe(2140);
    expect(finished?.pipeline.every((stage) => stage.status === 'complete')).toBe(true);
    expect(finished?.usedFallback).toBe(false);
  });

  it('falls back to POST /v1/query when the stream transport fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/query/stream')) {
        return new Response(JSON.stringify({ detail: 'stream backend unavailable' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(ENVELOPE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      latest?.submit('window?', DEFAULT_ASK_CONTROLS);
      await tick(120);
    });

    const assistant = latest?.messages[1];
    expect(assistant?.status).toBe('complete');
    expect(assistant?.usedFallback).toBe(true);
    expect(assistant?.content).toBe('Thirty days [1].');
    expect(assistant?.sources).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/v1/query'))).toBe(true);
  });

  it('keeps the partial answer and marks the turn aborted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );

    act(() => {
      latest?.submit('window?', DEFAULT_ASK_CONTROLS);
    });
    expect(latest?.isStreaming).toBe(true);

    await act(async () => {
      latest?.abort();
      await tick(80);
    });

    expect(latest?.isStreaming).toBe(false);
    expect(latest?.messages[1]?.status).toBe('aborted');
  });

  it('surfaces an error when both transport paths fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ detail: 'tenant suspended' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await act(async () => {
      latest?.submit('window?', DEFAULT_ASK_CONTROLS);
      await tick(120);
    });

    const assistant = latest?.messages[1];
    expect(assistant?.status).toBe('error');
    expect(assistant?.error).toBe('tenant suspended');
    expect(latest?.isStreaming).toBe(false);
  });

  it('marks the pipeline disconnected instead of failing Guardrails when the backend is down', async () => {
    // 502 on both the stream and the fallback query — backend up, engine down.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ detail: 'upstream crashed' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await act(async () => {
      latest?.submit('window?', DEFAULT_ASK_CONTROLS);
      await tick(120);
    });

    const assistant = latest?.messages[1];
    expect(assistant?.status).toBe('error');
    // No SSE stage ever completed → this is a connectivity failure, not a
    // guardrail policy block. Guardrails must stay neutral, not red.
    const guardrail = assistant?.pipeline.find((stage) => stage.id === 'guardrail');
    expect(guardrail?.status).not.toBe('failed');
    expect(guardrail?.status).not.toBe('complete');
    // …and the error must tell the operator what to do.
    expect(assistant?.error).toContain(':8000');
  });

  it('marks the active stage failed when the stream dies mid-pipeline', async () => {
    const stream = controlledStream();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/query/stream')) return stream.response;
      return new Response(JSON.stringify({ detail: 'engine exploded' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    act(() => {
      latest?.submit('window?', DEFAULT_ASK_CONTROLS);
    });
    await act(async () => {
      stream.send('retrieval_complete', { detail: 'hybrid · 18', results: [CHUNK] });
      stream.close();
      await tick(120);
    });

    const assistant = latest?.messages[1];
    expect(assistant?.status).toBe('error');
    // A stage DID complete → the pipeline is real; the in-flight stage goes red.
    expect(assistant?.pipeline.find((stage) => stage.id === 'retrieval')?.status).toBe('complete');
    expect(assistant?.pipeline.find((stage) => stage.id === 'guardrail')?.status).toBe('complete');
    expect(assistant?.pipeline.find((stage) => stage.id === 'rerank')?.status).toBe('failed');
  });

  it('reset clears the thread', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => controlledStream().response));
    act(() => {
      latest?.submit('q', DEFAULT_ASK_CONTROLS);
    });
    await act(async () => {
      latest?.reset();
      await tick(20);
    });
    expect(latest?.messages).toEqual([]);
    expect(latest?.isStreaming).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Launchpad → thread (full AskView wiring)                                    */
/* -------------------------------------------------------------------------- */

describe('AskView integration', () => {
  it('morphs the composer into the dock, renders citations, opens the lens', async () => {
    const stream = controlledStream();
    vi.stubGlobal('fetch', vi.fn(async () => stream.response));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const hostRoot = createRoot(host);

    act(() => {
      hostRoot.render(
        <AuthProvider>
          <AskView />
        </AuthProvider>,
      );
    });

    // Launchpad: composer is in the page, no thread yet.
    expect(host.querySelector('form')).not.toBeNull();
    expect(document.body.textContent).toContain('show their work');

    const textarea = host.querySelector('textarea');
    expect(textarea).not.toBeNull();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'What is the remediation window?');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      host
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await tick(40);
    });

    // The launchpad is gone and the composer now lives in the dock portal.
    expect(host.querySelector('form')).toBeNull();
    expect(document.body.querySelector('form')).not.toBeNull();

    await act(async () => {
      stream.send('retrieval_complete', { detail: 'hybrid · 18', results: [CHUNK] });
      stream.send('token', { text: 'Thirty days [1].' });
      stream.send('done', ENVELOPE);
      stream.close();
      await tick(120);
    });

    const chip = document.body.querySelector<HTMLElement>('[data-citation]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe('1');
    expect(document.body.textContent).toContain('Thirty days');
    expect(document.body.textContent).toContain('Evidence · 1');

    // Clicking the inline citation opens the Evidence Lens on the Cited tab.
    await act(async () => {
      chip?.click();
      await tick(20);
    });
    const dialog = document.body.querySelector('[role="dialog"][aria-label="Evidence lens"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('Cited Evidence');
    expect(dialog?.textContent).toContain('Provider shall remediate');

    act(() => hostRoot.unmount());
    host.remove();
  });
});

/* -------------------------------------------------------------------------- */
/* Markdown + citation pipeline                                               */
/* -------------------------------------------------------------------------- */

describe('renderAnswerMarkdown', () => {
  it('turns [n] and [n, m] markers into citation buttons', () => {
    const html = renderAnswerMarkdown('Thirty days [1]. See also [2, 3].');
    const chips = [...html.matchAll(/data-citation="(\d+)"/g)].map((match) => match[1]);
    expect(chips).toEqual(['1', '2', '3']);
    expect(html).toContain('aria-label="Open evidence 1"');
  });

  it('renders markdown structure', () => {
    const html = renderAnswerMarkdown('## Heading\n\n- one\n- **two**');
    expect(html).toContain('<h2');
    expect(html).toContain('<li');
    expect(html).toContain('<strong>');
  });

  it('strips scripts, event handlers and javascript: URLs', () => {
    const html = renderAnswerMarkdown(
      '<script>alert(1)</script><img src=x onerror="alert(2)">[safe](javascript:alert(3))',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
    // `javascript:` may survive as inert text, never as a live href.
    expect(html.toLowerCase()).not.toContain('href="javascript:');
    expect(html).not.toContain('<a ');
  });

  it('leaves citation markers inside code untouched', () => {
    const html = renderAnswerMarkdown('`chunk[1]` is a literal.');
    expect(html).toContain('chunk[1]');
    expect(html).not.toContain('data-citation');
  });

  it('caches parsed output', () => {
    const first = renderAnswerMarkdown('cache me [1]');
    const second = renderAnswerMarkdown('cache me [1]');
    expect(second).toBe(first);
  });
});

/* -------------------------------------------------------------------------- */
/* Components render                                                          */
/* -------------------------------------------------------------------------- */

describe('component rendering', () => {
  it('renders the hero launchpad', () => {
    const markup = renderToStaticMarkup(
      <AuthProvider>
        <AskView />
      </AuthProvider>,
    );
    expect(markup).toContain('show their work');
    expect(markup).toContain('aria-label="Ask Meridian a question"');
    expect(markup).toContain('8 chunks');
    expect(markup).toContain('Remediation window');
    expect(markup).toContain('Ask Meridian a question');
  });

  it('renders the pipeline ribbon with every stage', () => {
    const markup = renderToStaticMarkup(
      <PipelinePulse
        stages={createPipeline()}
        streaming
        startedAt={Date.now() - 2400}
        onAbort={() => undefined}
      />,
    );
    expect(markup).toContain('Guardrails');
    expect(markup).toContain('Retrieve');
    expect(markup).toContain('Abort');
    expect(markup).toContain('role="status"');
  });

  it('portals the lens outside any transformed ancestor', async () => {
    const host = document.createElement('div');
    host.style.transform = 'translateZ(0)'; // would trap `position: fixed` if not portaled
    document.body.appendChild(host);
    const hostRoot = createRoot(host);

    act(() => {
      hostRoot.render(
        <EvidenceLens
          open
          onClose={() => undefined}
          tab="cited"
          onTabChange={() => undefined}
          sources={normalizeSearchResults([CHUNK])}
          verification={normalizeVerification(ENVELOPE.verification)}
          query="remediation window"
          highlightedChunkId="ch_1"
          flaggedChunkIds={['ch_1']}
          sampleText="answer"
        />,
      );
    });

    const dialog = document.body.querySelector('[role="dialog"][aria-label="Evidence lens"]');
    expect(dialog).not.toBeNull();
    // Portaled: the scrim/drawer lives on <body>, never inside the host.
    expect(host.contains(dialog as Node)).toBe(false);
    // scrim wrapper (fixed inset-0 z-50) is a direct child of body
    expect(dialog?.parentElement?.parentElement).toBe(document.body);
    expect(dialog?.textContent).toContain('Evidence Lens');
    expect(dialog?.textContent).toContain('Retrieval Lab');
    expect(dialog?.textContent).toContain('Provider shall remediate');
    expect(dialog?.textContent).toContain('citations ok');

    act(() => hostRoot.unmount());
    host.remove();
  });

  it('shows the subtitle only on Cited and gives the lab an idle empty state', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const hostRoot = createRoot(host);

    const baseProps = {
      onClose: () => undefined,
      onTabChange: () => undefined,
      sources: normalizeSearchResults([CHUNK]),
      verification: normalizeVerification(ENVELOPE.verification),
      query: 'remediation window',
    };

    act(() => {
      hostRoot.render(
        <EvidenceLens open tab="cited" {...baseProps} />,
      );
    });
    const cited = document.body.querySelector('[role="dialog"][aria-label="Evidence lens"]');
    expect(cited?.textContent).toContain('citations ok'); // subtitle: "1 chunks · citations ok"

    act(() => {
      hostRoot.render(
        <EvidenceLens open tab="lab" {...baseProps} />,
      );
    });
    await tick(40);
    const lab = document.body.querySelector('[role="dialog"][aria-label="Evidence lens"]');
    expect(lab?.textContent).not.toContain('citations ok');
    expect(lab?.querySelector('textarea#lab-query')).not.toBeNull();
    expect(lab?.textContent).toContain('without calling an LLM'); // idle empty state

    act(() => hostRoot.unmount());
    host.remove();
  });

  it('renders nothing when the lens is closed', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const hostRoot = createRoot(host);

    act(() => {
      hostRoot.render(
        <EvidenceLens
          open={false}
          onClose={() => undefined}
          tab="cited"
          onTabChange={() => undefined}
          sources={[]}
          verification={null}
          query=""
        />,
      );
    });

    expect(document.body.querySelector('[aria-label="Evidence lens"]')).toBeNull();
    expect(host.textContent).toBe('');

    act(() => hostRoot.unmount());
    host.remove();
  });
});
