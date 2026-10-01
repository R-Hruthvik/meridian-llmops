import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RagWorkspace, formatLatency, shortId } from './RagWorkspace';
import { api, ApiError } from '../services/api';
import { WorkbenchContext } from '../WorkbenchContext';

// Mock the api module
vi.mock('../services/api', () => ({
  api: {
    getLLMSettings: vi.fn(),
    query: vi.fn(),
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

/** The canvas is a layer inside the shell: render it with a real provider. */
const openOverlay = vi.fn();
const renderCanvas = () =>
  render(
    <WorkbenchContext.Provider
      value={{ openOverlay, closeOverlay: vi.fn(), activeOverlay: null }}
    >
      <RagWorkspace tenantId="default" />
    </WorkbenchContext.Provider>,
  );

const run = async (user: ReturnType<typeof userEvent.setup>, response: object) => {
  (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response);

  renderCanvas();

  await user.type(screen.getByPlaceholderText(/Type your question/i), 'test query');
  await user.click(screen.getByRole('button', { name: /Run Agent/i }));
};

describe('RagWorkspace', () => {
  const mockQueryResponse = {
    query: 'test query',
    answer: 'test answer',
    source_chunks: [{ chunk_id: '1', document_id: 'doc1', text: 'chunk text', score: 0.95, retrieval_method: 'vector' }],
    entities: [{ name: 'TestEntity', entity_type: 'concept' }],
    cycle_count: 1,
    verified: true,
    refusal: false,
    execution_time_ms: 1234,
    serving_provider: 'openai',
    serving_model: 'gpt-4o-mini',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
  });

  it('renders without crashing', () => {
    renderCanvas();
    expect(screen.getByText('Ask Agentic RAG Pipeline')).toBeInTheDocument();
  });

  it('submits query on button click', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValue(mockQueryResponse);

    renderCanvas();

    const textarea = screen.getByPlaceholderText(/Type your question/i);
    await user.type(textarea, 'What is Meridian?');

    const runButton = screen.getByRole('button', { name: /Run Agent/i });
    await user.click(runButton);

    await waitFor(() => {
      expect(api.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'What is Meridian?',
          tenant_id: 'default',
        }),
      );
    });

    expect(screen.getByText('test answer')).toBeInTheDocument();
  });

  it('renders distinct error state for HTTP 429 (rate limit)', async () => {
    const user = userEvent.setup();
    const rateLimitError = new ApiError(
      'Rate limit exceeded for tenant default',
      429,
      'Rate limit exceeded',
    );
    (api.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(rateLimitError);

    renderCanvas();

    const textarea = screen.getByPlaceholderText(/Type your question/i);
    await user.type(textarea, 'test query');

    const runButton = screen.getByRole('button', { name: /Run Agent/i });
    await user.click(runButton);

    await waitFor(() => {
      expect(screen.getByText('Rate Limit Exceeded')).toBeInTheDocument();
    });
  });

  it('renders distinct error state for HTTP 401 (authentication)', async () => {
    const user = userEvent.setup();
    const authError = new ApiError(
      'Invalid or missing API key header',
      401,
      'Invalid API key',
    );
    (api.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(authError);

    renderCanvas();

    const textarea = screen.getByPlaceholderText(/Type your question/i);
    await user.type(textarea, 'test query');

    const runButton = screen.getByRole('button', { name: /Run Agent/i });
    await user.click(runButton);

    await waitFor(() => {
      expect(screen.getByText('Authentication Error')).toBeInTheDocument();
    });
  });

  it('renders distinct error state for HTTP 400 (bad request)', async () => {
    const user = userEvent.setup();
    const badRequestError = new ApiError(
      'Malformed query',
      400,
      'Bad request',
    );
    (api.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(badRequestError);

    renderCanvas();

    const textarea = screen.getByPlaceholderText(/Type your question/i);
    await user.type(textarea, 'test query');

    const runButton = screen.getByRole('button', { name: /Run Agent/i });
    await user.click(runButton);

    await waitFor(() => {
      expect(screen.getByText('Query Intercepted / Failed')).toBeInTheDocument();
    });

    expect(screen.getByText('HTTP 400')).toBeInTheDocument();
  });

  it('disables Run button when query is empty', () => {
    renderCanvas();
    const runButton = screen.getByRole('button', { name: /Run Agent/i });
    expect(runButton).toBeDisabled();
  });

  it('renders Validation Error for HTTP 422 with server detail', async () => {
    const user = userEvent.setup();
    const validationError = new ApiError(
      'top_k: Input should be less than or equal to 50',
      422,
      'top_k: Input should be less than or equal to 50',
    );
    (api.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(validationError);

    renderCanvas();

    const textarea = screen.getByPlaceholderText(/Type your question/i);
    await user.type(textarea, 'test query');

    const runButton = screen.getByRole('button', { name: /Run Agent/i });
    await user.click(runButton);

    await waitFor(() => {
      expect(screen.getByText('Validation Error')).toBeInTheDocument();
    });
    expect(screen.getByText(/less than or equal to 50/)).toBeInTheDocument();
  });

  it('prefers Degraded state over Verified when both are set', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockQueryResponse,
      verified: true,
      degraded_reason: 'LLM generation failed, served fallback',
    });

    renderCanvas();

    const textarea = screen.getByPlaceholderText(/Type your question/i);
    await user.type(textarea, 'test query');

    const runButton = screen.getByRole('button', { name: /Run Agent/i });
    await user.click(runButton);

    await waitFor(() => {
      expect(screen.getByText('DEGRADED')).toBeInTheDocument();
    });
    expect(screen.queryByText('VERIFIED GROUNDED')).toBeNull();
  });

  it('renders empty-answer fallback on degraded empty responses', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockQueryResponse,
      answer: '   ',
      verified: false,
      degraded_reason: 'LLM generation failed, served fallback',
    });

    renderCanvas();

    const textarea = screen.getByPlaceholderText(/Type your question/i);
    await user.type(textarea, 'test query');

    const runButton = screen.getByRole('button', { name: /Run Agent/i });
    await user.click(runButton);

    await waitFor(() => {
      expect(screen.getByText(/empty answer on a degraded path/)).toBeInTheDocument();
    });
  });

  it('does not write provider API keys to localStorage', () => {
    renderCanvas();

    // Verify no provider API keys in localStorage
    expect(localStorage.getItem('meridian_openai_key')).toBeNull();
    expect(localStorage.getItem('meridian_anthropic_key')).toBeNull();
    expect(localStorage.getItem('meridian_groq_key')).toBeNull();
  });

  it('G1: the chunk table surfaces chunk_id and document_id', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockQueryResponse,
      source_chunks: [
        { chunk_id: 'chunk-abc123', document_id: 'doc-xyz789', text: 'chunk text', score: 0.95, retrieval_method: 'vector' },
      ],
    });

    renderCanvas();

    const textarea = screen.getByPlaceholderText(/Type your question/i);
    await user.type(textarea, 'test query');
    await user.click(screen.getByRole('button', { name: /Run Agent/i }));

    // Readable in the cell, complete on hover.
    await waitFor(() => {
      expect(screen.getByText('doc-xyz7…')).toBeInTheDocument();
    });
    expect(screen.getByText('doc-xyz7…')).toHaveAttribute('title', 'doc-xyz789');
    expect(screen.getByText('chunk-ab…')).toHaveAttribute('title', 'chunk-abc123');
  });
});

