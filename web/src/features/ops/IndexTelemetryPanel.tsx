/**
 * Meridian — System & Index telemetry.
 *
 * One panel, four signals:
 *   • `GET /health` + `GET /health/ready`  → liveness / readiness strip
 *   • `GET /v1/index/status`               → 4-store bento grid (vector, graph,
 *                                            lexical, relational) + reachability
 *   • `POST /v1/reindex`                   → rebuild with live elapsed + result
 *   • `GET /v1/metrics`                    → collapsible raw counters/timings
 *
 * Every payload is narrowed through a normalizer, so a partial or renamed
 * backend response degrades into "—" chips instead of a blank screen.
 */
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  Boxes,
  Check,
  ChevronDown,
  Copy,
  Database,
  Layers,
  Loader2,
  Network,
  RefreshCw,
  RotateCw,
  Search,
  Server,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';

import { StatusBadge, type StatusTone } from '../../components/shell/StatusBadge';
import { ApiError, apiFetch } from '../../core/api';
import { FADE_UP, SPRING_SNAPPY, STAGGER_CONTAINER, STAGGER_ITEM } from '../../core/motion';
import type { IndexStatusResponse } from '../../core/types';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return /^(true|1|yes|ok|ready|online|up)$/i.test(value.trim());
  return false;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.detailMessage ?? error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString();
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

/** Maps an arbitrary status word onto a badge tone. */
export function statusTone(value: string | null | undefined): StatusTone {
  const text = (value ?? '').trim().toLowerCase();
  if (!text) return 'neutral';
  if (/(fail|error|down|unhealthy|unavailable|not[-_ ]?ready|offline|critical|refus)/.test(text)) {
    return 'fail';
  }
  if (/(degrad|warn|start|partial|pending|throttl|stale|rebuild)/.test(text)) return 'warn';
  if (/(^|\b)(ok|ready|healthy|up|pass|online|green|alive)(\b|$)/.test(text)) return 'ok';
  return 'neutral';
}

/* -------------------------------------------------------------------------- */
/* Health                                                                     */
/* -------------------------------------------------------------------------- */

export interface HealthSnapshot {
  status: string;
  tone: StatusTone;
  /** `null` when the payload carries no readiness signal. */
  ready: boolean | null;
  version: string | null;
  detail: string | null;
  latencyMs: number | null;
  checks: Array<{ name: string; ok: boolean }>;
}

function normalizeChecks(raw: unknown): Array<{ name: string; ok: boolean }> {
  if (Array.isArray(raw)) {
    return raw.flatMap((entry): Array<{ name: string; ok: boolean }> => {
      if (typeof entry === 'string') return [{ name: entry, ok: true }];
      if (!isRecord(entry)) return [];
      const name = firstString(entry['name'], entry['component'], entry['check']);
      if (!name) return [];
      const ok = asBool(entry['ok'] ?? entry['ready'] ?? entry['reachable'] ?? entry['status']);
      return [{ name, ok }];
    });
  }
  if (isRecord(raw)) {
    return Object.entries(raw).flatMap(([name, value]): Array<{ name: string; ok: boolean }> => {
      if (isRecord(value)) {
        return [
          { name, ok: asBool(value['ok'] ?? value['ready'] ?? value['reachable'] ?? value['status']) },
        ];
      }
      return [{ name, ok: asBool(value) }];
    });
  }
  return [];
}

export function normalizeHealth(raw: unknown, latencyMs: number | null = null): HealthSnapshot {
  const record = isRecord(raw) ? raw : {};
  const status =
    firstString(record['status'], record['state'], record['health']) ??
    (asBool(record['healthy'] ?? record['ok']) ? 'ok' : 'unknown');

  return {
    status,
    tone: statusTone(status),
    ready: null,
    version: firstString(record['version'], record['api_version'], record['build']),
    detail: firstString(record['detail'], record['message'], record['description']),
    latencyMs,
    checks: normalizeChecks(record['checks'] ?? record['components'] ?? record['dependencies']),
  };
}

export function normalizeReadiness(raw: unknown, latencyMs: number | null = null): HealthSnapshot {
  const record = isRecord(raw) ? raw : {};
  const status =
    firstString(record['status'], record['state'], record['readiness']) ??
    (asBool(record['ready']) ? 'ready' : 'unknown');
  const explicit = typeof record['ready'] === 'boolean' ? record['ready'] : null;
  const checks = normalizeChecks(
    record['checks'] ?? record['components'] ?? record['dependencies'] ?? record['backends'],
  );
  const inferred = checks.length > 0 ? checks.every((check) => check.ok) : null;
  const ready = explicit ?? inferred ?? statusTone(status) === 'ok';

  return {
    status,
    tone: ready ? 'ok' : 'warn',
    ready,
    version: firstString(record['version']),
    detail: firstString(record['detail'], record['message']),
    latencyMs,
    checks,
  };
}

