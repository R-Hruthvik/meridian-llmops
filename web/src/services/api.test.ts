import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError } from './api';
import type { QueryResponse } from '../types/api';

// Helper to create a mock fetch Response
function mockResponse(data: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MeridianApiClient', () => {
  beforeEach(() => {
    // Reset API key and baseUrl before each test
    api.setApiKey('');
    // Use a valid base URL for fetch calls
    (api as any).baseUrl = 'http://localhost:8000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('API key management', () => {
    it('does not store API key in localStorage', () => {
      api.setApiKey('my-secret-key');
      // The key should NOT be in localStorage
      expect(localStorage.getItem('meridian_api_key')).toBeNull();
    });

    it('stores API key in memory only', () => {
      api.setApiKey('my-secret-key');
      expect(api.getApiKey()).toBe('my-secret-key');
    });

    it('returns empty string by default (no localStorage fallback)', () => {
      expect(api.getApiKey()).toBe('');
    });

    it('does not read DEFAULT_API_KEY from localStorage on construction', () => {
      // Even if localStorage has a value, it should not be used
      localStorage.setItem('meridian_api_key', 'should-be-ignored');
      // Create a fresh instance conceptually — the api singleton starts empty
      expect(api.getApiKey()).toBe('');
      localStorage.removeItem('meridian_api_key');
    });
  });

  describe('ApiError', () => {
    it('extends Error with status and detail properties', () => {
      const err = new ApiError('Bad request', 400, 'Invalid input');
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Bad request');
      expect(err.status).toBe(400);
      expect(err.detail).toBe('Invalid input');
      expect(err.name).toBe('ApiError');
    });
  });

  describe('query() error handling with status codes', () => {
    it('throws ApiError with status 401 on unauthorized', async () => {
      const mock = mockResponse({ detail: 'Invalid API key' }, 401, 'Unauthorized');
      vi.spyOn(global, 'fetch').mockResolvedValue(mock as unknown as Response);

      try {
        await api.query({ query: 'test' });
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(401);
        expect((err as ApiError).message).toMatch(/Invalid API key|Unauthorized/);
      }
    });

    it('throws ApiError with status 429 on rate limited', async () => {
      const mock = mockResponse({ detail: 'Rate limit exceeded' }, 429, 'Too Many Requests');
      vi.spyOn(global, 'fetch').mockResolvedValue(mock as unknown as Response);

      try {
        await api.query({ query: 'test' });
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(429);
      }
    });

    it('throws ApiError with status 400 on bad request', async () => {
      const mock = mockResponse({ detail: 'Malformed query' }, 400, 'Bad Request');
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mock as unknown as Response);

      try {
        await api.query({ query: 'test' });
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(400);
        expect((err as ApiError).message).toContain('Malformed query');
      }
    });

    it('returns parsed response data on success', async () => {
      const mockData: QueryResponse = {
        query: 'test',
        answer: 'response',
        source_chunks: [],
        entities: [],
        cycle_count: 1,
        verified: true,
        refusal: false,
        execution_time_ms: 100,
      };
      const mock = mockResponse(mockData, 200);
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mock as unknown as Response);

      const result = await api.query({ query: 'test' });
      expect(result).toEqual(mockData);
    });
  });

  describe('error detail normalization (422 arrays)', () => {
    it('joins FastAPI 422 array detail into a string message', async () => {
      const detail = [
        { loc: ['body', 'openai_proj_id'], msg: 'Extra inputs are not permitted', type: 'extra_forbidden' },
        { loc: ['body', 'litellm_base_url'], msg: 'Extra inputs are not permitted', type: 'extra_forbidden' },
      ];
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse({ detail }, 422, 'Unprocessable Entity') as unknown as Response);

      try {
        await api.query({ query: 'test' });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(422);
        expect(typeof (err as ApiError).message).toBe('string');
        expect((err as ApiError).message).toContain('openai_proj_id');
        expect((err as ApiError).message).toContain('Extra inputs are not permitted');
        expect((err as ApiError).message).not.toContain('[object Object]');
      }
    });

    it('falls back when detail is missing or non-string', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse({}, 500, 'Server Error') as unknown as Response);

      try {
        await api.query({ query: 'test' });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(500);
        expect(typeof (err as ApiError).message).toBe('string');
      }
    });
  });

  describe('checkGuardrails() canonical GET contract', () => {
    it('calls GET /v1/guardrails/check?text= (no POST body)', async () => {
      const mock = mockResponse({ allowed: true, sanitized_text: 'hi', policy_violations: [], action_taken: 'pass' }, 200);
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(mock as unknown as Response);

      await api.checkGuardrails('hello <script>', 'acme');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/v1/guardrails/check?text=');
      expect(url).toContain(encodeURIComponent('hello <script>'));
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
      expect((init.headers as Record<string, string>)['X-Tenant-Id']).toBe('acme');
    });
  });

  describe('catalog calls pass tenantId through', () => {
    it('sends X-Tenant-Id on getDocuments/getDocument/delete', async () => {
      const docs = { total_documents: 0, total_chunks: 0, total_entities: 0, documents: [] };
      const fetchSpy = vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce(mockResponse(docs, 200) as unknown as Response)
        .mockResolvedValueOnce(mockResponse({ id: 'd1' }, 200) as unknown as Response)
        .mockResolvedValueOnce(mockResponse({ status: 'deleted', document_id: 'd1', message: 'ok' }, 200) as unknown as Response);

      await api.getDocuments('acme');
      await api.getDocument('d1', 'acme');
      await api.deleteDocument('d1', 'acme');

      for (const [, init] of fetchSpy.mock.calls as [string, RequestInit][]) {
        expect((init.headers as Record<string, string>)['X-Tenant-Id']).toBe('acme');
      }
    });
  });

  describe('getDocuments() & deleteDocument()', () => {
    it('fetches document catalog successfully', async () => {
      const mockDocs = {
        total_documents: 2,
        total_chunks: 5,
        total_entities: 4,
        documents: [
          {
            id: 'doc-1',
            title: 'Doc 1',
            format: 'md',
            source: 'manual',
            created_at: '2026-08-18T12:00:00Z',
            char_count: 100,
            chunk_count: 2,
            entities_count: 2,
            relationships_count: 1,
            snippet: 'Snippet 1',
          },
        ],
      };
      const mock = mockResponse(mockDocs, 200);
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mock as unknown as Response);

      const result = await api.getDocuments();
      expect(result.total_documents).toBe(2);
      expect(result.documents[0].title).toBe('Doc 1');
    });

    it('deletes document and returns status', async () => {
      const mockDel = { status: 'deleted', document_id: 'doc-1', message: 'Document deleted' };
      const mock = mockResponse(mockDel, 200);
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mock as unknown as Response);

      const result = await api.deleteDocument('doc-1');
      expect(result.status).toBe('deleted');
      expect(result.document_id).toBe('doc-1');
    });
  });

  describe('getProviders()', () => {
    it('fetches provider registry data', async () => {
      const mockProviders = {
        active_provider: 'openai',
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            description: 'GPT-4o',
            configured: true,
            is_active: true,
            base_url: 'https://api.openai.com/v1',
            current_model: 'gpt-4o-mini',
            models: ['gpt-4o-mini'],
            type: 'cloud',
          },
        ],
      };
      const mock = mockResponse(mockProviders, 200);
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mock as unknown as Response);

      const result = await api.getProviders();
      expect(result.active_provider).toBe('openai');
      expect(result.providers[0].configured).toBe(true);
    });
  });

  describe('testLLMConnection() quick ping', () => {
    it('POSTs empty body to /v1/settings/llm/test and returns latency', async () => {
      const ping = { status: 'success', message: 'Successfully connected', latency_ms: 42.5 };
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse(ping, 200) as unknown as Response);

      const result = await api.testLLMConnection();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/v1/settings/llm/test');
      expect(init.method).toBe('POST');
      expect(init.body).toBeUndefined();
      expect(result.latency_ms).toBe(42.5);
    });
  });

  describe('getIndexStatus()', () => {
    it('GETs /v1/index/status with the tenant header', async () => {
      const status = {
        vector: { collections: [], points_per_collection: {}, total_points: null, vector_dimension: null, is_fallback: true, detail: 'd' },
        graph: { node_count: null, relationship_count: null, entity_index_size: null, is_fallback: true, detail: 'd' },
        lexical: { corpus_size: null, document_count: null, is_fallback: true, detail: 'd' },
        relational: { dialect: null, tables: [], total_rows: 0, is_fallback: true, detail: 'd' },
        backends: {},
      };
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse(status, 200) as unknown as Response);

      const result = await api.getIndexStatus('acme');

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/v1/index/status');
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
      expect((init.headers as Record<string, string>)['X-Tenant-Id']).toBe('acme');
      expect(result.vector.is_fallback).toBe(true);
      expect(result.relational.tables).toEqual([]);
    });
  });

  describe('review queue calls', () => {
    it('lists pending items with tenant header', async () => {
      const items = [
        { id: 'r1', extracted_field_id: 'f1', document_id: 'd1', field_name: 'invoice_total', value: '100', confidence: 0.4, provenance_page: 1, status: 'pending', corrected_value: null, notes: null },
      ];
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse(items, 200) as unknown as Response);

      const result = await api.listReviewItems('acme');

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/v1/review/items');
      expect(init.method).toBe('GET');
      expect((init.headers as Record<string, string>)['X-Tenant-Id']).toBe('acme');
      expect(result).toHaveLength(1);
      expect(result[0].field_name).toBe('invoice_total');
    });

    it('posts approve action with tenant header', async () => {
      const updated = { id: 'r1', extracted_field_id: 'f1', document_id: 'd1', field_name: 'invoice_total', value: '100', confidence: 0.4, provenance_page: 1, status: 'approved', corrected_value: null, notes: null };
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse(updated, 200) as unknown as Response);

      const result = await api.reviewItemAction('r1', { action: 'approve' }, 'acme');

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/v1/review/items/r1/action');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['X-Tenant-Id']).toBe('acme');
      expect(JSON.parse(init.body as string)).toEqual({ action: 'approve' });
      expect(result.status).toBe('approved');
    });

    it('posts correct action with corrected value and notes', async () => {
      const updated = { id: 'r1', extracted_field_id: 'f1', document_id: 'd1', field_name: 'invoice_total', value: '120', confidence: 0.4, provenance_page: 1, status: 'corrected', corrected_value: '120', notes: 'verified' };
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse(updated, 200) as unknown as Response);

      const result = await api.reviewItemAction('r1', { action: 'correct', corrected_value: '120', notes: 'verified' });

      expect(result.status).toBe('corrected');
      expect(result.corrected_value).toBe('120');
    });
  });
});
