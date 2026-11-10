/** Aggregated read-only telemetry for the LLMOps Cockpit.
 *
 * Every subsystem reports real values or `null`; the UI renders `— unavailable`
 * for null, never a fake `0`. Backend down = `is_fallback: true` + `detail` on
 * a 200, so this never throws — only auth/transport failures propagate.
 */
export interface CockpitTelemetry {
  /** vector.total_points */
  vectorCount: number | null;
  /** vector.vector_dimension */
  vectorDimension: number | null;
  /** latency_ms.p95 */
  p95LatencyMs: number | null;
  /** graph.node_count */
  kgEntities: number | null;
  /** graph.relationship_count */
  kgRelations: number | null;
  /** lexical.document_count / lexical.corpus_size */
  bm25Documents: number | null;
  bm25Corpus: number | null;
  /** /v1/settings/llm default_model */
  activeModel: string | null;
  vectorFallback: boolean;
  graphFallback: boolean;
  bm25Fallback: boolean;
  ready: boolean;
}
