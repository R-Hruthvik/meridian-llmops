import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DesignPreviews } from './DesignPreviews';

const directions = ['Route Map', 'Evidence Journal', 'Signal Desk', 'Open Library', 'Flight Plan'];
const sharedSources = ['rag-survey-2024.pdf', 'meridian-chunking-notes.md', 'vector-search-notes.pdf'];

describe('design preview requirements', () => {
  it('uses the same source set in every design direction', () => {
    render(<DesignPreviews />);

    for (const direction of directions) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(direction) }));
      fireEvent.click(screen.getAllByRole('button', { name: 'Sources' })[0]);

      for (const source of sharedSources) {
        expect(screen.getAllByText(source).length).toBeGreaterThan(0);
      }
    }
  });
});
