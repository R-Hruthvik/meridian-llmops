import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MetricsDashboard } from './MetricsDashboard';
import { api } from '../services/api';

vi.mock('../services/api', () => ({
  api: {
    getMetrics: vi.fn(),
    checkHealth: vi.fn(),
    getIndexStatus: vi.fn(),
  },
}));

const INDEX_LIVE = {
  vector: { collections: ['documents'], points_per_collection: { documents: 42 }, total_points: 42, vector_dimension: 384, is_fallback: false, detail: 'Read live.' },
  graph: { node_count: 17, relationship_count: 5, entity_index_size: 9, is_fallback: false, detail: 'Read live.' },
  lexical: { corpus_size: 120, document_count: 4, is_fallback: false, detail: 'Read live.' },
  relational: { dialect: 'sqlite', tables: [{ name: 'documents', row_count: 4 }], total_rows: 4, is_fallback: false, detail: 'Read live.' },
  backends: {
    vector: { reachable: true, is_fallback: false, endpoint: 'http://qdrant:6333', detail: 'Qdrant answered live.' },
    graph: { reachable: true, is_fallback: false, endpoint: 'bolt://neo4j:7687', detail: 'Neo4j answered live.' },
    lexical: { reachable: true, is_fallback: false, endpoint: 'in-process', detail: 'BM25 read live.' },
    relational: { reachable: true, is_fallback: false, endpoint: 'sqlite:///meridian.db', detail: 'Relational answered live.' },
  },
};

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
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(INDEX_LIVE);
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

  it('Index & Storage: Qdrant card reports the live endpoint from /v1/index/status', async () => {
    render(<MetricsDashboard tenantId="default" />);

    const card = (await screen.findByText('Qdrant Vector Database')).closest('div.rounded-2xl');
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent('http://qdrant:6333');
  });

  it('Index & Storage: Neo4j card reports the live endpoint from /v1/index/status', async () => {
    render(<MetricsDashboard tenantId="default" />);

    const card = (await screen.findByText('Neo4j Knowledge Graph')).closest('div.rounded-2xl');
    expect(card).toHaveTextContent('bolt://neo4j:7687');
  });

  it('Index & Storage: a fallback vector backend is reported as Fallback, not Ready', async () => {
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...INDEX_LIVE,
      backends: {
        ...INDEX_LIVE.backends,
        vector: { reachable: false, is_fallback: true, endpoint: 'http://qdrant:6333', detail: 'Qdrant unreachable.' },
      },
    });
    render(<MetricsDashboard tenantId="default" />);

    const card = (await screen.findByText('Qdrant Vector Database')).closest('div.rounded-2xl');
    expect(card).toHaveTextContent('Fallback');
    expect(card).not.toHaveTextContent('Ready');
  });

  it('Index & Storage: an unreachable vector backend is reported as Offline', async () => {
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...INDEX_LIVE,
      backends: {
        ...INDEX_LIVE.backends,
        vector: { reachable: false, is_fallback: false, endpoint: 'http://qdrant:6333', detail: 'down' },
      },
    });
    render(<MetricsDashboard tenantId="default" />);

    const card = (await screen.findByText('Qdrant Vector Database')).closest('div.rounded-2xl');
    expect(card).toHaveTextContent('Offline');
  });

  it('Index & Storage: never claims Ready/Online for a card with no live source', async () => {
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('index status unavailable'));
    render(<MetricsDashboard tenantId="default" />);

    const card = (await screen.findByText('Qdrant Vector Database')).closest('div.rounded-2xl');
    expect(card).toHaveTextContent('Unprobed');
    expect(card).not.toHaveTextContent('Ready');
  });
});
