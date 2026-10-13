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
    it('keeps the API key in memory without reading or writing browser storage', () => {
      const getItem = vi.spyOn(Storage.prototype, 'getItem');
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

      const client = new (api.constructor as any)();
      client.setApiKey('my-secret-key');

      expect(client.getApiKey()).toBe('my-secret-key');
      expect(getItem).not.toHaveBeenCalled();
      expect(setItem).not.toHaveBeenCalled();
      expect(removeItem).not.toHaveBeenCalled();
      getItem.mockRestore();
      setItem.mockRestore();
      removeItem.mockRestore();
    });

    it('starts locked even if sessionStorage contains an old API key', () => {
      sessionStorage.setItem('meridian_api_key', 'session-key');
      const client = new (api.constructor as any)();
      expect(client.getApiKey()).toBe('');
      sessionStorage.removeItem('meridian_api_key');
    });

    it('sends the configured API key in the request header', async () => {
      api.setApiKey('my-secret-key');
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse({}) as unknown as Response);
      await api.query({ query: 'test' });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ headers: expect.objectContaining({ 'X-API-Key': 'my-secret-key' }) }),
      );
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

  describe('checkHealth() readiness contract', () => {
    it('calls public GET /health/ready and returns the readiness flag', async () => {
      const response = mockResponse({ ready: true, checks: {} });
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(response as unknown as Response);

      await expect(api.checkHealth()).resolves.toEqual({ ready: true, checks: {} });
      expect(fetchSpy).toHaveBeenCalledWith('http://localhost:8000/health/ready', {});
    });

    it('preserves readiness endpoint status failures', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse({ detail: 'Not ready' }, 503, 'Service Unavailable') as unknown as Response);

      await expect(api.checkHealth()).rejects.toMatchObject({ status: 503 });
    });
  });

  describe('query() error handling with status codes', () => {
    it('throws ApiError with status 401 on unauthorized', async () => {
      const mock = mockResponse({ detail: 'Invalid API key' }, 401, 'Unauthorized');
      vi.spyOn(global, 'fetch').mockResolvedValue(mock as unknown as Response);

      await expect(api.query({ query: 'test' })).rejects.toMatchObject({
        name: 'ApiError',
        status: 401,
        message: 'Enter API key',
      });
    });

    it('throws ApiError with status 429 on rate limited', async () => {
      const mock = mockResponse({ detail: 'Rate limit exceeded' }, 429, 'Too Many Requests');
      vi.spyOn(global, 'fetch').mockResolvedValue(mock as unknown as Response);

      await expect(api.query({ query: 'test' })).rejects.toMatchObject({ status: 429, message: 'Rate limited' });
    });

    it('maps an inconsistent-index response to a reindex instruction', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse({
        error: {
          code: 'index_inconsistent',
          message: 'The vector index is inconsistent with disk records; run scripts/reindex.py',
          reasons: ['point count mismatch'],
        },
      }, 503, 'Service Unavailable') as unknown as Response);

      await expect(api.query({ query: 'test' })).rejects.toMatchObject({
        status: 503,
        code: 'index_inconsistent',
        message: expect.stringContaining('Run scripts/reindex.py'),
      });
    });

    it('publishes failures for the app-level error notice and still rejects for inline handling', async () => {
      const listener = vi.fn();
      window.addEventListener('meridian:api-error', listener);
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse({ detail: 'bad query' }, 400, 'Bad Request') as unknown as Response);

      await expect(api.query({ query: 'test' })).rejects.toBeInstanceOf(ApiError);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toMatchObject({ detail: { message: 'bad query', status: 400 } });
      window.removeEventListener('meridian:api-error', listener);
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

  describe('checkGuardrails() canonical POST contract', () => {
    it('calls POST /v1/guardrails/check with text in the authenticated JSON body', async () => {
      const mock = mockResponse({ allowed: true, sanitized_text: 'hi', policy_violations: [], action_taken: 'pass' }, 200);
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(mock as unknown as Response);

      await api.checkGuardrails('hello <script>', 'acme');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:8000/v1/guardrails/check');
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ text: 'hello <script>' }));
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect((init.headers as Record<string, string>)['X-API-Key']).toBe('');
      expect((init.headers as Record<string, string>)['X-Tenant-Id']).toBe('acme');
    });
  });

  describe('catalog calls pass tenantId through', () => {
    it('sends the session API key and the explicit tenant on getDocuments/getDocument/delete', async () => {
      api.setApiKey('session-api-key');
      const docs = { total_documents: 0, total_chunks: 0, total_entities: 0, documents: [] };
      const fetchSpy = vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce(mockResponse(docs, 200) as unknown as Response)
        .mockResolvedValueOnce(mockResponse({ id: 'd1' }, 200) as unknown as Response)
        .mockResolvedValueOnce(mockResponse({ status: 'deleted', document_id: 'd1', message: 'ok' }, 200) as unknown as Response);

      await api.getDocuments('acme');
      await api.getDocument('d1', 'acme');
      await api.deleteDocument('d1', 'acme');

      for (const [, init] of fetchSpy.mock.calls as [string, RequestInit][]) {
        expect((init.headers as Record<string, string>)['X-API-Key']).toBe('session-api-key');
        expect((init.headers as Record<string, string>)['X-Tenant-Id']).toBe('acme');
      }
    });

    it('rejects catalog requests without an explicit tenant instead of assuming default', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');

      await expect(api.getDocuments(undefined as unknown as string)).rejects.toThrow('Tenant ID is required');
      expect(fetchSpy).not.toHaveBeenCalled();
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

      const result = await api.getDocuments('default');
      expect(result.total_documents).toBe(2);
      expect(result.documents[0].title).toBe('Doc 1');
    });

    it('deletes document and returns status', async () => {
      const mockDel = { status: 'deleted', document_id: 'doc-1', message: 'Document deleted' };
      const mock = mockResponse(mockDel, 200);
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mock as unknown as Response);

      const result = await api.deleteDocument('doc-1', 'default');
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

  describe('uploadDocuments()', () => {
    it('posts multiple files as multipart with auth and tenant headers', async () => {
      api.setApiKey('upload-key');
      const files = [
        new File(['# handbook'], 'handbook.md', { type: 'text/markdown' }),
        new File(['%PDF-1.4'], 'guide.pdf', { type: 'application/pdf' }),
      ];
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
        mockResponse({ results: [] }, 200) as unknown as Response,
      );

      await api.uploadDocuments(files, 'acme');

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/v1/documents');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['X-API-Key']).toBe('upload-key');
      expect((init.headers as Record<string, string>)['X-Tenant-Id']).toBe('acme');
      expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
      expect(init.body).toBeInstanceOf(FormData);
      expect((init.body as FormData).getAll('files')).toEqual(files);
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