/* -------------------------------------------------------------------------- */
/* Index status                                                               */
/* -------------------------------------------------------------------------- */

export type BackendKey = 'vector' | 'graph' | 'lexical' | 'relational';

const BACKEND_KEYS: BackendKey[] = ['vector', 'graph', 'lexical', 'relational'];

export interface Reachability {
  label: 'Online' | 'Fallback' | 'Offline' | 'Unknown';
  tone: StatusTone;
}

function emptyIndexStatus(): IndexStatusResponse {
  return {
    vector: {
      collections: [],
      points_per_collection: {},
      total_points: null,
      vector_dimension: null,
      is_fallback: false,
      detail: '',
    },
    graph: {
      node_count: null,
      relationship_count: null,
      entity_index_size: null,
      is_fallback: false,
      detail: '',
    },
    lexical: { corpus_size: null, document_count: null, is_fallback: false, detail: '' },
    relational: { dialect: null, tables: [], total_rows: 0, is_fallback: false, detail: '' },
    backends: {},
  };
}

/** Fills gaps so the grid always has something to render. */
export function normalizeIndexStatus(raw: unknown): IndexStatusResponse | null {
  if (!isRecord(raw)) return null;
  const base = emptyIndexStatus();

  const vector = isRecord(raw['vector']) ? raw['vector'] : {};
  const graph = isRecord(raw['graph']) ? raw['graph'] : {};
  const lexical = isRecord(raw['lexical']) ? raw['lexical'] : {};
  const relational = isRecord(raw['relational']) ? raw['relational'] : {};

  const perCollection: Record<string, number> = {};
  const collectionSource = vector['points_per_collection'];
  if (isRecord(collectionSource)) {
    for (const [name, value] of Object.entries(collectionSource)) {
      perCollection[name] = asNumber(value) ?? 0;
    }
  }

  const collections = Array.isArray(vector['collections'])
    ? vector['collections'].filter((name): name is string => typeof name === 'string')
    : Object.keys(perCollection);

  const tables = Array.isArray(relational['tables'])
    ? relational['tables'].flatMap((table): Array<{ name: string; row_count: number }> => {
        if (!isRecord(table)) return [];
        const name = firstString(table['name'], table['table']);
        if (!name) return [];
        return [{ name, row_count: asNumber(table['row_count'] ?? table['rows']) ?? 0 }];
      })
    : [];

  const backends: IndexStatusResponse['backends'] = {};
  if (isRecord(raw['backends'])) {
    for (const [name, value] of Object.entries(raw['backends'])) {
      if (!isRecord(value)) continue;
      backends[name] = {
        reachable: asBool(value['reachable'] ?? value['online'] ?? value['ok']),
        is_fallback: asBool(value['is_fallback'] ?? value['fallback']),
        endpoint: asString(value['endpoint'], '—'),
        detail: asString(value['detail'], ''),
      };
    }
  }

  const totalRows =
    asNumber(relational['total_rows']) ?? tables.reduce((sum, table) => sum + table.row_count, 0);

  return {
    vector: {
      collections: collections.length > 0 ? collections : base.vector.collections,
      points_per_collection: perCollection,
      total_points: asNumber(vector['total_points']),
      vector_dimension: asNumber(vector['vector_dimension'] ?? vector['dimension']),
      is_fallback: asBool(vector['is_fallback']),
      detail: asString(vector['detail']),
    },
    graph: {
      node_count: asNumber(graph['node_count'] ?? graph['nodes']),
      relationship_count: asNumber(graph['relationship_count'] ?? graph['relationships']),
      entity_index_size: asNumber(graph['entity_index_size']),
      is_fallback: asBool(graph['is_fallback']),
      detail: asString(graph['detail']),
    },
    lexical: {
      corpus_size: asNumber(lexical['corpus_size'] ?? lexical['chunks']),
      document_count: asNumber(lexical['document_count'] ?? lexical['documents']),
      is_fallback: asBool(lexical['is_fallback']),
      detail: asString(lexical['detail']),
    },
    relational: {
      dialect: firstString(relational['dialect'], relational['engine']),
      tables,
      total_rows: totalRows,
      is_fallback: asBool(relational['is_fallback']),
      detail: asString(relational['detail']),
    },
    backends,
  };
}

/** Reachable + not a fallback → Online, reachable fallback → Fallback, else Offline. */
export function backendReachability(
  status: IndexStatusResponse | null,
  key: BackendKey,
): Reachability {
  if (!status) return { label: 'Unknown', tone: 'neutral' };

  const entry = status.backends[key];
  if (entry) {
    if (!entry.reachable) return { label: 'Offline', tone: 'fail' };
    if (entry.is_fallback) return { label: 'Fallback', tone: 'warn' };
    return { label: 'Online', tone: 'ok' };
  }

  return status[key].is_fallback ? { label: 'Fallback', tone: 'warn' } : { label: 'Online', tone: 'ok' };
}

