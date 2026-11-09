import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RagWorkspace } from './RagWorkspace';
import { formatLatency, shortId } from './ragFormat';
import { api, ApiError } from '../services/api';
import { WorkbenchContext } from '../WorkbenchContext';
import type { QueryResponse, SearchResult, VerificationSummary } from '../types/api';

// Mock the api module
vi.mock('../services/api', () => ({
  api: {
    getDocuments: vi.fn(),
    getLLMSettings: vi.fn(),
    query: vi.fn(),
    retrieve: vi.fn(),
    updateLLMSettings: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public detail?: string) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

const mockSettings = {
  active_provider: 'openai',
  default_model: 'gpt-4o-mini',
  litellm_base_url: 'http://localhost:4000',
};

const CITATIONS_OK: VerificationSummary = {
  status: 'citations_ok',
  scope: 'format_and_numeric_consistency',
  invalid_citations: [],
  uncited_claims: [],
  numeric_mismatches: [],
  unsupported_claims: [],
  contradictions: [],
};

const makeChunk = (overrides: Partial<SearchResult> = {}): SearchResult => ({
  chunk_id: 'chunk-1',
  document_id: 'doc-1',
  text: 'Meridian stores dense vectors in Qdrant.',
  score: 0.93,
  retrieval_method: 'hybrid',
  filename: 'architecture.md',
  title: 'Architecture',
  page_start: 4,
  heading_path: 'Storage > Dual memory',
  ...overrides,
});

const makeResponse = (overrides: Partial<QueryResponse> = {}): QueryResponse => {
  const sources = overrides.sources ?? overrides.source_chunks ?? [makeChunk()];
  return {
    query: 'test query',
    answer: 'test answer',
    source_chunks: sources,
    entities: [{ name: 'TestEntity', entity_type: 'concept' }],
    cycle_count: 1,
    verified: true,
    refusal: false,
    execution_time_ms: 1234,
    answer_status: 'answered',
    verification: CITATIONS_OK,
    debug: {},
    sources,
    timings_ms: { dense: 12, llm: 240 },
    ...overrides,
  };
};

/** The workspace is a layer inside the shell: render it with a real provider. */
const openOverlay = vi.fn();
const renderCanvas = () =>
  render(
    <WorkbenchContext.Provider
      value={{ openOverlay, closeOverlay: vi.fn(), activeOverlay: null }}
    >
      <RagWorkspace tenantId="default" />
    </WorkbenchContext.Provider>,
  );

const dockInput = () =>
  screen.getByPlaceholderText('Ask Meridian RAG (Cmd+Enter to send)...');

const ask = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(dockInput(), text);
  await user.click(screen.getByRole('button', { name: 'Submit' }));
};

describe('RagWorkspace chat integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.query as ReturnType<typeof vi.fn>).mockReset();
    (api.getDocuments as ReturnType<typeof vi.fn>).mockReset();
    (api.getDocuments as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
    // Force the streaming endpoint to fail so JSON query fallback drives the transcript.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, body: null }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the workspace heading, transcript, and command dock without crashing', () => {
    renderCanvas();

    expect(screen.getByRole('heading', { name: 'Ask Meridian' })).toBeInTheDocument();
    expect(screen.getByTestId('chat-stream-view')).toBeInTheDocument();
    expect(dockInput()).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /meridian dual-memory rag cockpit/i })).toBeInTheDocument();
    expect(screen.queryByText('Retrieved Chunks & Citations')).not.toBeInTheDocument();
    expect(screen.queryByText('Knowledge Graph Entity Traversal')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /citation inspector/i })).not.toBeInTheDocument();
  });

  it('keeps example questions optional and fills the dock without submitting', async () => {
    const user = userEvent.setup();
    renderCanvas();

    await user.click(screen.getByText('Shortcuts'));
    await user.click(screen.getByRole('button', { name: 'Dual-memory retrieval' }));

    expect(dockInput()).toHaveValue('What storage engines does Meridian use for dual-memory retrieval?');
    expect(api.query).not.toHaveBeenCalled();
  });

  it('fills prompt injection controls shortcut into composer', async () => {
    const user = userEvent.setup();
    renderCanvas();

    await user.click(screen.getByText('Shortcuts'));
    await user.click(screen.getByRole('button', { name: 'Prompt injection controls' }));

    expect(dockInput()).toHaveValue('How does Meridian protect against prompt injections at the gateway?');
    expect(api.query).not.toHaveBeenCalled();
  });

  it('fills retry limits shortcut into composer', async () => {
    const user = userEvent.setup();
    renderCanvas();

    await user.click(screen.getByText('Shortcuts'));
    await user.click(screen.getByRole('button', { name: 'Retry limits' }));

    expect(dockInput()).toHaveValue('What is the maximum number of self-healing retry cycles allowed?');
    expect(api.query).not.toHaveBeenCalled();
  });

  it('shows recent documents from the selected workspace and opens the source catalog', async () => {
    const user = userEvent.setup();
    (api.getDocuments as ReturnType<typeof vi.fn>).mockResolvedValue({
      documents: [{ id: 'doc-recent', title: 'Product handbook', format: 'PDF', source: 'upload', created_at: '2026-10-14T08:00:00Z', char_count: 1200, chunk_count: 18, entities_count: 0, relationships_count: 0, snippet: '' }],
      total_documents: 1, total_chunks: 18, total_entities: 0,
    });
    renderCanvas();

    expect(await screen.findByText('Product handbook')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Browse sources/i }));
    expect(openOverlay).toHaveBeenCalledWith('corpus');
  });

  it('reports unavailable recent documents without breaking the transcript', async () => {
    (api.getDocuments as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
    renderCanvas();

    expect(
      await screen.findByText(/Recent sources are unavailable/i),
    ).toBeInTheDocument();
  });

  it('submits a question from the command dock and renders the answer turn', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeResponse());

    renderCanvas();
    await ask(user, 'What is Meridian?');

    await waitFor(() =>
      expect(api.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'What is Meridian?',
          tenant_id: 'default',
          top_k: 3,
          max_cycles: 3,
          enforce_guardrails: true,
        }),
      ),
    );

    expect(await screen.findByText('test answer')).toBeInTheDocument();
    expect(screen.getByText('VERIFIED GROUNDED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1 source/i })).toBeInTheDocument();
    expect(dockInput()).toHaveValue('');
  });

  it('submits query via Cmd+Enter in dock', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeResponse());

    renderCanvas();
    await user.type(dockInput(), 'What is Meridian?');
    fireEvent.keyDown(dockInput(), { key: 'Enter', metaKey: true });

    await waitFor(() =>
      expect(api.query).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'What is Meridian?' }),
      ),
    );
    expect(await screen.findByText('test answer')).toBeInTheDocument();
  });

  it('passes the selected top_k to the query API via dock chips', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeResponse());

    renderCanvas();
    await user.click(screen.getByRole('button', { name: '5' }));
    await ask(user, 'What is Meridian?');

    await waitFor(() =>
      expect(api.query).toHaveBeenCalledWith(
        expect.objectContaining({ top_k: 5 }),
      ),
    );
  });

  it('propagates top_k=8 and guardrail toggle to the chat request', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeResponse());

    renderCanvas();

    await user.click(screen.getByRole('button', { name: '8' }));
    const guardrails = screen.getByRole('button', { name: 'Toggle guardrails' });
    expect(guardrails).toHaveAttribute('aria-pressed', 'true');
    await user.click(guardrails);
    expect(guardrails).toHaveAttribute('aria-pressed', 'false');

    await ask(user, 'What is Meridian?');

    await waitFor(() =>
      expect(api.query).toHaveBeenCalledWith(
        expect.objectContaining({ top_k: 8, enforce_guardrails: false }),
      ),
    );
  });

  it('does nothing when the dock is submitted with an empty question', async () => {
    const user = userEvent.setup();
    renderCanvas();

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(api.query).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: /meridian dual-memory rag cockpit/i })).toBeInTheDocument();
  });

  it('shows the active stage and skeleton while a query is pending', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise(() => {}));

    renderCanvas();
    await ask(user, 'What is Meridian?');

    expect(await screen.findByTestId('active-stage-indicator')).toBeInTheDocument();
    expect(screen.getByText('Retrieving relevant context from dual-memory...')).toBeInTheDocument();
    expect(screen.getByTestId('answer-loading')).toBeInTheDocument();
    expect(screen.getByTestId('chat-stream-view')).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps the previous turn visible during a follow-up request', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeResponse())
      .mockReturnValueOnce(new Promise(() => {}));

    renderCanvas();
    await ask(user, 'first query');
    expect(await screen.findByText('test answer')).toBeInTheDocument();

    await ask(user, 'follow-up query');

    expect(screen.getByText('first query')).toBeInTheDocument();
    expect(screen.getByText('test answer')).toBeInTheDocument();
    expect(screen.getByTestId('chat-stream-view')).toHaveAttribute('aria-busy', 'true');
  });

  it('opens the citation inspector from a cited source and closes on Escape', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeResponse());

    renderCanvas();
    await ask(user, 'What is Meridian?');
    await user.click(await screen.findByRole('button', { name: /1 source/i }));

    const drawer = await screen.findByRole('dialog', { name: /citation inspector/i });
    expect(drawer).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Architecture' })).toBeInTheDocument();
    expect(screen.getByText('Storage > Dual memory')).toBeInTheDocument();
    expect(screen.getByText('p. 4')).toBeInTheDocument();
    expect(screen.getByText(/citations ok/i)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /citation inspector/i })).not.toBeInTheDocument();
  });

  it('opens the inspected chunk in the Corpus overlay with a breadcrumb', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeResponse());

    renderCanvas();
    await ask(user, 'What is Meridian?');
    await user.click(await screen.findByRole('button', { name: /1 source/i }));
    await user.click(screen.getByRole('button', { name: /open in corpus/i }));

    expect(openOverlay).toHaveBeenCalledWith('corpus', {
      breadcrumb: 'Ask · chunk 1',
      documentId: 'doc-1',
      chunkId: 'chunk-1',
    });
  });

  it('inspects recovered evidence on a refusal and breadcrumbs the selected row', async () => {
    const user = userEvent.setup();
    const first = makeChunk({ chunk_id: 'chunk-dense', document_id: 'doc-dense', title: 'Dense memory' });
    const second = makeChunk({ chunk_id: 'chunk-graph', document_id: 'doc-graph', title: 'Graph memory' });
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({
        answer: '',
        verified: false,
        refusal: true,
        sources: [first, second],
        source_chunks: [first, second],
      }),
    );

    renderCanvas();
    await ask(user, 'What is Meridian?');
    expect(await screen.findByTestId('evidence-recovery-surface')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Inspect' })[1]);
    expect(await screen.findByRole('heading', { name: 'Graph memory' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /open in corpus/i }));
    expect(openOverlay).toHaveBeenCalledWith('corpus', {
      breadcrumb: 'Ask · chunk 2',
      documentId: 'doc-graph',
      chunkId: 'chunk-graph',
    });
  });

  it('inspects recovered evidence on a degraded response with sources', async () => {
    const user = userEvent.setup();
    const chunk = makeChunk({ chunk_id: 'chunk-deg', document_id: 'doc-deg', title: 'Fallback Doc' });
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({
        answer: 'Partial fallback answer',
        verified: false,
        degraded_reason: 'LLM generation failed, served fallback',
        sources: [chunk],
        source_chunks: [chunk],
      }),
    );

    renderCanvas();
    await ask(user, 'test query');

    expect(await screen.findByTestId('evidence-recovery-surface')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Inspect' }));
    expect(await screen.findByRole('heading', { name: 'Fallback Doc' })).toBeInTheDocument();
  });

  it('renders distinct error state for HTTP 429 (rate limit)', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError('Rate limit exceeded for tenant default', 429, 'Rate limit exceeded'),
    );

    renderCanvas();
    await ask(user, 'test query');

    expect(await screen.findByText('Rate Limit Exceeded')).toBeInTheDocument();
    expect(screen.getByText('Query failed')).toBeInTheDocument();
    expect(screen.getByText('HTTP 429')).toBeInTheDocument();
  });

  it('renders distinct error state for HTTP 401 (authentication)', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError('Invalid or missing API key header', 401, 'Invalid API key'),
    );

    renderCanvas();
    await ask(user, 'test query');

    expect(await screen.findByText('Authentication Error')).toBeInTheDocument();
    expect(screen.getByText('HTTP 401')).toBeInTheDocument();
  });

  it('renders distinct error state for HTTP 400 (bad request)', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError('Malformed query payload', 400, 'Bad request'),
    );

    renderCanvas();
    await ask(user, 'test query');

    expect(await screen.findByText('Query Intercepted / Failed')).toBeInTheDocument();
    expect(screen.getByText('HTTP 400')).toBeInTheDocument();
  });

  it('renders Validation Error for HTTP 422 with server detail', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError('top_k: Input should be less than or equal to 50', 422),
    );

    renderCanvas();
    await ask(user, 'test query');

    expect(await screen.findByText('Validation Error')).toBeInTheDocument();
    expect(screen.getAllByText(/less than or equal to 50/).length).toBeGreaterThan(0);
    expect(screen.getByText('HTTP 422')).toBeInTheDocument();
  });

  it('REFUSED wins over DEGRADED when the pipeline declined and generation failed', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({
        answer: "I was unable to verify factual information regarding 'test query'",
        verified: false,
        refusal: true,
        degraded_reason: 'LLM generation failed via custom: All connection attempts failed',
      }),
    );

    renderCanvas();
    await ask(user, 'test query');

    expect(await screen.findByText('REFUSED')).toBeInTheDocument();
    expect(screen.queryByText('DEGRADED')).not.toBeInTheDocument();
  });

  it('renders the no-answer fallback on a degraded empty response', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({
        answer: '   ',
        verified: false,
        degraded_reason: 'LLM generation failed, served fallback',
      }),
    );

    renderCanvas();
    await ask(user, 'test query');

    expect(await screen.findByText('DEGRADED')).toBeInTheDocument();
    expect(screen.getByText('No answer text was returned for this turn.')).toBeInTheDocument();
  });

  it('does not write provider API keys to localStorage', () => {
    renderCanvas();

    expect(localStorage.getItem('meridian_openai_key')).toBeNull();
    expect(localStorage.getItem('meridian_anthropic_key')).toBeNull();
    expect(localStorage.getItem('meridian_groq_key')).toBeNull();
  });

  it('allows retrying an errored turn directly from the transcript', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new ApiError('Transient failure', 500))
      .mockResolvedValueOnce(makeResponse({ answer: 'Recovered answer' }));

    renderCanvas();
    await ask(user, 'retryable query');

    expect(await screen.findByText('Query failed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Recovered answer')).toBeInTheDocument();
    expect(screen.queryByText('Query Intercepted / Failed')).not.toBeInTheDocument();
  });

  it('copies answer text to clipboard when copy button is activated', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ answer: 'Copyable answer snippet' }),
    );

    renderCanvas();
    await ask(user, 'test query');

    const copyBtn = await screen.findByRole('button', { name: 'Copy answer' });
    await user.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith('Copyable answer snippet');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('does not submit when question contains only whitespace', async () => {
    const user = userEvent.setup();
    renderCanvas();

    await user.type(dockInput(), '   ');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(api.query).not.toHaveBeenCalled();
  });

  it('switches top_k chip to 3 when clicked', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeResponse());

    renderCanvas();
    await user.click(screen.getByRole('button', { name: '3' }));
    await ask(user, 'test query');

    await waitFor(() =>
      expect(api.query).toHaveBeenCalledWith(
        expect.objectContaining({ top_k: 3 }),
      ),
    );
  });

  it('toggles guardrails off and then back on', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeResponse());

    renderCanvas();
    const toggle = screen.getByRole('button', { name: 'Toggle guardrails' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await ask(user, 'test query');
    await waitFor(() =>
      expect(api.query).toHaveBeenCalledWith(
        expect.objectContaining({ enforce_guardrails: true }),
      ),
    );
  });

  it('cancels generation via Stop button in dock', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise(() => {}));

    renderCanvas();
    await ask(user, 'test query');

    const stopButton = await screen.findByRole('button', { name: 'Stop' });
    expect(stopButton).toBeInTheDocument();
    await user.click(stopButton);

    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  it('renders zero sources indicator when response has no sources', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ sources: [], source_chunks: [] }),
    );

    renderCanvas();
    await ask(user, 'test query');

    expect(await screen.findByText('0 sources')).toBeInTheDocument();
  });

  it('renders multiple sources count label correctly', async () => {
    const user = userEvent.setup();
    const chunkA = makeChunk({ chunk_id: 'c1' });
    const chunkB = makeChunk({ chunk_id: 'c2' });
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ sources: [chunkA, chunkB], source_chunks: [chunkA, chunkB] }),
    );

    renderCanvas();
    await ask(user, 'test query');

    expect(await screen.findByRole('button', { name: /2 sources/i })).toBeInTheDocument();
  });

  it('clears query input field immediately on submit', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise(() => {}));

    renderCanvas();
    await user.type(dockInput(), 'pending query');
    expect(dockInput()).toHaveValue('pending query');

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(dockInput()).toHaveValue('');
  });
});

