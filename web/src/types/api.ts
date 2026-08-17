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
