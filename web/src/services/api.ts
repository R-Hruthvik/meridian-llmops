import type {
  GuardrailCheckRequest,
  GuardrailResult,
  HealthStatus,
  IngestRequest,
  IngestResponse,
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
}

export const api = new MeridianApiClient();
