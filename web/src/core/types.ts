/**
 * Meridian — wire types.
 *
 * These interfaces mirror the FastAPI backend response models 1:1. They are
 * intentionally structural (no classes, no runtime validation) so they can be
 * shared with tests, MSW handlers and future zod schemas without translation.
 */

/** A retrieved chunk with its scores and provenance. */
export interface SearchResult {
  chunk_id: string;
  document_id: string;
  text: string;
  score: number;
  retrieval_method: string;
  metadata: Record<string, unknown>;
  rank?: number | null;
  filename: string;
  title: string;
  page_start?: number | null;
  heading_path: string;
  scores: Record<string, unknown>;
  chunk_index?: number | null;
}

/** A node in the knowledge graph. */
export interface Entity {
  name: string;
  normalized_name: string;
  entity_type: string;
  properties: Record<string, unknown>;
  document_ids: string[];
  chunk_ids: string[];
}

/** Guardrail / citation verification verdict attached to every answer. */
export interface VerificationSummary {
  status: 'citations_ok' | 'citations_failed' | 'supported' | 'unsupported' | 'unchecked';
  scope: 'format_and_numeric_consistency' | 'llm_judgment' | 'unchecked';
  invalid_citations: number[];
  uncited_claims: string[];
  numeric_mismatches: string[];
  unsupported_claims: string[];
  contradictions: string[];
  details?: string | null;
}

/** Which provider/model actually served the answer, and whether it was a fallback. */
export interface ServingProvenance {
  provider: string | null;
  model: string | null;
  fresh: boolean;
}

/** Request body for `POST /v1/query` (and `/v1/query/stream`). */
export interface QueryRequest {
  query: string;
  tenant_id?: string;
  top_k?: number;
  max_cycles?: number;
  enforce_guardrails?: boolean;
  session_id?: string | null;
}

/** Full agentic-RAG answer envelope. */
export interface QueryResponse {
  query: string;
  answer: string;
  source_chunks: SearchResult[];
  entities: Entity[];
  cycle_count: number;
  verified: boolean;
  refusal: boolean;
  execution_time_ms: number;
  degraded_reason?: string | null;
  serving_provider?: string | null;
  serving_model?: string | null;
  serving: ServingProvenance;
  answer_status: string;
  verification: VerificationSummary;
  sources: SearchResult[];
  request_id?: string | null;
  trace_id?: string | null;
  review_status: { flagged_chunk_ids: string[] };
  timings_ms: Record<string, number>;
  usage?: Record<string, unknown> | null;
}

/** Input/output guardrail decision. */
export interface GuardrailResult {
  allowed: boolean;
  sanitized_text: string;
  policy_violations: string[];
  action_taken: string;
}

/** Row in the Vault (document library). */
export interface DocumentSummary {
  id: string;
  title: string;
  format: string;
  source: string;
  chunk_count?: number;
  created_at?: string;
  metadata?: Record<string, unknown>;
}

/** A single chunk of a document, as shown in the evidence inspector. */
export interface ChunkItem {
  id: string;
  document_id: string;
  text: string;
  chunk_index: number;
  section_heading?: string | null;
  metadata: Record<string, unknown>;
}

/** Per-backend index telemetry for the Ops console. */
export interface IndexStatusResponse {
  vector: {
    collections: string[];
    points_per_collection: Record<string, number>;
    total_points: number | null;
    vector_dimension: number | null;
    is_fallback: boolean;
    detail: string;
  };
  graph: {
    node_count: number | null;
    relationship_count: number | null;
    entity_index_size: number | null;
    is_fallback: boolean;
    detail: string;
  };
  lexical: {
    corpus_size: number | null;
    document_count: number | null;
    is_fallback: boolean;
    detail: string;
  };
  relational: {
    dialect: string | null;
    tables: { name: string; row_count: number }[];
    total_rows: number;
    is_fallback: boolean;
    detail: string;
  };
  backends: Record<
    string,
    { reachable: boolean; is_fallback: boolean; endpoint: string; detail: string }
  >;
}

/** Human-in-the-loop extraction review queue item. */
export interface ReviewItemResponse {
  id: string;
  extracted_field_id: string;
  document_id: string;
  field_name: string;
  value: string;
  confidence: number;
  provenance_page: number;
  status: 'pending' | 'approved' | 'rejected' | 'corrected' | string;
  corrected_value?: string | null;
  notes?: string | null;
}

/** A regression-suite case used by the evaluation harness. */
export interface GoldenCase {
  id: string;
  category: string;
  question: string;
  answerable: boolean;
  expected_doc?: string | null;
  expected_phrases: string[];
  notes: string;
}

/** LLM provider configuration surfaced in Settings. */
export interface LLMSettingsResponse {
  active_provider: string;
  default_model: string;
  base_url: string;
  litellm_base_url?: string | null;
  custom_base_url?: string | null;
  provider_models?: Record<string, string> | null;
  provider_available_models?: Record<string, string[]> | null;
  providers_configured: Record<string, boolean>;
}