export function onlineCount(status: IndexStatusResponse | null): { online: number; fallback: number; offline: number } {
  const tally = { online: 0, fallback: 0, offline: 0 };
  if (!status) return tally;
  for (const key of BACKEND_KEYS) {
    const reach = backendReachability(status, key);
    if (reach.label === 'Online') tally.online += 1;
    else if (reach.label === 'Fallback') tally.fallback += 1;
    else if (reach.label === 'Offline') tally.offline += 1;
  }
  return tally;
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                    */
/* -------------------------------------------------------------------------- */

export interface MetricLeaf {
  path: string;
  value: string | number | boolean | null;
}

const MAX_LEAVES = 60;

/** Depth-limited flattening so an arbitrarily deep payload stays readable. */
export function flattenMetrics(raw: unknown, prefix = '', depth = 0): MetricLeaf[] {
  const leaves: MetricLeaf[] = [];

  const walk = (value: unknown, path: string, level: number) => {
    if (leaves.length >= MAX_LEAVES) return;

    if (value === null || typeof value !== 'object') {
      leaves.push({
        path: path || 'value',
        value: value === undefined ? null : (value as string | number | boolean | null),
      });
      return;
    }

    if (level >= depth + 3) {
      leaves.push({ path, value: Array.isArray(value) ? `[${value.length}]` : '{…}' });
      return;
    }

    if (Array.isArray(value)) {
      value.slice(0, 12).forEach((entry, index) => walk(entry, `${path}[${index}]`, level + 1));
      return;
    }

    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      walk(child, path ? `${path}.${key}` : key, level + 1);
    }
  };

  walk(raw, prefix, depth);
  return leaves;
}

const HIGHLIGHT_PATTERN = /(latency|_ms|duration|p50|p95|p99|rate|total|count|uptime|queries|errors|requests)/i;

/** The handful of leaves most worth surfacing before the raw tree. */
export function metricHighlights(leaves: MetricLeaf[], limit = 6): MetricLeaf[] {
  const numeric = leaves.filter((leaf) => typeof leaf.value === 'number');
  const interesting = numeric.filter((leaf) => HIGHLIGHT_PATTERN.test(leaf.path));
  return (interesting.length >= 3 ? interesting : numeric).slice(0, limit);
}

export function formatMetricValue(value: MetricLeaf['value']): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString();
    return value < 10 ? value.toFixed(2) : value.toFixed(1);
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* Reindex                                                                    */
/* -------------------------------------------------------------------------- */

export interface RebuildResult {
  ok: boolean;
  message: string;
  durationMs: number | null;
  stores: Array<{ name: string; ok: boolean }>;
}

export function normalizeReindexResult(raw: unknown, elapsedMs: number): RebuildResult {
  const record = isRecord(raw) ? raw : {};
  const durationMs =
    asNumber(record['duration_ms'] ?? record['elapsed_ms'] ?? record['ms'] ?? record['took_ms']) ??
    elapsedMs;

  const nested = record['rebuilt'] ?? record['backends'] ?? record['results'] ?? record['stores'];
  const stores: Array<{ name: string; ok: boolean }> = [];

  if (isRecord(nested)) {
    for (const [name, value] of Object.entries(nested)) {
      stores.push({
        name,
        ok: isRecord(value) ? asBool(value['ok'] ?? value['success'] ?? value['status']) : asBool(value),
      });
    }
  } else if (Array.isArray(nested)) {
    for (const entry of nested) {
      if (typeof entry === 'string') stores.push({ name: entry, ok: true });
      else if (isRecord(entry)) {
        const name = firstString(entry['name'], entry['store'], entry['backend']);
        if (name) stores.push({ name, ok: asBool(entry['ok'] ?? entry['success'] ?? entry['status']) });
      }
    }
  }

  const failed = stores.filter((store) => !store.ok);
  const explicitOk =
    typeof record['ok'] === 'boolean'
      ? record['ok']
      : typeof record['success'] === 'boolean'
        ? record['success']
        : null;
  const ok = explicitOk ?? (statusTone(firstString(record['status'])) !== 'fail' && failed.length === 0);

  /* "ok"/"success" is a status echo, not a human message — prefer the store
     summary in that case. */
  const statusWord = firstString(record['status'], record['state']);
  const statusEcho =
    statusWord !== null && /^(ok|success|done|complete|completed|accepted)$/i.test(statusWord);
  const explicitMessage =
    firstString(record['message'], record['detail'], record['summary']) ??
    (statusEcho ? null : statusWord);
  const message = ok
    ? explicitMessage ?? `Rebuilt ${stores.map((store) => store.name).join(' · ') || 'all stores'}`
    : explicitMessage ?? `Rebuild failed${failed.length > 0 ? ` (${failed.map((store) => store.name).join(', ')})` : ''}`;

  return { ok, message, durationMs, stores };
}

/* -------------------------------------------------------------------------- */
/* Small pieces                                                               */
/* -------------------------------------------------------------------------- */

