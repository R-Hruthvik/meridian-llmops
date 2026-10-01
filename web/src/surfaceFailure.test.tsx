import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

// A surface whose chunk failed to arrive: a deploy that renames chunks, an
// offline tab, a 404. `React.lazy` re-throws, and with no boundary React unmounts
// the whole tree — the operator loses the top bar, the rail and the Ask canvas
// because a dialog would not open.
const failNext = vi.hoisted(() => ({ on: false }));

vi.mock('./components/MetricsDashboard', () => ({
  MetricsDashboard: () => {
    if (failNext.on) throw new Error('Failed to fetch dynamically imported module');
    return <div data-testid="metrics-surface" />;
  },
}));
vi.mock('./components/SettingsModal', () => ({ SettingsModal: () => <div data-testid="settings-surface" /> }));
vi.mock('./services/api', () => ({
  api: {
    getApiKey: vi.fn(() => ''),
    setApiKey: vi.fn(),
    checkHealth: vi.fn(async () => ({
      status: 'healthy',
      service: 'meridian-rag-engine',
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

const strip = () => screen.getByRole('navigation', { name: 'Capability overlays' });

beforeEach(() => {
  failNext.on = false;
});

describe('a surface whose chunk fails does not take the shell with it', () => {
  it('names the failure in place of the surface and leaves the shell alive', async () => {
    const user = userEvent.setup();
    failNext.on = true;
    render(<App />);

    await user.click(within(strip()).getByRole('button', { name: 'Metrics' }));

    // The failure is stated where the surface would have been.
    const notice = await screen.findByTestId('surface-error');
    expect(notice).toBeInTheDocument();
    expect(screen.getByText(/Failed to fetch dynamically imported module/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();

    // The shell survives: banner, lens rail and the Ask canvas are still there.
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Workbench lenses' })).toBeInTheDocument();
    expect(screen.getByText('Ask Agentic RAG Pipeline')).toBeInTheDocument();
  });

  it('does not report an error for a surface that loads', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(within(strip()).getByRole('button', { name: 'Metrics' }));

    expect(await screen.findByTestId('metrics-surface')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('surface-error')).toBeNull());
  });

  it('keeps a failed surface from breaking the next one', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(within(strip()).getByRole('button', { name: 'Metrics' }));
    expect(await screen.findByTestId('metrics-surface')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // One surface failing later must not poison the host.
    failNext.on = true;
    await user.click(within(strip()).getByRole('button', { name: 'Metrics' }));

    expect(await screen.findByTestId('surface-error')).toBeInTheDocument();
    expect(screen.getByText('Ask Agentic RAG Pipeline')).toBeInTheDocument();
  });
});
