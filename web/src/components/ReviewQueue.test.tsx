import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewQueue } from './ReviewQueue';
import { api } from '../services/api';

vi.mock('../services/api', () => ({
  api: {
    listReviewItems: vi.fn(),
    reviewItemAction: vi.fn(),
  },
}));

const pendingItems = [
  {
    id: 'r1',
    extracted_field_id: 'f1',
    document_id: 'doc-1',
    field_name: 'invoice_total',
    value: '100',
    confidence: 0.4,
    provenance_page: 1,
    status: 'pending',
    corrected_value: null,
    notes: null,
  },
];

describe('ReviewQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.listReviewItems as ReturnType<typeof vi.fn>).mockResolvedValue(pendingItems);
    (api.reviewItemAction as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, action: { action: string }) => ({
      ...pendingItems[0],
      status: action.action === 'approve' ? 'approved' : action.action,
    }));
  });

  it('G7: renders pending items with approve/reject buttons', async () => {
    render(<ReviewQueue tenantId="default" />);

    await waitFor(() => {
      expect(api.listReviewItems).toHaveBeenCalledWith('default');
    });
    expect(await screen.findByText('invoice_total')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve invoice_total/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reject invoice_total/i })).toBeInTheDocument();
  });

  it('G7: approve posts the action at the api layer and refreshes', async () => {
    const user = userEvent.setup();
    render(<ReviewQueue tenantId="default" />);

    await screen.findByText('invoice_total');
    await user.click(screen.getByRole('button', { name: /Approve invoice_total/i }));

    await waitFor(() => {
      expect(api.reviewItemAction).toHaveBeenCalledWith('r1', { action: 'approve', corrected_value: undefined, notes: undefined }, 'default');
    });
  });

  it('G7: correct-with-note submits corrected value and notes', async () => {
    const user = userEvent.setup();
    render(<ReviewQueue tenantId="default" />);

    await screen.findByText('invoice_total');
    await user.click(screen.getByText('Correct'));

    await user.clear(screen.getByLabelText('Corrected value'));
    await user.type(screen.getByLabelText('Corrected value'), '120');
    await user.type(screen.getByLabelText('Review note'), 'verified against source');
    await user.click(screen.getByText('Submit correction'));

    await waitFor(() => {
      expect(api.reviewItemAction).toHaveBeenCalledWith(
        'r1',
        { action: 'correct', corrected_value: '120', notes: 'verified against source' },
        'default',
      );
    });
  });

  it('G7: empty queue renders the clear state', async () => {
    (api.listReviewItems as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    render(<ReviewQueue tenantId="default" />);

    expect(await screen.findByText('Review queue is clear')).toBeInTheDocument();
  });
});
