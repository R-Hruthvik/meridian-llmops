import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MetricsDashboard } from './MetricsDashboard';
import { api } from '../services/api';

vi.mock('../services/api', () => ({
  api: {
    getMetrics: vi.fn(),
    checkHealth: vi.fn(),
  },
}));

describe('MetricsDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({
      tenant_id: 'default',
      total_requests: 10,
      total_tokens: 500,
      total_cost_usd: 0.0123,
    });
    (api.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'healthy',
      service: 'meridian-rag-engine',
      storage_documents: 4,
      vector_chunks: 25,
      services: {
        qdrant: { status: 'reachable', endpoint: 'http://localhost:6333/collections', reachable: true },
        neo4j: { status: 'reachable', endpoint: 'http://localhost:7474', reachable: true },
        litellm: { status: 'reachable', endpoint: 'http://localhost:4000/health', reachable: true },
      },
    });
  });

  it('G6: surfaces storage_documents/vector_chunks counts from /health', async () => {
    render(<MetricsDashboard tenantId="default" />);

    await waitFor(() => {
      expect(api.checkHealth).toHaveBeenCalled();
    });
    expect(await screen.findByText(/4 docs/)).toBeInTheDocument();
    expect(screen.getByText(/25 chunks/)).toBeInTheDocument();
  });

  it('G6: Langfuse card is explicitly labeled by data source', async () => {
    render(<MetricsDashboard tenantId="default" />);

    expect(await screen.findByText('Langfuse Tracing')).toBeInTheDocument();
    expect(screen.getByText(/no live \/health probe/i)).toBeInTheDocument();
  });
});
