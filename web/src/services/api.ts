import type {
  GuardrailCheckRequest,
  GuardrailResult,
  HealthStatus,
  IngestRequest,
  IngestResponse,
  LLMSettings,
  LLMTestResponse,
  QueryRequest,
  QueryResponse,
  TenantMetrics,
} from '../types/api';

const DEFAULT_API_KEY = 'meridian-test-secret-key-2026';

class MeridianApiClient {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = localStorage.getItem('meridian_api_key') || DEFAULT_API_KEY;
    this.baseUrl = '';
  }

  setApiKey(key: string) {
    this.apiKey = key;
    localStorage.setItem('meridian_api_key', key);
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
    if (!res.ok) throw new Error(`Health check failed: ${res.statusText}`);
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
      throw new Error(errorData.detail || `Query failed: ${res.statusText}`);
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
      throw new Error(errorData.detail || `Ingestion failed: ${res.statusText}`);
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
      throw new Error(errorData.detail || `Guardrail check failed: ${res.statusText}`);
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
      throw new Error(errorData.detail || `Metrics fetch failed: ${res.statusText}`);
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
      throw new Error(errorData.detail || `LLM Settings fetch failed: ${res.statusText}`);
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
      throw new Error(errorData.detail || `LLM Settings update failed: ${res.statusText}`);
    }

    return res.json();
  }

  async testLLMConnection(): Promise<LLMTestResponse> {
    const res = await fetch(`${this.baseUrl}/v1/settings/llm/test`, {
      method: 'POST',
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(errorData.detail || `LLM Connection test failed: ${res.statusText}`);
    }

    return res.json();
  }
}

export const api = new MeridianApiClient();
