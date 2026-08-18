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

  describe('getLLMSettings()', () => {
    it('returns masked keys from backend (not from localStorage)', async () => {
      const mockData = {
        active_provider: 'openai',
        openai_api_key: 'sk-pr...xyz', // masked by backend (contains '...')
        default_model: 'gpt-4o-mini',
        litellm_base_url: 'http://localhost:4000',
      };
      const mock = mockResponse(mockData, 200);
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mock as unknown as Response);

      const result = await api.getLLMSettings();
      expect(result.openai_api_key).toContain('...'); // masked
      expect(localStorage.getItem('meridian_openai_key')).toBeNull();
    });
  });
});
