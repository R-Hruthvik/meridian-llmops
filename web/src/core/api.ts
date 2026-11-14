/**
 * Meridian — API layer.
 *
 * One thin, typed fetch wrapper plus an SSE reader for the streaming query
 * endpoint. No SDK, no client-side state: everything the UI knows about the
 * backend flows through these two functions.
 */
import type { QueryRequest } from './types';

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/** localStorage key for the optional API-key override. Mirrors `core/auth`. */
export const API_KEY_STORAGE_KEY = 'meridian_api_key';

let apiBaseUrl = '';

/** Point the API layer at an absolute origin (e.g. `https://api.meridian.dev`). */
export function setApiBaseUrl(baseUrl: string): void {
  apiBaseUrl = baseUrl.replace(/\/+$/, '');
}

/** Read the base URL: explicit setting, then a runtime global, then same-origin. */
function resolveBaseUrl(): string {
  if (apiBaseUrl) return apiBaseUrl;
  const globalScope = globalThis as typeof globalThis & {
    __MERIDIAN_API_BASE__?: string;
  };
  const injected = globalScope.__MERIDIAN_API_BASE__;
  return typeof injected === 'string' ? injected.replace(/\/+$/, '') : '';
}

/** Join base + path without double slashes. Absolute URLs pass through. */
export function buildUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = resolveBaseUrl();
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

/** The API-key override, if the operator set one in this browser. */
export function getStoredApiKey(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(API_KEY_STORAGE_KEY);
    return value && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Structured failure carrying the HTTP status and the FastAPI `detail` body.
 * `detail` is `unknown` on purpose: FastAPI returns either a string or a list
 * of validation objects.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(message: string, status: number, detail: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    // Keep `instanceof` working when compiled down to ES5.
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** Best-effort human-readable rendering of `detail`. */
  get detailMessage(): string | null {
    const { detail } = this;
    if (detail == null) return null;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      const parts = detail
        .map((item) =>
          typeof item === 'object' && item !== null && 'msg' in item
            ? String((item as { msg: unknown }).msg)
            : JSON.stringify(item),
        )
        .filter((part): part is string => typeof part === 'string');
      return parts.length > 0 ? parts.join('; ') : null;
    }
    if (typeof detail === 'object') {
      try {
        return JSON.stringify(detail);
      } catch {
        return null;
      }
    }
    return String(detail);
  }

  /** True for 5xx — the UI uses this to distinguish "our fault" from "yours". */
  get isServerError(): boolean {
    return this.status >= 500;
  }
}

/** Pull `detail` out of a failed response without assuming a JSON body. */
async function readErrorDetail(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (!text) return null;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null && 'detail' in parsed) {
        return (parsed as { detail: unknown }).detail;
      }
      return parsed;
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Core fetch                                                                 */
/* -------------------------------------------------------------------------- */

function isFormData(body: BodyInit | null | undefined): boolean {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

function buildHeaders(init: HeadersInit | undefined, body: BodyInit | null | undefined): Headers {
  const headers = new Headers(init);

  // Never override a caller-supplied content type; never set one on FormData
  // (the browser must append the multipart boundary itself).
  if (!isFormData(body) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const apiKey = getStoredApiKey();
  if (apiKey && !headers.has('X-API-Key')) {
    headers.set('X-API-Key', apiKey);
  }

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  return headers;
}

/**
 * Typed fetch against the Meridian backend.
 *
 * Attaches `X-API-Key` when an override is stored and `Content-Type:
 * application/json` unless the body is `FormData`. Throws {@link ApiError} with
 * `status` + `detail` on any non-2xx response.
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path), {
      ...options,
      headers: buildHeaders(options.headers, options.body),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(
      cause instanceof Error ? `Network request failed: ${cause.message}` : 'Network request failed',
      0,
      null,
    );
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    const message =
      (typeof detail === 'string' && detail) ||
      response.statusText ||
      `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, detail);
  }

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    const text = await response.text();
    return (text === '' ? undefined : text) as T;
  }

  try {
    return (await response.json()) as T;
  } catch (cause) {
    throw new ApiError(
      cause instanceof Error ? `Malformed JSON response: ${cause.message}` : 'Malformed JSON response',
      response.status,
      null,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Server-Sent Events                                                         */
/* -------------------------------------------------------------------------- */

export interface StreamHandlers {
  /** Called once per SSE frame with the parsed JSON payload (or raw string). */
  onEvent: (event: string, data: unknown) => void;
  /** Called for transport, HTTP and parse failures. Aborts are not errors. */
  onError: (err: Error) => void;
  /** Optional cancellation signal; aborting resolves the promise cleanly. */
  signal?: AbortSignal;
}

export interface ParsedEvent {
  event: string;
  data: unknown;
}

/**
 * Parse one `event:`/`data:` frame. Returns `null` for comment-only or empty
 * frames. Exported for tests.
 */
export function parseSseFrame(frame: string): ParsedEvent | null {
  let event = 'message';
  const dataLines: string[] = [];

  for (const rawLine of frame.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(':')) continue; // comment / keep-alive
    const colon = rawLine.indexOf(':');
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? '' : rawLine.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1); // spec: strip one space

    if (field === 'event') event = value || 'message';
    else if (field === 'data') dataLines.push(value);
    // `id:` and `retry:` are intentionally ignored.
  }

  if (dataLines.length === 0) return null;

  const payload = dataLines.join('\n');
  let data: unknown = payload;
  try {
    data = JSON.parse(payload) as unknown;
  } catch {
    /* not JSON — forward the raw string */
  }

  return { event, data };
}

/** Split complete frames off the buffer, invoking `onEvent` for each. */
function drainFrames(buffer: string, onEvent: (event: string, data: unknown) => void): string {
  let rest = buffer;
  let boundary = rest.search(/\r?\n\r?\n/);
  while (boundary !== -1) {
    const frame = rest.slice(0, boundary);
    const separator = rest.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n';
    rest = rest.slice(boundary + separator.length);
    const parsed = parseSseFrame(frame);
    if (parsed) onEvent(parsed.event, parsed.data);
    boundary = rest.search(/\r?\n\r?\n/);
  }
  return rest;
}

/**
 * Stream an agentic query (`POST /v1/query/stream`), dispatching each SSE frame
 * to `handlers.onEvent`. Resolves when the stream closes; aborts resolve
 * quietly. Keeps a single request alive — the caller owns reconnection policy.
 */
export async function streamQuery(req: QueryRequest, handlers: StreamHandlers): Promise<void> {
  const { onEvent, onError, signal } = handlers;

  let response: Response;
  try {
    response = await fetch(buildUrl('/v1/query/stream'), {
      method: 'POST',
      headers: buildHeaders({ Accept: 'text/event-stream' }, null),
      body: JSON.stringify(req),
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return;
    onError(
      cause instanceof Error
        ? new ApiError(`Stream request failed: ${cause.message}`, 0, null)
        : new ApiError('Stream request failed', 0, null),
    );
    return;
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    onError(
      new ApiError(
        (typeof detail === 'string' && detail) ||
          response.statusText ||
          `Stream failed with status ${response.status}`,
        response.status,
        detail,
      ),
    );
    return;
  }

  if (!response.body) {
    onError(new ApiError('Stream response had no readable body', response.status, null));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = drainFrames(buffer, onEvent);
    }

    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      const tail = drainFrames(`${buffer}\n\n`, onEvent);
      const parsed = parseSseFrame(tail);
      if (parsed) onEvent(parsed.event, parsed.data);
    }
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return;
    onError(cause instanceof Error ? cause : new Error('Stream read failed'));
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}
