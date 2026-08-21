import type {
  DocumentDetail,
  DocumentListResponse,
  GuardrailCheckRequest,
  GuardrailResult,
  HealthStatus,
  IngestRequest,
  IngestResponse,
  LLMSettings,
  LLMTestAndFetchRequest,
  LLMTestAndFetchResponse,
  ProvidersResponse,
  QueryRequest,
  QueryResponse,
  TenantMetrics,
} from '../types/api';

/**
 * Extended Error with HTTP status code for UI-level error rendering.
 * Allows the UI to distinguish 400/401/429 etc. and render distinct states.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
    this.name = 'ApiError';
  }
}

class MeridianApiClient {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    // Secret must be provided via VITE_MERIDIAN_API_KEY env or setApiKey(); never bake a default secret.
    // Empty string forces backend 401 until caller configures a valid key.
    this.apiKey = (import.meta as any).env?.VITE_MERIDIAN_API_KEY || '';
    this.baseUrl = '';
  }

  setApiKey(key: string) {
    // Store in memory only — never persist to localStorage to avoid XSS exposure.
    this.apiKey = key;
  }

  getApiKey(): string {
    return this.apiKey;
  }

  private getHeaders(tenantId: string = 'default'): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
      'X-Tenant-Id': tenantId,
    };
  }

  private async requestJSON<T>(url: string, init: RequestInit, errorFallback: string): Promise<T> {
    const res = await fetch(url, init);
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(errorData.detail || `${errorFallback}: ${res.statusText}`, res.status, errorData.detail);
    }
    return res.json() as Promise<T>;
  }

  async checkHealth(): Promise<HealthStatus> {
    return this.requestJSON<HealthStatus>(`${this.baseUrl}/health`, {}, 'Health check failed');
  }

  async query(req: QueryRequest): Promise<QueryResponse> {
    return this.requestJSON<QueryResponse>(
      `${this.baseUrl}/v1/query`,
      {
        method: 'POST',
        headers: this.getHeaders(req.tenant_id),
        body: JSON.stringify({
          query: req.query,
          tenant_id: req.tenant_id || 'default',
          top_k: req.top_k ?? 3,
          max_cycles: req.max_cycles ?? 3,
          enforce_guardrails: req.enforce_guardrails ?? true,
        }),
      },
      'Query failed',
    );
  }

  async ingest(req: IngestRequest, tenantId: string = 'default'): Promise<IngestResponse> {
    return this.requestJSON<IngestResponse>(
      `${this.baseUrl}/v1/ingest`,
      {
        method: 'POST',
        headers: this.getHeaders(tenantId),
        body: JSON.stringify(req),
      },
      'Ingestion failed',
    );
  }

  async checkGuardrails(req: GuardrailCheckRequest, tenantId: string = 'default'): Promise<GuardrailResult> {
    return this.requestJSON<GuardrailResult>(
      `${this.baseUrl}/v1/guardrails/check`,
      {
        method: 'POST',
        headers: this.getHeaders(tenantId),
        body: JSON.stringify(req),
      },
      'Guardrail check failed',
    );
  }

  async getMetrics(tenantId: string = 'default'): Promise<TenantMetrics> {
    return this.requestJSON<TenantMetrics>(
      `${this.baseUrl}/v1/metrics`,
      {
        method: 'GET',
        headers: this.getHeaders(tenantId),
      },
      'Metrics fetch failed',
    );
  }

  async getLLMSettings(): Promise<LLMSettings> {
    return this.requestJSON<LLMSettings>(
      `${this.baseUrl}/v1/settings/llm`,
      {
        method: 'GET',
        headers: this.getHeaders(),
      },
      'LLM Settings fetch failed',
    );
  }

  async updateLLMSettings(settings: Partial<LLMSettings>): Promise<LLMSettings> {
    return this.requestJSON<LLMSettings>(
      `${this.baseUrl}/v1/settings/llm`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(settings),
      },
      'LLM Settings update failed',
    );
  }

  async testAndFetchModels(req: LLMTestAndFetchRequest): Promise<LLMTestAndFetchResponse> {
    return this.requestJSON<LLMTestAndFetchResponse>(
      `${this.baseUrl}/v1/settings/llm/test-and-fetch-models`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(req),
      },
      'Model fetch test failed',
    );
  }

  async getProviders(): Promise<ProvidersResponse> {
    return this.requestJSON<ProvidersResponse>(
      `${this.baseUrl}/v1/settings/providers`,
      { method: 'GET', headers: this.getHeaders() },
      'Providers fetch failed',
    );
  }

  async getDocuments(): Promise<DocumentListResponse> {
    return this.requestJSON<DocumentListResponse>(
      `${this.baseUrl}/v1/documents`,
      { method: 'GET', headers: this.getHeaders() },
      'Documents list fetch failed',
    );
  }

  async getDocument(docId: string): Promise<DocumentDetail> {
    return this.requestJSON<DocumentDetail>(
      `${this.baseUrl}/v1/documents/${encodeURIComponent(docId)}`,
      { method: 'GET', headers: this.getHeaders() },
      'Document details fetch failed',
    );
  }

  async deleteDocument(docId: string): Promise<{ status: string; document_id: string; message: string }> {
    return this.requestJSON<{ status: string; document_id: string; message: string }>(
      `${this.baseUrl}/v1/documents/${encodeURIComponent(docId)}`,
      { method: 'DELETE', headers: this.getHeaders() },
      'Document delete failed',
    );
  }

  async clearAllDocuments(): Promise<{ status: string; deleted_count: number; message: string }> {
    return this.requestJSON<{ status: string; deleted_count: number; message: string }>(
      `${this.baseUrl}/v1/documents`,
      { method: 'DELETE', headers: this.getHeaders() },
      'Clear documents failed',
    );
  }

  async seedSampleDocuments(): Promise<{ status: string; documents_seeded: number }> {
    return this.requestJSON<{ status: string; documents_seeded: number }>(
      `${this.baseUrl}/v1/documents/seed-samples`,
      { method: 'POST', headers: this.getHeaders() },
      'Seed sample documents failed',
    );
  }
}

export const api = new MeridianApiClient();
