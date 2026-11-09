import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DoubleBezelCard } from './DoubleBezelCard';

describe('DoubleBezelCard', () => {
  it('renders its children', () => {
    render(
      <DoubleBezelCard>
        <p>Bezel content</p>
      </DoubleBezelCard>,
    );

    expect(screen.getByText('Bezel content')).toBeTruthy();
  });

  it('renders the outer shell with the default bezel classes', () => {
    const { container } = render(<DoubleBezelCard>Content</DoubleBezelCard>);
    const outer = container.firstElementChild as HTMLElement;

    expect(outer.className).toContain('relative');
    expect(outer.className).toContain('p-1.5');
    expect(outer.className).toContain('rounded-2xl');
    expect(outer.className).toContain('border');
    expect(outer.className).toContain('transition-colors');
    expect(outer.className).toContain('border-white/10');
    expect(outer.className).toContain('bg-white/[0.03]');
    expect(outer.className).toContain('dark:bg-zinc-950/40');
  });

  it('renders the inner core with the machined inset classes', () => {
    const { container } = render(<DoubleBezelCard>Content</DoubleBezelCard>);
    const outer = container.firstElementChild as HTMLElement;
    const inner = outer.firstElementChild as HTMLElement;

    expect(inner.className).toContain('rounded-xl');
    expect(inner.className).toContain('bg-zinc-900/90');
    expect(inner.className).toContain('dark:bg-zinc-900/90');
    expect(inner.className).toContain('p-4');
    expect(inner.className).toContain(
      'shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
    );
  });

  it('swaps the border to the sky accent when active', () => {
    const { container } = render(<DoubleBezelCard active>Content</DoubleBezelCard>);
    const outer = container.firstElementChild as HTMLElement;

    expect(outer.className).toContain('border-sky-400/50');
    expect(outer.className).not.toContain('border-white/10');
  });
});
