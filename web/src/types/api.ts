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

export interface QueryResponse {
  query: string;
  answer: string;
  source_chunks: SearchResult[];
  entities: Entity[];
  cycle_count: number;
  verified: boolean;
  refusal: boolean;
  execution_time_ms: number;
  serving_provider?: string;
  serving_model?: string;
}

export interface IngestRequest {
  title: string;
  text: string;
  source?: string;
}

export interface IngestResponse {
  document_id: string;
  title: string;
  chunks_indexed: number;
  entities_extracted: number;
  relationships_extracted: number;
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

export interface HealthStatus {
  status: string;
  service: string;
}

export interface LLMSettings {
  active_provider: string;
  openai_api_key?: string;
  openai_org_id?: string;
  openai_proj_id?: string;
  anthropic_api_key?: string;
  groq_api_key?: string;
  openrouter_api_key?: string;
  deepseek_api_key?: string;
  custom_api_key?: string;
  custom_base_url?: string;
  default_model: string;
  litellm_base_url: string;
}

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
