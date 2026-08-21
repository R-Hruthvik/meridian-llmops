import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IngestionStudio } from './IngestionStudio';
import { api } from '../services/api';

describe('IngestionStudio Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Document Catalog tab with document cards and statistics', async () => {
    vi.spyOn(api, 'getDocuments').mockResolvedValueOnce({
      total_documents: 1,
      total_chunks: 3,
      total_entities: 4,
      documents: [
        {
          id: 'doc-arch-1',
          title: 'Meridian Architecture Overview',
          format: 'md',
          source: 'manual',
          created_at: '2026-08-18T10:00:00Z',
          char_count: 500,
          chunk_count: 3,
          entities_count: 4,
          relationships_count: 2,
          snippet: 'Enterprise LLMOps platform combining self-healing Agentic RAG',
        },
      ],
    });

    render(<IngestionStudio tenantId="default" />);

    expect(await screen.findByText('Meridian Architecture Overview')).toBeInTheDocument();
    expect(screen.getByText('Knowledge Base Documents')).toBeInTheDocument();
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1); // chunks count in stat and doc card
  });

  it('switches to Ingest New Document tab and submits text', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getDocuments').mockResolvedValue({
      total_documents: 0,
      total_chunks: 0,
      total_entities: 0,
      documents: [],
    });
    vi.spyOn(api, 'ingest').mockResolvedValueOnce({
      document_id: 'doc-new-1',
      title: 'New Policy',
      chunks_indexed: 2,
      entities_extracted: 3,
      relationships_extracted: 1,
    });

    render(<IngestionStudio tenantId="default" />);

    const uploadTab = screen.getByText('Ingest New Document');
    await user.click(uploadTab);

    expect(screen.getByPlaceholderText('e.g. Enterprise Security Policy 2026')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('e.g. Enterprise Security Policy 2026'), 'Security Spec');
    await user.type(screen.getByPlaceholderText(/Paste or write structured documentation/), '# Security Policy\nDetails here.');

    const submitBtn = screen.getByText('Index & Store Permanently');
    await user.click(submitBtn);

    await waitFor(() => {
      expect(api.ingest).toHaveBeenCalledWith(
        { title: 'Security Spec', text: '# Security Policy\nDetails here.' },
        'default'
      );
    });
  });
});
