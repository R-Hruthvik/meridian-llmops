import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { IndexStorageStudio } from './IndexStorageStudio';
import { api } from '../services/api';
import type { IndexStatusResponse } from '../types/api';

vi.mock('../services/api', () => ({
  api: {
    getIndexStatus: vi.fn(),
  },
}));

const LIVE: IndexStatusResponse = {
  vector: {
    collections: ['documents'],
    points_per_collection: { documents: 42 },
    total_points: 42,
    vector_dimension: 384,
    is_fallback: false,
    detail: 'Read live from Qdrant collection documents.',
  },
  graph: {
    node_count: 17,
    relationship_count: 5,
    entity_index_size: 9,
    is_fallback: false,
    detail: 'Counted live with Cypher.',
  },
  lexical: {
    corpus_size: 120,
    document_count: 4,
    is_fallback: false,
    detail: 'Read from the live BM25 index.',
  },
  relational: {
    dialect: 'sqlite',
    tables: [
      { name: 'documents', row_count: 4 },
      { name: 'chunks', row_count: 120 },
    ],
    total_rows: 124,
    is_fallback: false,
    detail: 'Read live from sqlite: 2 tables introspected and counted.',
  },
  backends: {
    vector: { reachable: true, is_fallback: false, endpoint: 'http://localhost:6333', detail: 'Qdrant answered live.' },
    graph: { reachable: true, is_fallback: false, endpoint: 'bolt://localhost:7687', detail: 'Neo4j answered live.' },
    lexical: { reachable: true, is_fallback: false, endpoint: 'in-process', detail: 'BM25 index read live.' },
    relational: { reachable: true, is_fallback: false, endpoint: 'sqlite:///meridian.db', detail: 'Relational store answered live.' },
  },
};

const FALLBACKING: IndexStatusResponse = {
  vector: {
    collections: [],
    points_per_collection: {},
    total_points: 120,
    vector_dimension: 384,
    is_fallback: true,
    detail: 'Qdrant unreachable, so these counts are the in-process fallback cache.',
  },
  graph: {
    node_count: null,
    relationship_count: null,
    entity_index_size: null,
    is_fallback: true,
    detail: 'Neo4j unreachable, so no node or relationship counts exist.',
  },
  lexical: { corpus_size: 120, document_count: 4, is_fallback: false, detail: 'Read from the live BM25 index.' },
  relational: {
    dialect: null,
    tables: [],
    total_rows: 0,
    is_fallback: true,
    detail: 'Relational store unreachable, so no tables are reported: connection refused',
  },
  backends: {
    vector: { reachable: false, is_fallback: true, endpoint: 'http://localhost:6333', detail: 'Qdrant unreachable.' },
    graph: { reachable: false, is_fallback: true, endpoint: 'bolt://localhost:7687', detail: 'Neo4j unreachable.' },
    lexical: { reachable: true, is_fallback: false, endpoint: 'in-process', detail: 'BM25 index read live.' },
    relational: { reachable: false, is_fallback: true, endpoint: 'sqlite:///meridian.db', detail: 'Relational store unreachable.' },
  },
};

