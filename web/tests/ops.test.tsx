/**
 * Session 4 contract tests — the Ops & Review Studio.
 *
 * Covers telemetry normalizers (health, readiness, index snapshot, metrics,
 * reindex results), the review-queue normalizers and golden export, plus the
 * rendered behaviour of both panels and the segmented switcher.
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
    paths() {
      return calls.map((call) => call.path.split('?')[0] ?? call.path);
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
import IndexTelemetryPanel, {
  backendReachability,
  flattenMetrics,
  formatCount,
  formatDuration,
  formatMetricValue,
  metricHighlights,
  normalizeHealth,
  normalizeIndexStatus,
  normalizeReadiness,
  normalizeReindexResult,
  onlineCount,
  statusTone,
} from '../src/features/ops/IndexTelemetryPanel';
import OpsView from '../src/features/ops/OpsView';
import ReviewQueuePanel, {
  buildGoldenDownload,
  canonicalStatus,
  confidenceTone,
  countByStatus,
  downloadJsonFile,
  humanizeFieldName,
  normalizeConfidence,
  normalizeGoldenCases,
  normalizeReviewItems,
} from '../src/features/ops/ReviewQueuePanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const INDEX_STATUS = {
  vector: {
    collections: ['meridian_chunks', 'meridian_entities'],
    points_per_collection: { meridian_chunks: 1000, meridian_entities: 420 },
    total_points: 1420,
    vector_dimension: 1536,
    is_fallback: false,
    detail: 'Qdrant · HNSW',
  },
  graph: {
    node_count: 420,
    relationship_count: 1302,
    entity_index_size: 420,
    is_fallback: true,
    detail: 'in-memory fallback',
  },
  lexical: { corpus_size: 1000, document_count: 3, is_fallback: false, detail: 'BM25 · okapi' },
  relational: {
    dialect: 'postgresql',
    tables: [
      { name: 'documents', row_count: 3 },
      { name: 'chunks', row_count: 1000 },
    ],
    total_rows: 1003,
    is_fallback: false,
    detail: 'Postgres · 2 tables',
  },
  backends: {
    vector: { reachable: true, is_fallback: false, endpoint: 'qdrant:6333', detail: 'ok' },
    graph: {
      reachable: true,
      is_fallback: true,
      endpoint: 'neo4j:7687',
      detail: 'fallback: in-memory',
    },
    lexical: { reachable: true, is_fallback: false, endpoint: 'in-process', detail: 'ok' },
    relational: { reachable: true, is_fallback: false, endpoint: 'postgres:5432', detail: 'ok' },
  },
};

const METRICS = {
  uptime_seconds: 184_320,
  queries_total: 12_480,
  retrieval_p50_ms: 214,
  cache_hit_rate: 0.42,
  tokens: { prompt_total: 841_220, completion_total: 62_110 },
  review: { pending: 6 },
};

const REVIEW_ITEMS = [
  {
    id: 'rev_001',
    extracted_field_id: 'ef_1',
    document_id: 'doc_master_services',
    field_name: 'remediation_window_days',
    value: '30 days',
    confidence: 0.88,
    provenance_page: 12,
    status: 'pending',
    corrected_value: null,
    notes: null,
  },
  {
    id: 'rev_002',
    extracted_field_id: 'ef_2',
    document_id: 'doc_incident_policy',
    field_name: 'incident_commander_sla_minutes',
    value: '15 minutes',
    confidence: 0.54,
    provenance_page: 4,
    status: 'pending',
    corrected_value: null,
    notes: null,
  },
  {
    id: 'rev_003',
    extracted_field_id: 'ef_3',
    document_id: 'doc_incident_policy',
    field_name: 'sev1_response_minutes',
    value: '10',
    confidence: 0.72,
    provenance_page: 5,
    status: 'rejected',
    corrected_value: null,
    notes: 'Conflated two SLAs.',
  },
  {
    id: 'rev_004',
    extracted_field_id: 'ef_4',
    document_id: 'doc_security_addendum',
    field_name: 'encryption_standard',
    value: 'AES-128',
    confidence: 0.66,
    provenance_page: 3,
    status: 'corrected',
    corrected_value: 'AES-256-GCM',
    notes: 'Addendum mandates 256-bit.',
  },
  {
    id: 'rev_005',
    extracted_field_id: 'ef_5',
    document_id: 'doc_master_services',
    field_name: 'governing_law',
    value: 'State of Delaware',
    confidence: 0.96,
    provenance_page: 62,
    status: 'approved',
    corrected_value: null,
    notes: null,
  },
];

const GOLDEN = [
  {
    id: 'gc_001',
    category: 'obligation',
    question: 'What is the remediation window for a Sev-1 incident?',
    answerable: true,
    expected_doc: 'doc_master_services',
    expected_phrases: ['30 days', 'written notice'],
    notes: 'Core citation case.',
  },
];

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

async function waitFor(predicate: () => boolean, label = 'condition', timeout = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    let satisfied = false;
    await act(async () => {
      await tick(20);
      satisfied = predicate();
    });
    if (satisfied) return;
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function mount(node: ReactNode) {
  act(() => {
    root.render(node);
  });
}

function buttons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('button'));
}

function labelOf(button: HTMLButtonElement): string {
  return (button.getAttribute('aria-label') ?? button.textContent ?? '').trim().toLowerCase();
}

function findButton(label: string): HTMLButtonElement {
  const needle = label.toLowerCase();
  const match = buttons().find((button) => labelOf(button).includes(needle));
  if (!match) {
    throw new Error(`No button matching “${label}”. Saw: ${buttons().map(labelOf).join(' | ')}`);
  }
  return match;
}

function findButtons(label: string): HTMLButtonElement[] {
  const needle = label.toLowerCase();
  return buttons().filter((button) => labelOf(button).includes(needle));
}

function buttonIn(root: ParentNode, label: string): HTMLButtonElement {
  const needle = label.toLowerCase();
  const match = Array.from(root.querySelectorAll('button')).find((button) =>
    labelOf(button).includes(needle),
  );
  if (!match) throw new Error(`No button matching “${label}” inside the card`);
  return match;
}

function cardFor(text: string): HTMLElement {
  const card = Array.from(document.querySelectorAll('li')).find((entry) =>
    entry.textContent?.includes(text),
  );
  if (!card) throw new Error(`No card containing “${text}”`);
  return card as HTMLElement;
}

async function click(target: Element | null | undefined) {
  if (!target) throw new Error('Cannot click a missing element');
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick(0);
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

type Route = (path: string, init?: RequestInit) => unknown;

function defaultRoutes(overrides: Record<string, Route> = {}): Route {
  return (path, init) => {
    const clean = path.split('?')[0] ?? path;
    const override = overrides[clean];
    if (override) return override(path, init);

    const method = init?.method ?? 'GET';
    if (clean === '/health') return { status: 'ok', version: '0.9.4', detail: 'all good' };
    if (clean === '/health/ready') {
      return { status: 'ready', ready: true, checks: { vector: true, graph: true } };
    }
    if (clean === '/v1/index/status') return INDEX_STATUS;
    if (clean === '/v1/metrics') return METRICS;
    if (clean === '/v1/reindex' && method === 'POST') {
      return {
        status: 'ok',
        duration_ms: 1840,
        rebuilt: { vector: { ok: true }, graph: { ok: true }, lexical: { ok: true } },
      };
    }
    if (clean === '/v1/review/items' && method === 'GET') return REVIEW_ITEMS;
    if (clean === '/v1/review/golden-export') return GOLDEN;
    if (clean.startsWith('/v1/review/items/') && clean.endsWith('/action')) return undefined;
    return {};
  };
}

beforeEach(() => {
  harness.reset();
  harness.handle(defaultRoutes());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Telemetry helpers                                                          */
