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

    await user.clear(screen.getByLabelText('Corrected value for invoice_total'));
    await user.type(screen.getByLabelText('Corrected value for invoice_total'), '120');
    await user.type(screen.getByLabelText('Review note for invoice_total'), 'verified against source');
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

  it('toast uses past tense (corrected, not correctd)', async () => {
    const user = userEvent.setup();
    render(<ReviewQueue tenantId="default" />);

    await screen.findByText('invoice_total');
    await user.click(screen.getByText('Correct'));
    await user.clear(screen.getByLabelText('Corrected value for invoice_total'));
    await user.type(screen.getByLabelText('Corrected value for invoice_total'), '120');
    await user.click(screen.getByText('Submit correction'));

    expect(await screen.findByText('Item corrected successfully.')).toBeInTheDocument();
  });

  // --- instrument-console language ---------------------------------------
  // The queue is a dense table, not a card list: id, entity, confidence, age,
  // actions. Every number is tabular monospace.
  const longIdItems = [
    {
      id: '98cd9ff5c7874c6a1b2c3d4e5f60718',
      extracted_field_id: 'f1',
      document_id: 'doc-c2bd07cc',
      field_name: 'invoice_total',
      value: '100',
      confidence: 0.4,
      provenance_page: 1,
      status: 'pending',
      corrected_value: null,
      notes: null,
    },
  ];

  it('renders a dense table with the instrument column set', async () => {
    render(<ReviewQueue tenantId="default" />);
    await screen.findByText('invoice_total');

    const table = screen.getByRole('table');
    for (const header of ['Item', 'Entity', 'Confidence', 'Age', 'Actions']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(header, 'i') })).toBeInTheDocument();
    }
    expect(table).toBeInTheDocument();
  });

  it('item id renders in short form, in identifiers type', async () => {
    (api.listReviewItems as ReturnType<typeof vi.fn>).mockResolvedValueOnce(longIdItems);
    render(<ReviewQueue tenantId="default" />);

    const cell = (await screen.findByText(/^98cd9ff5/)).closest('td');
    expect(cell?.className).toContain('id-mono');
    // Short form: the full 32-char id must not be dumped on screen.
    expect(screen.queryByText('98cd9ff5c7874c6a1b2c3d4e5f60718')).not.toBeInTheDocument();
  });

  it('confidence renders as a tabular number with a proportional bar', async () => {
    (api.listReviewItems as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { ...longIdItems[0], confidence: 0.42 },
    ]);
    render(<ReviewQueue tenantId="default" />);

    const value = await screen.findByText('42%');
    expect(value.className).toContain('num');

    const bar = screen.getByRole('progressbar', { name: /confidence/i });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
  });

  it('age stays empty rather than inventing a timestamp the API never returns', async () => {
    (api.listReviewItems as ReturnType<typeof vi.fn>).mockResolvedValueOnce(longIdItems);
    render(<ReviewQueue tenantId="default" />);
    await screen.findByText('invoice_total');

    // The review API exposes no timestamp, so age must read as unavailable —
    // the same "unavailable, never a fake 0" rule the index counters follow.
    const age = screen.getByTestId('review-age-unavailable');
    expect(age).toHaveTextContent('—');
  });

  it('keeps the GLOBAL badge, empty state and toast on the restyled table', async () => {
    render(<ReviewQueue tenantId="default" />);
    await screen.findByText('invoice_total');
    expect(screen.getByText('Global')).toBeInTheDocument();
  });
});

describe('ReviewQueue keyboard and announcement behaviour', () => {
  const twoItems = [
    { ...pendingItems[0], id: 'r1', field_name: 'invoice_total' },
    { ...pendingItems[0], id: 'r2', field_name: 'due_date' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (api.reviewItemAction as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it('keeps focus in the queue after approving the last item', async () => {
    // The actioned row unmounts with its focused button, and React does not
    // relocate focus on unmount — so the next Tab used to restart at the top of
    // the document. Focus lands on the queue heading instead.
    // The actioned item is gone from the refetch, so the queue empties.
    (api.listReviewItems as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(pendingItems)
      .mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<ReviewQueue tenantId="default" />);

    await screen.findByText('invoice_total');
    await user.click(screen.getByRole('button', { name: /Approve invoice_total/i }));

    await waitFor(() => expect(api.listReviewItems).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: /Pending review/i }),
    );
  });

  it('moves focus to the next row when items remain', async () => {
    (api.listReviewItems as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(twoItems)
      .mockResolvedValueOnce([twoItems[1]]);
    const user = userEvent.setup();
    render(<ReviewQueue tenantId="default" />);

    await screen.findByText('invoice_total');
    await user.click(screen.getByRole('button', { name: /Approve invoice_total/i }));

    expect(await screen.findByRole('button', { name: /Approve due_date/i })).toHaveFocus();
  });

  it('exposes the Correct disclosure as expanded/collapsed', async () => {
    (api.listReviewItems as ReturnType<typeof vi.fn>).mockResolvedValue(pendingItems);
    const user = userEvent.setup();
    render(<ReviewQueue tenantId="default" />);

    await screen.findByText('invoice_total');
    const toggle = screen.getByRole('button', { name: /^Correct/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('has a live region standing before the toast text arrives', async () => {
    // A live region that mounts already containing its message is never
    // announced. Both the toast and the error mounted pre-filled, so the result
    // of the operator's own action — approved, rejected, or failed — was silent.
    (api.listReviewItems as ReturnType<typeof vi.fn>).mockResolvedValue(pendingItems);
    const user = userEvent.setup();
    render(<ReviewQueue tenantId="default" />);

    // Standing before anything is actioned.
    expect(screen.getByTestId('review-toast-region')).toBeInTheDocument();
    expect(screen.getByTestId('review-toast-region')).toHaveTextContent('');

    await screen.findByText('invoice_total');
    await user.click(screen.getByRole('button', { name: /Approve invoice_total/i }));

    await waitFor(() =>
      expect(screen.getByTestId('review-toast-region')).toHaveTextContent(/approved/i),
    );
  });

  it('names the correction fields after the item, not just the field type', async () => {
    // Every row rendered "Corrected value" and "Review note", so a screen-reader
    // user heard the same two names for whichever row they happened to be in.
    (api.listReviewItems as ReturnType<typeof vi.fn>).mockResolvedValue(pendingItems);
    const user = userEvent.setup();
    render(<ReviewQueue tenantId="default" />);

    await screen.findByText('invoice_total');
    await user.click(screen.getByRole('button', { name: /^Correct/ }));

    expect(screen.getByLabelText(/Corrected value for invoice_total/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Review note for invoice_total/i)).toBeInTheDocument();
  });
});