// §7 — the verdict bar. One dense strip: a state chip on the left, monospace
// readouts on the right. The state may never contradict the answer body.
describe('RagWorkspace verdict bar', () => {
  const baseResponse = {
    query: 'test query',
    answer: 'test answer',
    source_chunks: [
      { chunk_id: 'chunk-a', document_id: 'doc-a', text: 'alpha', score: 0.36, retrieval_method: 'HYBRID_RRF' },
    ],
    entities: [{ name: 'TestEntity', entity_type: 'concept' }],
    cycle_count: 1,
    verified: false,
    refusal: false,
    execution_time_ms: 1234,
    serving: { provider: 'anthropic', model: 'claude-3-5-haiku-20241022', fresh: true },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
  });

  const variantOf = (state: string) =>
    screen.getByText(state).closest('[data-variant]');

  it('VERIFIED GROUNDED in ok when the critic verified the answer', async () => {
    const user = userEvent.setup();
    await run(user, { ...baseResponse, verified: true });

    await waitFor(() => expect(screen.getByText('VERIFIED GROUNDED')).toBeInTheDocument());
    expect(variantOf('VERIFIED GROUNDED')).toHaveAttribute('data-variant', 'ok');
  });

  it('REFUSED in fail when the pipeline declined', async () => {
    const user = userEvent.setup();
    await run(user, { ...baseResponse, refusal: true, answer: 'I cannot answer that.' });

    await waitFor(() => expect(screen.getByText('REFUSED')).toBeInTheDocument());
    expect(variantOf('REFUSED')).toHaveAttribute('data-variant', 'fail');
    expect(screen.queryByText('VERIFIED GROUNDED')).toBeNull();
  });

  it('DEGRADED in warn, and it wins over verified', async () => {
    const user = userEvent.setup();
    await run(user, {
      ...baseResponse,
      verified: true,
      degraded_reason: 'LLM generation failed, served fallback',
    });

    await waitFor(() => expect(screen.getByText('DEGRADED')).toBeInTheDocument());
    expect(variantOf('DEGRADED')).toHaveAttribute('data-variant', 'warn');
    expect(screen.queryByText('VERIFIED GROUNDED')).toBeNull();
    // The reason is stated, not just implied by the colour.
    expect(screen.getByText(/LLM generation failed, served fallback/)).toBeInTheDocument();
  });

  it('REFUSED wins over DEGRADED when the pipeline declined *and* generation failed', async () => {
    const user = userEvent.setup();
    // The live payload from /v1/query when the LLM is unreachable: the pipeline
    // refuses, and the refusal's cause arrives as degraded_reason. The chip must
    // name the state of the answer, not the cause of it.
    await run(user, {
      ...baseResponse,
      verified: false,
      refusal: true,
      answer: "I was unable to verify factual information regarding 'test query'",
      degraded_reason:
        'LLM generation failed via custom (kilo @ http://localhost:20128/v1): All connection attempts failed',
      serving: { provider: null, model: null, fresh: false },
    });

    await waitFor(() => expect(screen.getByText('REFUSED')).toBeInTheDocument());
    expect(variantOf('REFUSED')).toHaveAttribute('data-variant', 'fail');
    expect(screen.queryByText('DEGRADED')).toBeNull();
    // The cause is still stated in words — swallowing it would lose the evidence.
    expect(screen.getByText(/LLM generation failed via custom/)).toBeInTheDocument();
  });

  it('UNVERIFIED in faint for a plain generated answer', async () => {
    const user = userEvent.setup();
    await run(user, { ...baseResponse });

    await waitFor(() => expect(screen.getByText('UNVERIFIED')).toBeInTheDocument());
    expect(variantOf('UNVERIFIED')).toHaveAttribute('data-variant', 'faint');
  });

  it('NO MODEL SERVED in faint when serving reports a stale answer', async () => {
    const user = userEvent.setup();
    await run(user, {
      ...baseResponse,
      verified: false,
      serving: { provider: null, model: null, fresh: false },
    });

    await waitFor(() => expect(screen.getByText('NO MODEL SERVED')).toBeInTheDocument());
    expect(variantOf('NO MODEL SERVED')).toHaveAttribute('data-variant', 'faint');
    expect(screen.queryByText('UNVERIFIED')).toBeNull();
  });

  it('reads out cycle, execution latency, chunk count and entity count', async () => {
    const user = userEvent.setup();
    await run(user, { ...baseResponse, cycle_count: 2 });

    await waitFor(() => expect(screen.getByText('2/3')).toBeInTheDocument());
    // 1234 ms reads as 1.2 s, not as a raw integer next to a "ms" unit.
    expect(screen.getByText('1.2')).toBeInTheDocument();
    expect(screen.getByText('s')).toBeInTheDocument();
    expect(screen.getByText('chunks')).toBeInTheDocument();
    expect(screen.getByText('entities')).toBeInTheDocument();
  });

  it('the hero card framing is gone', async () => {
    const user = userEvent.setup();
    await run(user, { ...baseResponse, verified: true });

    await waitFor(() => expect(screen.getByText('test answer')).toBeInTheDocument());
    expect(screen.queryByText('AI Agent Synthesis Output')).toBeNull();
    expect(screen.queryByText('Hero Output')).toBeNull();
  });
});

