'use client';

import type { FC } from 'react';
import { DoubleBezelCard } from './DoubleBezelCard';

export interface DynamicWidgetProps {
  name: string;
  content: string;
  className?: string;
}

export type WidgetComponent = FC<{ data: any; rawContent: string }>;

export function TimingsWaterfallWidget({ data }: { data: any }) {
  const timings: Record<string, number> =
    data && typeof data === 'object' && 'timings' in data && typeof data.timings === 'object' && data.timings !== null
      ? data.timings
      : data && typeof data === 'object' && !Array.isArray(data)
      ? data
      : {};

  const entries = Object.entries(timings).filter(([, val]) => typeof val === 'number');
  const total = entries.reduce((acc, [, val]) => acc + val, 0);
  const maxVal = entries.length > 0 ? Math.max(...entries.map(([, val]) => val), 1) : 1;

  return (
    <div>
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-white/10 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-200">Latency Breakdown</span>
          <span className="text-[10px] font-mono uppercase bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700">
            Waterfall
          </span>
        </div>
        <span className="font-mono text-zinc-400 text-[11px] tabular-nums">
          Total: <span className="text-zinc-200 font-semibold">{Math.round(total)}ms</span>
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="text-zinc-500 text-xs py-2">No timing measurements available</div>
      ) : (
        <div className="space-y-2.5">
          {entries.map(([key, duration]) => {
            const pct = Math.max(4, Math.round((duration / maxVal) * 100));
            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-zinc-300 text-[11px]">{key}</span>
                  <span className="font-mono text-zinc-400 text-[11px] tabular-nums">
                    {Math.round(duration)}ms
                  </span>
                </div>
                <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-500 rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MemoryHealthWidget({ data }: { data: any }) {
  const getEngineStatus = (key: string, defaultStatus = 'operational'): string => {
    if (!data || typeof data !== 'object') return defaultStatus;

    if (Array.isArray(data.engines)) {
      const match = data.engines.find(
        (e: any) =>
          typeof e === 'object' &&
          (e.name?.toLowerCase().includes(key) ||
            e.tag?.toLowerCase().includes(key) ||
            e.id?.toLowerCase().includes(key)),
      );
      if (match?.status) return match.status;
    }

    if (data.engines && typeof data.engines === 'object') {
      for (const [k, v] of Object.entries(data.engines)) {
        if (k.toLowerCase().includes(key)) return typeof v === 'string' ? v : (v as any)?.status || defaultStatus;
      }
    }

    for (const [k, v] of Object.entries(data)) {
      if (k.toLowerCase().includes(key)) return typeof v === 'string' ? v : (v as any)?.status || defaultStatus;
    }

    return defaultStatus;
  };

  const engines = [
    {
      id: 'chroma',
      name: '[VEC:CHROMA]',
      role: 'Dense Vector Engine',
      status: getEngineStatus('chroma', 'operational'),
    },
    {
      id: 'sqlite',
      name: '[KG:SQLITE]',
      role: 'Knowledge Graph',
      status: getEngineStatus('sqlite', 'operational'),
    },
    {
      id: 'redis',
      name: '[KV:REDIS]',
      role: 'Sparse / Key-Value Cache',
      status: getEngineStatus('redis', 'operational'),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-white/10 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-200">Dual-Memory Health</span>
          <span className="text-[10px] font-mono uppercase bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700">
            Engines
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {engines.map((eng) => {
          const statusLower = String(eng.status).toLowerCase();
          const isOk = ['operational', 'healthy', 'ok', 'active'].includes(statusLower);
          const isWarn = ['degraded', 'warning', 'warn'].includes(statusLower);

          return (
            <div
              key={eng.id}
              className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-col justify-between space-y-2"
            >
              <div>
                <div className="font-mono text-xs font-bold text-sky-400">{eng.name}</div>
                <div className="text-[11px] text-zinc-400 mt-0.5">{eng.role}</div>
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isOk ? 'bg-emerald-400' : isWarn ? 'bg-amber-400' : 'bg-rose-400'
                  }`}
                />
                <span
                  className={`text-[10px] font-mono uppercase font-semibold ${
                    isOk ? 'text-emerald-400' : isWarn ? 'text-amber-400' : 'text-rose-400'
                  }`}
                >
                  {statusLower.toUpperCase()}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SourceTableWidget({ data }: { data: any }) {
  const sources: Array<{ title?: string; score?: number; snippet?: string }> =
    data && typeof data === 'object' && Array.isArray(data.sources)
      ? data.sources
      : Array.isArray(data)
      ? data
      : [];

  return (
    <div>
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-white/10 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-200">Evidence Sources</span>
          <span className="text-[10px] font-mono uppercase bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700">
            Source Table
          </span>
        </div>
        <span className="font-mono text-zinc-400 text-[11px]">
          {sources.length} {sources.length === 1 ? 'source' : 'sources'}
        </span>
      </div>

      {sources.length === 0 ? (
        <div className="text-zinc-500 text-xs py-3 text-center">No source evidence available</div>
      ) : (
        <div className="overflow-x-auto rounded border border-zinc-800">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-zinc-950 border-b border-zinc-800 text-zinc-400">
                <th className="py-2 px-3 font-semibold text-[11px]">Source</th>
                <th className="py-2 px-3 font-semibold text-[11px] text-right">Score</th>
                <th className="py-2 px-3 font-semibold text-[11px]">Snippet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-zinc-950 text-zinc-300">
              {sources.map((s, idx) => (
                <tr key={idx} className="hover:bg-zinc-900 transition-colors">
                  <td className="py-2 px-3 font-medium text-zinc-200 whitespace-nowrap text-[11px]">
                    {s.title || 'Untitled'}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-[11px] tabular-nums text-emerald-400">
                    {typeof s.score === 'number'
                      ? s.score <= 1
                        ? `${(s.score * 100).toFixed(0)}%`
                        : s.score.toFixed(2)
                      : '—'}
                  </td>
                  <td className="py-2 px-3 text-zinc-400 text-[11px] max-w-xs truncate font-mono">
                    {s.snippet || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export const WIDGET_REGISTRY: Record<string, WidgetComponent> = {
  'timings-waterfall': TimingsWaterfallWidget,
  'memory-health': MemoryHealthWidget,
  'source-table': SourceTableWidget,
};

export function DynamicWidget({ name, content, className = '' }: DynamicWidgetProps) {
  const Component = WIDGET_REGISTRY[name];

  // If widget type is unknown, fall back to formatted code block
  if (!Component) {
    return (
      <div className={`my-3 ${className}`}>
        <div className="flex items-center justify-between px-3 py-1.5 rounded-t-lg border-t border-x border-hairline bg-surface-sunken text-xs font-mono text-muted">
          <span>{`Widget: ${name} (unregistered)`}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">RAW</span>
        </div>
        <pre className="overflow-x-auto rounded-b-lg border border-hairline bg-surface-sunken p-3 text-ink text-xs font-mono">
          <code className={`language-widget-${name}`}>{content}</code>
        </pre>
      </div>
    );
  }

  // Safe JSON parsing for streaming resilience
  const trimmed = content.trim();
  let parsedData: any = null;
  let isParsingError = false;

  if (!trimmed) {
    isParsingError = true;
  } else {
    try {
      parsedData = JSON.parse(trimmed);
    } catch {
      isParsingError = true;
    }
  }

  // During streaming, if JSON is incomplete, show sleek loading skeleton
  if (isParsingError) {
    return (
      <DoubleBezelCard className={`my-3 ${className}`}>
        <div className="flex items-center justify-between pb-2 mb-3 border-b border-white/10 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
            <span className="font-semibold text-zinc-200">Loading {name}...</span>
          </div>
          <span className="text-[10px] font-mono uppercase bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700">
            Streaming
          </span>
        </div>
        <div className="space-y-2 py-1" data-testid="widget-skeleton" aria-busy="true">
          <div className="h-4 bg-zinc-800 rounded animate-pulse w-3/4" />
          <div className="h-4 bg-zinc-800 rounded animate-pulse w-1/2" />
          <div className="h-4 bg-zinc-800 rounded animate-pulse w-5/6" />
        </div>
      </DoubleBezelCard>
    );
  }

  return (
    <DoubleBezelCard className={`my-3 ${className}`}>
      <Component data={parsedData} rawContent={content} />
    </DoubleBezelCard>
  );
}
