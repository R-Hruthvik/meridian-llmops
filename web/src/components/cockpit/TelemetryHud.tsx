import React from 'react';

import type { CockpitTelemetry } from '../../types/cockpit';
import { StatCell } from './StatCell';
import { ModelBadge } from './ModelBadge';

interface TelemetryHudProps {
  telemetry: CockpitTelemetry;
}

export const TelemetryHud: React.FC<TelemetryHudProps> = ({ telemetry }) => {
  const {
    vectorCount,
    vectorDimension,
    p95LatencyMs,
    kgEntities,
    kgRelations,
    vectorFallback,
    activeModel,
    bm25Corpus,
    bm25Fallback,
  } = telemetry;

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
      <StatCell
        label="vectors"
        value={vectorCount}
        sub={vectorDimension ? `${vectorDimension} dim` : undefined}
        fallback={vectorFallback}
        detail={vectorFallback ? undefined : 'Dense vector index (Qdrant)'}
        ariaLabel={`Vectors, ${vectorCount ?? '—'}${vectorDimension ? `, ${vectorDimension} dimension` : ''}`}
      />
      <StatCell
        label="p95 latency"
        value={p95LatencyMs}
        sub="ms"
        fallback={p95LatencyMs === null}
        detail="p95 search latency"
        ariaLabel={`p95 latency, ${p95LatencyMs ?? '—'} ms`}
      />
      <StatCell
        label="KG entities"
        value={kgEntities}
        fallback={kgEntities === null}
        detail="Knowledge graph nodes"
        ariaLabel={`KG entities, ${kgEntities ?? '—'}`}
      />
      <div className="flex flex-col gap-4">
        <StatCell
          label="KG relations"
          value={kgRelations}
          fallback={kgRelations === null}
          detail="Knowledge graph relationships"
          ariaLabel={`KG relations, ${kgRelations ?? '—'}`}
        />
        <ModelBadge model={activeModel} bm25Status={bm25Corpus} bm25Fallback={bm25Fallback} />
      </div>
    </div>
  );
};
