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

  it('loads LLM settings on mount', async () => {
    render(<RagWorkspace tenantId="default" />);
    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });
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

  it('renders generic error without status for non-HTTP errors', async () => {
    const user = userEvent.setup();
    (api.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    render(<RagWorkspace tenantId="default" />);

    const textarea = screen.getByPlaceholderText(/Type your question/i);
    await user.type(textarea, 'test query');

    const runButton = screen.getByRole('button', { name: /Run Agent/i });
    await user.click(runButton);

    await waitFor(() => {
      expect(screen.getByText('Query Intercepted / Failed')).toBeInTheDocument();
    });
  });

  it('disables Run button when query is empty', () => {
    render(<RagWorkspace tenantId="default" />);
    const runButton = screen.getByRole('button', { name: /Run Agent/i });
    expect(runButton).toBeDisabled();
  });

  it('does not write provider API keys to localStorage on model switch', async () => {
    (api.updateLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);

    render(<RagWorkspace tenantId="default" />);

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    // Verify no provider API keys in localStorage after settings load
    expect(localStorage.getItem('meridian_openai_key')).toBeNull();
    expect(localStorage.getItem('meridian_anthropic_key')).toBeNull();
    expect(localStorage.getItem('meridian_groq_key')).toBeNull();
  });
});