describe('IndexStorageStudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(LIVE);
  });

  it('requests index status for the active tenant', async () => {
    render(<IndexStorageStudio tenantId="acme" />);

    expect(api.getIndexStatus).toHaveBeenCalledWith('acme');
    // The surface name is the shared Overlay's title; the body states the read
    // it is making and the tenant it is scoped to.
    expect(await screen.findByText(/Live read of every backing store/)).toBeInTheDocument();
    expect(screen.getByText('acme')).toHaveClass('id-mono');
  });

  it('renders the live vector numbers', async () => {
    render(<IndexStorageStudio tenantId="default" />);

    const section = await screen.findByRole('region', { name: /vector index/i });
    expect(within(section).getByText('Total points').closest('div')).toHaveTextContent('42');
    expect(within(section).getByText('Dimension').closest('div')).toHaveTextContent('384');
    expect(within(section).getByText('documents')).toBeInTheDocument();
  });

  it('renders the live graph and lexical numbers', async () => {
    render(<IndexStorageStudio tenantId="default" />);

    const graph = await screen.findByRole('region', { name: /knowledge graph/i });
    expect(within(graph).getByText('Nodes').closest('div')).toHaveTextContent('17');
    expect(within(graph).getByText('Relationships').closest('div')).toHaveTextContent('5');

    const lexical = screen.getByRole('region', { name: /lexical index/i });
    expect(within(lexical).getByText('Corpus size').closest('div')).toHaveTextContent('120');
    expect(within(lexical).getByText('Documents').closest('div')).toHaveTextContent('4');
  });

  it('renders relational tables as a real table with live row counts', async () => {
    render(<IndexStorageStudio tenantId="default" />);

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2 tables
    expect(within(table).getByText('chunks')).toBeInTheDocument();
    expect(within(table).getByText('120')).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /rows/i })).toBeInTheDocument();
  });

  it('shows no fallback banner when every subsystem is live', async () => {
    render(<IndexStorageStudio tenantId="default" />);

    await screen.findByRole('table');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the fallback banner with the backend detail when a subsystem is in fallback', async () => {
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(FALLBACKING);
    render(<IndexStorageStudio tenantId="default" />);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/fallback/i);
    expect(banner).toHaveTextContent('Qdrant unreachable, so these counts are the in-process fallback cache.');
    expect(banner).toHaveTextContent('Neo4j unreachable, so no node or relationship counts exist.');
    expect(banner).toHaveTextContent('Relational store unreachable, so no tables are reported: connection refused');
  });

  it('names each falling-back subsystem in the banner', async () => {
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(FALLBACKING);
    render(<IndexStorageStudio tenantId="default" />);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/vector/i);
    expect(banner).toHaveTextContent(/graph/i);
    expect(banner).toHaveTextContent(/relational/i);
    // The live lexical subsystem must not be blamed.
    expect(banner).not.toHaveTextContent(/lexical/i);
  });

  it('marks each falling-back section inline, not just in the banner', async () => {
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(FALLBACKING);
    render(<IndexStorageStudio tenantId="default" />);

    const graph = await screen.findByRole('region', { name: /knowledge graph/i });
    expect(within(graph).getByText(/fallback/i)).toBeInTheDocument();
  });

  it('renders an unavailable marker for null counts instead of a misleading zero', async () => {
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(FALLBACKING);
    render(<IndexStorageStudio tenantId="default" />);

    const graph = await screen.findByRole('region', { name: /knowledge graph/i });
    expect(within(graph).getAllByText('unavailable').length).toBeGreaterThan(0);
    expect(within(graph).queryByText('0')).toBeNull();
  });

  it('renders an empty state when the relational store reports no tables', async () => {
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(FALLBACKING);
    render(<IndexStorageStudio tenantId="default" />);

    const relational = await screen.findByRole('region', { name: /relational storage/i });
    expect(within(relational).getByText(/no tables reported/i)).toBeInTheDocument();
  });

  it('renders an empty state when no vector collections exist', async () => {
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(FALLBACKING);
    render(<IndexStorageStudio tenantId="default" />);

    const vector = await screen.findByRole('region', { name: /vector index/i });
    expect(within(vector).getByText(/no collections reported/i)).toBeInTheDocument();
  });

  it('shows a loading state before the first response arrives', () => {
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<IndexStorageStudio tenantId="default" />);

    expect(screen.getByText(/loading live index state/i)).toBeInTheDocument();
  });

  it('shows the error state when the request fails', async () => {
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Index status fetch failed: 500'));
    render(<IndexStorageStudio tenantId="default" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Index status fetch failed: 500');
  });

  it('clears stale state when the request fails', async () => {
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const { rerender } = render(<IndexStorageStudio tenantId="default" />);

    await screen.findByRole('alert');
    rerender(<IndexStorageStudio tenantId="other" />);

    expect(screen.queryByRole('table')).toBeNull();
  });

  it('re-reads on manual refresh', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<IndexStorageStudio tenantId="default" />);

    await screen.findByRole('table');
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(FALLBACKING);
    await user.click(screen.getByRole('button', { name: /refresh/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/in-process fallback cache/);
  });
});

