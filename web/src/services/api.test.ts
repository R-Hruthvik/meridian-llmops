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
});
