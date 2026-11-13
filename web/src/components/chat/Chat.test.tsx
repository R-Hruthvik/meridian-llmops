import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { api } from '../../services/api';
import { Chat } from './Chat';

// Mock the api module
vi.mock('../../services/api', () => ({
  api: {
    query: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

const mockQueryResponse = {
  query: 'test query',
  answer: 'test answer',
  source_chunks: [
    { chunk_id: 'c1', document_id: 'doc1', text: 'chunk text', score: 0.95, retrieval_method: 'vector' },
  ],
  entities: [],
  cycle_count: 1,
  verified: true,
  refusal: false,
  execution_time_ms: 1234,
  request_id: 'req-1234',
  answer_status: 'answered',
  serving: { provider: 'openai', model: 'gpt-4o-mini', fresh: true },
  degraded_reason: null,
  timings_ms: {},
  sources: [
    { chunk_id: 'c1', document_id: 'doc1', text: 'chunk text', score: 0.95, retrieval_method: 'vector' },
  ],
};

const renderChat = () => render(<Chat tenantId="default" />);

const run = async (response: object) => {
  (api.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response);
  renderChat();
  const input = screen.getByPlaceholderText(/Ask Meridian/i);
  fireEvent.change(input, { target: { value: 'test query' } });
  fireEvent.click(screen.getByRole('button', { name: /Send/i }));
};

describe('Chat', () => {
  it('renders an empty input and send button', () => {
    renderChat();
    expect(screen.getByPlaceholderText(/Ask Meridian/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Send/i })).toBeDefined();
  });

  it('sends a query and renders the answer with a verdict chip', async () => {
    await run(mockQueryResponse);
    await waitFor(() => expect(screen.getByText('test answer')).toBeInTheDocument());
    expect(screen.getByText(/VERIFIED|UNVERIFIED|DEGRADED|REFUSED/)).toBeInTheDocument();
    expect(screen.getByText(/1.2 s/)).toBeInTheDocument();
  });

  it('renders an error when the query fails', async () => {
    (api.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    renderChat();
    const input = screen.getByPlaceholderText(/Ask Meridian/i);
    fireEvent.change(input, { target: { value: 'bad query' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
  });
});
