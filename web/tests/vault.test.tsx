/**
 * Session 3 contract tests — the Knowledge Vault.
 *
 * Covers the wire normalizers, both ingestion paths (multipart upload and raw
 * text), the catalog's search / filter / destructive flows behind their modals,
 * and the paginated chunk inspector.
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* -------------------------------------------------------------------------- */
/* apiFetch harness                                                           */
/* -------------------------------------------------------------------------- */

const harness = vi.hoisted(() => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  let handler: (path: string, init?: RequestInit) => unknown = () => undefined;

  return {
    calls,
    handle(next: (path: string, init?: RequestInit) => unknown) {
      handler = next;
    },
    reset() {
      calls.length = 0;
      handler = () => undefined;
    },
    run(path: string, init?: RequestInit) {
      calls.push({ path, init });
      return handler(path, init);
    },
    last() {
      return calls[calls.length - 1];
    },
  };
});

vi.mock('../src/core/api', async () => {
  const actual = await vi.importActual<typeof import('../src/core/api')>('../src/core/api');
  return {
    ...actual,
    apiFetch: (path: string, init?: RequestInit) => {
      try {
        return Promise.resolve(harness.run(path, init));
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
});

import { ApiError } from '../src/core/api';
import { AuthProvider } from '../src/core/auth';
import ChunkDrawer, { normalizeChunkPage } from '../src/features/vault/ChunkDrawer';
import UploadZone, {
  derivePasteTitle,
  formatBytes,
} from '../src/features/vault/UploadZone';
import VaultView, { normalizeDocuments, normalizeFormat } from '../src/features/vault/VaultView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const DOCS = [
  {
    id: 'doc_a',
    title: 'Master Services Agreement',
    format: 'pdf',
    source: 's3://corpus/msa.pdf',
    chunk_count: 12,
    created_at: '2026-09-02T10:14:00.000Z',
  },
  {
    id: 'doc_b',
    title: 'Incident Response Policy',
    format: 'docx',
    source: 'confluence://runbooks/irp',
    chunk_count: 4,
    created_at: '2026-09-18T07:40:00.000Z',
  },
  {
    id: 'doc_c',
    title: 'Chunking Strategy Notes',
    format: 'md',
    source: 'manual://eng/chunking',
    chunk_count: 2,
  },
];

const SECTIONS = ['1 · Scope', '2 · Obligations', '3 · Service levels'];

function makeChunks(offset: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const position = offset + index;
    return {
      id: `doc_a_c${position}`,
      document_id: 'doc_a',
      text: `Chunk body ${position}`,
      chunk_index: position,
      section_heading: SECTIONS[Math.floor(position / 4) % SECTIONS.length],
      metadata: { page: 1 + Math.floor(position / 3) },
    };
  });
}

const CHUNK_PAGE = {
  document_id: 'doc_a',
  title: 'Master Services Agreement',
  total_chunks: 12,
  limit: 50,
  offset: 0,
  chunks: makeChunks(0, 12),
};

/* -------------------------------------------------------------------------- */
/* DOM harness                                                                */
/* -------------------------------------------------------------------------- */

let container: HTMLDivElement;
let root: Root;

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function flush(rounds = 3) {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await tick(0);
    });
  }
}

async function waitFor(predicate: () => boolean, label = 'condition', timeout = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return;
    await act(async () => {
      await tick(25);
    });
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function mount(node: ReactNode) {
  act(() => {
    root.render(<AuthProvider>{node}</AuthProvider>);
  });
}

function buttons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('button'));
}

function findButton(label: string): HTMLButtonElement {
  const needle = label.toLowerCase();
  const match = buttons().find((button) => {
    const text = (button.getAttribute('aria-label') ?? button.textContent ?? '').trim().toLowerCase();
    return text.includes(needle);
  });
  if (!match) throw new Error(`No button matching “${label}”. Saw: ${buttons().map((b) => b.textContent).join(' | ')}`);
  return match;
}

function findButtons(label: string): HTMLButtonElement[] {
  const needle = label.toLowerCase();
  return buttons().filter((button) => {
    const text = (button.getAttribute('aria-label') ?? button.textContent ?? '').trim().toLowerCase();
    return text.includes(needle);
  });
}

async function click(target: Element | null | undefined) {
  if (!target) throw new Error('Cannot click a missing element');
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick(0);
  });
}

async function typeInto(target: Element | null, value: string) {
  if (!target) throw new Error('Cannot type into a missing element');
  const element = target as HTMLInputElement | HTMLTextAreaElement;
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(0);
  });
}

function dropFiles(target: Element | null, files: File[]) {
  if (!target) throw new Error('Cannot drop onto a missing element');
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files, items: files, types: ['Files'], dropEffect: 'copy' },
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