describe('RagWorkspace verdict and status chips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.query as ReturnType<typeof vi.fn>).mockReset();
    (api.getDocuments as ReturnType<typeof vi.fn>).mockReset();
    (api.getDocuments as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, body: null }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const variantOf = (state: string) =>
    screen.getByText(state).closest('[data-variant]');

  it('VERIFIED GROUNDED in ok when the critic verified the answer', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ verified: true, refusal: false }),
    );

    renderCanvas();
    await ask(user, 'test query');

    await waitFor(() => expect(screen.getByText('VERIFIED GROUNDED')).toBeInTheDocument());
    expect(variantOf('VERIFIED GROUNDED')).toHaveAttribute('data-variant', 'ok');
  });

  it('REFUSED in fail when the pipeline declined', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ verified: false, refusal: true, answer: 'I cannot answer that.' }),
    );

    renderCanvas();
    await ask(user, 'test query');

    await waitFor(() => expect(screen.getByText('REFUSED')).toBeInTheDocument());
    expect(variantOf('REFUSED')).toHaveAttribute('data-variant', 'fail');
    expect(screen.queryByText('VERIFIED GROUNDED')).toBeNull();
  });

  it('DEGRADED in warn, and it wins over verified', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({
        verified: true,
        degraded_reason: 'LLM generation failed, served fallback',
      }),
    );

    renderCanvas();
    await ask(user, 'test query');

    await waitFor(() => expect(screen.getByText('DEGRADED')).toBeInTheDocument());
    expect(variantOf('DEGRADED')).toHaveAttribute('data-variant', 'warn');
    expect(screen.queryByText('VERIFIED GROUNDED')).toBeNull();
  });

  it('prefers Degraded state over Verified when both are set in response', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({
        verified: true,
        degraded_reason: 'LLM generation failed, served fallback',
      }),
    );

    renderCanvas();
    await ask(user, 'test query');

    expect(await screen.findByText('DEGRADED')).toBeInTheDocument();
    expect(screen.queryByText('VERIFIED GROUNDED')).toBeNull();
  });

  it('UNVERIFIED in faint for a plain generated answer', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ verified: false, refusal: false, degraded_reason: undefined }),
    );

    renderCanvas();
    await ask(user, 'test query');

    await waitFor(() => expect(screen.getByText('UNVERIFIED')).toBeInTheDocument());
    expect(variantOf('UNVERIFIED')).toHaveAttribute('data-variant', 'faint');
  });

  it('the hero card framing is gone', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ verified: true }),
    );

    renderCanvas();
    await ask(user, 'test query');

    await waitFor(() => expect(screen.getByText('test answer')).toBeInTheDocument());
    expect(screen.queryByText('AI Agent Synthesis Output')).toBeNull();
    expect(screen.queryByText('Hero Output')).toBeNull();
  });
});