// Issue #35 display side: the bar must name the model that ACTUALLY served
// the request. The config echo (`serving_provider`/`serving_model`) may claim a
// model that never ran — a greeting/bypass, a refusal, a generation failure or
// an empty completion all answer with `serving.fresh === false`.
describe('RagWorkspace serving provenance readout', () => {
  // Legacy config echo: what the OLD UI would have shown, and the lie this
  // change has to stop telling.
  const baseResponse = {
    query: 'test query',
    answer: 'test answer',
    source_chunks: [],
    entities: [],
    cycle_count: 1,
    verified: true,
    refusal: false,
    execution_time_ms: 1234,
    serving_provider: 'openai',
    serving_model: 'gpt-4o-mini',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
  });

  it('fresh: shows the provider and model that actually served, not the config echo', async () => {
    const user = userEvent.setup();
    await run(user, {
      ...baseResponse,
      serving: { provider: 'anthropic', model: 'claude-3-5-haiku-20241022', fresh: true },
    });

    await waitFor(() => {
      expect(screen.getByText('claude-3-5-haiku-20241022')).toBeInTheDocument();
    });
    expect(screen.getByText('anthropic')).toBeInTheDocument();
    expect(screen.queryByText('gpt-4o-mini')).toBeNull();
    expect(screen.queryByText('openai')).toBeNull();
  });

  it('not fresh: says no model served instead of naming a model that never ran', async () => {
    const user = userEvent.setup();
    await run(user, {
      ...baseResponse,
      serving: { provider: null, model: null, fresh: false },
    });

    await waitFor(() => {
      expect(screen.getByText('— no model served')).toBeInTheDocument();
    });
    expect(screen.queryByText('gpt-4o-mini')).toBeNull();
    expect(screen.queryByText('openai')).toBeNull();
  });

  it('not fresh with a refusal: still reports that no model served the answer', async () => {
    const user = userEvent.setup();
    await run(user, {
      ...baseResponse,
      verified: false,
      refusal: true,
      answer: 'I cannot answer that.',
      serving: { provider: null, model: null, fresh: false },
    });

    await waitFor(() => {
      expect(screen.getByText('— no model served')).toBeInTheDocument();
    });
    expect(screen.queryByText('gpt-4o-mini')).toBeNull();
    // B3 precedence must survive the provenance change.
    expect(screen.getByText('REFUSED')).toBeInTheDocument();
  });

  it('serving absent: never names the deprecated config echo', async () => {
    const user = userEvent.setup();
    await run(user, { ...baseResponse });

    await waitFor(() => expect(screen.getByText('test answer')).toBeInTheDocument());
    expect(screen.queryByText('gpt-4o-mini')).toBeNull();
    expect(screen.queryByText('openai')).toBeNull();
    expect(screen.queryByText('— no model served')).toBeNull();
  });

  it('serving absent and legacy fields null: names no model either', async () => {
    const user = userEvent.setup();
    await run(user, { ...baseResponse, serving_provider: null, serving_model: null });

    await waitFor(() => {
      expect(screen.getByText('test answer')).toBeInTheDocument();
    });
    expect(screen.queryByText('— no model served')).toBeNull();
  });

  it('degraded precedence is unchanged when serving reports a stale answer', async () => {
    const user = userEvent.setup();
    await run(user, {
      ...baseResponse,
      verified: true,
      degraded_reason: 'LLM generation failed, served fallback',
      serving: { provider: null, model: null, fresh: false },
    });

    await waitFor(() => {
      expect(screen.getByText('DEGRADED')).toBeInTheDocument();
    });
    expect(screen.queryByText('VERIFIED GROUNDED')).toBeNull();
    expect(screen.getByText(/LLM generation failed, served fallback/)).toBeInTheDocument();
    expect(screen.getByText('— no model served')).toBeInTheDocument();
  });
});

