import React from 'react';
import { render } from '@testing-library/react';
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
});