describe('RagWorkspace citation inspector interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.query as ReturnType<typeof vi.fn>).mockReset();
    (api.getDocuments as ReturnType<typeof vi.fn>).mockReset();
    (api.getDocuments as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, body: null }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders source page and heading metadata when provided', async () => {
    const user = userEvent.setup();
    const chunk = makeChunk({
      title: 'Security Guide',
      heading_path: 'Authentication > Keys',
      page_start: 12,
    });
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ sources: [chunk], source_chunks: [chunk] }),
    );

    renderCanvas();
    await ask(user, 'What are the key requirements?');
    await user.click(await screen.findByRole('button', { name: /1 source/i }));

    expect(await screen.findByRole('heading', { name: 'Security Guide' })).toBeInTheDocument();
    expect(screen.getByText('Authentication > Keys')).toBeInTheDocument();
    expect(screen.getByText('p. 12')).toBeInTheDocument();
  });

  it('switches between Chunks, Waterfall, and Health tabs in the drawer', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ timings_ms: { dense: 15, llm: 220 } }),
    );

    renderCanvas();
    await ask(user, 'test query');
    await user.click(await screen.findByRole('button', { name: /1 source/i }));

    // Waterfall tab
    await user.click(screen.getByRole('tab', { name: 'Latency Waterfall' }));
    expect(await screen.findByText('Pipeline latency')).toBeInTheDocument();
    expect(screen.getByTestId('timing-dense')).toBeInTheDocument();
    expect(screen.getByTestId('timing-llm')).toBeInTheDocument();

    // Health tab
    await user.click(screen.getByRole('tab', { name: 'Dual-Memory Health' }));
    expect(await screen.findByText('Storage engines')).toBeInTheDocument();
    expect(screen.getByText('Qdrant Dense Vector Index')).toBeInTheDocument();
    expect(screen.getByText('Neo4j Knowledge Graph')).toBeInTheDocument();

    // Back to Evidence Chunks tab
    await user.click(screen.getByRole('tab', { name: /Evidence Chunks/ }));
    expect(screen.getByText('Ranked evidence')).toBeInTheDocument();
  });

  it('copies snippet to clipboard from citation drawer', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({
        sources: [makeChunk({ text: 'Unique snippet content to copy' })],
      }),
    );

    renderCanvas();
    await ask(user, 'test query');
    await user.click(await screen.findByRole('button', { name: /1 source/i }));

    const copyBtn = screen.getByRole('button', { name: /copy snippet/i });
    await user.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith('Unique snippet content to copy');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('closes citation inspector drawer via close button', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeResponse());

    renderCanvas();
    await ask(user, 'test query');
    await user.click(await screen.findByRole('button', { name: /1 source/i }));

    expect(await screen.findByRole('dialog', { name: /citation inspector/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close citation inspector' }));

    expect(screen.queryByRole('dialog', { name: /citation inspector/i })).not.toBeInTheDocument();
  });

  it('switches the active chunk when selecting a different chunk from the ranked list', async () => {
    const user = userEvent.setup();
    const chunkA = makeChunk({ chunk_id: 'c-a', title: 'Doc Alpha', text: 'Alpha text' });
    const chunkB = makeChunk({ chunk_id: 'c-b', title: 'Doc Beta', text: 'Beta text' });
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ sources: [chunkA, chunkB], source_chunks: [chunkA, chunkB] }),
    );

    renderCanvas();
    await ask(user, 'test query');
    await user.click(await screen.findByRole('button', { name: /2 sources/i }));

    expect(await screen.findByRole('heading', { name: 'Doc Alpha' })).toBeInTheDocument();
    await user.click(screen.getByTestId('citation-chunk-c-b'));

    expect(await screen.findByRole('heading', { name: 'Doc Beta' })).toBeInTheDocument();
    expect(screen.getAllByText('Beta text').length).toBeGreaterThanOrEqual(1);
  });

  it('opens a cited chunk with Enter from the keyboard', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeResponse());

    renderCanvas();
    await ask(user, 'test query');
    const sourceBtn = await screen.findByRole('button', { name: /1 source/i });
    sourceBtn.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('dialog', { name: /citation inspector/i })).toBeInTheDocument();
  });

  it('displays all three storage engines in health tab', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeResponse());

    renderCanvas();
    await ask(user, 'test query');
    await user.click(await screen.findByRole('button', { name: /1 source/i }));

    await user.click(screen.getByRole('tab', { name: 'Dual-Memory Health' }));
    expect(screen.getByText('[V]')).toBeInTheDocument();
    expect(screen.getByText('[G]')).toBeInTheDocument();
    expect(screen.getByText('[R]')).toBeInTheDocument();
    expect(screen.getAllByText('Indexed').length).toBe(3);
  });

  it('handles empty timings waterfall gracefully', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ timings_ms: {} }),
    );

    renderCanvas();
    await ask(user, 'test query');
    await user.click(await screen.findByRole('button', { name: /1 source/i }));

    await user.click(screen.getByRole('tab', { name: 'Latency Waterfall' }));
    expect(await screen.findByText('No pipeline timings were reported for this turn.')).toBeInTheDocument();
  });

  it('renders verification status chip in drawer', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({
        verification: { ...CITATIONS_OK, status: 'supported' },
      }),
    );

    renderCanvas();
    await ask(user, 'test query');
    await user.click(await screen.findByRole('button', { name: /1 source/i }));

    expect(await screen.findByText('supported')).toBeInTheDocument();
  });

  it('renders fallback untitled source when chunk metadata is empty', async () => {
    const user = userEvent.setup();
    const bareChunk = makeChunk({ title: '', filename: '', document_id: '' });
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ sources: [bareChunk], source_chunks: [bareChunk] }),
    );

    renderCanvas();
    await ask(user, 'test query');
    await user.click(await screen.findByRole('button', { name: /1 source/i }));

    expect(await screen.findByRole('heading', { name: 'Untitled source' })).toBeInTheDocument();
  });
});