/* -------------------------------------------------------------------------- */

describe('telemetry normalizers', () => {
  it('formats counts, durations and status words', () => {
    expect(formatCount(1420)).toBe((1420).toLocaleString());
    expect(formatCount(null)).toBe('—');
    expect(formatDuration(820)).toBe('820 ms');
    expect(formatDuration(2400)).toBe('2.4 s');
    expect(formatDuration(null)).toBe('—');

    expect(statusTone('ok')).toBe('ok');
    expect(statusTone('ready')).toBe('ok');
    expect(statusTone('degraded')).toBe('warn');
    expect(statusTone('not ready')).toBe('fail');
    expect(statusTone('offline')).toBe('fail');
    expect(statusTone('')).toBe('neutral');
  });

  it('normalizes health and readiness payloads', () => {
    const health = normalizeHealth({ status: 'ok', version: '0.9.4', detail: 'fine' }, 41);
    expect(health).toMatchObject({ status: 'ok', tone: 'ok', version: '0.9.4', latencyMs: 41 });
    expect(health.ready).toBeNull();

    const ready = normalizeReadiness({
      status: 'ready',
      checks: { vector: true, graph: false },
    });
    expect(ready.ready).toBe(false);
    expect(ready.tone).toBe('warn');
    expect(ready.checks).toEqual([
      { name: 'vector', ok: true },
      { name: 'graph', ok: false },
    ]);

    expect(normalizeReadiness({ ready: true }).ready).toBe(true);
    expect(normalizeReadiness({ status: 'degraded' }).tone).toBe('warn');
    expect(normalizeHealth(null).status).toBe('unknown');
  });

  it('fills an index snapshot from a partial payload', () => {
    const status = normalizeIndexStatus(INDEX_STATUS);
    expect(status?.vector.total_points).toBe(1420);
    expect(status?.relational.total_rows).toBe(1003);
    expect(status?.graph.is_fallback).toBe(true);

    const partial = normalizeIndexStatus({ vector: { total_points: '900', dimension: 768 } });
    expect(partial?.vector.total_points).toBe(900);
    expect(partial?.vector.vector_dimension).toBe(768);
    expect(partial?.lexical.corpus_size).toBeNull();
    expect(partial?.relational.total_rows).toBe(0);
    expect(normalizeIndexStatus('nope')).toBeNull();
  });

  it('deriving a missing relational total from the table list', () => {
    const status = normalizeIndexStatus({
      relational: { tables: [{ name: 'a', row_count: 4 }, { name: 'b', rows: '6' }] },
    });
    expect(status?.relational.total_rows).toBe(10);
    expect(status?.relational.tables).toHaveLength(2);
  });

  it('resolves reachability to Online / Fallback / Offline', () => {
    const status = normalizeIndexStatus(INDEX_STATUS);
    expect(status).not.toBeNull();
    if (!status) return;

    expect(backendReachability(status, 'vector')).toEqual({ label: 'Online', tone: 'ok' });
    expect(backendReachability(status, 'graph')).toEqual({ label: 'Fallback', tone: 'warn' });
    expect(backendReachability(null, 'vector')).toEqual({ label: 'Unknown', tone: 'neutral' });

    const offline = normalizeIndexStatus({
      ...INDEX_STATUS,
      backends: {
        ...INDEX_STATUS.backends,
        vector: { reachable: false, is_fallback: false, endpoint: 'qdrant:6333', detail: 'down' },
      },
    });
    expect(offline && backendReachability(offline, 'vector')).toEqual({
      label: 'Offline',
      tone: 'fail',
    });
    expect(onlineCount(offline)).toEqual({ online: 2, fallback: 1, offline: 1 });
    expect(onlineCount(status)).toEqual({ online: 3, fallback: 1, offline: 0 });
  });

  it('flattens metrics and highlights counters/timings', () => {
    const leaves = flattenMetrics(METRICS);
    const paths = leaves.map((leaf) => leaf.path);
    expect(paths).toContain('uptime_seconds');
    expect(paths).toContain('tokens.prompt_total');
    expect(paths).toContain('review.pending');

    const highlights = metricHighlights(leaves, 3);
    expect(highlights).toHaveLength(3);
    expect(highlights.every((leaf) => typeof leaf.value === 'number')).toBe(true);

    expect(formatMetricValue(12_480)).toBe((12_480).toLocaleString());
    expect(formatMetricValue(0.42)).toBe('0.42');
    expect(formatMetricValue(true)).toBe('true');
    expect(formatMetricValue(null)).toBe('—');

    // Depth guard: deep payloads collapse into a marker instead of exploding.
    const deep = flattenMetrics({ a: { b: { c: { d: { e: { f: 1 } } } } } });
    expect(deep.some((leaf) => String(leaf.value).startsWith('{'))).toBe(true);
  });

  it('normalizes rebuild results and their per-store detail', () => {
    const ok = normalizeReindexResult(
      {
        status: 'ok',
        duration_ms: 1840,
        rebuilt: { vector: { ok: true }, graph: { ok: true }, lexical: { ok: false } },
      },
      999,
    );
    expect(ok.durationMs).toBe(1840);
    expect(ok.stores).toEqual([
      { name: 'vector', ok: true },
      { name: 'graph', ok: true },
      { name: 'lexical', ok: false },
    ]);
    expect(ok.ok).toBe(false);

    const bare = normalizeReindexResult({ message: 'rebuilt' }, 1234);
    expect(bare.ok).toBe(true);
    expect(bare.durationMs).toBe(1234);
    expect(bare.message).toBe('rebuilt');
  });
});