// The verdict bar and the ID column are instrument readouts, so they have to
// read like instruments: a latency an operator can compare at a glance, and an
// id that is shortened in a way that is honest about being shortened.
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
  const response = {
    query: 'q',
    answer: 'a',
    source_chunks: [
      {
        chunk_id: '94a3f5b2c1d0e7ffa1b2c3d4e5f60718',
        document_id: 'doc-4f19ac02b7d3e881',
        text: 'first passage',
        score: 0.36,
        retrieval_method: 'HYBRID_RRF',
      },
    ],
    entities: [],
    cycle_count: 1,
    verified: true,
    refusal: false,
    execution_time_ms: 6197.359323501587,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
  });

  it('reads out a raw float latency as seconds, not as 6197.359323501587', async () => {
    const user = userEvent.setup();
    await run(user, response);

    await waitFor(() => expect(screen.getByText('6.2')).toBeInTheDocument());
    expect(screen.getByText('s')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('6197.359323501587');
  });

  it('keeps tabular figures on every numeric readout in the bar', async () => {
    const user = userEvent.setup();
    await run(user, response);

    await waitFor(() => expect(screen.getByText('6.2')).toBeInTheDocument());

    // Every readout value in the bar, in order: cycles, latency, chunks, entities.
    const readouts = Array.from(
      document.querySelectorAll('.text-readout'),
    ).map((el) => ({ value: el.textContent, className: el.className }));
    expect(readouts.map((r) => r.value)).toEqual(['1/3', '6.2', '1', '0']);
    readouts.forEach((r) => expect(r.className).toContain('num'));
  });

  it('shortens the chunk id and keeps the full id in the title', async () => {
    const user = userEvent.setup();
    await run(user, response);

    const cell = await screen.findByText('94a3f5b2…');
    expect(cell.className).toContain('truncate');
    expect(cell).toHaveAttribute('title', '94a3f5b2c1d0e7ffa1b2c3d4e5f60718');
  });

  it('shortens the source id the same way', async () => {
    const user = userEvent.setup();
    await run(user, response);

    const cell = await screen.findByText('doc-4f19…');
    expect(cell.className).toContain('truncate');
    expect(cell).toHaveAttribute('title', 'doc-4f19ac02b7d3e881');
  });

  it('keeps the chunk score on the monospace token class', async () => {
    const user = userEvent.setup();
    await run(user, response);

    expect((await screen.findByText('36%')).className).toContain('num');
  });
});

