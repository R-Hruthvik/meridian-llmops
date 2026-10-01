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

const DEGRADED = {
  ...HEALTHY,
  services: {
    qdrant: { status: 'reachable', endpoint: 'http://localhost:6333/collections', reachable: true },
    neo4j: { status: 'unreachable', endpoint: 'http://localhost:7474', reachable: false },
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
  (api.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue({ providers: [] });
  (api.checkGuardrails as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(INDEX_STATUS);
  (api.query as ReturnType<typeof vi.fn>).mockResolvedValue(QUERY_RESPONSE);
});

/** The three primary lenses live in the left icon rail. */
const rail = () => screen.getByRole('navigation', { name: 'Workbench lenses' });
const lens = (name: string) => within(rail()).getByRole('button', { name });

/** Every non-lens capability is reachable as an overlay from this strip. */
const capabilityStrip = () => screen.getByRole('navigation', { name: 'Capability overlays' });

const topBar = () => screen.getByRole('banner');

const chipVariant = (name: RegExp) => screen.getByText(name).closest('[data-variant]');

describe('App shell: three lenses on the icon rail', () => {
  it('exposes exactly three lenses and no capability surfaces', () => {
    render(<App />);

    const lenses = within(rail()).getAllByRole('button');
    expect(lenses.map((l) => l.textContent?.trim())).toEqual(['Ask', 'Corpus', 'Operate']);
  });

  it('does not put Index, Guardrails, Review or Metrics on the rail', () => {
    render(<App />);

    for (const name of ['Index & Storage', 'Guardrails', 'Review Queue', 'Metrics']) {
      expect(within(rail()).queryByRole('button', { name })).toBeNull();
    }
  });

  it('marks the active lens with the accent wash and accent ink', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(lens('Ask')).toHaveAttribute('aria-current', 'page');
    expect(lens('Ask').className).toContain('bg-accent-wash');
    expect(lens('Ask').className).toContain('text-accent-ink');
    expect(lens('Corpus')).toHaveAttribute('aria-current', 'false');

    await user.click(lens('Corpus'));
    expect(lens('Corpus')).toHaveAttribute('aria-current', 'page');
    expect(lens('Ask')).toHaveAttribute('aria-current', 'false');
  });

  it('gives every lens an accessible tooltip name beyond the glyph', () => {
    render(<App />);

    for (const name of ['Ask', 'Corpus', 'Operate']) {
      expect(lens(name)).toHaveAttribute('title', name);
    }
  });
});

describe('App shell: the top bar is one line', () => {
  it('never wraps its row', () => {
    render(<App />);

    const bar = topBar();
    expect(bar.className).toContain('flex-nowrap');
    expect(bar.className).toContain('whitespace-nowrap');
    expect(bar.className).toContain('overflow-x-auto');
  });

  it('holds brand, tenant, provider/model, health and settings in one cluster', async () => {
    render(<App />);

    const bar = topBar();
    await waitFor(() => expect(api.getLLMSettings).toHaveBeenCalled());

    expect(within(bar).getByText('Meridian')).toBeInTheDocument();
    expect(within(bar).getByLabelText('Tenant Identifier')).toBeInTheDocument();
    expect(within(bar).getByText(/openai/i)).toBeInTheDocument();
    expect(within(bar).getByText('gpt-4o-mini')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /open llm engine settings/i })).toBeInTheDocument();
  });

  it('renders exactly one tenant field and one health readout — no duplicate cluster', async () => {
    render(<App />);
    await waitFor(() => expect(api.checkHealth).toHaveBeenCalled());

    expect(screen.getAllByLabelText('Tenant Identifier')).toHaveLength(1);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('refuses a blank tenant instead of silently reading another tenant', async () => {
    const user = userEvent.setup();
    render(<App />);

    const field = screen.getByLabelText('Tenant Identifier');
    await user.clear(field);
    await user.type(field, '   ');

    // The backend substitutes "default" for an empty X-Tenant-Id, so a blank
    // field quietly shows the default tenant's data. Say so, and keep reading
    // the tenant the field last named.
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText(/Tenant identifier is required/i)).toBeInTheDocument();
    expect(api.getDocuments).not.toHaveBeenCalled();
  });

  it('accepts a valid tenant and stops reporting the error', async () => {
    const user = userEvent.setup();
    render(<App />);

    const field = screen.getByLabelText('Tenant Identifier');
    await user.clear(field);
    await user.type(field, '  ');
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));

    await user.type(field, 'acme');

    await waitFor(() => expect(field).not.toHaveAttribute('aria-invalid', 'true'));
    expect(screen.queryByText(/Tenant identifier is required/i)).toBeNull();
  });
});

