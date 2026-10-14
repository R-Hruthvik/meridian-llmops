import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

vi.mock('./services/api', () => ({
  api: {
    getApiKey: vi.fn(() => ''), setApiKey: vi.fn(), checkHealth: vi.fn(),
    getLLMSettings: vi.fn(), updateLLMSettings: vi.fn(), testLLMConnection: vi.fn(),
    query: vi.fn(), getDocuments: vi.fn(), getDocument: vi.fn(), deleteDocument: vi.fn(),
    clearAllDocuments: vi.fn(), seedSampleDocuments: vi.fn(), uploadDocuments: vi.fn(),
    ingest: vi.fn(), getProviders: vi.fn(), checkGuardrails: vi.fn(),
    listReviewItems: vi.fn(), reviewItemAction: vi.fn(), getMetrics: vi.fn(),
    getIndexStatus: vi.fn(), groq: {},
  },
  ApiError: class ApiError extends Error {},
}));

import { api } from './services/api';

const DOC = {
  id: 'doc-arch-1', title: 'Meridian Architecture Overview', format: 'md', source: 'manual',
  created_at: '2026-08-18T10:00:00Z', char_count: 500, chunk_count: 2,
  entities_count: 4, relationships_count: 2, snippet: 'Architecture overview',
};
const DOC_DETAIL = {
  ...DOC, text: 'Architecture overview text',
  chunks: [
    { id: 'chunk-a', chunk_index: 0, section_heading: 'Overview', text: 'First chunk of the architecture doc' },
    { id: 'chunk-b', chunk_index: 1, section_heading: 'Storage', text: 'Second chunk of the architecture doc' },
  ],
};
const QUERY_RESPONSE = {
  query: 'What storage engines does Meridian use?', answer: 'Qdrant and Neo4j.',
  source_chunks: [{ chunk_id: 'chunk-b', document_id: 'doc-arch-1', text: 'Second chunk of the architecture doc', score: 0.91, retrieval_method: 'vector' }],
  entities: [{ name: 'Qdrant', entity_type: 'concept' }], cycle_count: 1,
  verified: true, refusal: false, execution_time_ms: 42,
  serving: { provider: 'custom', model: 'kilo-auto/free', fresh: true },
};
const EMPTY_DOCUMENTS = { total_documents: 0, total_chunks: 0, total_entities: 0, documents: [] };
const EMPTY_INDEX_STATUS = {
  vector: { collections: [], points_per_collection: {}, total_points: null, vector_dimension: null, is_fallback: true, detail: '' },
  graph: { node_count: null, relationship_count: null, entity_index_size: null, is_fallback: true, detail: '' },
  lexical: { corpus_size: null, document_count: null, is_fallback: true, detail: '' },
  relational: { dialect: null, tables: [], total_rows: 0, is_fallback: true, detail: '' },
  backends: {},
};
const nav = () => screen.getByRole('navigation', { name: 'Primary navigation' });
const go = (name: string) => within(nav()).getByRole('link', { name });

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.clearAllMocks();
  (api.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue({ ready: true });
  (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
    active_provider: 'custom', default_model: 'kilo-auto/free',
    base_url: 'http://localhost:3010/v1', providers_configured: { custom: true },
  });
  (api.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue({ providers: [] });
  (api.testLLMConnection as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'success', message: 'Connected', latency_ms: 12 });
  (api.getDocuments as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_DOCUMENTS);
  (api.getDocument as ReturnType<typeof vi.fn>).mockResolvedValue(DOC_DETAIL);
  (api.listReviewItems as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.getMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({ tenant_id: 'default', total_requests: 0, total_tokens: 0, total_cost_usd: 0 });
  (api.checkGuardrails as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (api.getIndexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_INDEX_STATUS);
  (api.query as ReturnType<typeof vi.fn>).mockResolvedValue(QUERY_RESPONSE);
});

