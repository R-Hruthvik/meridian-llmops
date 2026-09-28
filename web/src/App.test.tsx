import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
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

const DOC = {
  id: 'doc-arch-1',
  title: 'Meridian Architecture Overview',
  format: 'md',
  source: 'manual',
  created_at: '2026-08-18T10:00:00Z',
  char_count: 500,
  chunk_count: 2,
  entities_count: 4,
  relationships_count: 2,
  snippet: 'Enterprise LLMOps platform combining self-healing Agentic RAG',
};

const DOC_DETAIL = {
  ...DOC,
  text: 'Architecture overview text',
  chunks: [
    { id: 'chunk-a', chunk_index: 0, section_heading: 'Overview', text: 'First chunk of the architecture doc' },
    { id: 'chunk-b', chunk_index: 1, section_heading: 'Storage', text: 'Second chunk of the architecture doc' },
  ],
};

const QUERY_RESPONSE = {
  query: 'What storage engines does Meridian use?',
  answer: 'Qdrant and Neo4j.',
  source_chunks: [
    { chunk_id: 'chunk-b', document_id: 'doc-arch-1', text: 'Second chunk of the architecture doc', score: 0.91, retrieval_method: 'vector' },
  ],
  entities: [{ name: 'Qdrant', entity_type: 'concept' }],
  cycle_count: 1,
  verified: true,
  refusal: false,
  execution_time_ms: 42,
  serving: { provider: 'openai', model: 'gpt-4o-mini', fresh: true },
};

const emptyDocs = { total_documents: 0, total_chunks: 0, total_entities: 0, documents: [] };

/** A live /v1/index/status. An empty object is not a valid response shape. */
const INDEX_STATUS = {
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
    tables: [{ name: 'documents', row_count: 4 }],
    total_rows: 4,
    is_fallback: false,
    detail: 'Read live from sqlite.',
  },
  backends: {
    vector: { reachable: true, is_fallback: false, endpoint: 'http://localhost:6333', detail: 'Qdrant answered live.' },
    graph: { reachable: true, is_fallback: false, endpoint: 'bolt://localhost:7687', detail: 'Neo4j answered live.' },
    lexical: { reachable: true, is_fallback: false, endpoint: 'in-process', detail: 'BM25 index read live.' },
    relational: { reachable: true, is_fallback: false, endpoint: 'sqlite:///meridian.db', detail: 'Relational store answered live.' },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  (api.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue(HEALTHY);
  (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (api.getDocuments as ReturnType<typeof vi.fn>).mockResolvedValue(emptyDocs);
  (api.getDocument as ReturnType<typeof vi.fn>).mockResolvedValue(DOC_DETAIL);
  (api.listReviewItems as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.getMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({
    tenant_id: 'default',
    total_requests: 0,
    total_tokens: 0,
    total_cost_usd: 0,
  });
  (api.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (api.checkGuardrails as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(INDEX_STATUS);
  (api.query as ReturnType<typeof vi.fn>).mockResolvedValue(QUERY_RESPONSE);
});

/** The three primary area tabs, which live in the header nav. */
const mainNav = () => screen.getByRole('tablist', { name: 'Main Navigation' });
const areaTab = (name: string) => within(mainNav()).getByRole('tab', { name });

describe('App: three connected workbench areas', () => {
  it('exposes exactly three primary areas', () => {
    render(<App />);

    const tabs = within(mainNav()).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Ask', 'Corpus', 'Operate']);
    expect(screen.queryByRole('tab', { name: 'Settings' })).toBeNull();
  });

  it('starts in Ask with the RAG workspace mounted and no other studio', () => {
    render(<App />);

    expect(areaTab('Ask')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Ask Agentic RAG Pipeline')).toBeInTheDocument();
    expect(api.getMetrics).not.toHaveBeenCalled();
    expect(api.getDocuments).not.toHaveBeenCalled();
    expect(api.listReviewItems).not.toHaveBeenCalled();
    expect(api.getIndexStatus).not.toHaveBeenCalled();
  });

  it('labels the Corpus sub-sections as sources and index', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(areaTab('Corpus'));

    const sections = screen.getByRole('tablist', { name: 'Corpus Sections' });
    expect(within(sections).getByRole('tab', { name: 'Sources' })).toHaveAttribute('aria-selected', 'true');
    expect(within(sections).getByRole('tab', { name: 'Index & Storage' })).toBeInTheDocument();
  });

  it('mounts only the selected Corpus sub-section', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(areaTab('Corpus'));
    await waitFor(() => expect(api.getDocuments).toHaveBeenCalled());
    expect(api.getIndexStatus).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: 'Index & Storage' }));
    await waitFor(() => expect(api.getIndexStatus).toHaveBeenCalled());
    // The sources sub-section unmounts rather than merely hiding.
    expect(screen.queryByRole('tab', { name: /^Document Catalog/ })).toBeNull();
  });

  it('switches between the three Operate sub-sections', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Guardrails is input-driven: it fetches nothing until you evaluate, so we
    // identify it by its own panel rather than by a call.
    await user.click(areaTab('Operate'));
    expect(await screen.findByText('Input Guardrails & Threat Evaluation')).toBeInTheDocument();
    expect(api.listReviewItems).not.toHaveBeenCalled();
    expect(api.getMetrics).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: 'Review Queue' }));
    await waitFor(() => expect(api.listReviewItems).toHaveBeenCalled());
    expect(screen.queryByText('Input Guardrails & Threat Evaluation')).toBeNull();
    expect(api.getMetrics).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: 'Metrics' }));
    await waitFor(() => expect(api.getMetrics).toHaveBeenCalled());
    expect(screen.queryByText('Input Guardrails & Threat Evaluation')).toBeNull();
  });

  it('remembers the sub-section chosen in each area', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(areaTab('Corpus'));
    await user.click(screen.getByRole('tab', { name: 'Index & Storage' }));
    await waitFor(() => expect(api.getIndexStatus).toHaveBeenCalled());

    await user.click(areaTab('Ask'));
    expect(areaTab('Ask')).toHaveAttribute('aria-selected', 'true');

    await user.click(areaTab('Corpus'));
    expect(screen.getByRole('tab', { name: 'Index & Storage' })).toHaveAttribute('aria-selected', 'true');
  });
});

