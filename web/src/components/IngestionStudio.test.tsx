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

// The shared-workbench context passes the citing document/chunk down from the
// Ask spine. These props are the seam between the two areas.
describe('IngestionStudio focused source (citation drill-through)', () => {
  const DOC = {
    id: 'doc-arch-1',
    title: 'Meridian Architecture Overview',
    format: 'md',
    source: 'manual',
    created_at: '2026-08-18T10:00:00Z',
    char_count: 500,
    chunk_count: 2,
    entities_count: 4,
    relationships_count: 2,
    snippet: 'Enterprise LLMOps platform combining self-healing Agentic RAG',
  };

  const DETAIL = {
    ...DOC,
    text: 'Architecture overview text',
    chunks: [
      { id: 'chunk-a', chunk_index: 0, section_heading: 'Overview', text: 'First chunk body' },
      { id: 'chunk-b', chunk_index: 1, section_heading: 'Storage', text: 'Second chunk body' },
    ],
  };

  const withOneDoc = () => {
    vi.spyOn(api, 'getDocuments').mockResolvedValue({
      total_documents: 1,
      total_chunks: 2,
      total_entities: 4,
      documents: [DOC],
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the focused document and highlights the focused chunk', async () => {
    withOneDoc();
    vi.spyOn(api, 'getDocument').mockResolvedValue(DETAIL);

    render(
      <IngestionStudio tenantId="default" focusedDocumentId="doc-arch-1" focusedChunkId="chunk-b" />
    );

    expect(await screen.findByText(/Document Chunk Inspector: Meridian Architecture Overview/)).toBeInTheDocument();
    expect(api.getDocument).toHaveBeenCalledWith('doc-arch-1', 'default');
    expect(document.querySelector('[data-focused-document="doc-arch-1"]')).toBeInTheDocument();
    expect(document.querySelector('[data-focused-chunk="chunk-b"]')).toBeInTheDocument();
    expect(document.querySelector('[data-focused-chunk="chunk-a"]')).toBeNull();
  });

  it('clears any active search filter so the focused document is not hidden', async () => {
    withOneDoc();
    vi.spyOn(api, 'getDocument').mockResolvedValue(DETAIL);

    const { rerender } = render(<IngestionStudio tenantId="default" />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Search documents catalog'), 'zzz-no-match');
    expect(screen.getByText('No matching documents found')).toBeInTheDocument();

    rerender(<IngestionStudio tenantId="default" focusedDocumentId="doc-arch-1" focusedChunkId="chunk-b" />);

    await waitFor(() => {
      expect(document.querySelector('[data-focused-document="doc-arch-1"]')).toBeInTheDocument();
    });
    expect(screen.queryByText('No matching documents found')).toBeNull();
  });

  it('reports back when the user dismisses the focus', async () => {
    withOneDoc();
    vi.spyOn(api, 'getDocument').mockResolvedValue(DETAIL);
    const onDismissFocus = vi.fn();

    render(
      <IngestionStudio
        tenantId="default"
        focusedDocumentId="doc-arch-1"
        focusedChunkId="chunk-b"
        onDismissFocus={onDismissFocus}
      />
    );

    await userEvent.setup().click(await screen.findByRole('button', { name: /Dismiss source focus/i }));

    expect(onDismissFocus).toHaveBeenCalledTimes(1);
  });

  it('shows no focus affordance when nothing is focused', async () => {
    withOneDoc();
    render(<IngestionStudio tenantId="default" />);

    expect(await screen.findByText('Meridian Architecture Overview')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dismiss source focus/i })).toBeNull();
    expect(document.querySelector('[data-focused-document]')).toBeNull();
  });

  it('closing the inspector (X) consumes the citation focus', async () => {
    withOneDoc();
    vi.spyOn(api, 'getDocument').mockResolvedValue(DETAIL);
    const onDismissFocus = vi.fn();

    render(
      <IngestionStudio
        tenantId="default"
        focusedDocumentId="doc-arch-1"
        focusedChunkId="chunk-b"
        onDismissFocus={onDismissFocus}
      />
    );

    await userEvent.setup().click(
      await screen.findByRole('button', { name: /Close Chunk Inspector/i })
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onDismissFocus).toHaveBeenCalledTimes(1);
  });

  it('closing the inspector (Close Inspector button) consumes the citation focus', async () => {
    withOneDoc();
    vi.spyOn(api, 'getDocument').mockResolvedValue(DETAIL);
    const onDismissFocus = vi.fn();

    render(
      <IngestionStudio
        tenantId="default"
        focusedDocumentId="doc-arch-1"
        focusedChunkId="chunk-b"
        onDismissFocus={onDismissFocus}
      />
    );

    await userEvent.setup().click(
      await screen.findByRole('button', { name: /^Close Inspector$/i })
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onDismissFocus).toHaveBeenCalledTimes(1);
  });

  it('re-entering Corpus after closing the inspector does NOT re-open it', async () => {
    withOneDoc();
    vi.spyOn(api, 'getDocument').mockResolvedValue(DETAIL);

    // Harness mirroring App: focusedDocumentId lives ABOVE IngestionStudio and
    // is only cleared via onDismissFocus. Remounting the child simulates the B5
    // lazy-mount when the user leaves and re-enters Corpus.
    const Harness: React.FC<{ mounted: boolean }> = ({ mounted }) => {
      const [focused, setFocused] = React.useState<string | null>('doc-arch-1');
      if (!mounted) return null;
      return (
        <IngestionStudio
          tenantId="default"
          focusedDocumentId={focused}
          focusedChunkId="chunk-b"
          onDismissFocus={() => setFocused(null)}
        />
      );
    };

    const { rerender } = render(<Harness mounted />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: /^Close Inspector$/i }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // Leave Corpus, then come back.
    rerender(<Harness mounted={false} />);
    rerender(<Harness mounted />);

    await screen.findByText('Meridian Architecture Overview');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.getDocument).toHaveBeenCalledTimes(1);
  });

  it('surfaces an error when the focused document cannot be loaded', async () => {
    withOneDoc();
    vi.spyOn(api, 'getDocument').mockRejectedValue(new Error('Document not found'));

    render(<IngestionStudio tenantId="default" focusedDocumentId="doc-missing" focusedChunkId="chunk-x" />);

    expect(await screen.findByText(/Document not found/)).toBeInTheDocument();
    // The focus is still named, so the user can tell what failed, and no chunk
    // is falsely marked as the cited one.
    expect(screen.getByText('chunk-x')).toBeInTheDocument();
    expect(document.querySelector('[data-focused-chunk]')).toBeNull();
  });
});