describe('Meridian workbench navigation', () => {
  it('shows four labeled destinations and opens Sources at its own route', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(within(nav()).getAllByRole('link').map((link) => link.textContent?.trim())).toEqual(['Ask', 'Sources', 'Operations', 'Settings']);
    await user.click(go('Sources'));
    expect(window.location.hash).toBe('#/sources');
    expect(go('Sources')).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { name: 'Sources' })).toBeInTheDocument();
    await waitFor(() => expect(api.getDocuments).toHaveBeenCalledWith('default'));
  });

  it('opens an Operations sub-section from a direct hash route', async () => {
    window.history.replaceState(null, '', '/#/operations/review');
    render(<App />);
    expect(go('Operations')).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { name: /review queue/i })).toBeInTheDocument();
    await waitFor(() => expect(api.listReviewItems).toHaveBeenCalled());
  });

  it('navigates between the source catalog and index view', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(go('Sources'));
    const sections = screen.getByRole('navigation', { name: 'Sources sections' });
    await user.click(within(sections).getByRole('link', { name: 'Index & storage' }));
    expect(window.location.hash).toBe('#/sources/index');
    await waitFor(() => expect(api.getIndexStatus).toHaveBeenCalled());
  });

  it('follows browser back and forward between sections', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(go('Sources'));
    await user.click(go('Operations'));
    window.history.back();
    await waitFor(() => expect(window.location.hash).toBe('#/sources'));
    expect(go('Sources')).toHaveAttribute('aria-current', 'page');
    window.history.forward();
    await waitFor(() => expect(window.location.hash).toBe('#/operations/safety'));
    expect(go('Operations')).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the question and answer in memory when leaving Ask', async () => {
    const user = userEvent.setup();
    render(<App />);
    const question = screen.getByPlaceholderText(/ask about your sources/i);
    await user.clear(question);
    await user.type(question, 'What storage engines does Meridian use?');
    await user.click(screen.getByRole('button', { name: /Ask/i }));
    expect(await screen.findByText('Qdrant and Neo4j.')).toBeInTheDocument();
    await user.click(go('Sources'));
    await user.click(go('Ask'));
    expect(screen.getByPlaceholderText(/ask about your sources/i)).toHaveValue('What storage engines does Meridian use?');
    expect(screen.getByText('Qdrant and Neo4j.')).toBeInTheDocument();
  });

  it('opens the cited document and chunk on the Sources route', async () => {
    const user = userEvent.setup();
    (api.getDocuments as ReturnType<typeof vi.fn>).mockResolvedValue({ total_documents: 1, total_chunks: 2, total_entities: 4, documents: [DOC] });
    render(<App />);
    await user.type(screen.getByPlaceholderText(/ask about your sources/i), 'What storage engines?');
    await user.click(screen.getByRole('button', { name: /Ask/i }));
    await screen.findByText('Qdrant and Neo4j.');
    await user.click(screen.getByRole('button', { name: /chunk 1 • vector/i }));
    expect(window.location.hash).toBe('#/sources');
    await waitFor(() => expect(api.getDocument).toHaveBeenCalledWith('doc-arch-1', 'default'));
    expect(await screen.findByText('Second chunk of the architecture doc')).toBeInTheDocument();
    expect(document.querySelector('[data-focused-chunk="chunk-b"]')).toBeInTheDocument();
  });

  it('maps Operations tabs to real views, with no invented all-good status', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(go('Operations'));
    const operations = screen.getByRole('navigation', { name: 'Operations sections' });
    expect(within(operations).getByRole('link', { name: 'Safety rules' })).toBeInTheDocument();
    expect(within(operations).getByRole('link', { name: 'Review queue' })).toBeInTheDocument();
    expect(within(operations).getByRole('link', { name: 'Usage' })).toBeInTheDocument();
    expect(screen.queryByText(/everything is in good shape|all systems ready/i)).toBeNull();
    await user.click(within(operations).getByRole('link', { name: 'Usage' }));
    expect(window.location.hash).toBe('#/operations/usage');
    await waitFor(() => expect(api.getMetrics).toHaveBeenCalled());
  });

  it('opens Settings as a page and reflects saved provider settings', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(go('Settings'));
    expect(window.location.hash).toBe('#/settings');
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect((await screen.findAllByDisplayValue('kilo-auto/free')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('provides a collapsible and keyboard-resizable desktop sidebar', async () => {
    const user = userEvent.setup();
    render(<App />);
    const separator = screen.getByRole('separator', { name: 'Resize sidebar' });
    expect(separator).toHaveAttribute('aria-valuenow', '248');
    await user.click(separator);
    await user.keyboard('{ArrowRight}');
    expect(separator).toHaveAttribute('aria-valuenow', '264');
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('keeps tenant and actual service health in the compact header', async () => {
    render(<App />);
    expect(screen.getByLabelText('Tenant Identifier')).toBeInTheDocument();
    expect(await screen.findByText('Online')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /profile/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /search anything/i })).toBeNull();
  });
});
