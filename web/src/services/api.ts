import type {
  DocumentDetail,
  DocumentListResponse,
  GuardrailResult,
  HealthStatus,
  IngestRequest,
  IngestResponse,
  LLMSettingsGet,
  MaskedLLMSettings,
  LLMTestAndFetchRequest,
  LLMTestAndFetchResponse,
  ProvidersResponse,
  QueryRequest,
  QueryResponse,
  TenantMetrics,
  UpdateLLMSettingsPayload,
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

/**
 * Normalizes FastAPI error details to a displayable string.
 * 422 responses carry `detail` as an array of {loc, msg, type} objects —
 * join them so the UI never renders "[object Object]".
 */
export function normalizeDetail(detail: unknown, fallback: string): string {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((d) => {
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object') {
        const loc = Array.isArray((d as { loc?: unknown[] }).loc)
          ? (d as { loc: unknown[] }).loc.filter((p) => p !== 'body').join('.')
          : '';
        const msg = (d as { msg?: unknown }).msg;
        return loc && typeof msg === 'string' ? `${loc}: ${msg}` : typeof msg === 'string' ? msg : JSON.stringify(d);
      }
      return String(d);
    });
    if (parts.length > 0) return parts.join('; ');
  }
  return fallback;
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

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
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
    // NOTE: empty baseUrl is intentional — relative fetch is same-origin in prod
    // (FastAPI serves web/dist) and vite-proxied to :8000 in dev. setBaseUrl()
    // is an opt-in override for remote backends only.
    const res = await fetch(url, init);
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ detail: res.statusText }));
      const detail = normalizeDetail(errorData?.detail, `${errorFallback}: ${res.statusText}`);
      throw new ApiError(detail, res.status, detail);
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

  async checkGuardrails(text: string, tenantId: string = 'default'): Promise<GuardrailResult> {
    // Canonical contract: GET /v1/guardrails/check?text= (POST is a deprecated alias).
    return this.requestJSON<GuardrailResult>(
      `${this.baseUrl}/v1/guardrails/check?text=${encodeURIComponent(text)}`,
      {
        method: 'GET',
        headers: this.getHeaders(tenantId),
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

  async getLLMSettings(): Promise<LLMSettingsGet> {
    return this.requestJSON<LLMSettingsGet>(
      `${this.baseUrl}/v1/settings/llm`,
      {
        method: 'GET',
        headers: this.getHeaders(),
      },
      'LLM Settings fetch failed',
    );
  }

  async updateLLMSettings(settings: UpdateLLMSettingsPayload): Promise<MaskedLLMSettings> {
    return this.requestJSON<MaskedLLMSettings>(
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

  async getDocuments(tenantId: string = 'default'): Promise<DocumentListResponse> {
    return this.requestJSON<DocumentListResponse>(
      `${this.baseUrl}/v1/documents`,
      { method: 'GET', headers: this.getHeaders(tenantId) },
      'Documents list fetch failed',
    );
  }

  async getDocument(docId: string, tenantId: string = 'default'): Promise<DocumentDetail> {
    return this.requestJSON<DocumentDetail>(
      `${this.baseUrl}/v1/documents/${encodeURIComponent(docId)}`,
      { method: 'GET', headers: this.getHeaders(tenantId) },
      'Document details fetch failed',
    );
  }

  async deleteDocument(
    docId: string,
    tenantId: string = 'default',
  ): Promise<{ status: string; document_id: string; message: string }> {
    return this.requestJSON<{ status: string; document_id: string; message: string }>(
      `${this.baseUrl}/v1/documents/${encodeURIComponent(docId)}`,
      { method: 'DELETE', headers: this.getHeaders(tenantId) },
      'Document delete failed',
    );
  }

  async clearAllDocuments(
    tenantId: string = 'default',
  ): Promise<{ status: string; deleted_count: number; message: string }> {
    return this.requestJSON<{ status: string; deleted_count: number; message: string }>(
      `${this.baseUrl}/v1/documents`,
      { method: 'DELETE', headers: this.getHeaders(tenantId) },
      'Clear documents failed',
    );
  }

  async seedSampleDocuments(
    tenantId: string = 'default',
  ): Promise<{ status: string; documents_seeded: number }> {
    return this.requestJSON<{ status: string; documents_seeded: number }>(
      `${this.baseUrl}/v1/documents/seed-samples`,
      { method: 'POST', headers: this.getHeaders(tenantId) },
      'Seed sample documents failed',
    );
  }
}

export const api = new MeridianApiClient();
