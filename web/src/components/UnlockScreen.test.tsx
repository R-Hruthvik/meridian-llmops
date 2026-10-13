import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UnlockScreen } from './UnlockScreen';

describe('UnlockScreen', () => {
  it('submits the entered key without exposing tenant or role choices', () => {
    const onUnlock = vi.fn();
    render(<UnlockScreen onUnlock={onUnlock} />);

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'test-session-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(onUnlock).toHaveBeenCalledWith('test-session-key');
    expect(screen.queryByLabelText(/tenant|role/i)).toBeNull();
  });
});
