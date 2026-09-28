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

  // --- instrument-console language ---------------------------------------
  // A guardrail verdict is a security decision, so it reads like one: a
  // StatusChip carrying the state, the action in mono, and the matched
  // regexes as the payload.
  const evaluateWith = async (result: Record<string, unknown>, preset = 'Safe Technical Query') => {
    const user = userEvent.setup();
    (api.checkGuardrails as ReturnType<typeof vi.fn>).mockResolvedValueOnce(result);

    render(<GuardrailsStudio tenantId="default" />);
    await user.click(screen.getByText(preset));

    await waitFor(() => {
      expect(api.checkGuardrails).toHaveBeenCalled();
    });
  };

  it('verdict renders a fail StatusChip for a blocked decision', async () => {
    await evaluateWith(
      { allowed: false, sanitized_text: '', policy_violations: [], action_taken: 'blocked' },
      'Prompt Injection',
    );

    const chip = (await screen.findByText('Blocked')).closest('[data-variant]');
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute('data-variant', 'fail');
  });

  it('verdict renders a warn StatusChip for a redacted decision', async () => {
    await evaluateWith({ allowed: false, sanitized_text: 'x', policy_violations: [], action_taken: 'redacted' });

    const chip = (await screen.findByText('Redacted')).closest('[data-variant]');
    expect(chip).toHaveAttribute('data-variant', 'warn');
  });

  it('verdict renders an ok StatusChip for a passed decision', async () => {
    await evaluateWith({ allowed: true, sanitized_text: 'safe', policy_violations: [], action_taken: 'pass' });

    const chip = (await screen.findByText('Pass')).closest('[data-variant]');
    expect(chip).toHaveAttribute('data-variant', 'ok');
  });

  it('the action taken is rendered in tabular monospace', async () => {
    await evaluateWith({ allowed: false, sanitized_text: '', policy_violations: [], action_taken: 'blocked' }, 'Prompt Injection');

    const action = await screen.findByText('blocked', { selector: '[data-slot="action"]' });
    expect(action.className).toContain('num');
  });

  it('matched policy violations are listed as the actual regexes, in monospace', async () => {
    await evaluateWith({
      allowed: false,
      sanitized_text: '',
      policy_violations: ['(?i)ignore\\s+all\\s+previous', 'sk-[a-z0-9]{16,}'],
      action_taken: 'blocked',
    });

    const first = await screen.findByText('(?i)ignore\\s+all\\s+previous');
    expect(first.className).toContain('num');
    expect(screen.getByText('sk-[a-z0-9]{16,}')).toBeInTheDocument();
  });

  it('sanitized text is rendered as answer prose, not a monospace code card', async () => {
    await evaluateWith({ allowed: true, sanitized_text: 'clean payload', policy_violations: [], action_taken: 'pass' });

    const prose = (await screen.findByText('clean payload')).closest('.answer-prose');
    expect(prose).not.toBeNull();
  });

  it('the preset chips survive the restyle', () => {
    render(<GuardrailsStudio tenantId="default" />);
    for (const name of ['Prompt Injection', 'PII Leakage Attempt', 'Jailbreak (DAN Mode)', 'Safe Technical Query']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });
});
