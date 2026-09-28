import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Database,
  Network,
  RefreshCw,
  Search,
  Waypoints,
} from 'lucide-react';
import { StatusChip } from './StatusChip';
import { api } from '../services/api';
import type { IndexStatusResponse } from '../types/api';

interface IndexStorageStudioProps {
  tenantId: string;
}

/** One subsystem section of the inspector, in render order. */
type SubsystemKey = 'vector' | 'graph' | 'lexical' | 'relational';

const SUBSYSTEMS: { key: SubsystemKey; label: string; region: string }[] = [
  { key: 'vector', label: 'Vector Index', region: 'Vector index' },
  { key: 'graph', label: 'Knowledge Graph', region: 'Knowledge graph' },
  { key: 'lexical', label: 'Lexical Index (BM25)', region: 'Lexical index' },
  { key: 'relational', label: 'Relational Storage', region: 'Relational storage' },
];

/**
 * A count the backend could not observe. Rendered as an explicit dash, never
 * as 0 — a missing measurement is not the same claim as "zero rows exist".
 */
const Unavailable: React.FC = () => (
  <>
    <span aria-hidden="true">—</span>
    <span className="sr-only">unavailable</span>
  </>
);

const formatCount = (value: number | null | undefined): string | null =>
  typeof value === 'number' ? value.toLocaleString() : null;