describe('App shell: the health chip reports real state only', () => {
  it('reads Online on a fully reachable services map', async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(chipVariant(/Online/)).toHaveAttribute('data-variant', 'ok');
  });

  it('reads Degraded when any service is unreachable', async () => {
    (api.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue(DEGRADED);
    render(<App />);

    await waitFor(() => expect(screen.getByText('Degraded')).toBeInTheDocument());
    expect(chipVariant(/Degraded/)).toHaveAttribute('data-variant', 'warn');
  });

  it('reads Offline when health cannot be reached at all', async () => {
    (api.checkHealth as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    render(<App />);

    await waitFor(() => expect(screen.getByText('Offline')).toBeInTheDocument());
    expect(chipVariant(/Offline/)).toHaveAttribute('data-variant', 'fail');
  });

  it('reads Unknown, never Online, when the payload carries no service evidence', async () => {
    // `services` is optional in HealthStatus, so a partial or proxied payload is
    // a real shape. `Object.values({}).some(...)` is false, which used to read as
    // "nothing is down" — the readout claimed health it had no evidence for.
    (api.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'healthy',
      service: 'meridian-rag-engine',
    });
    render(<App />);

    await waitFor(() => expect(screen.getByText('Unknown')).toBeInTheDocument());
    expect(chipVariant(/Unknown/)).toHaveAttribute('data-variant', 'faint');
    expect(screen.queryByText('Online')).toBeNull();
  });

  it('reads Unknown when the services map is present but empty', async () => {
    (api.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'healthy',
      service: 'meridian-rag-engine',
      services: {},
    });
    render(<App />);

    await waitFor(() => expect(screen.getByText('Unknown')).toBeInTheDocument());
    expect(screen.queryByText('Online')).toBeNull();
  });

  it('preserves the health poll', async () => {
    render(<App />);

    await waitFor(() => expect(api.checkHealth).toHaveBeenCalled());
  });
});

describe('App shell: the overlay host serves every capability', () => {
  it('opens and closes each of the five capability overlays', async () => {
    const user = userEvent.setup();
    render(<App />);

    const cases = [
      { opener: 'Corpus', dialog: 'Corpus' },
      { opener: 'Index & Storage', dialog: 'Index & Storage' },
      { opener: 'Guardrails', dialog: 'Guardrails' },
      { opener: 'Review Queue', dialog: 'Review Queue' },
      { opener: 'Metrics', dialog: 'Metrics' },
    ] as const;

    for (const { opener, dialog } of cases) {
      expect(screen.queryByRole('dialog', { name: dialog })).toBeNull();

      await user.click(within(capabilityStrip()).getByRole('button', { name: opener }));
      expect(await screen.findByRole('dialog', { name: dialog })).toBeInTheDocument();

      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog', { name: dialog })).toBeNull());
    }
  });

  it('shows no overlay before anything asks for one', () => {
    render(<App />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.getMetrics).not.toHaveBeenCalled();
    expect(api.getIndexStatus).not.toHaveBeenCalled();
    expect(api.listReviewItems).not.toHaveBeenCalled();
  });

  it('names where an overlay was opened from in its breadcrumb', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(within(capabilityStrip()).getByRole('button', { name: 'Metrics' }));

    const dialog = await screen.findByRole('dialog', { name: 'Metrics' });
    expect(within(dialog).getByText('ASK')).toBeInTheDocument();
  });

  it('keeps the Ask canvas mounted behind an open overlay', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(within(capabilityStrip()).getByRole('button', { name: 'Metrics' }));

    await waitFor(() => expect(api.getMetrics).toHaveBeenCalled());
    expect(lens('Ask')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Ask Agentic RAG Pipeline')).toBeInTheDocument();
  });
});