// B5: the lazy-mount invariant. Only the ACTIVE area's content is mounted,
// so inactive studios never fetch and unmounted DOM is really gone.
describe('App B5: only the active area is mounted', () => {
  it('unmounts the previous studio when switching areas', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText('Ask Agentic RAG Pipeline')).toBeInTheDocument();

    await user.click(areaTab('Operate'));
    await user.click(screen.getByRole('tab', { name: 'Metrics' }));

    await waitFor(() => expect(api.getMetrics).toHaveBeenCalled());
    expect(screen.queryByText('Ask Agentic RAG Pipeline')).toBeNull();
  });

  it('does not mount a guardrails or review studio while in Ask', async () => {
    render(<App />);

    expect(api.listReviewItems).not.toHaveBeenCalled();
    expect(api.getIndexStatus).not.toHaveBeenCalled();
    expect(screen.queryByText('Input Guardrails & Threat Evaluation')).toBeNull();
  });

  it('preserves the backend health poll', async () => {
    render(<App />);

    await waitFor(() => {
      expect(api.checkHealth).toHaveBeenCalled();
    });
  });
});

// The connecting tissue: an answer must be able to reach the source that
// produced it.
describe('App: citation drill-through to Corpus', () => {
  it('opens the citing document in Corpus with that chunk focused', async () => {
    const user = userEvent.setup();
    (api.getDocuments as ReturnType<typeof vi.fn>).mockResolvedValue({
      total_documents: 1,
      total_chunks: 2,
      total_entities: 4,
      documents: [DOC],
    });

    render(<App />);

    await user.type(screen.getByPlaceholderText(/Type your question/i), 'What storage engines?');
    await user.click(screen.getByRole('button', { name: /Run Agent/i }));
    await waitFor(() => expect(screen.getByText('Retrieved Chunks & Citations')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Chunk 1 • vector/ }));

    // We moved to the Corpus area, on its sources sub-section...
    await waitFor(() => expect(areaTab('Corpus')).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('tab', { name: 'Sources' })).toHaveAttribute('aria-selected', 'true');
    // ...and the ask spine is gone (B5 still holds across the navigation).
    expect(screen.queryByText('Ask Agentic RAG Pipeline')).toBeNull();

    // The cited document is loaded and its chunk is the highlighted one.
    await waitFor(() => expect(api.getDocument).toHaveBeenCalledWith('doc-arch-1', 'default'));
    await waitFor(() => {
      expect(document.querySelector('[data-focused-document="doc-arch-1"]')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-focused-chunk="chunk-b"]')).toBeInTheDocument();
  });

  it('clears the focus when the user dismisses it', async () => {
    const user = userEvent.setup();
    (api.getDocuments as ReturnType<typeof vi.fn>).mockResolvedValue({
      total_documents: 1,
      total_chunks: 2,
      total_entities: 4,
      documents: [DOC],
    });

    render(<App />);

    await user.type(screen.getByPlaceholderText(/Type your question/i), 'What storage engines?');
    await user.click(screen.getByRole('button', { name: /Run Agent/i }));
    await waitFor(() => expect(screen.getByText('Retrieved Chunks & Citations')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Chunk 1 • vector/ }));

    await waitFor(() => expect(document.querySelector('[data-focused-chunk="chunk-b"]')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Dismiss source focus/i }));

    await waitFor(() => {
      expect(document.querySelector('[data-focused-chunk="chunk-b"]')).toBeNull();
    });
    expect(document.querySelector('[data-focused-document="doc-arch-1"]')).toBeNull();
    // The area itself stays put — only the focus is cleared.
    expect(areaTab('Corpus')).toHaveAttribute('aria-selected', 'true');
  });
});

// Metrics is three numbers plus infra state: a status panel, not an area.
describe('App: metrics status panel', () => {
  it('opens from the header without leaving the current area', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /Open status panel/i }));

    await waitFor(() => expect(api.getMetrics).toHaveBeenCalled());
    // Still in Ask, with the workspace mounted behind the panel.
    expect(areaTab('Ask')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Ask Agentic RAG Pipeline')).toBeInTheDocument();
  });

  it('unmounts the panel when dismissed', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /Open status panel/i }));
    await waitFor(() => expect(api.getMetrics).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /Close status panel/i }));

    await waitFor(() => {
      expect(screen.queryByText('LLMOps Observability & Tenant Economics')).toBeNull();
    });
  });
});
