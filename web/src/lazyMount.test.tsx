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

vi.mock('./services/api', () => ({
  api: {
    getApiKey: vi.fn(() => ''),
    setApiKey: vi.fn(),
    checkHealth: vi.fn(async () => ({
      status: 'healthy',
      service: 'meridian-rag-engine',
      storage_documents: 0,
      vector_chunks: 0,
      services: { qdrant: { reachable: true } },
    })),
    getLLMSettings: vi.fn(async () => ({ active_provider: 'openai', default_model: 'gpt-4o-mini' })),
    query: vi.fn(),
    getDocuments: vi.fn(),
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

const rail = () => screen.getByRole('navigation', { name: 'Workbench lenses' });
const lens = (name: string) => within(rail()).getByRole('button', { name });
const strip = () => screen.getByRole('navigation', { name: 'Capability overlays' });

beforeEach(() => {
  evaluated.length = 0;
});

describe('first paint ships only the Ask surface', () => {
  it('evaluates no studio module other than Ask before anything asks for one', () => {
    render(<App />);

    expect(screen.getByText('Ask Agentic RAG Pipeline')).toBeInTheDocument();
    expect(AT_MODULE_LOAD).toEqual([]);
  });

  it('evaluates the settings studio only when the gear is used', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(evaluated).not.toContain('settings');

    await user.click(screen.getByRole('button', { name: /open llm engine settings/i }));

    expect(await screen.findByTestId('settings-surface')).toBeInTheDocument();
    expect(evaluated).toContain('settings');
  });
});

describe('a surface is evaluated the first time it is opened', () => {
  it('loads Index & Storage, Review Queue and Metrics on demand', async () => {
    const user = userEvent.setup();
    render(<App />);

    for (const [label, marker] of [
      ['Index & Storage', 'index-surface'],
      ['Review Queue', 'review-surface'],
      ['Metrics', 'metrics-surface'],
    ] as const) {
      await user.click(within(strip()).getByRole('button', { name: label }));
      expect(await screen.findByTestId(marker)).toBeInTheDocument();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }

    expect(evaluated).toEqual(['index', 'review', 'metrics']);
  });

  it('loads Corpus and Guardrails on demand from the rail', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(lens('Corpus'));
    expect(await screen.findByTestId('corpus-surface')).toBeInTheDocument();

    await user.click(lens('Operate'));
    expect(await screen.findByTestId('guardrails-surface')).toBeInTheDocument();

    expect(evaluated).toEqual(['corpus', 'guardrails']);
  });
});

describe('a pending surface is labelled, not blank', () => {
  it('replaces the fallback with the surface and leaves no residue', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(within(strip()).getByRole('button', { name: 'Metrics' }));

    expect(await screen.findByTestId('metrics-surface')).toBeInTheDocument();
    expect(screen.queryByTestId('surface-fallback')).toBeNull();
  });
});
