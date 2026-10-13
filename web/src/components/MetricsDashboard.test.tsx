import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MetricsDashboard } from './MetricsDashboard';
import { api } from '../services/api';

vi.mock('../services/api', () => ({
  api: {
    getMetrics: vi.fn(),
    checkHealth: vi.fn(),
    getIndexStatus: vi.fn(),
    retrieve: vi.fn(),
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
    (api.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue({ ready: true });
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(INDEX_LIVE);
  });

  it('announces the initial metrics load and keeps the KPI strip single-column on phones', async () => {
    (api.getMetrics as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise(() => {}));
    render(<MetricsDashboard tenantId="default" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading telemetry metrics');
    expect(screen.getByText(/Loading recent tenant telemetry/)).toBeInTheDocument();
    expect(screen.getByTestId('kpi-strip')).toHaveClass('grid-cols-1');
    expect(screen.getByTestId('metrics-loading-status')).toHaveClass('min-h-[3rem]');
    await waitFor(() => expect(api.checkHealth).toHaveBeenCalled());
  });

  it('reserves the metrics status slot after loading completes', async () => {
    render(<MetricsDashboard tenantId="default" />);

    expect(await screen.findByTestId('kpi-total-requests')).toHaveTextContent('10');
    expect(screen.getByTestId('metrics-loading-status')).toHaveClass('min-h-[3rem]');
  });

  it('clears the old tenant immediately and ignores an older refresh response after switching tenants', async () => {
    let resolveStale!: (value: {
      tenant_id: string;
      total_requests: number;
      total_tokens: number;
      total_cost_usd: number | null;
      error_count: number;
      retrieval_latency_ms: { p50: number | null; p95: number | null };
      recent_requests: Array<{ query: string; duration_ms: number; timings_ms: Record<string, number> }>;
    }) => void;
    let resolveNewTenant!: (value: Parameters<typeof resolveStale>[0]) => void;
    const staleRefresh = new Promise<Parameters<typeof resolveStale>[0]>((resolve) => {
      resolveStale = resolve;
    });
    const newTenantFetch = new Promise<Parameters<typeof resolveStale>[0]>((resolve) => {
      resolveNewTenant = resolve;
    });
    const oldMetrics = {
      tenant_id: 'tenant-old', total_requests: 1, total_tokens: 4, total_cost_usd: 0,
      error_count: 0, retrieval_latency_ms: { p50: 2, p95: 3 },
      recent_requests: [{ query: 'Old tenant query', duration_ms: 4, timings_ms: { search: 2 } }],
    };
    (api.getMetrics as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(oldMetrics)
      .mockReturnValueOnce(staleRefresh)
      .mockReturnValueOnce(newTenantFetch);

    const { rerender } = render(<MetricsDashboard tenantId="tenant-old" />);
    expect(await screen.findByText('Old tenant query')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh telemetry metrics' }));

    rerender(<MetricsDashboard tenantId="tenant-new" />);
    expect(screen.queryByText('Old tenant query')).not.toBeInTheDocument();
    expect(screen.getByText(/Loading recent tenant telemetry/)).toBeInTheDocument();
    expect(api.getMetrics).toHaveBeenLastCalledWith('tenant-new');

    await act(async () => {
      resolveNewTenant({
        tenant_id: 'tenant-new', total_requests: 1, total_tokens: 8, total_cost_usd: 0,
        error_count: 0, retrieval_latency_ms: { p50: 5, p95: 6 },
        recent_requests: [{ query: 'New tenant query', duration_ms: 7, timings_ms: { search: 5 } }],
      });
    });
    expect(await screen.findByText('New tenant query')).toBeInTheDocument();

    await act(async () => {
      resolveStale({
        ...oldMetrics,
        total_tokens: 40,
        recent_requests: [{ query: 'Late old tenant query', duration_ms: 40, timings_ms: { search: 40 } }],
      });
    });
    expect(screen.getByText('New tenant query')).toBeInTheDocument();
    expect(screen.queryByText('Late old tenant query')).not.toBeInTheDocument();
    expect(screen.getByTestId('kpi-total-tokens')).toHaveTextContent('8');
  });

  it('rejects metrics whose tenant id does not match the requested tenant', async () => {
    (api.getMetrics as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      tenant_id: 'tenant-other', total_requests: 99, total_tokens: 99, total_cost_usd: null,
      error_count: 0, retrieval_latency_ms: { p50: null, p95: null }, recent_requests: [],
    });
    render(<MetricsDashboard tenantId="tenant-requested" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not match requested tenant/i);
    expect(screen.queryByTestId('kpi-total-requests')).toHaveTextContent('—');
  });

  it('uses the public readiness flag for the engine status', async () => {
    render(<MetricsDashboard tenantId="default" />);

    await waitFor(() => {
      expect(api.checkHealth).toHaveBeenCalled();
    });
    const card = (await screen.findByText('Meridian RAG Engine (FastAPI)')).closest('[data-testid="infra-card"]');
    expect(card).toHaveTextContent('Online');
    expect(screen.queryByText(/\d+ docs/)).toBeNull();
  });

  it('refreshes public readiness every 15 seconds while Diagnostics is mounted', async () => {
    vi.useFakeTimers();
    try {
      render(<MetricsDashboard tenantId="default" />);
      expect(api.checkHealth).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(14_999);
      });
      expect(api.checkHealth).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(api.checkHealth).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes index status every 15 seconds while Diagnostics is mounted', async () => {
    vi.useFakeTimers();
    try {
      render(<MetricsDashboard tenantId="default" />);
      await act(async () => {});
      expect(api.getIndexStatus).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(14_999);
      });
      expect(api.getIndexStatus).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(api.getIndexStatus).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports Degraded when the public readiness flag is false', async () => {
    (api.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue({ ready: false });
    render(<MetricsDashboard tenantId="default" />);

    const card = (await screen.findByText('Meridian RAG Engine (FastAPI)')).closest('[data-testid="infra-card"]');
    expect(card).toHaveTextContent('Degraded');
  });

  it('runs retrieval in Diagnostics and displays ranked chunks with backend scores', async () => {
    (api.getMetrics as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      tenant_id: 'tenant-a',
      total_requests: 10,
      total_tokens: 500,
      total_cost_usd: 0.0123,
    });
    (api.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
      query: 'What is hybrid retrieval?',
      top_k: 5,
      timings_ms: { total: 18.2 },
      chunks: [
        {
          rank: 1,
          chunk_id: 'chunk-a',
          document_id: 'doc-a',
          filename: 'retrieval-notes.md',
          title: 'Hybrid retrieval',
          page_start: 4,
          heading_path: 'Search / Ranking',
          text: 'Reciprocal rank fusion combines dense and BM25 results.',
          scores: {
            dense: 0.83,
            bm25: 5.27,
            dense_rank: 1,
            bm25_rank: 2,
            rrf: 0.0325,
            rerank: null,
            final: 0.0325,
          },
        },
      ],
    });
    render(<MetricsDashboard tenantId="tenant-a" />);

    fireEvent.change(await screen.findByRole('textbox', { name: /retrieval query/i }), {
      target: { value: 'What is hybrid retrieval?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run retrieval/i }));

    expect(api.retrieve).toHaveBeenCalledWith(
      { query: 'What is hybrid retrieval?', top_k: 5 },
      'tenant-a',
    );
    expect(await screen.findByText('Reciprocal rank fusion combines dense and BM25 results.')).toBeInTheDocument();
    expect(screen.getByText('retrieval-notes.md')).toBeInTheDocument();
    expect(screen.getByText('0.83')).toBeInTheDocument();
    expect(screen.getByText('5.27')).toBeInTheDocument();
    expect(screen.getByText('0.0325')).toBeInTheDocument();
    expect(screen.getByText('Dense')).toBeInTheDocument();
    expect(screen.getByText('BM25')).toBeInTheDocument();
    expect(screen.getByText('RRF')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-total-requests')).toHaveTextContent('10');
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

    it('shows an unavailable cost placeholder when upstream cost is unknown', async () => {
      (api.getMetrics as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        tenant_id: 'default',
        total_requests: 1,
        total_tokens: 30,
        total_cost_usd: null,
      });
      render(<MetricsDashboard tenantId="default" />);

      expect(await screen.findByTestId('kpi-cost')).toHaveTextContent('—');
    });
  });

  describe('tenant request telemetry', () => {
    it('shows error count, retrieval percentiles, and the tenant recent requests', async () => {
      const recentRequests = Array.from({ length: 22 }, (_, index) => ({
        query: `Question ${22 - index}`,
        duration_ms: index + 10,
        timings_ms: { embed_query: 1.2, dense_search: 2.3 },
      }));
      (api.getMetrics as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        tenant_id: 'tenant-a',
        total_requests: 22,
        total_tokens: 300,
        total_cost_usd: null,
        error_count: 3,
        retrieval_latency_ms: { p50: 12.5, p95: 31.25 },
        recent_requests: recentRequests,
      });
      render(<MetricsDashboard tenantId="tenant-a" />);

      expect(await screen.findByTestId('error-count')).toHaveTextContent('3');
      expect(screen.getByText('12.5 ms')).toBeInTheDocument();
      expect(screen.getByText('31.3 ms')).toBeInTheDocument();
      expect(await screen.findByText('Question 22')).toBeInTheDocument();
      expect(screen.getByText('Question 3')).toBeInTheDocument();
      expect(screen.queryByText('Question 2')).not.toBeInTheDocument();
      expect(screen.getAllByText('embed_query')).toHaveLength(20);
      expect(screen.getAllByText('dense_search')).toHaveLength(20);
      expect(api.getMetrics).toHaveBeenCalledWith('tenant-a');
    });

    it('shows an empty state when the tenant has no recent requests', async () => {
      (api.getMetrics as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        tenant_id: 'tenant-a',
        total_requests: 0,
        total_tokens: 0,
        total_cost_usd: 0,
        error_count: 0,
        latency_ms: { p50: null, p95: null, p99: null },
        retrieval_latency_ms: { p50: null, p95: null },
        recent_requests: [],
      });
      render(<MetricsDashboard tenantId="tenant-a" />);

      expect(await screen.findByText('No recent requests recorded for this tenant.')).toBeInTheDocument();
      expect(screen.getByTestId('retrieval-p50')).toHaveTextContent('—');
      expect(screen.getByTestId('retrieval-p95')).toHaveTextContent('—');
    });

    it('uses the metrics error state when recent request telemetry cannot load', async () => {
      (api.getMetrics as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('metrics unavailable'));
      render(<MetricsDashboard tenantId="tenant-a" />);

      expect(await screen.findByRole('alert')).toHaveTextContent('metrics unavailable');
      expect(screen.getByText('Recent tenant telemetry is unavailable.')).toBeInTheDocument();
      expect(screen.queryByText('No recent requests recorded for this tenant.')).not.toBeInTheDocument();
    });
  });

  describe('infra live-source honesty survives the restyle', () => {
    it('a card with no live source still names its source on its face', async () => {
      render(<MetricsDashboard tenantId="default" />);

      const card = (await screen.findByText('Langfuse Tracing')).closest('[data-testid="infra-card"]');
      expect(card).toHaveTextContent(/no live \/health probe/i);
      expect(card).not.toHaveTextContent('Ready');
    });

    it('does not infer gateway reachability from the public readiness response', async () => {
      render(<MetricsDashboard tenantId="default" />);

      const card = (await screen.findByText('LiteLLM AI Gateway')).closest('[data-testid="infra-card"]');
      expect(card).toHaveTextContent('Unknown');
      expect(card).toHaveTextContent(/public readiness does not report gateway reachability/i);
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
