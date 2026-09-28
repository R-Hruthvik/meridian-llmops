import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

vi.mock('./services/api', () => ({
  api: {
    getApiKey: vi.fn(() => ''),
    setApiKey: vi.fn(),
    checkHealth: vi.fn(),
    getLLMSettings: vi.fn(),
    updateLLMSettings: vi.fn(),
    query: vi.fn(),
    getDocuments: vi.fn(),
    getDocument: vi.fn(),
    deleteDocument: vi.fn(),
    clearAllDocuments: vi.fn(),
    seedSampleDocuments: vi.fn(),
    ingest: vi.fn(),
    getProviders: vi.fn(),
    checkGuardrails: vi.fn(),
    listReviewItems: vi.fn(),
    reviewItemAction: vi.fn(),
    getMetrics: vi.fn(),
    getIndexStatus: vi.fn(),
    groq: {},
  },
  ApiError: class ApiError extends Error {},
}));

import { api } from './services/api';

const HEALTHY = {
  status: 'healthy',
  service: 'meridian-rag-engine',
  storage_documents: 4,
  vector_chunks: 25,
  services: {
    qdrant: { status: 'reachable', endpoint: 'http://localhost:6333/collections', reachable: true },
    neo4j: { status: 'reachable', endpoint: 'http://localhost:7474', reachable: true },
    litellm: { status: 'reachable', endpoint: 'http://localhost:4000/health', reachable: true },
  },
};

describe('App B5: only the active studio is mounted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue(HEALTHY);
    (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getDocuments as ReturnType<typeof vi.fn>).mockResolvedValue({
      total_documents: 0,
      total_chunks: 0,
      total_entities: 0,
      documents: [],
    });
    (api.listReviewItems as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.getMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({
      tenant_id: 'default',
      total_requests: 0,
      total_tokens: 0,
      total_cost_usd: 0,
    });
    (api.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.checkGuardrails as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it('mounts the RAG workspace and no other studio on first paint', () => {
    render(<App />);

    expect(screen.getByText('Ask Agentic RAG Pipeline')).toBeInTheDocument();
    // The other four studios must never mount (and so never fetch).
    expect(api.getMetrics).not.toHaveBeenCalled();
    expect(api.getDocuments).not.toHaveBeenCalled();
    expect(api.listReviewItems).not.toHaveBeenCalled();
  });

  it('unmounts the previous studio when switching tabs', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText('Ask Agentic RAG Pipeline')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Observability & Costs/i }));

    await waitFor(() => {
      expect(api.getMetrics).toHaveBeenCalled();
    });
    // RAG workspace is gone from the DOM, not merely hidden.
    expect(screen.queryByText('Ask Agentic RAG Pipeline')).toBeNull();
  });

  it('mounts each studio on demand across tab switches', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('tab', { name: /Observability & Costs/i }));
    await waitFor(() => expect(api.getMetrics).toHaveBeenCalled());

    await user.click(screen.getByRole('tab', { name: /Ingestion Studio/i }));
    await waitFor(() => expect(api.getDocuments).toHaveBeenCalled());

    await user.click(screen.getByRole('tab', { name: /Review Queue/i }));
    await waitFor(() => expect(api.listReviewItems).toHaveBeenCalled());

    await user.click(screen.getByRole('tab', { name: /Agentic RAG/i }));
    expect(screen.getByText('Ask Agentic RAG Pipeline')).toBeInTheDocument();
  });

  it('mounts the index studio on demand, like every other tab', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(api.getIndexStatus).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: /Index & Storage/i }));

    await waitFor(() => {
      expect(api.getIndexStatus).toHaveBeenCalled();
    });
    // B5 pattern: the RAG workspace is unmounted, not hidden.
    expect(screen.queryByText('Ask Agentic RAG Pipeline')).toBeNull();
  });

  it('preserves the backend health poll', async () => {
    render(<App />);

    await waitFor(() => {
      expect(api.checkHealth).toHaveBeenCalled();
    });
  });
});