// §4/§9 — the per-subsystem cards become dense readout blocks: label + mono
// value, endpoint as an identifier, and the state as a shared StatusChip.
describe('IndexStorageStudio instrument language', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(LIVE);
  });

  it('renders each subsystem as readout cells, not card boxes', async () => {
    render(<IndexStorageStudio tenantId="default" />);

    const vector = await screen.findByRole('region', { name: /vector index/i });
    expect(vector.querySelectorAll('[data-slot="readout"]')).toHaveLength(2);
    // §9 — the retired shadow-card chrome does not come back.
    expect(document.querySelectorAll('.shadow-card')).toHaveLength(0);
  });

  it('renders every count as a mono tabular readout', async () => {
    render(<IndexStorageStudio tenantId="default" />);

    const vector = await screen.findByRole('region', { name: /vector index/i });
    const graph = screen.getByRole('region', { name: /knowledge graph/i });

    for (const region of [vector, graph]) {
      const readouts = region.querySelectorAll('[data-slot="readout"]');
      expect(readouts.length).toBeGreaterThan(0);
      for (const readout of Array.from(readouts)) {
        expect(readout.querySelector('.num')).not.toBeNull();
        expect(readout.querySelector('.label-section')).not.toBeNull();
      }
    }
    // Collection point counts are numbers too.
    expect(within(vector).getAllByText('42')[0]).toHaveClass('num');
  });

  it('renders endpoints as identifiers, not prose', async () => {
    render(<IndexStorageStudio tenantId="default" />);

    const vector = await screen.findByRole('region', { name: /vector index/i });
    const graph = screen.getByRole('region', { name: /knowledge graph/i });

    expect(within(vector).getByText('http://localhost:6333')).toHaveClass('id-mono');
    expect(within(graph).getByText('bolt://localhost:7687')).toHaveClass('id-mono');
  });

  it('carries the is_fallback state as a StatusChip on every subsystem', async () => {
    render(<IndexStorageStudio tenantId="default" />);

    const vector = await screen.findByRole('region', { name: /vector index/i });
    expect(vector.querySelector('[data-variant="ok"]')).not.toBeNull();
  });

  it('flags every falling-back subsystem with a warn chip while live ones stay ok', async () => {
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(FALLBACKING);
    render(<IndexStorageStudio tenantId="default" />);

    const graph = await screen.findByRole('region', { name: /knowledge graph/i });
    expect(graph.querySelector('[data-variant="warn"]')).not.toBeNull();
    expect(graph.querySelector('[data-variant="ok"]')).toBeNull();

    const lexical = screen.getByRole('region', { name: /lexical index/i });
    expect(lexical.querySelector('[data-variant="ok"]')).not.toBeNull();
    expect(lexical.querySelector('[data-variant="warn"]')).toBeNull();
  });

  it('keeps the honest fallback banner intact while restyling', async () => {
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(FALLBACKING);
    render(<IndexStorageStudio tenantId="default" />);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/Fallback data — 3 of 4 subsystems are not persisted state/);
    expect(banner).toHaveTextContent(/They vanish on restart/);
    expect(banner).toHaveTextContent('Qdrant unreachable, so these counts are the in-process fallback cache.');
    // §9 — the degraded/fallback counts in the banner are mono too.
    expect(within(banner).getByText('3')).toHaveClass('num');
    expect(within(banner).getByText('4')).toHaveClass('num');
  });

  it('announces the fallback warning instead of mounting it pre-filled', async () => {
    // A live region that arrives already containing its text is silent in
    // NVDA/JAWS/VoiceOver: they announce *changes* inside a region that already
    // exists. The banner used to mount only after the fetch resolved, so the one
    // message saying these numbers are not real was never spoken. The region has
    // to be in the DOM before the message lands in it.
    let resolveStatus: (value: IndexStatusResponse) => void = () => {};
    (api.getIndexStatus as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<IndexStatusResponse>((resolve) => {
        resolveStatus = resolve;
      }),
    );

    render(<IndexStorageStudio tenantId="default" />);

    // The live region exists, and it is the one that will carry the warning.
    const region = await screen.findByTestId('index-status-region');
    expect(region).toHaveTextContent(/Loading live index state/);
    expect(region).not.toHaveTextContent(/Fallback data/);

    resolveStatus(FALLBACKING);

    await waitFor(() =>
      expect(screen.getByTestId('index-status-region')).toHaveTextContent(
        /Fallback data — 3 of 4 subsystems are not persisted state/,
      ),
    );
    // Same node throughout: a change inside an existing region is what gets
    // announced.
    expect(screen.getByTestId('index-status-region')).toBe(region);
  });
});
