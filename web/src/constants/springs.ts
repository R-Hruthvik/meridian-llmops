export interface SpringConfig {
  type: 'spring';
  stiffness: number;
  damping: number;
  mass: number;
}

export interface TweenConfig {
  type: 'tween';
  duration: number;
  ease?: string;
}

export const MERIDIAN_SPRING: SpringConfig = {
  type: 'spring',
  stiffness: 100,
  damping: 20,
  mass: 1,
};

export const MERIDIAN_REDUCED_TRANSITION: TweenConfig = {
  type: 'tween',
  duration: 0.1,
  ease: 'linear',
};

export function useMeridianPhysics() {
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return {
    prefersReducedMotion,
    transition: prefersReducedMotion ? MERIDIAN_REDUCED_TRANSITION : MERIDIAN_SPRING,
  };
}
