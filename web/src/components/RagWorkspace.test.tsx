import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RagWorkspace } from './RagWorkspace';
import { api, ApiError } from '../services/api';

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

describe('RagWorkspace', () => {
  const mockSettings = {
    active_provider: 'openai',
    default_model: 'gpt-4o-mini',
    litellm_base_url: 'http://localhost:4000',
  };

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
    render(<RagWorkspace tenantId="default" />);
    expect(screen.getByText('Ask Agentic RAG Pipeline')).toBeInTheDocument();
  });

  it('submits query on button click', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValue(mockQueryResponse);

    render(<RagWorkspace tenantId="default" />);

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

    render(<RagWorkspace tenantId="default" />);

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

    render(<RagWorkspace tenantId="default" />);

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

    render(<RagWorkspace tenantId="default" />);

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
    render(<RagWorkspace tenantId="default" />);
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

    render(<RagWorkspace tenantId="default" />);

    const textarea = screen.getByPlaceholderText(/Type your question/i);
    await user.type(textarea, 'test query');

    const runButton = screen.getByRole('button', { name: /Run Agent/i });
    await user.click(runButton);

    await waitFor(() => {
      expect(screen.getByText('Validation Error')).toBeInTheDocument();
    });
    expect(screen.getByText(/less than or equal to 50/)).toBeInTheDocument();
  });

  it('prefers Degraded badge over Verified when both are set', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockQueryResponse,
      verified: true,
      degraded_reason: 'LLM generation failed, served fallback',
    });

    render(<RagWorkspace tenantId="default" />);

    const textarea = screen.getByPlaceholderText(/Type your question/i);
    await user.type(textarea, 'test query');

    const runButton = screen.getByRole('button', { name: /Run Agent/i });
    await user.click(runButton);

    await waitFor(() => {
      expect(screen.getByText('Degraded Response')).toBeInTheDocument();
    });
    expect(screen.queryByText('Critic Verified Grounded')).toBeNull();
  });

  it('renders empty-answer fallback on degraded empty responses', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockQueryResponse,
      answer: '   ',
      verified: false,
      degraded_reason: 'LLM generation failed, served fallback',
    });

    render(<RagWorkspace tenantId="default" />);

    const textarea = screen.getByPlaceholderText(/Type your question/i);
    await user.type(textarea, 'test query');

    const runButton = screen.getByRole('button', { name: /Run Agent/i });
    await user.click(runButton);

    await waitFor(() => {
      expect(screen.getByText(/empty answer on a degraded path/)).toBeInTheDocument();
    });
  });

  it('does not write provider API keys to localStorage', () => {
    render(<RagWorkspace tenantId="default" />);

    // Verify no provider API keys in localStorage
    expect(localStorage.getItem('meridian_openai_key')).toBeNull();
    expect(localStorage.getItem('meridian_anthropic_key')).toBeNull();
    expect(localStorage.getItem('meridian_groq_key')).toBeNull();
  });

  it('G1: chunk cards surface chunk_id and document_id', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockQueryResponse);

    render(<RagWorkspace tenantId="default" />);

    const textarea = screen.getByPlaceholderText(/Type your question/i);
    await user.type(textarea, 'test query');
    await user.click(screen.getByRole('button', { name: /Run Agent/i }));

    await waitFor(() => {
      expect(screen.getByText(/id: 1 • doc: doc1/)).toBeInTheDocument();
    });
  });
});

