import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { RagWorkspace } from './RagWorkspace';
import { useRagChat } from '../components/chat/useRagChat';
import { FluidMembraneInput } from '../components/canvas/FluidMembraneInput';
import type { ChatTurn } from '../components/chat/useRagChat';
import type { FluidMembraneInputProps } from '../components/canvas/FluidMembraneInput';

// jsdom has no canvas 2d context, so stub the membrane input and assert
// integration through its props and events instead of canvas pixels.
vi.mock('../components/canvas/FluidMembraneInput', () => ({
  FluidMembraneInput: vi.fn((props: FluidMembraneInputProps) => (
    <div data-testid="fluid-membrane-input">
      <input
        data-testid="membrane-input"
        ref={props.inputRef}
        type="text"
        value={props.value ?? ''}
        onChange={(e) => props.onChange?.(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') props.onSubmit?.();
        }}
        aria-label={props.ariaLabel}
      />
      <button data-testid="membrane-send" onClick={props.onSubmit} type="button" />
    </div>
  )),
}));

vi.mock('../components/chat/useRagChat', () => ({
  useRagChat: vi.fn(),
}));

let turnCounter = 0;

const makeTurn = (overrides: Partial<ChatTurn> = {}): ChatTurn => {
  turnCounter += 1;
  return {
    id: `turn-${turnCounter}`,
    query: 'What does Meridian use for retrieval?',
    createdAt: Date.now(),
    status: 'complete',
    answer: '',
    sources: [],
    verified: false,
    refusal: false,
    timings_ms: {},
    execution_time_ms: 0,
    ...overrides,
  };
};

const holder = { turns: [] as ChatTurn[] };
const submitQuery = vi.fn(async (text: string) => {
  const query = text.trim();
  if (!query) return;
  holder.turns = [...holder.turns, makeTurn({ query })];
});

beforeEach(() => {
  turnCounter = 0;
  holder.turns = [];
  submitQuery.mockClear();
  vi.mocked(useRagChat).mockImplementation(() => ({
    turns: holder.turns,
    isLoading: false,
    submitQuery,
    activeTurnId: null,
    activeTurn: null,
    abortCurrentQuery: vi.fn(),
    clearTurns: vi.fn(),
    removeTurn: vi.fn(),
  }));
  vi.mocked(FluidMembraneInput).mockClear();
});

const renderWorkspace = (initialTurns: ChatTurn[] = [], onTurnsUpdate = vi.fn()) => {
  holder.turns = [...initialTurns];
  return render(
    <RagWorkspace tenantId="tenant-1" initialTurns={initialTurns} onTurnsUpdate={onTurnsUpdate} />,
  );
};

describe('RagWorkspace', () => {
  it('renders FluidMembraneInput centered when turns are empty', () => {
    renderWorkspace();

    expect(screen.getByTestId('fluid-membrane-input')).toBeInTheDocument();
    expect(screen.getByTestId('membrane-input')).toBeInTheDocument();

    const props = vi.mocked(FluidMembraneInput).mock.calls[0]?.[0];
    expect(props?.isCenter).toBe(true);
  });

  it('submits the trimmed query when the input is submitted', () => {
    renderWorkspace();

    const input = screen.getByTestId('membrane-input');
    fireEvent.change(input, { target: { value: '  hello world  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(submitQuery).toHaveBeenCalledTimes(1);
    expect(submitQuery).toHaveBeenCalledWith('hello world', {
      topK: 3,
      maxCycles: 3,
      enforceGuardrails: true,
    });
    expect(input.value).toBe('');
  });

  it('focuses the input when the chat is empty', () => {
    renderWorkspace();

    expect(document.activeElement).toBe(screen.getByTestId('membrane-input'));
  });

  it('renders the error alert with status code and message', () => {
    renderWorkspace([
      makeTurn({
        status: 'error',
        error: { message: 'Upstream stream failed', status: 500 },
      }),
    ]);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveTextContent('HTTP 500');
    expect(alert).toHaveTextContent('Query Intercepted / Failed');
    expect(alert).toHaveTextContent('Upstream stream failed');
  });

  it('calls onTurnsUpdate when a submitted query adds a turn', () => {
    const onTurnsUpdate = vi.fn();
    const { rerender } = renderWorkspace([], onTurnsUpdate);

    const input = screen.getByTestId('membrane-input');
    fireEvent.change(input, { target: { value: '  what is qdrant?  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(submitQuery).toHaveBeenCalledWith('what is qdrant?', {
      topK: 3,
      maxCycles: 3,
      enforceGuardrails: true,
    });

    rerender(<RagWorkspace tenantId="tenant-1" initialTurns={[]} onTurnsUpdate={onTurnsUpdate} />);

    expect(onTurnsUpdate).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ query: 'what is qdrant?' })]),
    );
  });
});
