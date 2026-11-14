/**
 * Meridian — reusable Framer Motion presets.
 *
 * Motion language: quick, physical, spring-driven. Nothing bounces for the
 * sake of bouncing; springs are used for spatial continuity (a pill that
 * travels between dock items, a panel that slides from the edge) and eased
 * fades for content that materialises.
 */
import type { Transition, Variants } from 'framer-motion';

/* -------------------------------------------------------------------------- */
/* Springs                                                                    */
/* -------------------------------------------------------------------------- */

/** Snappy — for small, direct-manipulation elements (dock pill, toggles, chips). */
export const SPRING_SNAPPY: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 32,
  mass: 0.8,
};

/** Gentle — for larger surfaces (drawers, palette frames, layout shifts). */
export const SPRING_GENTLE: Transition = {
  type: 'spring',
  stiffness: 260,
  damping: 28,
};

/** Softer sibling of GENTLE for very large panels that should not overshoot. */
export const SPRING_SOFT: Transition = {
  type: 'spring',
  stiffness: 200,
  damping: 30,
  mass: 1,
};

/** Instant-ish feedback for hover/press states. */
export const TWEEN_FAST: Transition = { duration: 0.16, ease: [0.22, 1, 0.36, 1] };

/* -------------------------------------------------------------------------- */
/* Content variants                                                           */
/* -------------------------------------------------------------------------- */

/** Generic entrances: content rises and de-blurs out of the canvas. */
export const FADE_UP: Variants = {
  initial: { opacity: 0, y: 12, filter: 'blur(6px)' },
  animate: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { ...SPRING_GENTLE, opacity: { duration: 0.24, ease: 'easeOut' } },
  },
  exit: {
    opacity: 0,
    y: -8,
    filter: 'blur(4px)',
    transition: { duration: 0.18, ease: [0.4, 0, 1, 1] },
  },
};

/** Right-hand slide-over drawers (evidence panels, review sheets). */
export const DRAWER_SLIDE: Variants = {
  initial: { x: '100%', opacity: 0.4 },
  animate: { x: 0, opacity: 1, transition: { ...SPRING_GENTLE } },
  exit: { x: '100%', opacity: 0.4, transition: { duration: 0.24, ease: [0.4, 0, 1, 1] } },
};

/** Backdrop scrim that pairs with DRAWER_SLIDE / dialogs. */
export const SCRIM_FADE: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18 } },
  exit: { opacity: 0, transition: { duration: 0.16 } },
};

/** Modal frame: scale + opacity spring used by the command palette. */
export const DIALOG_POP: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 6 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { ...SPRING_SNAPPY } },
  exit: { opacity: 0, scale: 0.97, y: 4, transition: { duration: 0.14, ease: 'easeIn' } },
};

/* -------------------------------------------------------------------------- */
/* Lists                                                                      */
/* -------------------------------------------------------------------------- */

/** Parent of a stagger group — pair with STAGGER_ITEM on each child. */
export const STAGGER_CONTAINER: Variants = {
  initial: {},
  animate: {
    transition: { staggerChildren: 0.045, delayChildren: 0.06 },
  },
  exit: {
    transition: { staggerChildren: 0.02, staggerDirection: -1 },
  },
};

/** Child of a STAGGER_CONTAINER. */
export const STAGGER_ITEM: Variants = {
  initial: { opacity: 0, y: 10, filter: 'blur(4px)' },
  animate: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { ...SPRING_GENTLE },
  },
  exit: { opacity: 0, y: -6, transition: { duration: 0.12 } },
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** True when the user has asked the OS to reduce motion. Safe in non-DOM envs. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Collapses a transition to a near-instant tween when the user prefers reduced
 * motion. Pass the result to any `transition` prop for an accessible fallback.
 */
export function withMotionPreference(transition: Transition): Transition {
  return prefersReducedMotion() ? { duration: 0.001 } : transition;
}

/** Shared `layoutId` values — single source of truth for morphing elements. */
export const LAYOUT_IDS = {
  dockActivePill: 'dock-active-pill',
  themeIcon: 'theme-icon',
} as const;
