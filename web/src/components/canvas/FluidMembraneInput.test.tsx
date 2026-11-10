import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import { FluidMembraneInput } from './FluidMembraneInput';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FluidMembraneInput', () => {
  it('renders a canvas and an input', () => {
    render(<FluidMembraneInput placeholder="Type here" />);

    expect(document.querySelector('canvas')).toBeTruthy();
    expect(document.querySelector('input[placeholder="Type here"]')).toBeTruthy();
  });

  it('applies a className to the wrapper', () => {
    render(<FluidMembraneInput className="custom-wrap" />);

    expect(document.querySelector('.custom-wrap')).toBeTruthy();
  });

  it('fires onChange when typing', () => {
    const onChange = vi.fn();
    render(<FluidMembraneInput onChange={onChange} />);

    const input = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hello' } });

    expect(onChange).toHaveBeenCalledWith('hello');
  });

  it('accepts the isCenter prop without crashing', () => {
    render(<FluidMembraneInput isCenter />);
    render(<FluidMembraneInput isCenter={false} />);

    expect(document.querySelector('canvas')).toBeTruthy();
    expect(document.querySelector('input')).toBeTruthy();
  });
});
