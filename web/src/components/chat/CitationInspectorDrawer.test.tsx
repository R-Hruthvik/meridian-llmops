import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import type { SearchResult, VerificationSummary } from '../../types/api';
import { CitationInspectorDrawer } from './CitationInspectorDrawer';

const CHUNKS: SearchResult[] = [
  {
    chunk_id: 'chunk-a',
    document_id: 'doc-a',
    text: 'Qdrant holds the dense vectors and answers similarity queries.',
    score: 0.923,
    retrieval_method: 'dense',
    filename: 'qdrant.md',
    title: 'Dense Memory',
    page_start: 4,
    heading_path: 'Storage > Dense vectors',
  },
  {
    chunk_id: 'chunk-b',
    document_id: 'doc-b',
    text: 'Neo4j stores the entity graph and relationship provenance.',
    score: 0.811,
    retrieval_method: 'graph',
    filename: 'graph.md',
    title: 'Knowledge Graph',
    page_start: 7,
    heading_path: 'Storage > Graph',
  },
  {
    chunk_id: 'chunk-c',
    document_id: 'doc-c',
    text: 'SQLite records the relational provenance ledger.',
    score: 0.704,
    retrieval_method: 'sparse_bm25',
    filename: 'ledger.md',
    title: 'Relational Ledger',
    page_start: 12,
    heading_path: 'Storage > Ledger',
  },
];

const VERIFICATION: VerificationSummary = {
  status: 'citations_ok',
  scope: 'format_and_numeric_consistency',
  invalid_citations: [],
  uncited_claims: [],
  numeric_mismatches: [],
  unsupported_claims: [],
  contradictions: [],
};

const TIMINGS = {
  dense: 120,
  sparse_bm25: 35,
  graph: 80,
  llm: 640,
  verify: 45,
};

function renderDrawer(
  overrides: Partial<React.ComponentProps<typeof CitationInspectorDrawer>> = {},
) {
  return render(
    <CitationInspectorDrawer
      isOpen
      onClose={vi.fn()}
      activeChunk={CHUNKS[0]}
      chunks={CHUNKS}
      onSelectChunk={vi.fn()}
      timings={TIMINGS}
      verification={VERIFICATION}
      onOpenCorpus={vi.fn()}
      {...overrides}
    />,
  );
}

