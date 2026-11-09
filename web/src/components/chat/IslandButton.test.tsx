import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { IslandButton } from './IslandButton';

describe('IslandButton', () => {
  it('renders its label', () => {
    render(<IslandButton>Send query</IslandButton>);

    expect(screen.getByRole('button', { name: 'Send query' })).toBeTruthy();
  });

  it('renders a trailing icon inside a circular badge', () => {
    render(
      <IslandButton icon={<svg data-testid="trailing-icon" />}>
        Continue
      </IslandButton>,
    );

    const icon = screen.getByTestId('trailing-icon');
    const badge = icon.parentElement as HTMLElement;

    expect(badge).toBeTruthy();
    expect(badge.className).toContain('w-6');
    expect(badge.className).toContain('h-6');
    expect(badge.className).toContain('rounded-full');
    expect(badge.className).toContain('flex');
    expect(badge.className).toContain('items-center');
    expect(badge.className).toContain('justify-center');
  });

  it('does not render an icon badge when no icon is provided', () => {
    render(<IslandButton>No icon</IslandButton>);

    expect(screen.queryByTestId('trailing-icon')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'No icon' }).querySelector('span'),
    ).toBeNull();
  });

  it('handles click events', () => {
    const onClick = vi.fn();
    render(<IslandButton onClick={onClick}>Run</IslandButton>);

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled and ignores clicks when disabled', () => {
    const onClick = vi.fn();
    render(
      <IslandButton onClick={onClick} disabled>
        Run
      </IslandButton>,
    );

    const button = screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });
});