function installClipboard() {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

beforeEach(() => {
  harness.reset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  harness.handle((path, init) => {
    const method = init?.method ?? 'GET';
    if (path === '/v1/documents' && method === 'GET') return { documents: DOCS };
    if (path === '/v1/documents/seed-samples' && method === 'POST') {
      return { seeded: 5, documents: [] };
    }
    if (path === '/v1/documents' && method === 'POST') return { id: 'doc_upload' };
    if (path === '/v1/documents' && method === 'DELETE') return { deleted: 3 };
    if (path === '/v1/ingest' && method === 'POST') return { id: 'doc_paste' };
    if (path.includes('/chunks')) return CHUNK_PAGE;
    if (method === 'DELETE') return { deleted: 1 };
    return {};
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

describe('vault normalizers', () => {
  it('accepts both the envelope and the bare-array catalog shape', () => {
    expect(normalizeDocuments({ documents: DOCS })).toHaveLength(3);
    expect(normalizeDocuments(DOCS)).toHaveLength(3);
    expect(normalizeDocuments({ items: [DOCS[0]] })).toHaveLength(1);
    expect(normalizeDocuments({ results: [DOCS[1]] })[0]?.title).toBe('Incident Response Policy');
    expect(normalizeDocuments(null)).toEqual([]);
  });

  it('fills defaults and drops entries without a document id', () => {
    const [doc] = normalizeDocuments([
      { document_id: 'doc_x', filename: 'scan.pdf', file_type: 'PDF', uri: 's3://x' },
      { title: 'no id here' },
      'nonsense',
    ]);

    expect(doc).toMatchObject({
      id: 'doc_x',
      title: 'scan.pdf',
      format: 'PDF',
      source: 's3://x',
      metadata: {},
    });
    expect(normalizeDocuments([{ title: 'no id here' }])).toEqual([]);
  });

  it('normalizes formats to short badges', () => {
    expect(normalizeFormat('PDF')).toBe('pdf');
    expect(normalizeFormat('.markdown')).toBe('md');
    expect(normalizeFormat('text/plain')).toBe('txt');
    expect(normalizeFormat('application/msword')).toBe('docx');
    expect(normalizeFormat(undefined)).toBe('doc');
  });

  it('parses a chunk page with totals, and falls back to the page length', () => {
    const page = normalizeChunkPage(CHUNK_PAGE, 'doc_a');
    expect(page.total).toBe(12);
    expect(page.title).toBe('Master Services Agreement');
    expect(page.chunks[0]?.chunk_index).toBe(0);
    expect(page.chunks[0]?.section_heading).toBe('1 · Scope');

    const bare = normalizeChunkPage([{ chunk_id: 'c1', content: 'hello', index: 7 }], 'doc_z');
    expect(bare.documentId).toBe('doc_z');
    expect(bare.total).toBe(1);
    expect(bare.chunks[0]).toMatchObject({
      id: 'c1',
      document_id: 'doc_z',
      text: 'hello',
      chunk_index: 7,
      section_heading: null,
    });

    expect(normalizeChunkPage(undefined, 'doc_q').chunks).toEqual([]);
  });

  it('formats byte sizes and derives a paste title', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(derivePasteTitle('\n\n# Vendor Addendum\nbody')).toBe('Vendor Addendum');
    expect(derivePasteTitle('   ')).toBe('Untitled paste');
  });
});

/* -------------------------------------------------------------------------- */
/* Server rendering                                                           */
/* -------------------------------------------------------------------------- */

describe('vault static rendering', () => {
  it('renders the ingestion studio without touching the DOM', () => {
    const html = renderToStaticMarkup(<UploadZone onIngested={() => undefined} />);
    expect(html).toContain('Ingestion studio');
    expect(html).toContain('Drop files here');
    expect(html).toContain('Paste raw text');
  });

  it('renders nothing while the chunk drawer is closed', () => {
    const html = renderToStaticMarkup(
      <ChunkDrawer open={false} documentId={null} onClose={() => undefined} />,
    );
    expect(html).toBe('');
  });
});

/* -------------------------------------------------------------------------- */
/* Upload zone                                                                */
/* -------------------------------------------------------------------------- */

describe('UploadZone', () => {
  it('uploads dropped files as multipart form data', async () => {
    const onIngested = vi.fn();
    mount(<UploadZone onIngested={onIngested} />);

    const zone = document.querySelector('[aria-label="Drop files here or open the file browser"]');
    expect(zone).not.toBeNull();

    dropFiles(zone, [new File(['# hello'], 'policy.md', { type: 'text/markdown' })]);
    await flush();

    const call = harness.calls.find(
      (entry) => entry.path === '/v1/documents' && entry.init?.method === 'POST',
    );
    expect(call).toBeDefined();
    const body = call?.init?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBeInstanceOf(File);
    expect(((body as FormData).get('file') as File).name).toBe('policy.md');

    expect(onIngested).toHaveBeenCalledWith(1);
    expect(document.body.textContent).toContain('policy.md');
    expect(document.body.textContent).toContain('1/1 ingested');
  });

  it('rejects unsupported extensions before hitting the API', async () => {
    const onIngested = vi.fn();
    const onError = vi.fn();
    mount(<UploadZone onIngested={onIngested} onError={onError} />);

    dropFiles(document.querySelector('[aria-label="Drop files here or open the file browser"]'), [
      new File(['MZ'], 'tool.exe'),
    ]);
    await flush();

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Unsupported file type'));
    expect(onIngested).not.toHaveBeenCalled();
    expect(harness.calls).toHaveLength(0);
  });

  it('ingests pasted text with the chunking controls', async () => {
    const onIngested = vi.fn();
    mount(<UploadZone onIngested={onIngested} />);

    await click(findButton('Paste raw text'));
    await waitFor(() => document.querySelector('textarea') !== null, 'the paste editor');

    const textarea = document.querySelector('textarea');
    await typeInto(textarea, 'Sev-1 remediation is capped at thirty days.');

    const titleInput = document.querySelector('input[placeholder="Q3 Vendor Addendum"]');
    await typeInto(titleInput, 'Remediation Notes');

    await click(findButton('Ingest text'));
    await flush();

    const call = harness.calls.find((entry) => entry.path === '/v1/ingest');
    expect(call?.init?.method).toBe('POST');
    const payload = JSON.parse(String(call?.init?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      text: 'Sev-1 remediation is capped at thirty days.',
      title: 'Remediation Notes',
      format: 'txt',
      chunk_size: 800,
      chunk_overlap: 120,
    });
    expect(payload.source).toBe('manual://paste');
    expect(onIngested).toHaveBeenCalledWith(1);
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('surfaces ingest failures without claiming success', async () => {
    harness.handle(() => {
      throw new ApiError('ingest exploded', 500);
    });

    const onIngested = vi.fn();
    mount(<UploadZone onIngested={onIngested} />);

    await click(findButton('Paste raw text'));
    await waitFor(() => document.querySelector('textarea') !== null, 'the paste editor');
    await typeInto(document.querySelector('textarea'), 'some text');
    await click(findButton('Ingest text'));
    await flush();

    expect(onIngested).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('ingest exploded');
  });
});

/* -------------------------------------------------------------------------- */
/* Catalog                                                                    */
/* -------------------------------------------------------------------------- */

describe('VaultView catalog', () => {
  it('lists documents with format badges and corpus totals', async () => {
    mount(<VaultView />);
    await flush();

    const text = document.body.textContent ?? '';
    expect(text).toContain('Master Services Agreement');
    expect(text).toContain('Incident Response Policy');
    expect(text).toContain('Chunking Strategy Notes');
    expect(text).toContain('12 chunks');
    expect(text).toContain('4 chunks');
    expect(text).toContain('2 chunks');
    expect(harness.calls[0]?.path).toBe('/v1/documents');
  });

  it('filters by free text and by format chip', async () => {
    mount(<VaultView />);
    await flush();

    await typeInto(document.querySelector('input[aria-label="Search documents"]'), 'incident');
    await flush(1);
    expect(document.body.textContent).toContain('Incident Response Policy');
    expect(document.body.textContent).not.toContain('Chunking Strategy Notes');

    await click(document.querySelector('input[aria-label="Search documents"] + button'));
    await flush(1);
    await click(findButtons('pdf')[0] ?? null);
    await flush(1);

    expect(document.body.textContent).toContain('Master Services Agreement');
    expect(document.body.textContent).not.toContain('Incident Response Policy');
  });

  it('deletes a single document only after confirmation', async () => {
    mount(<VaultView />);
    await flush();

    await click(findButton('Delete Master Services Agreement'));
    await flush(1);

    const dialog = document.querySelector('[role="dialog"][aria-label="Delete this document?"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('cannot be undone');
    expect(harness.calls.some((call) => call.init?.method === 'DELETE')).toBe(false);

    await click(findButton('Delete document'));
    await flush();

    const call = harness.calls.find((entry) => entry.init?.method === 'DELETE');
    expect(call?.path).toBe('/v1/documents/doc_a');
    expect(document.body.textContent).toContain('Deleted “Master Services Agreement”');
  });

  it('requires typing DELETE before clearing the whole vault', async () => {
    mount(<VaultView />);
    await flush();

    await click(findButton('Clear all'));
    await flush(1);

    const dialog = document.querySelector('[role="dialog"][aria-label="Clear the entire vault?"]');
    expect(dialog).not.toBeNull();

    const confirm = findButton('Clear vault');
    expect(confirm.disabled).toBe(true);

    await typeInto(dialog?.querySelector('input') ?? null, 'delete');
    await flush(1);
    expect(findButton('Clear vault').disabled).toBe(false);

    await click(findButton('Clear vault'));
    await flush();

    const call = harness.calls.find(
      (entry) => entry.path === '/v1/documents' && entry.init?.method === 'DELETE',
    );
    expect(call).toBeDefined();
    expect(document.body.textContent).toContain('Vault cleared');
  });

  it('offers the sample corpus when the vault is empty', async () => {
    harness.handle((path, init) => {
      if (path === '/v1/documents' && (init?.method ?? 'GET') === 'GET') return { documents: [] };
      if (path === '/v1/documents/seed-samples') return { seeded: 5, documents: [] };
      return {};
    });

    mount(<VaultView />);
    await flush();

    expect(document.body.textContent).toContain('Your vault is empty');

    const seeds = findButtons('Seed sample corpus');
    expect(seeds.length).toBeGreaterThanOrEqual(2);
    await click(seeds[seeds.length - 1] ?? null);
    await flush();

    const call = harness.calls.find((entry) => entry.path === '/v1/documents/seed-samples');
    expect(call?.init?.method).toBe('POST');
    expect(document.body.textContent).toContain('Seeded 5 sample documents');
  });

  it('seeds from the header action when documents already exist', async () => {
    mount(<VaultView />);
    await flush();

    await click(findButton('Seed sample corpus'));
    await flush();

    expect(
      harness.calls.some(
        (call) => call.path === '/v1/documents/seed-samples' && call.init?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('shows a retryable banner when the catalog cannot load', async () => {
    let failing = true;
    harness.handle((path, init) => {
      if (path === '/v1/documents' && (init?.method ?? 'GET') === 'GET') {
        if (failing) throw new ApiError('vector store offline', 503, 'backend unreachable');
        return { documents: DOCS };
      }
      return {};
    });

    mount(<VaultView />);
    await flush();

    expect(document.body.textContent).toContain('backend unreachable');
    expect(findButton('Retry')).toBeTruthy();

    failing = false;
    await click(findButton('Retry'));
    await flush();

    expect(document.body.textContent).toContain('Master Services Agreement');
  });

  it('opens the chunk inspector from a document card', async () => {
    mount(<VaultView />);
    await flush();

    await click(findButtons('Inspect')[0] ?? null);
    await flush();

    const dialog = document.querySelector('[role="dialog"][aria-label="Chunk inspector"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('Master Services Agreement');
    expect(dialog?.textContent).toContain('12 chunks');
    expect(dialog?.textContent).toContain('Chunk body 0');
    expect(harness.calls.some((call) => call.path.endsWith('/chunks?limit=50&offset=0'))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Chunk drawer                                                               */
/* -------------------------------------------------------------------------- */

describe('ChunkDrawer', () => {
  it('pages through chunks and disables the first back-step', async () => {
    harness.handle((path) => {
      const url = new URL(path, 'http://localhost');
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return {
        document_id: 'doc_a',
        title: 'Master Services Agreement',
        total_chunks: 120,
        limit,
        offset,
        chunks: makeChunks(offset, Math.min(limit, 120 - offset)),
      };
    });

    mount(<ChunkDrawer open documentId="doc_a" documentTitle="MSA" onClose={() => undefined} />);
    await flush();

    const back = document.querySelector('[aria-label="Previous page of chunks"]');
    expect((back as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toContain('#0');
    expect(document.body.textContent).toContain('1–50 of 120');

    await click(document.querySelector('[aria-label="Next page of chunks"]'));
    await flush();

    expect(harness.last()?.path).toContain('offset=50');
    expect(document.body.textContent).toContain('#50');
    expect(document.body.textContent).toContain('51–100 of 120');
    expect(document.body.textContent).toContain('2 / 3');
  });

  it('copies a chunk to the clipboard', async () => {
    const writeText = installClipboard();
    mount(<ChunkDrawer open documentId="doc_a" onClose={() => undefined} />);
    await flush();

    await click(findButton('Copy chunk text'));
    await flush(1);

    expect(writeText).toHaveBeenCalledWith('Chunk body 0');
    expect(document.querySelector('[aria-label="Copied chunk text"]')).not.toBeNull();
  });

  it('reports an empty index instead of a blank panel', async () => {
    harness.handle(() => ({
      document_id: 'doc_a',
      title: 'Empty doc',
      total_chunks: 0,
      limit: 50,
      offset: 0,
      chunks: [],
    }));

    mount(<ChunkDrawer open documentId="doc_a" onClose={() => undefined} />);
    await flush();

    expect(document.body.textContent).toContain('No chunks indexed');
  });
});
