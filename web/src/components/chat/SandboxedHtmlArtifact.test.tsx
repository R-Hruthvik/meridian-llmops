import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SandboxedHtmlArtifact, generateArtifactSrcDoc } from './SandboxedHtmlArtifact';

describe('SandboxedHtmlArtifact', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders an iframe with sandbox="allow-scripts"', () => {
    render(<SandboxedHtmlArtifact html="<p>Test snippet</p>" />);

    const iframe = screen.getByTitle('Interactive Widget');
    expect(iframe).toBeInTheDocument();
    expect(iframe.tagName.toLowerCase()).toBe('iframe');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(iframe.className).toContain('w-full');
    expect(iframe.className).toContain('h-80');
    expect(iframe.className).toContain('bg-zinc-950');
  });

  it('generates srcDoc with standard boilerplate: tailwind CDN, #070809 bg, #EDEDED text, and CSS vars', () => {
    const snippet = '<div class="text-sky-400">Hello World</div>';
    render(<SandboxedHtmlArtifact html={snippet} />);

    const iframe = screen.getByTitle('Interactive Widget') as HTMLIFrameElement;
    const srcDoc = iframe.getAttribute('srcdoc') || '';

    expect(srcDoc).toContain('https://cdn.tailwindcss.com');
    expect(srcDoc).toContain('background-color: #070809');
    expect(srcDoc).toContain('color: #EDEDED');
    expect(srcDoc).toContain('--surface: #070809');
    expect(srcDoc).toContain('--accent: #38BDF8');
    expect(srcDoc).toContain(snippet);
  });

  it('injects tailwind and styling when input is already a full HTML document', () => {
    const fullHtml = '<!DOCTYPE html><html><head><title>Full</title></head><body>Full Doc Content</body></html>';
    const srcDoc = generateArtifactSrcDoc(fullHtml);

    expect(srcDoc).toContain('https://cdn.tailwindcss.com');
    expect(srcDoc).toContain('background-color: #070809');
    expect(srcDoc).toContain('Full Doc Content');
  });

  it('renders header with title, HTML badge, and Copy Code button', () => {
    render(<SandboxedHtmlArtifact html="<div>Test</div>" title="Custom Tool View" />);

    expect(screen.getByText('Custom Tool View')).toBeInTheDocument();
    expect(screen.getByText('HTML')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Code' })).toBeInTheDocument();
  });

  it('copies code to clipboard and indicates copied status', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    const snippet = '<div>Interactive Canvas</div>';
    render(<SandboxedHtmlArtifact html={snippet} />);

    const copyBtn = screen.getByRole('button', { name: 'Copy Code' });
    fireEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith(snippet);
    await waitFor(() => {
      expect(screen.getByText('Copied')).toBeInTheDocument();
    });
  });
});