function HealthPill({
  icon: Icon,
  label,
  snapshot,
  error,
  pending,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  snapshot: HealthSnapshot | null;
  error: string | null;
  pending: boolean;
}) {
  const tone: StatusTone = error ? 'fail' : snapshot ? snapshot.tone : 'neutral';
  /* "unknown" is the normalizer's placeholder for "no status in the payload". */
  const status = snapshot?.status === 'unknown' ? 'not checked' : snapshot?.status;
  const text = error
    ? 'unreachable'
    : snapshot
      ? label === 'Readiness'
        ? `${snapshot.ready ? 'ready' : status}`
        : status
      : pending
        ? 'checking…'
        : 'not checked';

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-elevated/70 py-1 pl-1.5 pr-0.5"
      title={error ?? snapshot?.detail ?? snapshot?.latencyMs?.toString() ?? undefined}
    >
      <Icon className="h-3 w-3 text-ink-faint" strokeWidth={2.2} />
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
        {label}
      </span>
      <StatusBadge
        tone={tone}
        size="sm"
        label={text}
        pulse={tone === 'ok' && !error}
        className="border-transparent bg-transparent px-1"
      />
      {snapshot?.latencyMs !== null && snapshot?.latencyMs !== undefined ? (
        <span className="tabular pr-1 font-mono text-[9.5px] text-ink-faint">
          {formatDuration(snapshot.latencyMs)}
        </span>
      ) : null}
    </span>
  );
}

function StatRow({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: number | string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="truncate text-[10px] text-ink-muted">{label}</span>
      <span className={cx('shrink-0 text-[11px] font-medium text-ink', mono && 'tabular font-mono')}>
        {typeof value === 'number' ? formatCount(value) : value ?? '—'}
      </span>
    </div>
  );
}

interface BackendCardProps {
  title: string;
  store: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  reach: Reachability;
  isFallback: boolean;
  primaryLabel: string;
  primaryValue: number | null;
  stats: Array<{ label: string; value: number | string | null; mono?: boolean }>;
  breakdown: Array<{ label: string; value: number }>;
  detail: string;
}

function BackendCard({
  title,
  store,
  icon: Icon,
  reach,
  isFallback,
  primaryLabel,
  primaryValue,
  stats,
  breakdown,
  detail,
}: BackendCardProps) {
  return (
    <motion.article
      variants={STAGGER_ITEM}
      whileHover={{ y: -2 }}
      transition={SPRING_SNAPPY}
      className={cx(
        'group relative flex flex-col gap-2.5 overflow-hidden rounded-lg border bg-elevated/80 p-3.5 shadow-hairline backdrop-blur-xl transition-colors',
        reach.tone === 'fail'
          ? 'border-fail/30'
          : reach.tone === 'warn'
            ? 'border-warn/30'
            : 'border-hairline hover:border-accent/30',
      )}
    >
      {(reach.tone === 'fail' || reach.tone === 'warn') && (
        <span
          aria-hidden="true"
          className={cx(
            'pointer-events-none absolute inset-x-0 top-0 h-[2px]',
            reach.tone === 'fail' ? 'bg-fail/50' : 'bg-warn/60',
          )}
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-[7px] border border-hairline bg-subtle text-ink-muted transition-colors group-hover:text-accent">
          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <StatusBadge tone={reach.tone} size="sm" label={reach.label} />
      </div>

      <div className="min-w-0">
        <h3 className="truncate text-[13px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
        <p className="truncate font-mono text-[9.5px] text-ink-faint">{store}</p>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="tabular text-[24px] font-semibold leading-none tracking-[-0.03em] text-ink">
          {formatCount(primaryValue)}
        </span>
        <span className="text-[10px] text-ink-muted">{primaryLabel}</span>
      </div>

      {isFallback ? (
        <span className="inline-flex items-center gap-1 self-start rounded-[5px] border border-warn/30 bg-warn-soft px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-warn-ink">
          <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2.6} />
          fallback store
        </span>
      ) : null}

      <div className="mt-auto flex flex-col gap-1 border-t border-hairline pt-2">
        {stats.map((stat) => (
          <StatRow key={stat.label} label={stat.label} value={stat.value} mono={stat.mono ?? true} />
        ))}
      </div>

      {breakdown.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {breakdown.slice(0, 3).map((entry) => (
            <li key={entry.label} className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[9.5px] text-ink-faint">{entry.label}</span>
              <span className="tabular shrink-0 font-mono text-[9.5px] text-ink-muted">
                {formatCount(entry.value)}
              </span>
            </li>
          ))}
          {breakdown.length > 3 ? (
            <li className="font-mono text-[9.5px] text-ink-faint">+{breakdown.length - 3} more</li>
          ) : null}
        </ul>
      ) : null}

      {detail ? (
        <p className="truncate text-[9.5px] text-ink-faint" title={detail}>
          {detail}
        </p>
      ) : null}
    </motion.article>
  );
}

