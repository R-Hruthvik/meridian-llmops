import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MERIDIAN_SPRING, MERIDIAN_REDUCED_TRANSITION, useMeridianPhysics } from './springs';

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

describe('Meridian Physics & Motion Tokens', () => {
  it('defines a critically damped spring configuration (zeta = 1.0)', () => {
    expect(MERIDIAN_SPRING.type).toBe('spring');
    expect(MERIDIAN_SPRING.stiffness).toBe(100);
    expect(MERIDIAN_SPRING.damping).toBe(20);
    expect(MERIDIAN_SPRING.mass).toBe(1);
  });

  it('defines a zero-spatial-movement fallback for reduced motion', () => {
    expect(MERIDIAN_REDUCED_TRANSITION.type).toBe('tween');
    expect(MERIDIAN_REDUCED_TRANSITION.duration).toBe(0.1);
  });
});

describe('useMeridianPhysics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the critically damped spring when motion is allowed', () => {
    stubReducedMotion(false);

    const { result } = renderHook(() => useMeridianPhysics());

    expect(result.current.prefersReducedMotion).toBe(false);
    expect(result.current.transition).toBe(MERIDIAN_SPRING);
  });

  it('returns the 100ms fallback when reduced motion is preferred', () => {
    stubReducedMotion(true);

    const { result } = renderHook(() => useMeridianPhysics());

    expect(result.current.prefersReducedMotion).toBe(true);
    expect(result.current.transition).toBe(MERIDIAN_REDUCED_TRANSITION);
  });
});