describe('CitationInspectorDrawer', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the drawer only while isOpen is true', () => {
    const { rerender } = renderDrawer();
    expect(screen.getByRole('dialog', { name: /citation inspector/i })).toBeInTheDocument();

    rerender(
      <CitationInspectorDrawer
        isOpen={false}
        onClose={vi.fn()}
        activeChunk={CHUNKS[0]}
        chunks={CHUNKS}
      />,
    );

    expect(screen.queryByRole('dialog', { name: /citation inspector/i })).not.toBeInTheDocument();
  });

  it('shows the selected chunk evidence, metadata, and chunk count', () => {
    renderDrawer();

    expect(screen.getByRole('tab', { name: /evidence chunks/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('(3)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dense Memory' })).toBeInTheDocument();
    expect(screen.getByText('Storage > Dense vectors')).toBeInTheDocument();
    expect(screen.getByText('p. 4')).toBeInTheDocument();
    expect(screen.getAllByText('0.92').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('Qdrant holds the dense vectors and answers similarity queries.').length,
    ).toBeGreaterThan(0);
  });

  it('switches between Evidence, Latency, and Health tabs', () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('tab', { name: /latency waterfall/i }));
    expect(screen.getAllByText('[VEC:CHROMA]').length).toBeGreaterThan(0);
    expect(screen.getByText('120 ms')).toBeInTheDocument();
    expect(screen.getAllByText('[LLM]').length).toBeGreaterThan(0);
    expect(screen.getByText('640 ms')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /dual-memory health/i }));
    expect(screen.getByText('Qdrant Dense Vector Index')).toBeInTheDocument();
    expect(screen.getByText('Neo4j Knowledge Graph')).toBeInTheDocument();
    expect(screen.getByText('SQLite Provenance & Relational Index')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /evidence chunks/i }));
    expect(screen.getByRole('heading', { name: 'Dense Memory' })).toBeInTheDocument();
  });

  it('selects a chunk from the ranked list', () => {
    const onSelectChunk = vi.fn();
    renderDrawer({ onSelectChunk });

    fireEvent.click(screen.getByTestId('citation-chunk-chunk-b'));

    expect(onSelectChunk).toHaveBeenCalledWith(CHUNKS[1]);
  });

  it('copies the active snippet and shows copied feedback', async () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Copy snippet' }));

    expect(writeText).toHaveBeenCalledWith(
      'Qdrant holds the dense vectors and answers similarity queries.',
    );
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('opens the active chunk in the corpus', () => {
    const onOpenCorpus = vi.fn();
    renderDrawer({ onOpenCorpus });

    fireEvent.click(screen.getByRole('button', { name: /open in corpus/i }));

    expect(onOpenCorpus).toHaveBeenCalledWith(CHUNKS[0]);
  });

  it('closes from the close button', () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });

    fireEvent.click(screen.getByRole('button', { name: /close citation inspector/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when Escape is pressed', () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not listen for Escape while closed', () => {
    const onClose = vi.fn();
    renderDrawer({ isOpen: false, onClose });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows verification status alongside evidence', () => {
    renderDrawer();

    const panel = screen.getByRole('dialog', { name: /citation inspector/i });
    expect(within(panel).getByText(/citations ok/i)).toBeInTheDocument();
  });

  describe('Waterfall tab segmented micro-bar and monograms', () => {
    it('renders segmented micro-bar with colored segments for each timing', () => {
      renderDrawer();

      fireEvent.click(screen.getByRole('tab', { name: /latency waterfall/i }));

      const microBar = screen.getByRole('img', { name: /pipeline latency/i });
      expect(microBar).toBeInTheDocument();
      // Segments are decorative (aria-hidden) and expose no accessible role.
      const segments = microBar.querySelectorAll(':scope > div');
      expect(segments.length).toBeGreaterThan(0);
    });

    it('renders legend with engine monograms and timing labels', () => {
      renderDrawer();

      fireEvent.click(screen.getByRole('tab', { name: /latency waterfall/i }));

      // Monograms repeat in the legend and the detailed waterfall rows.
      expect(screen.getAllByText('[VEC:CHROMA]').length).toBeGreaterThan(0);
      expect(screen.getAllByText('[KG:SQLITE]').length).toBeGreaterThan(0);
      expect(screen.getAllByText('[LLM]').length).toBeGreaterThan(0);
      expect(screen.getByText('Vector 120ms')).toBeInTheDocument();
      expect(screen.getByText('Graph 80ms')).toBeInTheDocument();
      expect(screen.getByText('LLM Gen 640ms')).toBeInTheDocument();
    });

    it('renders detailed waterfall bars with monograms', () => {
      renderDrawer();

      fireEvent.click(screen.getByRole('tab', { name: /latency waterfall/i }));

      expect(screen.getByTestId('timing-[VEC:CHROMA]')).toBeInTheDocument();
      expect(screen.getByTestId('timing-[KG:SQLITE]')).toBeInTheDocument();
      expect(screen.getByTestId('timing-[LLM]')).toBeInTheDocument();
    });
  });

  describe('Health tab storage engine monograms', () => {
    it('renders storage engines with monogram badges', () => {
      renderDrawer();

      fireEvent.click(screen.getByRole('tab', { name: /dual-memory health/i }));

      expect(screen.getByText('[VEC:CHROMA]')).toBeInTheDocument();
      expect(screen.getByText('[KG:SQLITE]')).toBeInTheDocument();
      expect(screen.getByText('[KV:REDIS]')).toBeInTheDocument();
      expect(screen.getByText('Qdrant Dense Vector Index')).toBeInTheDocument();
      expect(screen.getByText('Neo4j Knowledge Graph')).toBeInTheDocument();
      expect(screen.getByText('SQLite Provenance & Relational Index')).toBeInTheDocument();
    });

    it('shows Indexed status chip for each engine', () => {
      renderDrawer();

      fireEvent.click(screen.getByRole('tab', { name: /dual-memory health/i }));

      const indexedChips = screen.getAllByText('Indexed');
      expect(indexedChips).toHaveLength(3);
    });
  });
});