/* -------------------------------------------------------------------------- */
/* JSON viewer                                                                */
/* -------------------------------------------------------------------------- */

function JsonScalar({ value }: { value: MetricLeaf['value'] }) {
  if (value === null) return <span className="text-ink-faint">—</span>;
  if (typeof value === 'boolean') {
    return <span className="text-warn-ink">{value ? 'true' : 'false'}</span>;
  }
  if (typeof value === 'number') return <span className="text-accent">{value.toLocaleString()}</span>;
  return <span className="text-ok-ink">“{value}”</span>;
}

function JsonTree({ leaves }: { leaves: MetricLeaf[] }) {
  return (
    <div className="max-h-64 overflow-auto overscroll-contain rounded-[7px] border border-hairline bg-subtle/50 p-2">
      <dl className="flex flex-col gap-[3px] font-mono text-[10.5px] leading-relaxed">
        {leaves.map((leaf) => (
          <div key={leaf.path} className="flex items-start justify-between gap-3">
            <dt className="min-w-0 break-all text-ink-muted">{leaf.path}</dt>
            <dd className="shrink-0">
              <JsonScalar value={leaf.value} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

export interface IndexTelemetryPanelProps {
  className?: string;
  /** Fired after a rebuild so the host view can refresh sibling data. */
  onRebuilt?: (result: RebuildResult) => void;
}

type ReindexState =
  | { status: 'idle' }
  | { status: 'running'; startedAt: number }
  | { status: 'done'; result: RebuildResult }
  | { status: 'error'; message: string };

export function IndexTelemetryPanel({ className, onRebuilt }: IndexTelemetryPanelProps) {
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [readiness, setReadiness] = useState<HealthSnapshot | null>(null);
  const [index, setIndex] = useState<IndexStatusResponse | null>(null);
  const [metrics, setMetrics] = useState<MetricLeaf[] | null>(null);

  const [healthError, setHealthError] = useState<string | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const [reindex, setReindex] = useState<ReindexState>({ status: 'idle' });
  const [elapsed, setElapsed] = useState(0);

  const [metricsOpen, setMetricsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  const copyTimer = useRef<number | null>(null);

  const refresh = useCallback(async (mode: 'initial' | 'manual') => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);

    const timed = async <T,>(path: string, normalize: (raw: unknown, ms: number) => T) => {
      const started = performance.now();
      const raw = await apiFetch<unknown>(path, { signal: controller.signal });
      return normalize(raw, Math.round(performance.now() - started));
    };

    const [healthResult, readyResult, indexResult, metricsResult] = await Promise.allSettled([
      timed('/health', (raw, ms) => normalizeHealth(raw, ms)),
      timed('/health/ready', (raw, ms) => normalizeReadiness(raw, ms)),
      apiFetch<unknown>('/v1/index/status', { signal: controller.signal }),
      apiFetch<unknown>('/v1/metrics', { signal: controller.signal }),
    ]);

    if (controller.signal.aborted) return;

    if (healthResult.status === 'fulfilled') {
      setHealth(healthResult.value);
      setHealthError(null);
    } else {
      setHealth(null);
      setHealthError(errorMessage(healthResult.reason, 'health unavailable'));
    }

    if (readyResult.status === 'fulfilled') {
      setReadiness(readyResult.value);
      setReadinessError(null);
    } else {
      setReadiness(null);
      setReadinessError(errorMessage(readyResult.reason, 'readiness unavailable'));
    }

    if (indexResult.status === 'fulfilled') {
      const normalized = normalizeIndexStatus(indexResult.value);
      setIndex(normalized);
      setIndexError(normalized ? null : 'Unexpected index status payload');
    } else {
      setIndex(null);
      setIndexError(errorMessage(indexResult.reason, 'index status unavailable'));
    }

    if (metricsResult.status === 'fulfilled') {
      setMetrics(flattenMetrics(metricsResult.value));
      setMetricsError(null);
    } else {
      setMetrics(null);
      setMetricsError(errorMessage(metricsResult.reason, 'metrics unavailable'));
    }

    setLastChecked(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void refresh('initial');
    return () => controllerRef.current?.abort();
  }, [refresh]);

  /* Live elapsed clock while a rebuild runs. */
  useEffect(() => {
    if (reindex.status !== 'running') return undefined;
    setElapsed(0);
    const id = window.setInterval(() => {
      setElapsed(Math.round(performance.now() - reindex.startedAt));
    }, 100);
    return () => window.clearInterval(id);
  }, [reindex]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const runReindex = useCallback(async () => {
    if (reindex.status === 'running') return;
    const startedAt = performance.now();
    setReindex({ status: 'running', startedAt });

    try {
      const raw = await apiFetch<unknown>('/v1/reindex', { method: 'POST' });
      const result = normalizeReindexResult(raw, Math.round(performance.now() - startedAt));
      setReindex({ status: 'done', result });
      onRebuilt?.(result);
      await refresh('manual');
    } catch (error) {
      setReindex({ status: 'error', message: errorMessage(error, 'Reindex failed') });
    }
  }, [onRebuilt, refresh, reindex.status]);

  const copyMetrics = useCallback(async () => {
    if (!metrics) return;
    const payload = JSON.stringify(
      Object.fromEntries(metrics.map((leaf) => [leaf.path, leaf.value])),
      null,
      2,
    );
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [metrics]);

  const reach = useMemo(
    () => ({
      vector: backendReachability(index, 'vector'),
      graph: backendReachability(index, 'graph'),
      lexical: backendReachability(index, 'lexical'),
      relational: backendReachability(index, 'relational'),
    }),
    [index],
  );

  const tally = useMemo(() => onlineCount(index), [index]);
  const highlights = useMemo(() => metricHighlights(metrics ?? []), [metrics]);
  const running = reindex.status === 'running';
  /* Single source of truth for the offline state: when the index read fails and
     nothing is cached we show one banner, not one error per surface. */
  const offline = Boolean(indexError && !index);

  return (
    <div className={cx('flex flex-col gap-3.5', className)}>
      {/* ---------------- health strip ---------------- */}
      <motion.section
        variants={FADE_UP}
        initial="initial"
        animate="animate"
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline bg-elevated/70 px-2.5 py-2 shadow-hairline backdrop-blur-xl"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {offline ? (
            <StatusBadge tone="fail" size="sm" label="offline" pulse={false} />
          ) : (
            <>
              <HealthPill
                icon={Activity}
                label="API"
                snapshot={health}
                error={healthError}
                pending={loading}
              />
              <HealthPill
                icon={Server}
                label="Readiness"
                snapshot={readiness}
                error={readinessError}
                pending={loading}
              />
            </>
          )}
          <span className="tabular px-1 font-mono text-[9.5px] text-ink-faint">
            {health?.version ? `v${health.version} · ` : ''}
            {lastChecked ? `checked ${lastChecked.toLocaleTimeString()}` : 'awaiting first check'}
          </span>
        </div>

        <button
          type="button"
          onClick={() => void refresh('manual')}
          disabled={refreshing || loading}
          className="inline-flex h-7 items-center gap-1.5 rounded-pill border border-hairline bg-elevated px-2.5 text-[10.5px] font-semibold text-ink-muted transition-colors hover:text-ink disabled:cursor-progress disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {refreshing || loading ? (
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.6} />
          ) : (
            <RefreshCw className="h-3 w-3" strokeWidth={2.6} />
          )}
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </motion.section>

      {/* ---------------- bento grid ---------------- */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Index stores
        </p>
        <p className="flex items-center gap-1.5 text-[10px] text-ink-muted">
          <span className="tabular font-medium text-ink">
            {tally.online}/{BACKEND_KEYS.length}
          </span>
          online
          {tally.fallback > 0 ? <span className="text-warn-ink">· {tally.fallback} fallback</span> : null}
          {tally.offline > 0 ? <span className="text-fail-ink">· {tally.offline} offline</span> : null}
        </p>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {indexError && !index ? (
          <motion.div
            key="index-error"
            variants={FADE_UP}
            initial="initial"
            animate="animate"
            exit="exit"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-fail/30 bg-fail-soft px-3 py-2.5"
          >
            <p className="flex items-center gap-1.5 text-[11.5px] text-fail-ink">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
              {indexError}
            </p>
            <button
              type="button"
              onClick={() => void refresh('manual')}
              className="inline-flex h-6 items-center gap-1 rounded-pill border border-fail/30 bg-elevated px-2 text-[10.5px] font-semibold text-fail-ink transition-colors hover:border-fail/60"
            >
              <RefreshCw className="h-2.5 w-2.5" strokeWidth={2.6} />
              Retry
            </button>
          </motion.div>
        ) : (
          <motion.div
            key={index ? 'index-ready' : 'index-loading'}
            variants={STAGGER_CONTAINER}
            initial="initial"
            animate="animate"
            exit="exit"
            className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4"
          >
            {!index
              ? [0, 1, 2, 3].map((key) => (
                  <div
                    key={key}
                    aria-hidden="true"
                    className="h-[212px] animate-pulse rounded-lg border border-hairline bg-subtle/50"
                  />
                ))
              : [
                  <BackendCard
                    key="vector"
                    title="Vector"
                    store="Qdrant"
                    icon={Layers}
                    reach={reach.vector}
                    isFallback={index.vector.is_fallback}
                    primaryLabel="points"
                    primaryValue={index.vector.total_points}
                    stats={[
                      { label: 'dimension', value: index.vector.vector_dimension },
                      { label: 'collections', value: index.vector.collections.length },
                    ]}
                    breakdown={index.vector.collections.map((name) => ({
                      label: name,
                      value: index.vector.points_per_collection[name] ?? 0,
                    }))}
                    detail={index.vector.detail}
                  />,
                  <BackendCard
                    key="graph"
                    title="Knowledge Graph"
                    store="Neo4j"
                    icon={Network}
                    reach={reach.graph}
                    isFallback={index.graph.is_fallback}
                    primaryLabel="nodes"
                    primaryValue={index.graph.node_count}
                    stats={[
                      { label: 'relationships', value: index.graph.relationship_count },
                      { label: 'entity index', value: index.graph.entity_index_size },
                    ]}
                    breakdown={[]}
                    detail={index.graph.detail}
                  />,
                  <BackendCard
                    key="lexical"
                    title="Lexical"
                    store="BM25"
                    icon={Search}
                    reach={reach.lexical}
                    isFallback={index.lexical.is_fallback}
                    primaryLabel="indexed chunks"
                    primaryValue={index.lexical.corpus_size}
                    stats={[
                      { label: 'documents', value: index.lexical.document_count },
                      { label: 'engine', value: 'bm25-okapi', mono: false },
                    ]}
                    breakdown={[]}
                    detail={index.lexical.detail}
                  />,
                  <BackendCard
                    key="relational"
                    title="Relational DB"
                    store={index.relational.dialect ?? 'SQL'}
                    icon={Database}
                    reach={reach.relational}
                    isFallback={index.relational.is_fallback}
                    primaryLabel="rows"
                    primaryValue={index.relational.total_rows}
                    stats={[{ label: 'tables', value: index.relational.tables.length }]}
                    breakdown={index.relational.tables.map((table) => ({
                      label: table.name,
                      value: table.row_count,
                    }))}
                    detail={index.relational.detail}
                  />,
                ]}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- reindex ---------------- */}
      <motion.section
        variants={FADE_UP}
        initial="initial"
        animate="animate"
        className="relative overflow-hidden rounded-lg border border-hairline bg-elevated/80 p-3.5 shadow-hairline backdrop-blur-xl"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              <RotateCw className="h-3 w-3" strokeWidth={2.4} />
              Index operations
            </p>
            <h3 className="mt-1 text-[15px] font-semibold tracking-[-0.02em] text-ink">
              Rebuild index
            </h3>
            <p className="mt-0.5 max-w-lg text-[11.5px] leading-relaxed text-ink-muted">
              Re-streams every chunk into the vector, graph and lexical stores. Retrieval stays
              online against the previous snapshot until the rebuild commits.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void runReindex()}
            disabled={running}
            aria-busy={running}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-pill bg-accent px-3.5 text-[11.5px] font-semibold text-accent-contrast shadow-hairline transition-colors hover:bg-accent-hover disabled:cursor-progress disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.6} />
            ) : (
              <RotateCw className="h-3.5 w-3.5" strokeWidth={2.6} />
            )}
            {running ? `Rebuilding… ${formatDuration(elapsed)}` : 'Rebuild index'}
          </button>
        </div>

        <div role="status" aria-live="polite" className="mt-2">
          <AnimatePresence initial={false}>
            {running ? (
              <motion.div
                key="running"
                variants={FADE_UP}
                initial="initial"
                animate="animate"
                exit="exit"
                className="flex items-center gap-2 rounded-[7px] border border-accent/25 bg-accent-soft px-2.5 py-1.5"
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                </span>
                <p className="text-[11px] font-medium text-accent">
                  Rebuilding all stores — {formatDuration(elapsed)} elapsed
                </p>
                <span className="tabular ml-auto font-mono text-[10px] text-accent/70">
                  {running ? 'Queued · streaming · verifying' : ''}
                </span>
              </motion.div>
            ) : reindex.status === 'done' ? (
              <motion.div
                key="done"
                variants={FADE_UP}
                initial="initial"
                animate="animate"
                exit="exit"
                className={cx(
                  'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[7px] border px-2.5 py-1.5',
                  reindex.result.ok
                    ? 'border-ok/30 bg-ok-soft'
                    : 'border-fail/30 bg-fail-soft',
                )}
              >
                {reindex.result.ok ? (
                  <Check className="h-3 w-3 text-ok-ink" strokeWidth={3} />
                ) : (
                  <AlertTriangle className="h-3 w-3 text-fail-ink" strokeWidth={2.4} />
                )}
                <p
                  className={cx(
                    'text-[11px] font-medium',
                    reindex.result.ok ? 'text-ok-ink' : 'text-fail-ink',
                  )}
                >
                  {reindex.result.message}
                </p>
                <span className="tabular font-mono text-[10px] text-ink-muted">
                  {formatDuration(reindex.result.durationMs)}
                </span>
                {reindex.result.stores.length > 0 ? (
                  <span className="flex flex-wrap items-center gap-1">
                    {reindex.result.stores.map((store) => (
                      <StatusBadge
                        key={store.name}
                        tone={store.ok ? 'ok' : 'fail'}
                        size="sm"
                        label={store.name}
                      />
                    ))}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setReindex({ status: 'idle' })}
                  aria-label="Dismiss rebuild result"
                  className="ml-auto grid h-4 w-4 place-items-center rounded-full text-ink-faint transition-colors hover:text-ink"
                >
                  <X className="h-3 w-3" strokeWidth={2.6} />
                </button>
              </motion.div>
            ) : reindex.status === 'error' ? (
              <motion.div
                key="error"
                variants={FADE_UP}
                initial="initial"
                animate="animate"
                exit="exit"
                className="flex flex-wrap items-center gap-2 rounded-[7px] border border-fail/30 bg-fail-soft px-2.5 py-1.5"
              >
                <AlertTriangle className="h-3 w-3 text-fail-ink" strokeWidth={2.4} />
                <p className="text-[11px] font-medium text-fail-ink">{reindex.message}</p>
                <button
                  type="button"
                  onClick={() => setReindex({ status: 'idle' })}
                  aria-label="Dismiss rebuild error"
                  className="ml-auto grid h-4 w-4 place-items-center rounded-full text-fail-ink/70 transition-colors hover:text-fail-ink"
                >
                  <X className="h-3 w-3" strokeWidth={2.6} />
                </button>
              </motion.div>
            ) : (
              <motion.p
                key="idle"
                variants={FADE_UP}
                initial="initial"
                animate="animate"
                exit="exit"
                className="font-mono text-[10px] text-ink-faint"
              >
                last rebuild —{' '}
                {index
                  ? `${formatCount(
                      index.vector.total_points,
                    )} points · ${formatCount(index.lexical.corpus_size)} lexical chunks`
                  : 'no status yet'}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </motion.section>

      {/* ---------------- metrics ---------------- */}
      <motion.section
        variants={FADE_UP}
        initial="initial"
        animate="animate"
        className="overflow-hidden rounded-lg border border-hairline bg-elevated/70 shadow-hairline backdrop-blur-xl"
      >
        <button
          type="button"
          onClick={() => setMetricsOpen((open) => !open)}
          aria-expanded={metricsOpen}
          aria-controls="ops-metrics-body"
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-subtle/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Boxes className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2.2} />
            <span className="text-[11.5px] font-semibold text-ink">Raw metrics</span>
            <span className="truncate font-mono text-[10px] text-ink-faint">
              {offline && !metrics
                ? 'unavailable while offline'
                : metricsError
                  ? metricsError
                  : metrics
                    ? `${metrics.length} metrics reported`
                    : loading
                      ? 'loading…'
                      : 'not loaded yet'}
            </span>
          </span>
          <motion.span
            animate={{ rotate: metricsOpen ? 180 : 0 }}
            transition={SPRING_SNAPPY}
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-ink-faint"
          >
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.4} />
          </motion.span>
        </button>

        <AnimatePresence initial={false}>
          {metricsOpen ? (
            <motion.div
              key="metrics"
              id="ops-metrics-body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={SPRING_SNAPPY}
              className="overflow-hidden border-t border-hairline"
            >
              <div className="flex flex-col gap-2.5 p-3">
                {metricsError ? (
                  <p className="text-[11.5px] text-fail-ink">{metricsError}</p>
                ) : metrics && metrics.length > 0 ? (
                  <>
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-6">
                      {highlights.map((leaf) => (
                        <div
                          key={leaf.path}
                          className="rounded-[7px] border border-hairline bg-subtle/50 px-2 py-1.5"
                        >
                          <p
                            className="truncate font-mono text-[9px] uppercase tracking-[0.06em] text-ink-faint"
                            title={leaf.path}
                          >
                            {leaf.path.split('.').slice(-1)[0] ?? leaf.path}
                          </p>
                          <p className="tabular truncate text-[14px] font-semibold text-ink">
                            {formatMetricValue(leaf.value)}
                          </p>
                          <p className="truncate font-mono text-[8.5px] text-ink-faint" title={leaf.path}>
                            {leaf.path}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between">
                      <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                        Payload
                      </p>
                      <button
                        type="button"
                        onClick={() => void copyMetrics()}
                        aria-label={copied ? 'Metrics JSON copied' : 'Copy metrics JSON'}
                        className={cx(
                          'inline-flex h-6 items-center gap-1 rounded-pill border px-2 text-[10px] font-medium transition-colors',
                          copied
                            ? 'border-ok/30 bg-ok-soft text-ok-ink'
                            : 'border-hairline bg-elevated text-ink-muted hover:text-ink',
                        )}
                      >
                        {copied ? (
                          <Check className="h-2.5 w-2.5" strokeWidth={3} />
                        ) : (
                          <Copy className="h-2.5 w-2.5" strokeWidth={2.4} />
                        )}
                        {copied ? 'Copied' : 'Copy JSON'}
                      </button>
                    </div>

                    <JsonTree leaves={metrics} />
                  </>
                ) : (
                  <p className="text-[11.5px] text-ink-muted">No metrics reported.</p>
                )}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.section>
    </div>
  );
}

export default IndexTelemetryPanel;
