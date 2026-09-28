import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Database,
  HardDrive,
  Network,
  RefreshCw,
  Search,
  Waypoints,
} from 'lucide-react';
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-meridian-text flex items-center space-x-2">
            <HardDrive className="w-5 h-5 text-meridian-primary" />
            <span>Index &amp; Storage</span>
          </h2>
          <p className="text-xs text-meridian-textMuted mt-0.5 font-medium">
            Live read of every backing store. Tenant:{' '}
            <span className="font-bold text-meridian-primary">{tenantId}</span>
          </p>
        </div>

        <button
          onClick={fetchStatus}
          disabled={loading}
          aria-label="Refresh index and storage status"
          className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-white hover:bg-meridian-lavenderLight border border-meridian-border text-xs text-meridian-text font-bold shadow-card transition-all disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-meridian-primary focus-visible:outline-none"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-meridian-primary' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold"
        >
          {error}
        </div>
      )}

      {loading && !status && (
        <div
          role="status"
          className="p-6 rounded-3xl bg-white/80 border border-meridian-border text-xs font-semibold text-meridian-textMuted"
        >
          Loading live index state…
        </div>
      )}

      {status && fallingBack.length > 0 && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-5 rounded-3xl bg-amber-50 border-2 border-amber-400 text-amber-900 shadow-card"
        >
          <h3 className="flex items-center space-x-2 text-sm font-extrabold">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Fallback data — {fallingBack.length} of {SUBSYSTEMS.length} subsystems are not
              persisted state
            </span>
          </h3>
          <p className="text-xs font-semibold mt-1.5">
            These numbers come from an in-process fallback. They vanish on restart and are not the
            data your queries are actually served from.
          </p>
          <ul className="mt-3 space-y-2">
            {fallingBack.map(({ key, label }) => (
              <li key={key} className="text-xs">
                <span className="font-extrabold">{label}: </span>
                <span className="font-medium">{status[key].detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Vector Index */}
          <section
            aria-label="Vector index"
            className="bg-white/80 backdrop-blur-md border border-meridian-border rounded-3xl p-5 shadow-card"
          >
            <SectionHeader
              icon={Waypoints}
              title="Vector Index"
              isFallback={status.vector.is_fallback}
              endpoint={status.backends.vector?.endpoint}
            />
            {status.vector.collections.length === 0 ? (
              <p className="text-xs font-semibold text-meridian-textMuted">
                No collections reported by the vector store.
              </p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <Stat label="Total points" value={formatCount(status.vector.total_points)} />
                  <Stat label="Dimension" value={formatCount(status.vector.vector_dimension)} />
                </dl>
                <ul className="mt-3 space-y-1">
                  {status.vector.collections.map((name) => (
                    <li key={name} className="flex items-center justify-between text-xs">
                      <span className="font-mono font-semibold text-meridian-text">{name}</span>
                      <span className="font-bold text-meridian-primary">
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
            className="bg-white/80 backdrop-blur-md border border-meridian-border rounded-3xl p-5 shadow-card"
          >
            <SectionHeader
              icon={Network}
              title="Knowledge Graph"
              isFallback={status.graph.is_fallback}
              endpoint={status.backends.graph?.endpoint}
            />
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <Stat label="Nodes" value={formatCount(status.graph.node_count)} />
              <Stat label="Relationships" value={formatCount(status.graph.relationship_count)} />
              <Stat label="Entity index" value={formatCount(status.graph.entity_index_size)} />
            </dl>
            <DetailText detail={status.graph.detail} />
          </section>

          {/* Lexical Index */}
          <section
            aria-label="Lexical index"
            className="bg-white/80 backdrop-blur-md border border-meridian-border rounded-3xl p-5 shadow-card"
          >
            <SectionHeader
              icon={Search}
              title="Lexical Index (BM25)"
              isFallback={status.lexical.is_fallback}
              endpoint={status.backends.lexical?.endpoint}
            />
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <Stat label="Corpus size" value={formatCount(status.lexical.corpus_size)} />
              <Stat label="Documents" value={formatCount(status.lexical.document_count)} />
            </dl>
            <DetailText detail={status.lexical.detail} />
          </section>

          {/* Relational Storage */}
          <section
            aria-label="Relational storage"
            className="bg-white/80 backdrop-blur-md border border-meridian-border rounded-3xl p-5 shadow-card"
          >
            <SectionHeader
              icon={Database}
              title="Relational Storage"
              isFallback={status.relational.is_fallback}
              endpoint={status.backends.relational?.endpoint}
            />
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <Stat label="Dialect" value={status.relational.dialect ?? null} />
              <Stat label="Total rows" value={formatCount(status.relational.total_rows)} />
            </dl>
            <table className="w-full mt-3 text-xs">
              <caption className="sr-only">Live relational tables and their row counts</caption>
              <thead>
                <tr className="text-left text-meridian-textMuted">
                  <th scope="col" className="py-1 font-bold uppercase tracking-wider text-[10px]">
                    Table
                  </th>
                  <th scope="col" className="py-1 font-bold uppercase tracking-wider text-[10px] text-right">
                    Rows
                  </th>
                </tr>
              </thead>
              <tbody>
                {status.relational.tables.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="py-2 font-semibold text-meridian-textMuted">
                      No tables reported by the relational store.
                    </td>
                  </tr>
                ) : (
                  status.relational.tables.map((table) => (
                    <tr key={table.name} className="border-t border-meridian-border">
                      <td className="py-1.5 font-mono font-semibold text-meridian-text">
                        {table.name}
                      </td>
                      <td className="py-1.5 text-right font-bold text-meridian-primary">
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
  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
    <h3 className="text-xs font-bold text-meridian-text flex items-center space-x-2">
      <Icon className="w-4 h-4 text-meridian-primary" />
      <span>{title}</span>
    </h3>
    {isFallback ? (
      <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold border border-amber-300 bg-amber-50 text-amber-800">
        <AlertTriangle className="w-3 h-3" />
        <span>In-process fallback</span>
      </span>
    ) : (
      <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold border border-emerald-200 bg-emerald-50 text-emerald-700">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        <span>Live</span>
      </span>
    )}
    {endpoint && (
      <span className="w-full text-[10px] font-mono text-meridian-textMuted break-all">
        {endpoint}
      </span>
    )}
  </div>
);

const Stat: React.FC<{ label: string; value: string | null }> = ({ label, value }) => (
  <div className="rounded-2xl bg-meridian-bg/70 border border-meridian-border px-3 py-2">
    <dt className="text-[10px] uppercase tracking-wider font-bold text-meridian-textMuted">
      {label}
    </dt>
    <dd className="mt-0.5 text-base font-black text-meridian-text">
      {value === null ? <Unavailable /> : value}
    </dd>
  </div>
);

const DetailText: React.FC<{ detail: string }> = ({ detail }) =>
  detail ? (
    <p className="mt-3 text-[10px] font-medium text-meridian-textMuted border-l-2 border-meridian-border pl-2">
      {detail}
    </p>
  ) : null;
