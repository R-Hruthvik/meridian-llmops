import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { MarkdownRenderer } from './MarkdownRenderer';

const CODE = ['# Heading', '', 'Some prose with `inline` code.', '', '```python', 'print("hello")', '```'].join('\n');

describe('MarkdownRenderer: token layer, no literal colour', () => {
  it('renders nothing for empty content', () => {
    const { container } = render(<MarkdownRenderer content="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('maps the code block onto the instrument tokens, not a literal hex', () => {
    const { container } = render(<MarkdownRenderer content={CODE} />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(container.innerHTML).not.toMatch(/#[0-9A-Fa-f]{3,6}/);
    expect(wrapper.className).toContain('[&_pre]:bg-surface-sunken');
    expect(wrapper.className).toContain('[&_pre]:text-ink');
    expect(wrapper.className).toContain('[&_pre]:border-hairline');
    expect(wrapper.className).not.toContain('meridian-');
  });

  it('renders the markdown through to HTML', () => {
    const { container } = render(<MarkdownRenderer content="A **bold** claim." />);

    expect(container.querySelector('strong')).not.toBeNull();
  });

  it('strips script tags from embedded HTML', () => {
    const { container } = render(<MarkdownRenderer content={'before\n\n<script>alert(1)</script>\n\nafter'} />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('before');
  });

  it('renders inline [^1] as a clickable citation button', () => {
    const onCitationClick = vi.fn();
    render(
      <MarkdownRenderer
        content="Grounding evidence is here [^1] and in section [^2]."
        onCitationClick={onCitationClick}
      />,
    );

    const badge1 = screen.getByRole('button', { name: 'Citation 1' });
    expect(badge1).toBeInTheDocument();
    expect(badge1).toHaveAttribute('data-citation-index', '1');
    expect(badge1).toHaveTextContent('[^1]');

    const badge2 = screen.getByRole('button', { name: 'Citation 2' });
    expect(badge2).toBeInTheDocument();

    fireEvent.click(badge1);
    expect(onCitationClick).toHaveBeenCalledWith(1);
  });

  it('strips non-citation rogue buttons from embedded HTML', () => {
    const { container } = render(
      <MarkdownRenderer content={'<button onclick="steal()">Click me</button>\n\nValid [^1]'} />,
    );

    expect(screen.queryByText('Click me')).toBeNull();
    expect(screen.getByRole('button', { name: 'Citation 1' })).toBeInTheDocument();
    expect(container.querySelector('button.citation-badge')).not.toBeNull();
  });
});

