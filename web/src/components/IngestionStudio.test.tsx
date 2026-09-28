import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IngestionStudio, isBinaryLike } from './IngestionStudio';
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

  it('switches to Ingest New Document tab and submits text', async () => {    const user = userEvent.setup();
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

  it('G3: doc cards show relationships_count footer', async () => {
    vi.spyOn(api, 'getDocuments').mockResolvedValueOnce({
      total_documents: 1,
      total_chunks: 3,
      total_entities: 4,
      documents: [
        {
          id: 'doc-rel-1',
          title: 'Rel Doc',
          format: 'md',
          source: 'manual',
          created_at: '2026-08-18T10:00:00Z',
          char_count: 500,
          chunk_count: 3,
          entities_count: 4,
          relationships_count: 7,
          snippet: 'snippet',
        },
      ],
    });

    render(<IngestionStudio tenantId="default" />);

    expect(await screen.findByText('Rel Doc')).toBeInTheDocument();
    expect(screen.getByText('relationships')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('G2: file picker accepts text types only (no PDF/DOCX)', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getDocuments').mockResolvedValue({
      total_documents: 0,
      total_chunks: 0,
      total_entities: 0,
      documents: [],
    });

    render(<IngestionStudio tenantId="default" />);
    await user.click(screen.getByText('Ingest New Document'));

    const fileInput = screen.getByLabelText('Upload document file') as HTMLInputElement;
    expect(fileInput.accept).not.toContain('.pdf');
    expect(fileInput.accept).not.toContain('.docx');
    expect(fileInput.accept).toContain('.md');
    expect(screen.getByText(/binary PDF\/DOCX are not supported/i)).toBeInTheDocument();
  });

  it('G2: binary file content triggers a client-side warning', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getDocuments').mockResolvedValue({
      total_documents: 0,
      total_chunks: 0,
      total_entities: 0,
      documents: [],
    });

    render(<IngestionStudio tenantId="default" />);
    await user.click(screen.getByText('Ingest New Document'));

    const fileInput = screen.getByLabelText('Upload document file') as HTMLInputElement;
    const binaryFile = new File(['PK\0\x03\x04binary-content'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [binaryFile] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/looks like a binary file/i);
  });

  it('G2: %PDF signature without NUL still warns as binary', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getDocuments').mockResolvedValue({
      total_documents: 0,
      total_chunks: 0,
      total_entities: 0,
      documents: [],
    });

    render(<IngestionStudio tenantId="default" />);
    await user.click(screen.getByText('Ingest New Document'));

    const fileInput = screen.getByLabelText('Upload document file') as HTMLInputElement;
    const pdfText = new File(['%PDF-1.4 fake binary garble \x01\x02\x03\x04 obj stream'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [pdfText] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/looks like a binary file/i);
  });

  it('G2: isBinaryLike flags signatures/garble but passes plain text', () => {
    expect(isBinaryLike('%PDF-1.4 binary content')).toBe(true);
    expect(isBinaryLike('PK\x03\x04 zip content')).toBe(true);
    expect(isBinaryLike('# Hello\nPlain markdown text.')).toBe(false);
  });

  it('G3: success card shows filename and created_at from the backend', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getDocuments').mockResolvedValue({
      total_documents: 0,
      total_chunks: 0,
      total_entities: 0,
      documents: [],
    });
    vi.spyOn(api, 'ingest').mockResolvedValueOnce({
      document_id: 'doc-new-9',
      title: 'New Policy',
      filename: 'policy.md',
      chunks_indexed: 2,
      entities_extracted: 3,
      relationships_extracted: 1,
      created_at: '2026-09-01T10:00:00Z',
    });

    render(<IngestionStudio tenantId="default" />);
    await user.click(screen.getByText('Ingest New Document'));
    await user.type(screen.getByPlaceholderText('e.g. Enterprise Security Policy 2026'), 'New Policy');
    await user.type(screen.getByPlaceholderText(/Paste or write structured documentation/), '# Body');
    await user.click(screen.getByText('Index & Store Permanently'));

    // handleIngest switches back to the catalog tab — reopen upload to see the card
    await waitFor(() => {
      expect(api.ingest).toHaveBeenCalled();
    });
    await user.click(screen.getByText('Ingest New Document'));

    expect(await screen.findByText('policy.md')).toBeInTheDocument();
    expect(screen.getByText(/Created:/)).toBeInTheDocument();
  });
});
