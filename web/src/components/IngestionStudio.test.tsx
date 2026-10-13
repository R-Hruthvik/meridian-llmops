import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IngestionStudio } from './IngestionStudio';
import { api } from '../services/api';

describe('IngestionStudio Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Document Catalog tab with document rows and a readout strip', async () => {
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
    expect(screen.getByText('Documents')).toBeInTheDocument();
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1); // chunks count in strip and row
  });

  // §4/§9 — the four "KNOWLEDGE BASE DOCUMENTS / 8 / Persisted Permanently"
  // cards collapse into one hairline-separated strip of label + mono value.
  it('reads the corpus counts as a dense readout strip, not stat cards', async () => {
    vi.spyOn(api, 'getDocuments').mockResolvedValue({
      total_documents: 8,
      total_chunks: 21,
      total_entities: 14,
      documents: [],
    });

    render(<IngestionStudio tenantId="default" />);

    const strip = await screen.findByTestId('corpus-readout-strip');
    const cells = strip.querySelectorAll('[data-slot="readout"]');
    expect(cells).toHaveLength(3);

    const readout = (label: string) =>
      within(strip).getByText(label).closest('[data-slot="readout"]') as HTMLElement;

    expect(readout('Documents')).toHaveTextContent('8');
    expect(readout('Chunks')).toHaveTextContent('21');
    expect(readout('Entities')).toHaveTextContent('14');
    // §9 — every count is monospace tabular.
    for (const cell of Array.from(cells)) {
      expect(cell.querySelector('.num')).not.toBeNull();
      expect(cell.querySelector('.label-section')).not.toBeNull();
    }
    // The retired card chrome must not come back.
    expect(document.querySelectorAll('.shadow-card')).toHaveLength(0);
  });

  // §8/§9 — the catalog grid of rounded cards becomes a ranked table.
  it('renders the document catalog as a ranked table of hairline rows', async () => {
    vi.spyOn(api, 'getDocuments').mockResolvedValueOnce({
      total_documents: 2,
      total_chunks: 5,
      total_entities: 6,
      documents: [
        {
          id: 'doc-a',
          title: 'Alpha Doc',
          format: 'md',
          source: 'manual',
          created_at: '2026-08-18T10:00:00Z',
          char_count: 500,
          chunk_count: 2,
          entities_count: 3,
          relationships_count: 7,
          snippet: 'alpha snippet',
        },
        {
          id: 'doc-b',
          title: 'Beta Doc',
          format: 'pdf',
          source: 'seed',
          created_at: '2026-08-19T10:00:00Z',
          char_count: 800,
          chunk_count: 3,
          entities_count: 3,
          relationships_count: 1,
          snippet: 'beta snippet',
        },
      ],
    });

    render(<IngestionStudio tenantId="default" />);

    const table = await screen.findByRole('table');
    for (const header of ['#', 'TITLE', 'CHUNKS', 'ENTS', 'RELS', 'SOURCE', 'FORMAT', 'ADDED']) {
      expect(within(table).getByRole('columnheader', { name: header })).toBeInTheDocument();
    }

    // Rows are table rows, not cards.
    const alpha = within(table).getByText('Alpha Doc').closest('tr') as HTMLElement;
    expect(alpha).not.toBeNull();
    expect(within(alpha).getByText('md')).toBeInTheDocument();
    expect(within(alpha).getByText('manual')).toBeInTheDocument();
    // Every count in the row is mono.
    for (const value of ['2', '3', '7']) {
      expect(within(alpha).getByText(value)).toHaveClass('num');
    }
    expect(within(table).getByText('pdf')).toBeInTheDocument();
  });

  it('Inspect Chunks still opens the chunk inspector from a catalog row', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getDocuments').mockResolvedValue({
      total_documents: 1,
      total_chunks: 1,
      total_entities: 0,
      documents: [
        {
          id: 'doc-inspect-1',
          title: 'Inspectable Doc',
          format: 'md',
          source: 'manual',
          created_at: '2026-08-18T10:00:00Z',
          char_count: 500,
          chunk_count: 1,
          entities_count: 0,
          relationships_count: 0,
          snippet: 'snippet',
        },
      ],
    });
    vi.spyOn(api, 'getDocument').mockResolvedValue({
      id: 'doc-inspect-1',
      title: 'Inspectable Doc',
      format: 'md',
      source: 'manual',
      created_at: '2026-08-18T10:00:00Z',
      char_count: 500,
      chunk_count: 1,
      entities_count: 0,
      relationships_count: 0,
      snippet: 'snippet',
      text: 'body',
      chunks: [{ id: 'chunk-1', chunk_index: 0, section_heading: 'S', text: 'body text' }],
    });

    render(<IngestionStudio tenantId="default" />);

    const user_ = await screen.findByRole('button', { name: /inspect chunks/i });
    await user.click(user_);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(api.getDocument).toHaveBeenCalledWith('doc-inspect-1', 'default');
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

  it('G3: catalog rows show the relationships_count in mono', async () => {
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

    const row = (await screen.findByText('Rel Doc')).closest('tr') as HTMLElement;
    expect(row).not.toBeNull();
    expect(within(row).getByText('7')).toHaveClass('num');
  });

  it('G2: file picker supports multiple Markdown, text, PDF, DOCX, and HTML files', async () => {
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
    expect(fileInput.multiple).toBe(true);
    expect(fileInput.accept).toContain('.pdf');
    expect(fileInput.accept).toContain('.docx');
    expect(fileInput.accept).toContain('.md');
    expect(fileInput.accept).toContain('.txt');
    expect(fileInput.accept).toContain('.html');
    expect(screen.getByText(/Markdown, Text, PDF, DOCX, and HTML/i)).toBeInTheDocument();
  });

  it('uploads selected files and renders each backend result with pages, chunks, warnings, and duplicate status', async () => {
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
    const indexedFile = new File(['%PDF-1.4 bytes'], 'manual.pdf', { type: 'application/pdf' });
    const duplicateFile = new File(['same'], 'copy.md', { type: 'text/markdown' });
    const rejectedFile = new File(['bad'], 'broken.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    vi.spyOn(api, 'uploadDocuments').mockResolvedValueOnce({
      results: [
        { filename: 'manual.pdf', status: 'indexed_with_warnings', document_id: 'doc-pdf', format: 'pdf', pages: 4, chunks: 2, warnings: ['1 page has no extractable text'], duplicate_of: null },
        { filename: 'copy.md', status: 'duplicate', document_id: 'doc-original', format: null, pages: 0, chunks: 0, warnings: [], duplicate_of: 'doc-original' },
        { filename: 'broken.docx', status: 'rejected', document_id: null, format: null, pages: 0, chunks: 0, warnings: [], duplicate_of: null, error: 'Unsupported file type' },
      ],
    });
    fireEvent.change(fileInput, { target: { files: [indexedFile, duplicateFile, rejectedFile] } });
    await user.click(screen.getByText('Upload & Index Files'));

    expect(await screen.findByText('manual.pdf')).toBeInTheDocument();
    expect(screen.getByText('indexed_with_warnings')).toBeInTheDocument();
    expect(screen.getByText(/4 pages/)).toBeInTheDocument();
    expect(screen.getByText(/2 chunks/)).toBeInTheDocument();
    expect(screen.getByText('1 page has no extractable text')).toBeInTheDocument();
    expect(screen.getByText(/Duplicate of doc-original/)).toBeInTheDocument();
    expect(screen.getByText('Unsupported file type')).toBeInTheDocument();
    expect(await screen.findByText('Processed 3 files; 1 indexed.')).toBeInTheDocument();
    expect(api.uploadDocuments).toHaveBeenCalledWith([indexedFile, duplicateFile, rejectedFile], 'default');
  });

  it('uploads files dropped onto the file picker', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getDocuments').mockResolvedValue({
      total_documents: 0,
      total_chunks: 0,
      total_entities: 0,
      documents: [],
    });
    vi.spyOn(api, 'uploadDocuments').mockResolvedValueOnce({ results: [] });

    render(<IngestionStudio tenantId="default" />);
    await user.click(screen.getByText('Ingest New Document'));
    const file = new File(['# notes'], 'notes.md', { type: 'text/markdown' });
    const fileDrop = screen.getByLabelText('Upload document file').parentElement as HTMLElement;
    fireEvent.drop(fileDrop, { dataTransfer: { files: [file] } });
    await user.click(screen.getByText('Upload & Index Files'));

    await waitFor(() => expect(api.uploadDocuments).toHaveBeenCalledWith([file], 'default'));
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
    const focusedDoc = document.querySelector('[data-focused-document="doc-arch-1"]');
    expect(focusedDoc).toBeInTheDocument();
    // The marker lives on a catalog table row, not a card.
    expect(focusedDoc?.tagName).toBe('TR');
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