/* -------------------------------------------------------------------------- */
/* Review helpers                                                             */
/* -------------------------------------------------------------------------- */

describe('review normalizers', () => {
  it('accepts bare arrays and envelopes, dropping junk rows', () => {
    expect(normalizeReviewItems(REVIEW_ITEMS)).toHaveLength(5);
    expect(normalizeReviewItems({ items: REVIEW_ITEMS.slice(0, 2) })).toHaveLength(2);
    expect(normalizeReviewItems({ data: [REVIEW_ITEMS[0]] })).toHaveLength(1);
    expect(normalizeReviewItems([{ field_name: 'no id' }, null, 3])).toEqual([]);
    expect(normalizeReviewItems(null)).toEqual([]);
  });

  it('canonicalises status words and confidence scales', () => {
    expect(canonicalStatus('Approved')).toBe('approved');
    expect(canonicalStatus('accepted')).toBe('approved');
    expect(canonicalStatus('edited')).toBe('corrected');
    expect(canonicalStatus('declined')).toBe('rejected');
    expect(canonicalStatus('who knows')).toBe('pending');

    expect(normalizeConfidence(0.42)).toBeCloseTo(0.42);
    expect(normalizeConfidence(88)).toBeCloseTo(0.88);
    expect(normalizeConfidence(4)).toBeCloseTo(0.04);
    expect(normalizeConfidence(400)).toBe(1);
    expect(normalizeConfidence(-2)).toBe(0);

    expect(confidenceTone(0.4)).toBe('fail');
    expect(confidenceTone(0.7)).toBe('warn');
    expect(confidenceTone(0.95)).toBe('ok');

    expect(countByStatus(normalizeReviewItems(REVIEW_ITEMS))).toEqual({
      pending: 2,
      approved: 1,
      rejected: 1,
      corrected: 1,
    });
  });

  it('builds a dated golden JSON download', () => {
    const cases = normalizeGoldenCases(GOLDEN);
    expect(cases[0]).toMatchObject({ id: 'gc_001', answerable: true, expected_doc: 'doc_master_services' });
    expect(normalizeGoldenCases({ cases: GOLDEN })).toHaveLength(1);
    expect(normalizeGoldenCases({ cases: [{ question: 'q' }] })[0]?.expected_phrases).toEqual([]);

    const { filename, json } = buildGoldenDownload(cases, new Date('2026-11-14T07:00:00Z'));
    expect(filename).toBe('meridian-golden-cases-2026-11-14.json');
    expect(JSON.parse(json)).toEqual(cases);
  });

  it('humanises raw field ids into readable labels', () => {
    expect(humanizeFieldName('field_name')).toBe('Field name');
    expect(humanizeFieldName('remediation_window_days')).toBe('Remediation window days');
    expect(humanizeFieldName('liability_cap_USD')).toBe('Liability cap USD');
    expect(humanizeFieldName('unknown_field')).toBe('Unknown field');
  });

  it('downloads JSON through an anchor with the right filename', () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });

    const clicked: Array<{ download: string; href: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download, href: this.href });
    });

    const ok = downloadJsonFile('golden.json', '{"a":1}');
    expect(ok).toBe(true);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual([{ download: 'golden.json', href: 'blob:mock-url' }]);
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Server rendering                                                           */
/* -------------------------------------------------------------------------- */

