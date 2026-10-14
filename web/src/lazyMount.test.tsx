import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

// Each studio module records the moment it is actually evaluated. A static
// import graph evaluates every studio before the first render; a `React.lazy`
// boundary evaluates a studio only when its surface is first asked for.
const evaluated = vi.hoisted(() => [] as string[]);

vi.mock('./components/IndexStorageStudio', () => {
  evaluated.push('index');
  return { IndexStorageStudio: () => <div data-testid="index-surface" /> };
});
vi.mock('./components/ReviewQueue', () => {
  evaluated.push('review');
  return { ReviewQueue: () => <div data-testid="review-surface" /> };
});
vi.mock('./components/MetricsDashboard', () => {
  evaluated.push('metrics');
  return { MetricsDashboard: () => <div data-testid="metrics-surface" /> };
});
vi.mock('./components/IngestionStudio', () => {
  evaluated.push('corpus');
  return { IngestionStudio: () => <div data-testid="corpus-surface" /> };
});
vi.mock('./components/GuardrailsStudio', () => {
  evaluated.push('guardrails');
  return { GuardrailsStudio: () => <div data-testid="guardrails-surface" /> };
});
vi.mock('./components/SettingsModal', () => {
  evaluated.push('settings');
  return { SettingsModal: () => <div data-testid="settings-surface" /> };
});
vi.mock('./components/MarkdownRenderer', () => {
  evaluated.push('markdown');
  return { MarkdownRenderer: () => <div data-testid="markdown-surface">answer body</div> };
});

const ANSWER = {
  query: 'What storage engines?',
  answer: 'Qdrant and Neo4j.',
  source_chunks: [
    { chunk_id: 'chunk-a', document_id: 'doc-a', text: 'alpha', score: 0.4, retrieval_method: 'hybrid_rrf' },
  ],
  entities: [{ name: 'Qdrant', entity_type: 'concept' }],
  cycle_count: 1,
  verified: true,
  refusal: false,
  execution_time_ms: 900,
  serving: { provider: 'openai', model: 'gpt-4o-mini', fresh: true },
  degraded_reason: null,
};

vi.mock('./services/api', () => ({
  api: {
    getApiKey: vi.fn(() => 'test-session-key'),
    setApiKey: vi.fn(),
    checkHealth: vi.fn(() => new Promise(() => {})),
    getLLMSettings: vi.fn(async () => ({ active_provider: 'openai', default_model: 'gpt-4o-mini' })),
    query: vi.fn(async () => ANSWER),
    getDocuments: vi.fn(() => new Promise(() => {})),
    getMetrics: vi.fn(),
    getIndexStatus: vi.fn(),
    listReviewItems: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

/**
 * Snapshotted after the import graph has been evaluated and before the first
 * render. Anything listed here shipped with the initial bundle, whether or not
 * the user ever asked for it.
 */
const AT_MODULE_LOAD = [...evaluated];

const primary = () => screen.getByRole('navigation', { name: 'Primary navigation' });
const go = (name: string) => within(primary()).getByRole('link', { name });
const operations = () => screen.getByRole('navigation', { name: 'Monitor sections' });
const sources = () => screen.getByRole('navigation', { name: 'Sources sections' });

beforeEach(() => {
  evaluated.length = 0;
  window.history.replaceState(null, '', '/#/ask');
});

describe('first paint ships only the Ask surface', () => {
  it('evaluates no studio module other than Ask before anything asks for one', () => {
    render(<App />);

    expect(screen.getByText('Ask Meridian')).toBeInTheDocument();
    expect(AT_MODULE_LOAD).toEqual([]);
  });

  it('evaluates the settings studio only when the gear is used', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(evaluated).not.toContain('settings');

    await user.click(go('Settings'));

    expect(await screen.findByTestId('settings-surface')).toBeInTheDocument();
    expect(evaluated).toContain('settings');
  });
});

describe('a surface is evaluated the first time it is opened', () => {
  it('loads Index & Storage, Safety checks, Review Queue and Metrics on demand', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(go('Sources'));
    await user.click(within(sources()).getByRole('link', { name: 'Index & storage' }));
    expect(await screen.findByTestId('index-surface')).toBeInTheDocument();
    await user.click(go('Monitor'));
    expect(await screen.findByTestId('metrics-surface')).toBeInTheDocument();
    await user.click(within(operations()).getByRole('link', { name: 'Safety checks' }));
    expect(await screen.findByTestId('guardrails-surface')).toBeInTheDocument();
    await user.click(within(operations()).getByRole('link', { name: 'Review queue' }));
    expect(await screen.findByTestId('review-surface')).toBeInTheDocument();

    expect(evaluated).toEqual(['corpus', 'index', 'metrics', 'guardrails', 'review']);
  });

  it('loads Corpus and Guardrails on demand from the rail', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(go('Sources'));
    expect(await screen.findByTestId('corpus-surface')).toBeInTheDocument();

    await user.click(go('Monitor'));
    await user.click(within(operations()).getByRole('link', { name: 'Safety checks' }));
    expect(await screen.findByTestId('guardrails-surface')).toBeInTheDocument();

    expect(screen.getByTestId('guardrails-surface')).toBeInTheDocument();
  });
});

describe('a pending surface is labelled, not blank', () => {
  it('replaces the fallback with the surface and leaves no residue', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(go('Monitor'));
    await user.click(within(operations()).getByRole('link', { name: 'Usage' }));

    expect(await screen.findByTestId('metrics-surface')).toBeInTheDocument();
    expect(screen.queryByTestId('surface-fallback')).toBeNull();
  });
});

describe('the answer body is deferred until an answer exists', () => {
  it('does not evaluate the markdown renderer on first paint', () => {
    render(<App />);

    expect(screen.getByText('Ask Meridian')).toBeInTheDocument();
    expect(AT_MODULE_LOAD).not.toContain('markdown');
    expect(evaluated).not.toContain('markdown');
  });

  it('evaluates it once an answer has been returned', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByPlaceholderText(/Ask about your sources/i), 'What storage engines?');
    await user.click(screen.getByRole('button', { name: /Ask/i }));

    expect(await screen.findByTestId('markdown-surface')).toBeInTheDocument();
    expect(evaluated).toContain('markdown');
  });
});