// B3: the answer panel header must not contradict the answer body.
// A degraded / refused answer may not be labelled as a
// "self-healing verified response" synthesis.
describe('RagWorkspace B3: answer header matches answer state', () => {
  const run = async (user: ReturnType<typeof userEvent.setup>, response: object) => {
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response);

    render(<RagWorkspace tenantId="default" />);

    await user.type(screen.getByPlaceholderText(/Type your question/i), 'test query');
    await user.click(screen.getByRole('button', { name: /Run Agent/i }));
  };

  const baseResponse = {
    query: 'test query',
    answer: 'test answer',
    source_chunks: [],
    entities: [],
    cycle_count: 1,
    verified: false,
    refusal: false,
    execution_time_ms: 1234,
    serving_provider: 'openai',
    serving_model: 'gpt-4o-mini',
  };

  const mockSettings = {
    active_provider: 'openai',
    default_model: 'gpt-4o-mini',
    litellm_base_url: 'http://localhost:4000',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
  });

  it('grounded verified answer: header claims verified synthesis', async () => {
    const user = userEvent.setup();
    await run(user, { ...baseResponse, verified: true });

    await waitFor(() => {
      expect(screen.getByText('AI Agent Synthesis Output')).toBeInTheDocument();
    });
    expect(screen.getByText(/self-healing verified response/i)).toBeInTheDocument();
    expect(screen.queryByText('Refusal Response')).toBeNull();
  });

  it('refusal: header must not claim a verified synthesis', async () => {
    const user = userEvent.setup();
    await run(user, { ...baseResponse, refusal: true, answer: 'I cannot answer that.' });

    await waitFor(() => {
      expect(screen.getByText('Safe Refusal Fallback')).toBeInTheDocument();
    });
    expect(screen.queryByText(/self-healing verified response/i)).toBeNull();
    expect(screen.queryByText('AI Agent Synthesis Output')).toBeNull();
    expect(screen.getByText('Refusal Response')).toBeInTheDocument();
  });

  it('degraded: header must not claim a verified synthesis and wins over verified', async () => {
    const user = userEvent.setup();
    await run(user, {
      ...baseResponse,
      verified: true,
      degraded_reason: 'LLM generation failed, served fallback',
    });

    await waitFor(() => {
      expect(screen.getByText('Degraded Response')).toBeInTheDocument();
    });
    expect(screen.queryByText(/self-healing verified response/i)).toBeNull();
    expect(screen.queryByText('AI Agent Synthesis Output')).toBeNull();
    expect(screen.getByText('Degraded Pipeline Output')).toBeInTheDocument();
    expect(screen.getByText(/LLM generation failed, served fallback/)).toBeInTheDocument();
  });

  it('unverified non-degraded answer: header does not claim verification', async () => {
    const user = userEvent.setup();
    await run(user, { ...baseResponse, verified: false });

    await waitFor(() => {
      expect(screen.getByText('Generated Response')).toBeInTheDocument();
    });
    expect(screen.queryByText(/self-healing verified response/i)).toBeNull();
    expect(screen.getByText('AI Agent Output')).toBeInTheDocument();
  });
});

// Issue #35 display side: the badge must name the model that ACTUALLY served
// the request. The config echo (`serving_provider`/`serving_model`) may claim a
// model that never ran — a greeting/bypass, a refusal, a generation failure or
// an empty completion all answer with `serving.fresh === false`.
describe('RagWorkspace serving provenance badge', () => {
  const run = async (user: ReturnType<typeof userEvent.setup>, response: object) => {
    (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response);

    render(<RagWorkspace tenantId="default" />);

    await user.type(screen.getByPlaceholderText(/Type your question/i), 'test query');
    await user.click(screen.getByRole('button', { name: /Run Agent/i }));
  };

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

  const mockSettings = {
    active_provider: 'openai',
    default_model: 'gpt-4o-mini',
    litellm_base_url: 'http://localhost:4000',
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

  it('not fresh: says no model served this instead of naming a model that never ran', async () => {
    const user = userEvent.setup();
    await run(user, {
      ...baseResponse,
      serving: { provider: null, model: null, fresh: false },
    });

    await waitFor(() => {
      expect(screen.getByText(/no model served this/i)).toBeInTheDocument();
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
      expect(screen.getByText(/no model served this/i)).toBeInTheDocument();
    });
    expect(screen.queryByText('gpt-4o-mini')).toBeNull();
    // B3 header precedence must survive the provenance change.
    expect(screen.getByText('Refusal Response')).toBeInTheDocument();
  });

  it('serving absent: falls back to the legacy serving_provider/serving_model fields', async () => {
    const user = userEvent.setup();
    await run(user, { ...baseResponse });

    await waitFor(() => {
      expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();
    });
    expect(screen.getByText('openai')).toBeInTheDocument();
    expect(screen.queryByText(/no model served this/i)).toBeNull();
  });

  it('serving absent and legacy fields null: renders no badge at all', async () => {
    const user = userEvent.setup();
    await run(user, { ...baseResponse, serving_provider: null, serving_model: null });

    await waitFor(() => {
      expect(screen.getByText('test answer')).toBeInTheDocument();
    });
    expect(screen.queryByText(/no model served this/i)).toBeNull();
    expect(screen.queryByText('gpt-4o-mini')).toBeNull();
  });

  it('degraded header precedence is unchanged when serving reports a stale answer', async () => {
    const user = userEvent.setup();
    await run(user, {
      ...baseResponse,
      verified: true,
      degraded_reason: 'LLM generation failed, served fallback',
      serving: { provider: null, model: null, fresh: false },
    });

    await waitFor(() => {
      expect(screen.getByText('Degraded Response')).toBeInTheDocument();
    });
    expect(screen.getByText('Degraded Pipeline Output')).toBeInTheDocument();
    expect(screen.getByText(/no model served this/i)).toBeInTheDocument();
  });
});
