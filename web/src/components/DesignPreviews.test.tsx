import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DesignPreviews } from './DesignPreviews';

describe('DesignPreviews', () => {
  it('switches between the five design directions', () => {
    render(<DesignPreviews />);
    expect(screen.getByRole('heading', { name: 'Route Map' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Evidence Journal/ }));
    expect(screen.getByRole('heading', { name: 'Evidence Journal' })).toBeInTheDocument();
  });
});