describe('formatLatency', () => {
  it('shows whole milliseconds below one second', () => {
    expect(formatLatency(847)).toEqual({ value: '847', unit: 'ms' });
    expect(formatLatency(847.4)).toEqual({ value: '847', unit: 'ms' });
    expect(formatLatency(0)).toEqual({ value: '0', unit: 'ms' });
  });

  it('crosses to seconds with one decimal at the 1000ms boundary', () => {
    expect(formatLatency(1000)).toEqual({ value: '1.0', unit: 's' });
    expect(formatLatency(6197.359323501587)).toEqual({ value: '6.2', unit: 's' });
    expect(formatLatency(1234)).toEqual({ value: '1.2', unit: 's' });
  });

  it('never emits a raw float, and never shows 1000ms next to 1.0s', () => {
    for (const ms of [0, 7, 999, 1000, 1234, 6197.359323501587, 60000]) {
      const { value } = formatLatency(ms);
      expect(value).not.toMatch(/\.\d{2,}/);
    }
    expect(formatLatency(999.6)).toEqual({ value: '1.0', unit: 's' });
  });
});

describe('shortId', () => {
  it('cuts a long hash to eight characters with an ellipsis', () => {
    expect(shortId('94a3f5b2c1d0e7ffa1b2c3d4e5f60718')).toBe('94a3f5b2…');
    expect(shortId('98cd9ff5c7874c6')).toBe('98cd9ff5…');
  });

  it('leaves an id that already fits untouched', () => {
    expect(shortId('94a3f5b2')).toBe('94a3f5b2');
    expect(shortId('chunk-a')).toBe('chunk-a');
  });

  it('falls back to an em dash when there is no id at all', () => {
    expect(shortId('')).toBe('—');
    expect(shortId(undefined)).toBe('—');
  });
});

