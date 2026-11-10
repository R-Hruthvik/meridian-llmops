import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../services/api';
import type { CockpitTelemetry } from '../types/cockpit';

/** Reads read-only Cockpit telemetry from the backend and polls every 30 s.
 *
 * Polling pauses when the tab is hidden and resumes on visibilitychange, so it
 * never drains the main thread on a backgrounded tab. Any single failure leaves
 * the remaining cells healthy (serial fetch, never throws the UI).
 */
export function useCockpitTelemetry(): { telemetry: CockpitTelemetry } {
  const [telemetry, setTelemetry] = useState<CockpitTelemetry>({
    vectorCount: null,
    vectorDimension: null,
    p95LatencyMs: null,
    kgEntities: null,
    kgRelations: null,
    bm25Documents: null,
    bm25Corpus: null,
    activeModel: null,
    vectorFallback: false,
    graphFallback: false,
    bm25Fallback: false,
    ready: false,
  });

  const pollRef = useRef<number | null>(null);

  const fetchAll = useCallback(async () => {
    const state: Omit<CockpitTelemetry, 'ready'> = {
      vectorCount: null,
      vectorDimension: null,
      p95LatencyMs: null,
      kgEntities: null,
      kgRelations: null,
      bm25Documents: null,
      bm25Corpus: null,
      activeModel: null,
      vectorFallback: false,
      graphFallback: false,
      bm25Fallback: false,
    };

    // Serial fetch — one failure leaves the rest healthy.
    try {
      const indexStatus = await api.getIndexStatus();
      state.vectorCount = indexStatus.vector.total_points;
      state.vectorDimension = indexStatus.vector.vector_dimension;
      state.vectorFallback = indexStatus.vector.is_fallback;
      state.kgEntities = indexStatus.graph.node_count;
      state.kgRelations = indexStatus.graph.relationship_count;
      state.graphFallback = indexStatus.graph.is_fallback;
      state.bm25Documents = indexStatus.lexical.document_count;
      state.bm25Corpus = indexStatus.lexical.corpus_size;
      state.bm25Fallback = indexStatus.lexical.is_fallback;
    } catch {
      // Leave all index cells null / fallback-false; the UI shows unavailable.
    }

    try {
      const metrics = await api.getMetrics();
      state.p95LatencyMs = metrics.retrieval_latency_ms?.p95 ?? metrics.latency_ms?.p95 ?? null;
    } catch {
      // Leave p95 null; the UI shows unavailable.
    }

    try {
      const llmSettings = await api.getLLMSettings();
      state.activeModel = llmSettings.default_model ?? null;
    } catch {
      // Leave activeModel null; the UI shows "Not configured".
    }

    setTelemetry((prev) => ({ ...prev, ...state }));
  }, []);

  const schedule = useCallback(() => {
    if (pollRef.current !== null) return;
    pollRef.current = window.setInterval(fetchAll, 30_000);
  }, [fetchAll]);

  const cancel = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    fetchAll();
    schedule();
    cancel();
    return undefined;
  }, [fetchAll, schedule, cancel]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        cancel();
      } else {
        schedule();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [cancel, schedule]);

  return { telemetry };
}
