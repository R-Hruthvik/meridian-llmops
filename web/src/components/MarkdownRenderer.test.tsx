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

describe('MarkdownRenderer: Generative UI & Sandboxed Artifacts', () => {
  it('intercepts widget:<name> code fence and renders DynamicWidget', () => {
    const content = [
      'Here are the retrieval execution timings [^1]:',
      '',
      '```widget:timings-waterfall',
      JSON.stringify({
        timings: {
          dense_retrieval: 38,
          graph_traversal: 14,
        },
      }),
      '```',
      '',
      'All latencies within acceptable bounds.',
    ].join('\n');

    render(<MarkdownRenderer content={content} />);

    expect(screen.getByText('Latency Breakdown')).toBeInTheDocument();
    expect(screen.getByText('dense_retrieval')).toBeInTheDocument();
    expect(screen.getByText('38ms')).toBeInTheDocument();
    expect(screen.getByText('graph_traversal')).toBeInTheDocument();
    expect(screen.getByText('14ms')).toBeInTheDocument();
    expect(screen.getByText('All latencies within acceptable bounds.')).toBeInTheDocument();
  });

  it('intercepts html:artifact code fence and renders SandboxedHtmlArtifact', () => {
    const content = [
      'Interactive visual simulation below:',
      '',
      '```html:artifact',
      '<div id="graph-canvas"><canvas width="200" height="100"></canvas></div>',
      '```',
    ].join('\n');

    render(<MarkdownRenderer content={content} />);

    expect(screen.getByText('Interactive Widget')).toBeInTheDocument();
    expect(screen.getByText('HTML')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Code' })).toBeInTheDocument();

    const iframe = screen.getByTitle('Interactive Widget') as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
    expect(iframe.getAttribute('srcdoc')).toContain('id="graph-canvas"');
    expect(iframe.getAttribute('srcdoc')).toContain('https://cdn.tailwindcss.com');
  });

  it('intercepts html:interactive code fence and renders SandboxedHtmlArtifact', () => {
    const content = [
      '```html:interactive',
      '<button class="p-2 bg-blue-500 text-white rounded">Click me</button>',
      '```',
    ].join('\n');

    render(<MarkdownRenderer content={content} />);

    const iframe = screen.getByTitle('Interactive Widget');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
    expect(iframe.getAttribute('srcdoc')).toContain('Click me');
  });

  it('retains clickable citations and sanitization when widgets are interleaved', () => {
    const onCitationClick = vi.fn();
    const content = [
      'Corpus analysis [^1]:',
      '',
      '```widget:memory-health',
      JSON.stringify({
        engines: {
          chroma: 'operational',
          sqlite: 'operational',
          redis: 'operational',
        },
      }),
      '```',
      '',
      'See concluding evidence [^2].',
      '<script>alert("malicious")</script>',
    ].join('\n');

    const { container } = render(
      <MarkdownRenderer content={content} onCitationClick={onCitationClick} />,
    );

    // Citations work
    const badge2 = screen.getByRole('button', { name: 'Citation 2' });
    fireEvent.click(badge2);
    expect(onCitationClick).toHaveBeenCalledWith(2);

    // Widget rendered
    expect(screen.getByText('Dual-Memory Health')).toBeInTheDocument();
    expect(screen.getByText('[VEC:CHROMA]')).toBeInTheDocument();

    // Script removed by sanitizer
    expect(container.querySelector('script')).toBeNull();
  });
});