describe('RagWorkspace instrument readouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.query as ReturnType<typeof vi.fn>).mockReset();
    (api.getDocuments as ReturnType<typeof vi.fn>).mockReset();
    (api.getDocuments as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, body: null }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads out a raw float latency as seconds, not as 6197.359323501587', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ execution_time_ms: 6197.359323501587 }),
    );

    renderCanvas();
    await ask(user, 'q');

    await waitFor(() => expect(screen.getByText('6.2')).toBeInTheDocument());
    expect(screen.getByText('s')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('6197.359323501587');
  });

  it('keeps tabular figures on numeric latency readout in the turn footer', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ execution_time_ms: 1200 }),
    );

    renderCanvas();
    await ask(user, 'q');

    const readout = await screen.findByText('1.2');
    expect(readout.className).toContain('num');
  });

  it('surfaces chunk score with numeric formatting in drawer', async () => {
    const user = userEvent.setup();
    const chunk = makeChunk({ score: 0.954 });
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ sources: [chunk], source_chunks: [chunk] }),
    );

    renderCanvas();
    await ask(user, 'q');
    await user.click(await screen.findByRole('button', { name: /1 source/i }));

    expect(await screen.findByTitle('Relevance score')).toHaveTextContent('0.95');
  });

  it('formats millisecond latency below 1000ms in turn footer', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ execution_time_ms: 450 }),
    );

    renderCanvas();
    await ask(user, 'q');

    const readout = await screen.findByText('450');
    expect(readout).toBeInTheDocument();
    expect(screen.getByText('ms')).toBeInTheDocument();
  });

  it('formats zero latency as 0 ms in turn footer', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ execution_time_ms: 0 }),
    );

    renderCanvas();
    await ask(user, 'q');

    const readout = await screen.findByText('0');
    expect(readout).toBeInTheDocument();
  });
});

