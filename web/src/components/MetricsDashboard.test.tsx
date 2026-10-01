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

    const card = (await screen.findByText('Qdrant Vector Database')).closest('[data-testid="infra-card"]');
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent('http://qdrant:6333');
  });

  it('Index & Storage: Neo4j card reports the live endpoint from /v1/index/status', async () => {
    render(<MetricsDashboard tenantId="default" />);

    const card = (await screen.findByText('Neo4j Knowledge Graph')).closest('[data-testid="infra-card"]');
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

    const card = (await screen.findByText('Qdrant Vector Database')).closest('[data-testid="infra-card"]');
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

    const card = (await screen.findByText('Qdrant Vector Database')).closest('[data-testid="infra-card"]');
    expect(card).toHaveTextContent('Offline');
  });

  it('Index & Storage: never claims Ready/Online for a card with no live source', async () => {
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('index status unavailable'));
    render(<MetricsDashboard tenantId="default" />);

    const card = (await screen.findByText('Qdrant Vector Database')).closest('[data-testid="infra-card"]');
    expect(card).toHaveTextContent('Unprobed');
    expect(card).not.toHaveTextContent('Ready');
  });

  // --- instrument-console language ---------------------------------------
  describe('KPI readout strip', () => {
    it('renders the three KPIs as one dense strip, not three cards', async () => {
      render(<MetricsDashboard tenantId="default" />);

      const strip = await screen.findByTestId('kpi-strip');
      expect(strip).toBeInTheDocument();
      expect(strip.querySelectorAll('[data-slot="kpi"]')).toHaveLength(3);
    });

    it('every KPI value is tabular monospace with its unit', async () => {
      render(<MetricsDashboard tenantId="default" />);
      await screen.findByTestId('kpi-strip');

      const values = screen.getAllByTestId('kpi-value');
      expect(values).toHaveLength(3);
      for (const value of values) {
        expect(value.className).toContain('num');
      }
      expect(screen.getByTestId('kpi-total-requests')).toHaveTextContent('10');
      expect(screen.getByTestId('kpi-total-tokens')).toHaveTextContent('500');
    });

    it('reports unmeasured telemetry as unavailable, never as a measured zero', async () => {
      (api.getMetrics as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('telemetry down'),
      );
      render(<MetricsDashboard tenantId="default" />);

      await screen.findByRole('alert');

      // The file's own rule, 70 lines below: "the unavailable case shows an
      // em-dash, never a fake 0". A KPI strip that reads 0 req / 0 tok / $0.0000
      // after a failed fetch asserts unmeasured data as measured.
      expect(screen.getByTestId('kpi-total-requests')).toHaveTextContent('—');
      expect(screen.getByTestId('kpi-total-tokens')).toHaveTextContent('—');
      expect(screen.getByTestId('kpi-cost')).toHaveTextContent('—');
    });

    it('formats cost to fixed precision instead of leaking a raw float', async () => {      (api.getMetrics as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        tenant_id: 'default',
        total_requests: 10,
        total_tokens: 500,
        total_cost_usd: 1.5,
      });
      render(<MetricsDashboard tenantId="default" />);

      // A raw float renders as "1.5"; the readout must pad to a fixed scale.
      expect(await screen.findByTestId('kpi-cost')).toHaveTextContent('$1.5000');
    });

    it('shows a zeroed readout when metrics have not loaded, not a blank', async () => {
      (api.getMetrics as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        tenant_id: 'default',
        total_requests: 0,
        total_tokens: 0,
        total_cost_usd: 0,
      });
      render(<MetricsDashboard tenantId="default" />);

      expect(await screen.findByTestId('kpi-cost')).toHaveTextContent('$0.0000');
    });
  });

  describe('infra live-source honesty survives the restyle', () => {
    it('a card with no live source still names its source on its face', async () => {
      render(<MetricsDashboard tenantId="default" />);

      const card = (await screen.findByText('Langfuse Tracing')).closest('[data-testid="infra-card"]');
      expect(card).toHaveTextContent(/no live \/health probe/i);
      expect(card).not.toHaveTextContent('Ready');
    });

    it('a failed health poll never claims a sourced card is Online', async () => {
      (api.checkHealth as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('health unreachable'));
      render(<MetricsDashboard tenantId="default" />);

      const card = (await screen.findByText('LiteLLM AI Gateway')).closest('[data-testid="infra-card"]');
      expect(card).toHaveTextContent('Unprobed');
    });

    it('self-sourced engine card reads Offline when health is unreachable', async () => {
      (api.checkHealth as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('health unreachable'));
      render(<MetricsDashboard tenantId="default" />);

      const card = (await screen.findByText('Meridian RAG Engine (FastAPI)')).closest('[data-testid="infra-card"]');
      expect(card).toHaveTextContent('Offline');
      expect(card).not.toHaveTextContent('Online');
    });

    it('infra status chips carry the shared StatusChip state attribute', async () => {
      render(<MetricsDashboard tenantId="default" />);
      await screen.findByText('Qdrant Vector Database');

      const card = screen.getByText('Qdrant Vector Database').closest('[data-testid="infra-card"]');
      expect(card?.querySelector('[data-variant]')).not.toBeNull();
    });
  });
});