// §8 — the ranked chunk table. Ranked rows, hairline dividers, no card boxes,
// and the whole row opens the source in the Corpus overlay.
describe('RagWorkspace chunk table', () => {
  const chunks = [
    { chunk_id: '98cd9ff5c7874c6', document_id: 'doc-c2bd07cc', text: 'first passage', score: 0.36, retrieval_method: 'HYBRID_RRF' },
    { chunk_id: '02ec848c94974f36', document_id: 'doc-e23a17ed', text: 'second passage', score: 0.28, retrieval_method: 'HYBRID_RRF' },
  ];

  const response = {
    query: 'q',
    answer: 'a',
    source_chunks: chunks,
    entities: [],
    cycle_count: 1,
    verified: true,
    refusal: false,
    execution_time_ms: 10,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
  });

  it('renders the ranked columns in order', async () => {
    const user = userEvent.setup();
    await run(user, response);

    await waitFor(() => expect(screen.getByText('SOURCE')).toBeInTheDocument());

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['#', 'SOURCE', 'SCORE', 'METHOD', 'ID']);
  });

  it('renders scores as percentages and ids in the row', async () => {
    const user = userEvent.setup();
    await run(user, response);

    await waitFor(() => expect(screen.getByText('36%')).toBeInTheDocument());
    expect(screen.getByText('28%')).toBeInTheDocument();
    expect(screen.getByText('doc-c2bd…')).toHaveAttribute('title', 'doc-c2bd07cc');
    expect(screen.getByText('98cd9ff5…')).toHaveAttribute('title', '98cd9ff5c7874c6');
    expect(screen.getByText('doc-e23a…')).toHaveAttribute('title', 'doc-e23a17ed');
    expect(screen.getByText('02ec848c…')).toHaveAttribute('title', '02ec848c94974f36');
  });

  it('marks up every numeric cell with the monospace token class', async () => {
    const user = userEvent.setup();
    await run(user, response);

    await waitFor(() => expect(screen.getByText('36%')).toBeInTheDocument());

    expect(screen.getByText('36%').className).toContain('num');
    expect(screen.getByText('98cd9ff5…').className).toContain('id-mono');
    expect(screen.getByText('98cd9ff5…').className).toContain('truncate');
  });

  it('is a real table with no card boxes', async () => {
    const user = userEvent.setup();
    await run(user, response);

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(document.querySelector('.rounded-3xl')).toBeNull();
  });

  it('opens the chunk in the Corpus overlay when a row is activated', async () => {
    const user = userEvent.setup();
    await run(user, response);

    const row = await screen.findByRole('button', { name: /chunk 1/i });
    await user.click(row);

    expect(openOverlay).toHaveBeenCalledWith('corpus', {
      breadcrumb: 'Ask · chunk 1',
      documentId: 'doc-c2bd07cc',
      chunkId: '98cd9ff5c7874c6',
    });
  });

  it('breadcrumbs the row that was actually activated', async () => {
    const user = userEvent.setup();
    await run(user, response);

    await user.click(await screen.findByRole('button', { name: /chunk 2/i }));

    expect(openOverlay).toHaveBeenCalledWith('corpus', {
      breadcrumb: 'Ask · chunk 2',
      documentId: 'doc-e23a17ed',
      chunkId: '02ec848c94974f36',
    });
  });

  it('keeps the chunk table usable when nothing has been retrieved', () => {
    renderCanvas();
    expect(screen.getByText('No query context retrieved yet')).toBeInTheDocument();
  });
});