describe('App shell: settings opens the LLM studio from the top bar', () => {
  it('opens the settings modal from the gear without leaving the lens', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /open llm engine settings/i }));

    expect(await screen.findByRole('dialog', { name: /llm provider & platform key studio/i })).toBeInTheDocument();
    expect(lens('Ask')).toHaveAttribute('aria-current', 'page');
  });
});

// B5: the lazy-mount invariant. Only the ACTIVE lens's studio is mounted, so
// inactive studios never fetch and unmounted DOM is really gone.
describe('App B5: only the active lens is mounted', () => {
  it('starts in Ask with the workspace mounted and nothing else', () => {
    render(<App />);

    expect(screen.getByText('Ask Agentic RAG Pipeline')).toBeInTheDocument();
    expect(api.getMetrics).not.toHaveBeenCalled();
    expect(api.getDocuments).not.toHaveBeenCalled();
    expect(api.listReviewItems).not.toHaveBeenCalled();
    expect(api.getIndexStatus).not.toHaveBeenCalled();
  });

  it('unmounts the previous studio when switching lenses', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText('Ask Agentic RAG Pipeline')).toBeInTheDocument();

    await user.click(lens('Operate'));

    expect(await screen.findByText('Input Guardrails & Threat Evaluation')).toBeInTheDocument();
    expect(screen.queryByText('Ask Agentic RAG Pipeline')).toBeNull();
  });

  it('mounts the corpus studio when the Corpus lens is chosen', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(lens('Corpus'));

    await waitFor(() => expect(api.getDocuments).toHaveBeenCalled());
    expect(api.getIndexStatus).not.toHaveBeenCalled();
  });

  it('mounts an overlay surface only while its overlay is open', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(within(capabilityStrip()).getByRole('button', { name: 'Index & Storage' }));
    await waitFor(() => expect(api.getIndexStatus).toHaveBeenCalled());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(api.getIndexStatus).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// The connecting tissue: an answer must be able to reach the source that
// produced it, and the source is now an overlay over the canvas rather than a
// neighbouring screen.
describe('App: citation drill-through to the Corpus overlay', () => {
  it('opens the citing document in the Corpus overlay with that chunk focused', async () => {
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

    const dialog = await screen.findByRole('dialog', { name: 'Corpus' });
    expect(dialog).toBeInTheDocument();
    // The Ask canvas is still behind it — the citation is an overlay, not a
    // change of screen.
    expect(screen.getByText('Ask Agentic RAG Pipeline')).toBeInTheDocument();

    await waitFor(() => expect(api.getDocument).toHaveBeenCalledWith('doc-arch-1', 'default'));
    await waitFor(() => {
      expect(document.querySelector('[data-focused-document="doc-arch-1"]')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-focused-chunk="chunk-b"]')).toBeInTheDocument();
  });

  it('clears the focus when the user dismisses it, keeping the overlay open', async () => {
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
    await screen.findByRole('dialog', { name: 'Corpus' });

    await waitFor(() => expect(document.querySelector('[data-focused-chunk="chunk-b"]')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Dismiss source focus/i }));

    await waitFor(() => {
      expect(document.querySelector('[data-focused-chunk="chunk-b"]')).toBeNull();
    });
    expect(document.querySelector('[data-focused-document="doc-arch-1"]')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Corpus' })).toBeInTheDocument();
  });
});
