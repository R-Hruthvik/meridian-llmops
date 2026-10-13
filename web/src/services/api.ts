import type {
  DocumentDetail,
  DocumentListResponse,
  ApiErrorPayload,
  ApiFailureDetail,
  GuardrailResult,
  HealthReadiness,
  IngestRequest,
  IngestResponse,
  IndexStatusResponse,
  LLMPingResponse,
  LLMSettingsGet,
  MaskedLLMSettings,
  LLMTestAndFetchRequest,
  LLMTestAndFetchResponse,
  ProvidersResponse,
  QueryRequest,
  QueryResponse,
  ReviewItem,
  ReviewItemActionPayload,
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
  readonly code?: string;

  constructor(message: string, status: number, detail?: string, code?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
    this.code = code;
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
    // Keep the API key in memory so refreshes require a fresh unlock.
    this.apiKey = '';
    this.baseUrl = '';
  }

  setApiKey(key: string) {
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

  private async requestJSON<T>(url: string, init: RequestInit, errorFallback: string, notifyFailure = true): Promise<T> {
    // NOTE: empty baseUrl is intentional — relative fetch is same-origin in prod
    // (FastAPI serves web/dist) and vite-proxied to :8000 in dev. setBaseUrl()
    // is an opt-in override for remote backends only.
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : errorFallback;
      const apiError = new ApiError(message || errorFallback, 0, message || errorFallback);
      if (notifyFailure) this.publishFailure({ message: apiError.message, status: 0 });
      throw apiError;
    }
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ detail: res.statusText })) as ApiErrorPayload;
      const errorCode = errorData.error?.code;
      const rawDetail = errorData.error?.message ?? errorData.detail;
      const detail = normalizeDetail(rawDetail, `${errorFallback}: ${res.statusText}`);
      const message = res.status === 401
        ? 'Enter API key'
        : res.status === 429
          ? 'Rate limited'
          : res.status === 503 && errorCode === 'index_inconsistent'
            ? 'Index is inconsistent. Run scripts/reindex.py to rebuild it.'
            : detail;
      const action = errorCode === 'index_inconsistent' ? 'Run scripts/reindex.py to rebuild the index.' : undefined;
      const apiError = new ApiError(message, res.status, detail, errorCode);
      if (notifyFailure) this.publishFailure({ message, status: res.status, code: errorCode, action });
      throw apiError;
    }
    return res.json() as Promise<T>;
  }

  private publishFailure(detail: ApiFailureDetail): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<ApiFailureDetail>('meridian:api-error', { detail }));
    }
  }

  async checkHealth(): Promise<HealthReadiness> {
    return this.requestJSON<HealthReadiness>(`${this.baseUrl}/health/ready`, {}, 'Health check failed', false);
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

  /**
   * GET /v1/index/status — read-only live inspection of every storage subsystem.
   * Non-throwing by contract: a down backend arrives as is_fallback + detail,
   * so a 200 here does NOT mean the data is persisted. Only auth/transport
   * failures (401, 500, network) throw.
   */
  async getIndexStatus(tenantId: string = 'default'): Promise<IndexStatusResponse> {
    return this.requestJSON<IndexStatusResponse>(
      `${this.baseUrl}/v1/index/status`,
      {
        method: 'GET',
        headers: this.getHeaders(tenantId),
      },
      'Index status fetch failed',
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

  async testLLMConnection(): Promise<LLMPingResponse> {
    // Quick ping against the saved provider config (empty body — server
    // resolves active provider/model from runtime settings).
    return this.requestJSON<LLMPingResponse>(
      `${this.baseUrl}/v1/settings/llm/test`,
      { method: 'POST', headers: this.getHeaders() },
      'LLM connection test failed',
    );
  }

  async listReviewItems(tenantId: string = 'default'): Promise<ReviewItem[]> {
    return this.requestJSON<ReviewItem[]>(
      `${this.baseUrl}/v1/review/items`,
      { method: 'GET', headers: this.getHeaders(tenantId) },
      'Review queue fetch failed',
    );
  }

  async reviewItemAction(
    itemId: string,
    action: ReviewItemActionPayload,
    tenantId: string = 'default',
  ): Promise<ReviewItem> {
    return this.requestJSON<ReviewItem>(
      `${this.baseUrl}/v1/review/items/${encodeURIComponent(itemId)}/action`,
      {
        method: 'POST',
        headers: this.getHeaders(tenantId),
        body: JSON.stringify(action),
      },
      'Review action failed',
    );
  }
}

export const api = new MeridianApiClient();
