import type {
  GuardrailCheckRequest,
  GuardrailResult,
  HealthStatus,
  IngestRequest,
  IngestResponse,
  LLMSettings,
  LLMTestAndFetchRequest,
  LLMTestAndFetchResponse,
  QueryRequest,
  QueryResponse,
  TenantMetrics,
} from '../types/api';

/**
 * Extended Error with HTTP status code for UI-level error rendering.
 * Allows the UI to distinguish 400/401/429 etc. and render distinct states.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

class MeridianApiClient {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    // Platform API key is no longer stored in localStorage for security.
    // It is expected to be provided via an HTTP-only cookie set by the backend,
    // or set per-session via `setApiKey()` without persistence.
    // The header-based approach is retained for local dev where the cookie
    // may not be present; callers should use `setApiKey` to inject a key
    // obtained through a secure channel (e.g. a login flow).
    this.apiKey = '';
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

  async checkHealth(): Promise<HealthStatus> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok)
      throw new ApiError(
        `Health check failed: ${res.statusText}`,
        res.status,
      );
    return res.json();
  }

  async query(req: QueryRequest): Promise<QueryResponse> {
    const res = await fetch(`${this.baseUrl}/v1/query`, {
      method: 'POST',
      headers: this.getHeaders(req.tenant_id),
      body: JSON.stringify({
        query: req.query,
        tenant_id: req.tenant_id || 'default',
        top_k: req.top_k ?? 3,
        max_cycles: req.max_cycles ?? 3,
        enforce_guardrails: req.enforce_guardrails ?? true,
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(
        errorData.detail || `Query failed: ${res.statusText}`,
        res.status,
        errorData.detail,
      );
    }

    return res.json();
  }

  async ingest(req: IngestRequest, tenantId: string = 'default'): Promise<IngestResponse> {
    const res = await fetch(`${this.baseUrl}/v1/ingest`, {
      method: 'POST',
      headers: this.getHeaders(tenantId),
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(
        errorData.detail || `Ingestion failed: ${res.statusText}`,
        res.status,
        errorData.detail,
      );
    }

    return res.json();
  }

  async checkGuardrails(req: GuardrailCheckRequest, tenantId: string = 'default'): Promise<GuardrailResult> {
    const res = await fetch(`${this.baseUrl}/v1/guardrails/check`, {
      method: 'POST',
      headers: this.getHeaders(tenantId),
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(
        errorData.detail || `Guardrail check failed: ${res.statusText}`,
        res.status,
        errorData.detail,
      );
    }

    return res.json();
  }

  async getMetrics(tenantId: string = 'default'): Promise<TenantMetrics> {
    const res = await fetch(`${this.baseUrl}/v1/metrics`, {
      method: 'GET',
      headers: this.getHeaders(tenantId),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(
        errorData.detail || `Metrics fetch failed: ${res.statusText}`,
        res.status,
        errorData.detail,
      );
    }

    return res.json();
  }

  async getLLMSettings(): Promise<LLMSettings> {
    const res = await fetch(`${this.baseUrl}/v1/settings/llm`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(
        errorData.detail || `LLM Settings fetch failed: ${res.statusText}`,
        res.status,
        errorData.detail,
      );
    }

    return res.json();
  }

  async updateLLMSettings(settings: Partial<LLMSettings>): Promise<LLMSettings> {
    const res = await fetch(`${this.baseUrl}/v1/settings/llm`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(settings),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(
        errorData.detail || `LLM Settings update failed: ${res.statusText}`,
        res.status,
        errorData.detail,
      );
    }

    return res.json();
  }

  async testAndFetchModels(req: LLMTestAndFetchRequest): Promise<LLMTestAndFetchResponse> {
    const res = await fetch(`${this.baseUrl}/v1/settings/llm/test-and-fetch-models`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(
        errorData.detail || `Model fetch test failed: ${res.statusText}`,
        res.status,
        errorData.detail,
      );
    }

    return res.json();
  }
}

export const api = new MeridianApiClient();
