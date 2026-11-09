import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { CommandDock } from './CommandDock';

const baseProps = {
  query: '',
  onQueryChange: vi.fn(),
  onSubmit: vi.fn(),
  topK: 5,
  onTopKChange: vi.fn(),
  guardrails: false,
  onGuardrailsChange: vi.fn(),
};

function renderDock(overrides: Partial<React.ComponentProps<typeof CommandDock>> = {}) {
  return render(<CommandDock {...baseProps} {...overrides} />);
}

describe('CommandDock', () => {
  it('renders the query textarea with the expected placeholder', () => {
    renderDock({ query: 'hello' });

    const textarea = screen.getByPlaceholderText(
      'Ask Meridian RAG (Cmd+Enter to send)...',
    ) as HTMLTextAreaElement;

    expect(textarea.value).toBe('hello');
  });

  it('reports text input changes', () => {
    const onQueryChange = vi.fn();
    renderDock({ onQueryChange });

    fireEvent.change(
      screen.getByPlaceholderText('Ask Meridian RAG (Cmd+Enter to send)...'),
      { target: { value: 'new question' } },
    );

    expect(onQueryChange).toHaveBeenCalledWith('new question');
  });

  it('submits on Cmd+Enter', () => {
    const onSubmit = vi.fn();
    renderDock({ query: 'question', onSubmit });

    fireEvent.keyDown(
      screen.getByPlaceholderText('Ask Meridian RAG (Cmd+Enter to send)...'),
      { key: 'Enter', metaKey: true },
    );

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('submits on Ctrl+Enter', () => {
    const onSubmit = vi.fn();
    renderDock({ query: 'question', onSubmit });

    fireEvent.keyDown(
      screen.getByPlaceholderText('Ask Meridian RAG (Cmd+Enter to send)...'),
      { key: 'Enter', ctrlKey: true },
    );

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('changes Top-K when a chip is clicked', () => {
    const onTopKChange = vi.fn();
    renderDock({ topK: 5, onTopKChange });

    fireEvent.click(screen.getByRole('button', { name: '8' }));

    expect(onTopKChange).toHaveBeenCalledWith(8);
  });

  it('toggles guardrails when the shield button is clicked', () => {
    const onGuardrailsChange = vi.fn();
    renderDock({ guardrails: false, onGuardrailsChange });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle guardrails' }));

    expect(onGuardrailsChange).toHaveBeenCalledWith(true);
  });

  it('submits when the submit CTA is clicked', () => {
    const onSubmit = vi.fn();
    renderDock({ query: 'question', onSubmit });

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('cancels instead of submitting while streaming', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    renderDock({ query: 'question', onSubmit, onCancel, isStreaming: true });

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
