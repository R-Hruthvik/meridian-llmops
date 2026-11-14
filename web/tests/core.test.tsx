/**
 * Contract tests for the design-system + core modules: motion presets, theme
 * resolution, health interpretation and the navigation primitives the shell
 * exposes for reuse.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StatusBadge, STATUS_TONE_CLASSES, type StatusTone } from '../src/components/shell/StatusBadge';
import {
  FloatingDock,
  NAV_ITEMS,
  interpretHealth,
  type NavView,
} from '../src/components/shell/StudioShell';
import { DEFAULT_TENANT_ID, STORAGE_KEYS, resolveInitialTheme } from '../src/core/auth';
import {
  DRAWER_SLIDE,
  FADE_UP,
  LAYOUT_IDS,
  SPRING_GENTLE,
  SPRING_SNAPPY,
  STAGGER_CONTAINER,
  STAGGER_ITEM,
  prefersReducedMotion,
} from '../src/core/motion';

/* -------------------------------------------------------------------------- */
/* Motion presets                                                             */
/* -------------------------------------------------------------------------- */

describe('motion presets', () => {
  it('pins the snappy spring to the specified physics', () => {
    expect(SPRING_SNAPPY).toEqual({
      type: 'spring',
      stiffness: 420,
      damping: 32,
      mass: 0.8,
    });
    expect(SPRING_GENTLE).toEqual({ type: 'spring', stiffness: 260, damping: 28 });
  });

  it('exposes initial/animate/exit on content variants', () => {
    for (const key of ['initial', 'animate', 'exit'] as const) {
      expect(FADE_UP).toHaveProperty(key);
      expect(DRAWER_SLIDE).toHaveProperty(key);
    }
    expect(DRAWER_SLIDE.animate).toMatchObject({ x: 0 });
    expect(DRAWER_SLIDE.exit).toMatchObject({ x: '100%' });
  });

  it('drives staggering from the container', () => {
    const transition = (STAGGER_CONTAINER.animate as { transition?: { staggerChildren?: number } })
      .transition;
    expect(transition?.staggerChildren).toBeGreaterThan(0);
    expect(STAGGER_ITEM.initial).toMatchObject({ opacity: 0 });
  });

  it('keeps the dock pill layout id stable', () => {
    expect(LAYOUT_IDS.dockActivePill).toBe('dock-active-pill');
  });

  it('degrades gracefully when matchMedia is unavailable', () => {
    expect(prefersReducedMotion()).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Theme                                                                      */
/* -------------------------------------------------------------------------- */

describe('resolveInitialTheme', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to light without a stored preference', () => {
    expect(resolveInitialTheme()).toBe('light');
  });

  it('honours a stored preference', () => {
    window.localStorage.setItem(STORAGE_KEYS.theme, 'dark');
    expect(resolveInitialTheme()).toBe('dark');
  });

  it('falls back to prefers-color-scheme', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('dark'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    expect(resolveInitialTheme()).toBe('dark');
    vi.unstubAllGlobals();
  });

  it('uses the documented storage keys', () => {
    expect(STORAGE_KEYS).toEqual({
      apiKey: 'meridian_api_key',
      tenantId: 'meridian_tenant_id',
      theme: 'meridian_theme',
    });
    expect(DEFAULT_TENANT_ID).toBe('default');
  });
});

/* -------------------------------------------------------------------------- */
/* Health                                                                     */
/* -------------------------------------------------------------------------- */

describe('interpretHealth', () => {
  it.each([
    [{ status: 'ok' }, 'ok'],
    [{ status: 'healthy' }, 'ok'],
    [{ status: 'READY' }, 'ok'],
    [{ status: 'degraded' }, 'warn'],
    [{ status: 'partial_outage' }, 'warn'],
    [{ status: 'unhealthy' }, 'fail'],
    [{ status: 'down' }, 'fail'],
    [{}, 'ok'],
  ] as const)('maps %j to %s', (payload, expected) => {
    expect(interpretHealth({ ...payload })).toBe(expected);
  });
});

/* -------------------------------------------------------------------------- */
/* StatusBadge                                                                */
/* -------------------------------------------------------------------------- */

describe('StatusBadge', () => {
  const tones: StatusTone[] = ['ok', 'warn', 'fail', 'neutral'];

  it('defines a recipe for every tone', () => {
    for (const tone of tones) {
      expect(STATUS_TONE_CLASSES[tone].pill).toContain('border');
      expect(STATUS_TONE_CLASSES[tone].dot).toContain('bg-');
    }
  });

  it('renders a live region with its label', () => {
    const markup = renderToStaticMarkup(
      <StatusBadge tone="ok" label="Healthy" pulse />,
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain('Healthy');
  });

  it('renders a bare dot when no label is given', () => {
    const markup = renderToStaticMarkup(<StatusBadge tone="fail" size="sm" />);
    expect(markup).not.toContain('<span class="whitespace-nowrap');
  });
});

/* -------------------------------------------------------------------------- */
/* Navigation primitives                                                      */
/* -------------------------------------------------------------------------- */

describe('FloatingDock', () => {
  it('exposes the four spatial views', () => {
    expect(NAV_ITEMS.map((item) => item.id)).toEqual<NavView[]>([
      'ask',
      'vault',
      'ops',
      'settings',
    ]);
  });

  it('marks the active view and keeps labels in the accessible name', () => {
    const markup = renderToStaticMarkup(
      <FloatingDock activeView="ops" onNavigate={() => undefined} />,
    );

    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="Ops"');
    expect(markup).toContain('aria-label="Ask"');
    expect(markup).toContain('backdrop-blur-xl');
  });
});
