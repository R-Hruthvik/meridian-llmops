import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiErrorNotice } from './ApiErrorNotice';
import { api } from '../services/api';

describe('ApiErrorNotice', () => {
  it('shows and lets the user dismiss an actionable API error', () => {
    render(<ApiErrorNotice />);
    act(() => {
      window.dispatchEvent(new CustomEvent('meridian:api-error', {
        detail: {
          message: 'Index is inconsistent. Run scripts/reindex.py to rebuild it.',
          status: 503,
          code: 'index_inconsistent',
          action: 'Run scripts/reindex.py to rebuild the index.',
        },
      }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Index is inconsistent.');
    expect(screen.getByRole('alert')).toHaveTextContent('Run scripts/reindex.py to rebuild the index.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss API error' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps a caught settings-load failure visible to the user', async () => {
    render(<ApiErrorNotice />);
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Unauthorized' }), {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'Content-Type': 'application/json' },
    }));

    await act(async () => api.getProviders().catch(() => undefined));

    expect(screen.getByRole('alert')).toHaveTextContent('Enter API key');
  });
});
