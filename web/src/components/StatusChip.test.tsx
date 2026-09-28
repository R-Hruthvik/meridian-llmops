import React from 'react';
import { render, screen } from '@testing-library/react';
import { StatusChip, type StatusChipVariant } from './StatusChip';

const VARIANTS: StatusChipVariant[] = ['ok', 'warn', 'fail', 'faint', 'accent'];

describe('StatusChip', () => {
  it.each(VARIANTS)('renders the %s variant as real, non-colour-only text', (variant) => {
    render(<StatusChip variant={variant}>VERIFIED GROUNDED</StatusChip>);

    const label = screen.getByText('VERIFIED GROUNDED');
    expect(label).toBeInTheDocument();
    expect(label.closest('[data-variant]')).toHaveAttribute('data-variant', variant);
  });

  it('exposes the label text to assistive tech and hides the decorative dot', () => {
    const { container } = render(<StatusChip variant="fail">REFUSED</StatusChip>);

    expect(screen.getByText('REFUSED')).toBeInTheDocument();
    const dot = container.querySelector('[data-slot="dot"]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute('aria-hidden', 'true');
  });

  it('sets the mono uppercase label contract from the type scale', () => {
    render(<StatusChip variant="warn">DEGRADED</StatusChip>);

    const label = screen.getByText('DEGRADED');
    expect(label).toHaveClass('font-mono', 'uppercase');
  });

  it('defaults to the faint variant when none is given', () => {
    render(<StatusChip>UNVERIFIED</StatusChip>);

    expect(screen.getByText('UNVERIFIED').closest('[data-variant]')).toHaveAttribute(
      'data-variant',
      'faint',
    );
  });

  it('merges caller className onto the chip', () => {
    render(
      <StatusChip variant="accent" className="mr-2">
        NO MODEL SERVED
      </StatusChip>,
    );

    const chip = screen.getByText('NO MODEL SERVED').closest('[data-variant]');
    expect(chip).toHaveClass('mr-2');
  });
});
