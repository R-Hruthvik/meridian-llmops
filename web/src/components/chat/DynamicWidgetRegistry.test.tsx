import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DynamicWidget } from './DynamicWidgetRegistry';

describe('DynamicWidgetRegistry', () => {
  describe('timings-waterfall', () => {
    it('renders latency breakdown bars from valid timings object', () => {
      const payload = JSON.stringify({
        timings: {
          dense_retrieval: 45,
          graph_traversal: 20,
          sparse_lexical: 15,
        },
      });

      render(<DynamicWidget name="timings-waterfall" content={payload} />);

      expect(screen.getByText('Latency Breakdown')).toBeInTheDocument();
      expect(screen.getByText('dense_retrieval')).toBeInTheDocument();
      expect(screen.getByText('45ms')).toBeInTheDocument();
      expect(screen.getByText('graph_traversal')).toBeInTheDocument();
      expect(screen.getByText('20ms')).toBeInTheDocument();
      expect(screen.getByText('80ms')).toBeInTheDocument(); // total 45 + 20 + 15
    });
  });

  describe('memory-health', () => {
    it('renders the three dual-memory engines ([VEC:CHROMA], [KG:SQLITE], [KV:REDIS]) and status', () => {
      const payload = JSON.stringify({
        engines: {
          chroma: 'operational',
          sqlite: 'operational',
          redis: 'degraded',
        },
      });

      render(<DynamicWidget name="memory-health" content={payload} />);

      expect(screen.getByText('Dual-Memory Health')).toBeInTheDocument();
      expect(screen.getByText('[VEC:CHROMA]')).toBeInTheDocument();
      expect(screen.getByText('[KG:SQLITE]')).toBeInTheDocument();
      expect(screen.getByText('[KV:REDIS]')).toBeInTheDocument();
      expect(screen.getByText('DEGRADED')).toBeInTheDocument();
    });
  });

  describe('source-table', () => {
    it('renders tabular list of evidence chunks with title, score, and snippet', () => {
      const payload = JSON.stringify({
        sources: [
          {
            title: 'Whitepaper Sec 4',
            score: 0.94,
            snippet: 'Vector search utilizes dense embeddings for semantic retrieval.',
          },
          {
            title: 'Architecture Doc',
            score: 0.81,
            snippet: 'SQLite graph stores multi-hop entity relationships.',
          },
        ],
      });

      render(<DynamicWidget name="source-table" content={payload} />);

      expect(screen.getByText('Evidence Sources')).toBeInTheDocument();
      expect(screen.getByText('Whitepaper Sec 4')).toBeInTheDocument();
      expect(screen.getByText('94%')).toBeInTheDocument();
      expect(
        screen.getByText('Vector search utilizes dense embeddings for semantic retrieval.'),
      ).toBeInTheDocument();
      expect(screen.getByText('Architecture Doc')).toBeInTheDocument();
      expect(screen.getByText('81%')).toBeInTheDocument();
    });
  });

  describe('streaming & invalid JSON fallback', () => {
    it('renders sleek loading skeleton when JSON is incomplete during streaming', () => {
      const brokenPayload = '{"timings": {"dense_retrieval": 45';

      render(<DynamicWidget name="timings-waterfall" content={brokenPayload} />);

      const skeleton = screen.getByTestId('widget-skeleton');
      expect(skeleton).toBeInTheDocument();
      expect(skeleton).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByText(/Loading timings-waterfall/i)).toBeInTheDocument();
    });

    it('renders loading skeleton when content is empty during stream initiation', () => {
      render(<DynamicWidget name="source-table" content="" />);

      expect(screen.getByTestId('widget-skeleton')).toBeInTheDocument();
      expect(screen.getByText(/Loading source-table/i)).toBeInTheDocument();
    });
  });

  describe('unknown widget fallback', () => {
    it('falls back to formatted code block when widget type is unregistered', () => {
      const rawContent = '{"custom_metric": 1234}';

      const { container } = render(
        <DynamicWidget name="unknown-custom-widget" content={rawContent} />,
      );

      expect(screen.getByText(/Widget: unknown-custom-widget/i)).toBeInTheDocument();
      const code = container.querySelector('code');
      expect(code).toBeInTheDocument();
      expect(code?.textContent).toBe(rawContent);
    });
  });
});
