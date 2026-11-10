import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

import { FluidPointerCanvas } from './FluidPointerCanvas';

const mockMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FluidPointerCanvas', () => {
  it('renders a fullscreen canvas with aria-hidden', () => {
    mockMatchMedia(false);
    render(<FluidPointerCanvas />);

    const canvas = document.querySelector('canvas');
    expect(canvas).toBeTruthy();
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
  });

  it('applies a className to the canvas', () => {
    mockMatchMedia(false);
    render(<FluidPointerCanvas className="custom-canvas" />);

    expect(document.querySelector('.custom-canvas')).toBeTruthy();
  });

  it('renders a canvas under prefers-reduced-motion without crashing', () => {
    mockMatchMedia(true);
    render(<FluidPointerCanvas />);

    expect(document.querySelector('canvas')).toBeTruthy();
  });

  it('accepts a custom colorRgb prop', () => {
    mockMatchMedia(false);
    render(<FluidPointerCanvas colorRgb="20 22 24" />);

    expect(document.querySelector('canvas')).toBeTruthy();
  });
});