export const IndexStorageStudio: React.FC<IndexStorageStudioProps> = ({ tenantId }) => {
  const [status, setStatus] = useState<IndexStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await api.getIndexStatus(tenantId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load index & storage status');
      // Never leave stale numbers on screen next to a newer failure.
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Any subsystem reporting fallback means the numbers below it are in-process
  // data, not persisted state. This banner is the point of the whole studio.
  const fallingBack = SUBSYSTEMS.filter(({ key }) => status?.[key]?.is_fallback);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-micro text-muted">
          Live read of every backing store · Tenant{' '}
          <span className="id-mono text-ink">{tenantId}</span>
        </p>

        <button
          onClick={fetchStatus}
          disabled={loading}
          aria-label="Refresh index and storage status"
          className="flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-raised px-2.5 py-1 text-label font-semibold text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin text-accent-ink' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded border border-hairline bg-fail-wash p-3 text-label font-semibold text-fail"
        >
          {error}
        </div>
      )}

      {loading && !status && (
        <div
          role="status"
          className="rounded border border-hairline bg-surface-raised p-4 text-label font-semibold text-muted"
        >
          Loading live index state…
        </div>
      )}

      {status && fallingBack.length > 0 && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded border border-warn bg-warn-wash p-3 text-warn"
        >
          <h3 className="flex items-start gap-2 text-label font-bold">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Fallback data — <span className="num">{fallingBack.length}</span> of{' '}
              <span className="num">{SUBSYSTEMS.length}</span> subsystems are not persisted state
            </span>
          </h3>
          <p className="mt-1 text-micro font-semibold">
            These numbers come from an in-process fallback. They vanish on restart and are not the
            data your queries are actually served from.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {fallingBack.map(({ key, label }) => (
              <li key={key} className="text-micro">
                <span className="font-bold">{label}: </span>
                <span>{status[key].detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status && (
        <div className="flex flex-col gap-4">
          {/* Vector Index */}
          <section
            aria-label="Vector index"
            className="rounded border border-hairline bg-surface-raised p-3"
          >
            <SectionHeader
              icon={Waypoints}
              title="Vector Index"
              isFallback={status.vector.is_fallback}
              endpoint={status.backends.vector?.endpoint}
            />
            {status.vector.collections.length === 0 ? (
              <p className="text-micro font-semibold text-muted">
                No collections reported by the vector store.
              </p>
            ) : (
              <>
                <dl className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Stat label="Total points" value={formatCount(status.vector.total_points)} />
                  <Stat label="Dimension" value={formatCount(status.vector.vector_dimension)} />
                </dl>
                <ul className="mt-2 flex flex-col">
                  {status.vector.collections.map((name) => (
                    <li
                      key={name}
                      className="flex items-center justify-between border-t border-hairline py-1 text-micro"
                    >
                      <span className="id-mono text-ink">{name}</span>
                      <span className="num text-readout font-semibold text-ink">
                        {formatCount(status.vector.points_per_collection[name]) ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <DetailText detail={status.vector.detail} />
          </section>

          {/* Knowledge Graph */}
          <section
            aria-label="Knowledge graph"
            className="rounded border border-hairline bg-surface-raised p-3"
          >
            <SectionHeader
              icon={Network}
              title="Knowledge Graph"
              isFallback={status.graph.is_fallback}
              endpoint={status.backends.graph?.endpoint}
            />
            <dl className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Stat label="Nodes" value={formatCount(status.graph.node_count)} />
              <Stat label="Relationships" value={formatCount(status.graph.relationship_count)} />
              <Stat label="Entity index" value={formatCount(status.graph.entity_index_size)} />
            </dl>
            <DetailText detail={status.graph.detail} />
          </section>

          {/* Lexical Index */}
          <section
            aria-label="Lexical index"
            className="rounded border border-hairline bg-surface-raised p-3"
          >
            <SectionHeader
              icon={Search}
              title="Lexical Index (BM25)"
              isFallback={status.lexical.is_fallback}
              endpoint={status.backends.lexical?.endpoint}
            />
            <dl className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Stat label="Corpus size" value={formatCount(status.lexical.corpus_size)} />
              <Stat label="Documents" value={formatCount(status.lexical.document_count)} />
            </dl>
            <DetailText detail={status.lexical.detail} />
          </section>

          {/* Relational Storage */}
          <section
            aria-label="Relational storage"
            className="rounded border border-hairline bg-surface-raised p-3"
          >
            <SectionHeader
              icon={Database}
              title="Relational Storage"
              isFallback={status.relational.is_fallback}
              endpoint={status.backends.relational?.endpoint}
            />
            <dl className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Stat label="Dialect" value={status.relational.dialect ?? null} />
              <Stat label="Total rows" value={formatCount(status.relational.total_rows)} />
            </dl>
            <table className="mt-2 w-full border-collapse text-left">
              <caption className="sr-only">Live relational tables and their row counts</caption>
              <thead>
                <tr className="border-b border-hairline-strong">
                  <th scope="col" className="label-section py-1 pr-2 font-normal text-faint">
                    Table
                  </th>
                  <th
                    scope="col"
                    className="label-section py-1 pl-2 text-right font-normal text-faint"
                  >
                    Rows
                  </th>
                </tr>
              </thead>
              <tbody>
                {status.relational.tables.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="py-1.5 text-micro font-semibold text-muted">
                      No tables reported by the relational store.
                    </td>
                  </tr>
                ) : (
                  status.relational.tables.map((table) => (
                    <tr key={table.name} className="border-b border-hairline last:border-b-0">
                      <td className="id-mono py-1 pr-2 text-ink">{table.name}</td>
                      <td className="num py-1 pl-2 text-right text-readout font-semibold text-ink">
                        {table.row_count.toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <DetailText detail={status.relational.detail} />
          </section>
        </div>
      )}
    </div>
  );
};

const SectionHeader: React.FC<{
  icon: typeof Network;
  title: string;
  isFallback: boolean;
  endpoint?: string;
}> = ({ icon: Icon, title, isFallback, endpoint }) => (
  <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-hairline pb-2">
    <h3 className="label-section flex items-center gap-1.5 text-muted">
      <Icon className="size-3.5" />
      <span>{title}</span>
    </h3>
    <StatusChip variant={isFallback ? 'warn' : 'ok'}>
      {isFallback ? 'In-process fallback' : 'Live'}
    </StatusChip>
    {endpoint && <span className="id-mono w-full break-all text-faint">{endpoint}</span>}
  </div>
);

const Stat: React.FC<{ label: string; value: string | null }> = ({ label, value }) => (
  <div data-slot="readout" className="border-l border-hairline pl-3 first:border-l-0 first:pl-0">
    <dt className="label-section text-faint">{label}</dt>
    <dd className="num mt-0.5 text-readout font-semibold text-ink">
      {value === null ? <Unavailable /> : value}
    </dd>
  </div>
);

const DetailText: React.FC<{ detail: string }> = ({ detail }) =>
  detail ? (
    <p className="mt-2 border-l-2 border-hairline pl-2 text-micro text-muted">{detail}</p>
  ) : null;