describe('RagWorkspace follow-up and re-run actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.query as ReturnType<typeof vi.fn>).mockReset();
    (api.getDocuments as ReturnType<typeof vi.fn>).mockReset();
    (api.getDocuments as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, body: null }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows follow-up context chip and populates dock when Follow-up is clicked', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeResponse());

    renderCanvas();
    await ask(user, 'original query');

    await user.click(screen.getByRole('button', { name: /follow-up/i }));

    const chip = screen.getByTestId('followup-context-chip');
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent(/Context: 1 sources/);
    expect(dockInput()).toHaveValue('Context from previous turn (1 sources): original query');
  });

  it('clears follow-up context chip when close button is clicked', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeResponse());

    renderCanvas();
    await ask(user, 'original query');
    await user.click(screen.getByRole('button', { name: /follow-up/i }));

    expect(screen.getByTestId('followup-context-chip')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear follow-up context/i }));

    expect(screen.queryByTestId('followup-context-chip')).not.toBeInTheDocument();
    expect(dockInput()).toHaveValue('');
  });

  it('populates dock with original query when Re-run is clicked', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeResponse());

    renderCanvas();
    await ask(user, 'original query');

    await user.click(screen.getByRole('button', { name: /re-run/i }));

    expect(dockInput()).toHaveValue('original query');
  });

  it('submits follow-up query with context when submitted after Follow-up', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeResponse())
      .mockResolvedValueOnce(makeResponse({ answer: 'Follow-up answer' }));

    renderCanvas();
    await ask(user, 'original query');
    await user.click(screen.getByRole('button', { name: /follow-up/i }));
    await ask(user, 'follow-up question');

    await waitFor(() =>
      expect(api.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining('Context from previous turn'),
        }),
      ),
    );
  });
});
