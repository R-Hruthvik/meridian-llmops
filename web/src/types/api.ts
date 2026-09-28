export interface SearchResult {
  chunk_id: string;
  document_id: string;
  text: string;
  score: number;
  retrieval_method: string;
  metadata?: Record<string, any>;
}

export interface Entity {
  name: string;
  entity_type: string;
  properties?: Record<string, any>;
}

export interface QueryRequest {
  query: string;
  tenant_id?: string;
  top_k?: number;
  max_cycles?: number;
  enforce_guardrails?: boolean;
}

/**
 * Who actually served a query response. Nulls mean no LLM produced the answer.
 * Mirrors the backend ServingProvenance model.
 */
export interface ServingProvenance {
  /** Provider that actually served the request, or null when no LLM served it. */
  provider: string | null;
  /** Model the upstream reported it served, or null when no LLM served it. */
  model: string | null;
  /** True only when this request's own upstream call returned non-empty content. */
  fresh: boolean;
}

export interface QueryResponse {
  query: string;
  answer: string;
  source_chunks: SearchResult[];
  entities: Entity[];
  cycle_count: number;
  verified: boolean;
  refusal: boolean;
  execution_time_ms: number;
  /** @deprecated Backward-compat config echo — use `serving` when present. */
  serving_provider?: string | null;
  /** @deprecated Backward-compat config echo — use `serving` when present. */
  serving_model?: string | null;
  /** Authoritative serving provenance. Optional: absent on older backends. */
  serving?: ServingProvenance;
  degraded_reason?: string | null;
}

export interface IngestRequest {
  title: string;
  text: string;
  source?: string;
}

export interface IngestResponse {
  document_id: string;
  title: string;
  filename?: string;
  chunks_indexed: number;
  entities_extracted: number;
  relationships_extracted: number;
  created_at?: string;
}

export interface GuardrailCheckRequest {
  text: string;
}

export interface GuardrailResult {
  allowed: boolean;
  sanitized_text: string;
  policy_violations: string[];
  action_taken: string;
}

export interface TenantMetrics {
  tenant_id: string;
  total_requests: number;
  total_tokens: number;
  total_cost_usd: number;
}

export interface HealthServiceStatus {
  status: string;
  endpoint: string;
  reachable: boolean;
}

export interface HealthStatus {
  status: string;
  service: string;
  storage_documents?: number;
  vector_chunks?: number;
  services?: Record<string, HealthServiceStatus>;
}

/** Masked key status returned by POST /v1/settings/llm (never key material). */
export interface MaskedKeyStatus {
  configured: boolean;
  hint?: string;
}

/**
 * GET /v1/settings/llm view: provider booleans only, no key material.
 * Keys are never exposed — per-provider state lives in `providers_configured`.
 */
export interface LLMSettingsGet {
  active_provider: string;
  default_model: string;
  litellm_base_url?: string;
  custom_base_url?: string;
  provider_models?: Record<string, string>;
  provider_available_models?: Record<string, string[]>;
  providers_configured: Record<string, boolean>;
}

/**
 * POST /v1/settings/llm masked view: same scalar fields, but secret-suffixed
 * keys are `{configured, hint}` objects (hint = last-4, or "****").
 */
export interface MaskedLLMSettings {
  active_provider: string;
  default_model: string;
  litellm_base_url?: string;
  custom_base_url?: string;
  openai_org_id?: string;
  provider_models?: Record<string, string>;
  provider_available_models?: Record<string, string[]>;
  providers_configured?: Record<string, boolean>;
  openai_api_key?: MaskedKeyStatus;
  anthropic_api_key?: MaskedKeyStatus;
  groq_api_key?: MaskedKeyStatus;
  openrouter_api_key?: MaskedKeyStatus;
  deepseek_api_key?: MaskedKeyStatus;
  custom_api_key?: MaskedKeyStatus;
}

/**
 * Payload for POST /v1/settings/llm (UpdateLLMSettingsRequest, extra="forbid").
 * Only these fields are accepted — unknown fields (e.g. openai_proj_id,
 * litellm_base_url) are rejected with 422. Blank strings are dropped
 * server-side ("blank preserves saved").
 */
export interface UpdateLLMSettingsPayload {
  provider?: string;
  api_key?: string;
  custom_api_key?: string;
  openai_api_key?: string;
  anthropic_api_key?: string;
  groq_api_key?: string;
  openrouter_api_key?: string;
  deepseek_api_key?: string;
  active_provider?: string;
  openai_org_id?: string;
  default_model?: string;
  custom_base_url?: string;
  model?: string;
  base_url?: string;
  timeout_seconds?: number;
  enforce_guardrails?: boolean;
  max_cycles?: number;
}

/** @deprecated Use LLMSettingsGet (GET view) or MaskedLLMSettings (POST view). */
export type LLMSettings = LLMSettingsGet;

export interface LLMTestAndFetchRequest {
  provider: string;
  api_key?: string;
  base_url?: string;
  organization_id?: string;
  project_id?: string;
  model?: string;
}

export interface LLMTestAndFetchResponse {
  status: string;
  success: boolean;
  provider: string;
  message: string;
  latency_ms: number;
  models: string[];
}

export interface DocumentChunk {
  id: string;
  chunk_index: number;
  section_heading?: string | null;
  text: string;
  metadata?: Record<string, any>;
  embedding?: number[] | null;
}

export interface DocumentSummary {
  id: string;
  title: string;
  format: string;
  source: string;
  created_at: string;
  char_count: number;
  chunk_count: number;
  entities_count: number;
  relationships_count: number;
  snippet: string;
}

export interface DocumentDetail extends DocumentSummary {
  text: string;
  chunks: DocumentChunk[];
}

export interface DocumentListResponse {
  total_documents: number;
  total_chunks: number;
  total_entities: number;
  documents: DocumentSummary[];
}

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  configured: boolean;
  is_active: boolean;
  base_url: string;
  current_model: string;
  models: string[];
  type: 'cloud' | 'local' | 'custom';
}

export interface ProvidersResponse {
  active_provider: string;
  providers: ProviderInfo[];
}

export interface LLMPingResponse {
  status: string;
  message: string;
  latency_ms: number;
}

export interface ReviewItem {
  id: string;
  extracted_field_id: string;
  document_id: string;
  field_name: string;
  value: string;
  confidence: number;
  provenance_page: number;
  status: string;
  corrected_value?: string | null;
  notes?: string | null;
}

export interface ReviewItemActionPayload {
  action: string;
  corrected_value?: string;
  notes?: string;
}