describe('ops static rendering', () => {
  it('renders both panels and the switcher server-side', () => {
    const telemetry = renderToStaticMarkup(<IndexTelemetryPanel />);
    expect(telemetry).toContain('Index stores');
    expect(telemetry).toContain('Rebuild index');
    expect(telemetry).toContain('Raw metrics');

    const review = renderToStaticMarkup(<ReviewQueuePanel />);
    expect(review).toContain('Review queue');
    expect(review).toContain('Download Golden JSON');

    const view = renderToStaticMarkup(<OpsView />);
    expect(view).toContain('Operations');
    expect(view).toContain('System &amp; Index');
    expect(view).toContain('Review Queue');
    expect(view).toContain('role="tablist"');
  });
});

/* -------------------------------------------------------------------------- */
/* Index telemetry panel                                                      */
/* -------------------------------------------------------------------------- */

describe('IndexTelemetryPanel', () => {
  it('renders health, four store cards, reachability and the fallback warning', async () => {
    mount(<IndexTelemetryPanel />);
    await waitFor(() => document.body.textContent?.includes('1,420') === true, 'index cards');

    const text = document.body.textContent ?? '';
    expect(text).toContain('3/4');
    expect(text).toContain('online');
    expect(text).toContain('1 fallback');
    expect(text).toContain('Qdrant');
    expect(text).toContain('Neo4j');
    expect(text).toContain('BM25');
    expect(text).toContain('postgresql');
    expect(text).toContain('fallback store');
    expect(text).toContain('relationships');
    expect(text).toContain('checked');

    // Health strip reached both probes.
    expect(harness.paths()).toContain('/health');
    expect(harness.paths()).toContain('/health/ready');
    expect(harness.paths()).toContain('/v1/index/status');
    expect(harness.paths()).toContain('/v1/metrics');
  });

  it('refreshes every probe on demand', async () => {
    mount(<IndexTelemetryPanel />);
    await waitFor(() => document.body.textContent?.includes('Qdrant') === true, 'first load');

    const before = harness.paths().filter((path) => path === '/v1/index/status').length;
    await click(findButton('Refresh'));
    await flush(4);

    const after = harness.paths().filter((path) => path === '/v1/index/status').length;
    expect(after).toBeGreaterThan(before);
  });

  it('expands the raw metrics panel with highlights and the payload tree', async () => {
    mount(<IndexTelemetryPanel />);
    await waitFor(
      () => document.body.textContent?.includes('metrics reported') === true,
      'metrics loaded',
    );

    const toggle = document.querySelector('button[aria-controls="ops-metrics-body"]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');

    await click(toggle);
    await flush(2);

    expect(document.querySelector('button[aria-controls="ops-metrics-body"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.textContent).toContain('uptime_seconds');
    expect(document.body.textContent).toContain('tokens.prompt_total');
    expect(document.body.textContent).toContain('Copy JSON');

  });

  it('runs a rebuild with live progress and a per-store result', async () => {
    harness.handle(
      defaultRoutes({
        '/v1/reindex': () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  status: 'ok',
                  duration_ms: 1640,
                  rebuilt: { vector: { ok: true }, graph: { ok: true }, lexical: { ok: true } },
                }),
              60,
            );
          }),
      }),
    );

    mount(<IndexTelemetryPanel />);
    await waitFor(() => document.body.textContent?.includes('Qdrant') === true, 'first load');

    await click(findButton('Rebuild index'));
    expect(findButton('Rebuilding')).toBeTruthy();
    expect(findButton('Rebuilding').disabled).toBe(true);

    console.log('DEBUG calls:', harness.calls.map((c) => `${c.path}:${c.init?.method ?? 'GET'}`).join(', '));
    await waitFor(() => document.body.textContent?.includes('Rebuilt vector') === true, 'rebuild result');
    const text = document.body.textContent ?? '';
    expect(text).toContain('Rebuilt vector · graph · lexical');
    expect(text).toContain('1.6 s');
    expect(text).toContain('vector');
    expect(findButton('Rebuild index').disabled).toBe(false);

    const call = harness.calls.find((entry) => entry.path === '/v1/reindex');
    expect(call?.init?.method).toBe('POST');
  });

  it('surfaces a rebuild failure without losing the panel', async () => {
    harness.handle(
      defaultRoutes({
        '/v1/reindex': () => {
          throw new ApiError('reindex lock held', 409, 'another rebuild is running');
        },
      }),
    );

    mount(<IndexTelemetryPanel />);
    await waitFor(() => document.body.textContent?.includes('Qdrant') === true, 'first load');

    await click(findButton('Rebuild index'));
    await waitFor(
      () => document.body.textContent?.includes('another rebuild is running') === true,
      'rebuild error',
    );
    expect(document.body.textContent).toContain('Qdrant');
  });

  it('shows a retry banner when the index snapshot is unavailable', async () => {
    let failing = true;
    harness.handle(
      defaultRoutes({
        '/v1/index/status': () => {
          if (failing) throw new ApiError('vector store offline', 503, 'vector store offline');
          return INDEX_STATUS;
        },
      }),
    );

    mount(<IndexTelemetryPanel />);
    await waitFor(
      () => document.body.textContent?.includes('vector store offline') === true,
      'index error banner',
    );

    failing = false;
    await click(findButton('Retry'));
    await waitFor(() => document.body.textContent?.includes('Qdrant') === true, 'recovered index');
  });
});

