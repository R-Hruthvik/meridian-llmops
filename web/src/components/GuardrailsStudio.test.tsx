import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuardrailsStudio } from './GuardrailsStudio';
import { api } from '../services/api';

vi.mock('../services/api', () => ({
  api: {
    checkGuardrails: vi.fn(),
  },
}));

describe('GuardrailsStudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('G3: verdict renders explicit Allowed Yes/No alongside the action badge', async () => {
    const user = userEvent.setup();
    (api.checkGuardrails as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      allowed: false,
      sanitized_text: 'redacted',
      policy_violations: ['prompt_injection'],
      action_taken: 'blocked',
    });

    render(<GuardrailsStudio tenantId="default" />);

    await user.click(screen.getByText('Prompt Injection'));

    await waitFor(() => {
      expect(api.checkGuardrails).toHaveBeenCalled();
    });
    expect(await screen.findByText('No')).toBeInTheDocument();
    expect(screen.getByText(/Action Taken:/)).toBeInTheDocument();
    expect(screen.getAllByText(/blocked/i).length).toBeGreaterThanOrEqual(1);
  });

  it('G3: allowed content shows Allowed Yes', async () => {
    const user = userEvent.setup();
    (api.checkGuardrails as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      allowed: true,
      sanitized_text: 'safe text',
      policy_violations: [],
      action_taken: 'pass',
    });

    render(<GuardrailsStudio tenantId="default" />);

    await user.click(screen.getByText('Safe Technical Query'));

    await waitFor(() => {
      expect(api.checkGuardrails).toHaveBeenCalled();
    });
    expect(await screen.findByText('Yes')).toBeInTheDocument();
  });
});