/* -------------------------------------------------------------------------- */
/* Review queue                                                               */
/* -------------------------------------------------------------------------- */

describe('ReviewQueuePanel', () => {
  it('defaults to pending and shows field, confidence and provenance', async () => {
    mount(<ReviewQueuePanel />);
    await waitFor(
      () => document.body.textContent?.includes('Remediation window days') === true,
      'queue items',
    );

    const text = document.body.textContent ?? '';
    expect(text).toContain('Incident commander sla minutes');
    expect(text).not.toContain('Encryption standard');
    expect(text).toContain('Page 12');
    expect(text).toContain('88%');
    expect(text).toContain('54%');

    const meter = document.querySelector('[role="meter"][aria-label="Extraction confidence"]');
    expect(meter?.getAttribute('aria-valuenow')).toBe('88');
  });

  it('filters by status, including reviewed items', async () => {
    mount(<ReviewQueuePanel />);
    await waitFor(() => document.body.textContent?.includes('Remediation window days') === true, 'queue');

    await click(findButtons('corrected')[0] ?? null);
    await flush(2);
    expect(document.body.textContent).toContain('Encryption standard');
    expect(document.body.textContent).toContain('AES-256-GCM');
    expect(document.body.textContent).not.toContain('Remediation window days');

    await click(findButtons('all')[0] ?? null);
    await flush(2);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Remediation window days');
    expect(text).toContain('Encryption standard');
    expect(text).toContain('Governing law');
  });

  it('approves an item with the documented payload', async () => {
    harness.handle(
      defaultRoutes({
        '/v1/review/items/rev_001/action': () => ({
          ...REVIEW_ITEMS[0],
          status: 'approved',
        }),
      }),
    );

    mount(<ReviewQueuePanel />);
    await waitFor(() => document.body.textContent?.includes('Remediation window days') === true, 'queue');

    await click(buttonIn(cardFor('Remediation window days'), 'Approve'));
    await waitFor(() => document.body.textContent?.includes('Approved') === true, 'approve notice');

    const call = harness.calls.find((entry) =>
      entry.path.startsWith('/v1/review/items/rev_001/action'),
    );
    expect(call?.init?.method).toBe('POST');
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      action: 'approve',
      corrected_value: null,
      notes: null,
    });
    expect(document.body.textContent).toContain('· doc_master_services');
  });

  it('rejects an item and keeps the reviewer note visible', async () => {
    harness.handle(
      defaultRoutes({
        '/v1/review/items/rev_002/action': () => ({ ...REVIEW_ITEMS[1], status: 'rejected' }),
      }),
    );

    mount(<ReviewQueuePanel />);
    await waitFor(
      () => document.body.textContent?.includes('Incident commander sla minutes') === true,
      'queue',
    );

    await click(buttonIn(cardFor('Incident commander sla minutes'), 'Reject'));
    await waitFor(() => document.body.textContent?.includes('Rejected') === true, 'reject notice');

    const call = harness.calls.find((entry) =>
      entry.path.startsWith('/v1/review/items/rev_002/action'),
    );
    expect(JSON.parse(String(call?.init?.body))).toMatchObject({ action: 'reject' });
  });

  it('expands the correct editor, validates, and saves a correction', async () => {
    harness.handle(
      defaultRoutes({
        '/v1/review/items/rev_001/action': () => ({
          ...REVIEW_ITEMS[0],
          status: 'corrected',
          corrected_value: '30 calendar days',
          notes: 'Counted from notice, not report.',
        }),
      }),
    );

    mount(<ReviewQueuePanel />);
    await waitFor(() => document.body.textContent?.includes('Remediation window days') === true, 'queue');

    const card = cardFor('Remediation window days');
    await click(buttonIn(card, 'Correct'));
    await flush(2);

    const editor = cardFor('Remediation window days');
    const textarea = editor.querySelector('textarea[aria-label="Corrected value"]');
    expect(textarea).not.toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe('30 days');

    // Emptying the field blocks the save.
    await typeInto(textarea, '   ');
    expect(buttonIn(cardFor('Remediation window days'), 'Save correction').disabled).toBe(true);

    await typeInto(textarea, '30 calendar days');
    await typeInto(editor.querySelector('input[aria-label="Review notes"]'), 'Counted from notice, not report.');
    await click(buttonIn(cardFor('Remediation window days'), 'Save correction'));

    // The corrected item leaves the pending filter — the flash confirms the save.
    await waitFor(
      () => document.body.textContent?.includes('Corrected “Remediation window days”') === true,
      'correction flash',
    );

    const call = harness.calls.find((entry) =>
      entry.path.startsWith('/v1/review/items/rev_001/action'),
    );
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      action: 'correct',
      corrected_value: '30 calendar days',
      notes: 'Counted from notice, not report.',
    });

    // Reopen the item under the corrected filter: the value and note persist.
    await click(findButtons('corrected')[0] ?? null);
    await flush(2);
    const correctedCard = cardFor('Remediation window days');
    expect(correctedCard.textContent).toContain('30 calendar days');
    expect(correctedCard.textContent).toContain('Counted from notice, not report.');
    expect(correctedCard.textContent).toContain('corrected value');
    await flush(3);
  });

  it('keeps reviewer notes with the item they were typed on', async () => {
    harness.handle(
      defaultRoutes({
        '/v1/review/items/rev_001/action': () => ({ ...REVIEW_ITEMS[0], status: 'approved' }),
        '/v1/review/items/rev_002/action': () => ({ ...REVIEW_ITEMS[1], status: 'approved' }),
      }),
    );

    mount(<ReviewQueuePanel />);
    await waitFor(
      () => document.body.textContent?.includes('Remediation window days') === true,
      'queue',
    );

    // Type notes on the first card only.
    await click(buttonIn(cardFor('Remediation window days'), 'Correct'));
    await flush(2);
    await typeInto(
      cardFor('Remediation window days').querySelector('input[aria-label="Review notes"]'),
      'Only mine',
    );

    // Approve the other card: it must not carry the first card's notes.
    await click(buttonIn(cardFor('Incident commander sla minutes'), 'Approve'));
    await waitFor(() => document.body.textContent?.includes('Approved') === true, 'approve notice');

    const secondCall = harness.calls.find((entry) =>
      entry.path.startsWith('/v1/review/items/rev_002/action'),
    );
    expect(JSON.parse(String(secondCall?.init?.body))).toEqual({
      action: 'approve',
      corrected_value: null,
      notes: null,
    });
  });

  it('downloads the golden set and confirms it inline', async () => {
    const createObjectURL = vi.fn(() => 'blob:golden');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    mount(<ReviewQueuePanel />);
    await waitFor(() => document.body.textContent?.includes('Download Golden JSON') === true, 'panel');

    await click(findButton('Download Golden JSON'));
    await waitFor(
      () => document.body.textContent?.includes('Exported 1 golden case') === true,
      'export notice',
    );

    expect(harness.paths()).toContain('/v1/review/golden-export');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('.json');
  });

  it('reports an empty queue instead of an empty panel', async () => {
    harness.handle(defaultRoutes({ '/v1/review/items': () => [] }));

    mount(<ReviewQueuePanel />);
    await waitFor(
      () => document.body.textContent?.includes('Review queue is clear') === true,
      'empty state',
    );
  });

  it('surfaces a queue failure with a retry', async () => {
    let failing = true;
    harness.handle(
      defaultRoutes({
        '/v1/review/items': () => {
          if (failing) throw new ApiError('queue unavailable', 500, 'queue unavailable');
          return REVIEW_ITEMS;
        },
      }),
    );

    mount(<ReviewQueuePanel />);
    await waitFor(
      () => document.body.textContent?.includes('queue unavailable') === true,
      'queue error',
    );

    failing = false;
    await click(findButton('Retry'));
    await waitFor(() => document.body.textContent?.includes('Remediation window days') === true, 'retry');
  });
});

/* -------------------------------------------------------------------------- */
/* Ops view                                                                   */
/* -------------------------------------------------------------------------- */

describe('OpsView', () => {
  it('opens on System & Index and badges the review tab with queue depth', async () => {
    mount(<OpsView />);
    await waitFor(() => document.body.textContent?.includes('awaiting review') === true, 'pending badge');

    expect(document.body.textContent).toContain('2 awaiting review');
    expect(document.body.textContent).toContain('Index stores');

    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('false');
    expect(document.querySelector('[role="tabpanel"]')?.id).toBe('ops-panel-system');
  });

  it('switches to the review queue and back', async () => {
    mount(<OpsView />);
    await waitFor(() => document.body.textContent?.includes('Index stores') === true, 'system panel');

    await click(document.querySelector('#ops-tab-review'));
    await waitFor(
      () => document.body.textContent?.includes('Remediation window days') === true,
      'review panel',
    );
    expect(document.querySelector('[role="tabpanel"]')?.id).toBe('ops-panel-review');
    expect(document.querySelector('#ops-tab-review')?.getAttribute('aria-selected')).toBe('true');
    expect(document.body.textContent).not.toContain('Index stores');

    await click(document.querySelector('#ops-tab-system'));
    await waitFor(() => document.body.textContent?.includes('Index stores') === true, 'back to system');
  });

  it('moves between tabs with the arrow keys', async () => {
    mount(<OpsView />);
    await waitFor(() => document.body.textContent?.includes('Index stores') === true, 'system panel');

    const tablist = document.querySelector('[role="tablist"]');
    await act(async () => {
      tablist?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await tick(0);
    });

    await waitFor(
      () => document.body.textContent?.includes('Remediation window days') === true,
      'review panel via keyboard',
    );
    expect(document.querySelector('#ops-tab-review')?.getAttribute('aria-selected')).toBe('true');
  });
});
