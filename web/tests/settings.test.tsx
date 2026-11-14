/**
 * Session 5 contract tests — Gateway settings + root assembly.
 *
 * The interesting part is the update contract: `POST /v1/settings/llm` must carry
 * only non-empty, changed fields and never an unknown key. Those builders are
 * asserted key-by-key, then exercised through the UI against a recording stub.
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* -------------------------------------------------------------------------- */
/* apiFetch harness                                                           */
/* -------------------------------------------------------------------------- */

const harness = vi.hoisted(() => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  let handler: (path: string, init?: RequestInit) => unknown = () => undefined;

  return {
    calls,
    handle(next: (path: string, init?: RequestInit) => unknown) {
      handler = next;
    },
    reset() {
      calls.length = 0;
      handler = () => undefined;
    },
    run(path: string, init?: RequestInit) {
      calls.push({ path, init });
      return handler(path, init);
    },
    paths() {
      return calls.map((call) => call.path.split('?')[0] ?? call.path);
    },
    find(path: string, method?: string) {
      return calls.find(
        (call) =>
          (call.path.split('?')[0] ?? call.path) === path &&
          (method ? call.init?.method === method : true),
      );
    },
  };
});

vi.mock('../src/core/api', async () => {
  const actual = await vi.importActual<typeof import('../src/core/api')>('../src/core/api');
  return {
    ...actual,
    apiFetch: (path: string, init?: RequestInit) => {
      try {
        return Promise.resolve(harness.run(path, init));
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
});

import { ApiError } from '../src/core/api';
import { AuthProvider, STORAGE_KEYS } from '../src/core/auth';
import App from '../src/App';
import SettingsView, {
  PROVIDERS,
  buildSettingsPayload,
  buildTestPayload,
  changedFields,
  extractFetchedModels,
  hasPayloadChanges,
  initialFor,
  normalizeLLMSettings,
  normalizeProviders,
  normalizeTestOutcome,
  providerMeta,
} from '../src/features/settings/SettingsView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const SETTINGS_PAYLOAD = {
  active_provider: 'openai',
  default_model: 'gpt-4.1-mini',
  base_url: 'https://api.openai.com/v1',
  litellm_base_url: 'http://litellm:4000',
  custom_base_url: null,
  provider_models: { openai: 'gpt-4.1-mini', anthropic: 'claude-sonnet-4-20250514' },
  provider_available_models: {},
  providers_configured: {
    openai: true,
    anthropic: true,
    groq: false,
    openrouter: false,
    deepseek: false,
    ollama: true,
    custom: false,
  },
};

const PROVIDERS_PAYLOAD = [
  { provider: 'openai', configured: true, base_url: 'https://api.openai.com/v1', models: [] },
  { provider: 'anthropic', configured: true, base_url: 'https://api.anthropic.com/v1', models: [] },
  { provider: 'groq', configured: false, base_url: 'https://api.groq.com/openai/v1', models: [] },
  { provider: 'ollama', configured: true, base_url: 'http://localhost:11434', models: [] },
];

/* -------------------------------------------------------------------------- */
/* DOM harness                                                                */
/* -------------------------------------------------------------------------- */

let container: HTMLDivElement;
let root: Root;

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function flush(rounds = 3) {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await tick(0);
    });
  }
}

async function waitFor(predicate: () => boolean, label = 'condition', timeout = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    let satisfied = false;
    await act(async () => {
      await tick(20);
      satisfied = predicate();
    });
    if (satisfied) return;
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function mount(node: ReactNode) {
  act(() => {
    root.render(<AuthProvider>{node}</AuthProvider>);
  });
}

function buttons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('button'));
}

function labelOf(button: HTMLButtonElement): string {
  return (button.getAttribute('aria-label') ?? button.textContent ?? '').trim().toLowerCase();
}

function findButton(label: string): HTMLButtonElement {
  const needle = label.toLowerCase();
  const match = buttons().find((button) => labelOf(button).includes(needle));
  if (!match) {
    throw new Error(`No button matching “${label}”. Saw: ${buttons().map(labelOf).join(' | ')}`);
  }
  return match;
}

async function click(target: Element | null | undefined) {
  if (!target) throw new Error('Cannot click a missing element');
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick(0);
    await tick(0);
  });
}

async function typeInto(target: Element | null, value: string) {
  if (!target) throw new Error('Cannot type into a missing element');
  const element = target as HTMLInputElement | HTMLTextAreaElement;
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(0);
  });
}

function field(label: string): HTMLInputElement {
  const input = document.querySelector(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`No input labelled “${label}”`);
  return input as HTMLInputElement;
}

type Route = (path: string, init?: RequestInit) => unknown;

function defaultRoutes(overrides: Record<string, Route> = {}): Route {
  return (path, init) => {
    const clean = path.split('?')[0] ?? path;
    const override = overrides[clean];
    if (override) return override(path, init);

    const method = init?.method ?? 'GET';
    if (clean === '/health') return { status: 'ok', version: '0.9.4' };
    if (clean === '/health/ready') return { status: 'ready', ready: true };
    if (clean === '/v1/settings/llm' && method === 'GET') return SETTINGS_PAYLOAD;
    if (clean === '/v1/settings/providers') return PROVIDERS_PAYLOAD;
    if (clean === '/v1/settings/llm' && method === 'POST') return SETTINGS_PAYLOAD;
    if (clean === '/v1/settings/llm/test') {
      return { ok: true, message: 'Active configuration reachable · openai', latency_ms: 412 };
    }
    if (clean === '/v1/settings/llm/test-and-fetch-models') {
      return {
        ok: true,
        message: 'Credentials verified · openai',
        models: ['gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
      };
    }
    if (clean === '/v1/review/items') return [];
    if (clean === '/v1/documents') return { documents: [] };
    return {};
  };
}

beforeEach(() => {
  harness.reset();
  harness.handle(defaultRoutes());
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/* -------------------------------------------------------------------------- */
/* Update contract                                                            */
/* -------------------------------------------------------------------------- */

describe('settings payload builders', () => {
  const baseline = { base_url: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' };

  it('never sends a blank key; clearing base URL or model sends an empty value when changed', () => {
    const draft = { provider: 'openai', api_key: '', base_url: '', model: '' };
    const payload = buildSettingsPayload(draft, baseline);
    expect(payload).toEqual({ provider: 'openai', base_url: '', model: '' });
    expect(Object.keys(payload).sort()).toEqual(['base_url', 'model', 'provider']);
    expect(hasPayloadChanges(payload)).toBe(true);
  });

  it('sends only the fields the operator touched', () => {
    const keyOnly = buildSettingsPayload(
      { provider: 'openai', api_key: 'sk-new', base_url: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
      baseline,
    );
    expect(keyOnly).toEqual({ provider: 'openai', api_key: 'sk-new' });

    const urlOnly = buildSettingsPayload(
      { provider: 'openai', api_key: '', base_url: 'https://proxy.internal/v1', model: 'gpt-4.1-mini' },
      baseline,
    );
    expect(urlOnly).toEqual({ provider: 'openai', base_url: 'https://proxy.internal/v1' });

    const clearedModel = buildSettingsPayload(
      { provider: 'openai', api_key: '', base_url: 'https://api.openai.com/v1', model: '' },
      baseline,
    );
    expect(clearedModel).toEqual({ provider: 'openai', model: '' });

    const modelTouched = buildSettingsPayload(
      { provider: 'anthropic', api_key: '', base_url: 'https://api.anthropic.com/v1', model: 'claude-opus-4-1' },
      { base_url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514' },
    );
    expect(modelTouched).toEqual({ provider: 'anthropic', model: 'claude-opus-4-1' });
  });

  it('omits unchanged values and any unknown field', () => {
    const payload = buildSettingsPayload(
      { provider: 'openai', api_key: '  sk-padded  ', base_url: 'https://api.openai.com/v1 ', model: 'gpt-4.1-mini' },
      baseline,
    );
    expect(payload.api_key).toBe('sk-padded');
    expect(payload).not.toHaveProperty('base_url');
    expect(payload).not.toHaveProperty('model');
    expect(Object.keys(payload).every((key) => ['provider', 'api_key', 'base_url', 'model'].includes(key))).toBe(
      true,
    );
    expect(hasPayloadChanges(payload)).toBe(true);
  });

  it('reports which fields changed for the UI', () => {
    expect(changedFields({ provider: 'openai', api_key: '', base_url: '', model: '' }, baseline)).toEqual([
      'base_url',
      'model',
    ]);
    expect(
      changedFields(
        { provider: 'openai', api_key: 'sk-1', base_url: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
        baseline,
      ),
    ).toEqual(['api_key']);
  });

  it('builds a test payload from every non-empty field', () => {
    expect(
      buildTestPayload(
        { provider: 'groq', api_key: 'gsk-1', base_url: 'https://api.groq.com/openai/v1', model: '' },
        'groq',
      ),
    ).toEqual({ provider: 'groq', api_key: 'gsk-1', base_url: 'https://api.groq.com/openai/v1' });

    expect(buildTestPayload({ provider: 'ollama', api_key: '', base_url: '', model: '' }, 'ollama')).toEqual(
      { provider: 'ollama' },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Normalizers                                                                */
/* -------------------------------------------------------------------------- */

describe('settings normalizers', () => {
  it('fills a settings payload and tolerates junk', () => {
    const settings = normalizeLLMSettings(SETTINGS_PAYLOAD);
    expect(settings).toMatchObject({
      active_provider: 'openai',
      default_model: 'gpt-4.1-mini',
      litellm_base_url: 'http://litellm:4000',
      custom_base_url: null,
    });
    expect(settings?.providers_configured.openai).toBe(true);
    expect(settings?.providers_configured.groq).toBe(false);
    expect(normalizeLLMSettings({ provider: 'groq' })?.active_provider).toBe('groq');
    expect(normalizeLLMSettings('nope')).toBeNull();
  });

  it('normalizes both provider inventory shapes into 7 canonical cards', () => {
    const fromArray = normalizeProviders(PROVIDERS_PAYLOAD, normalizeLLMSettings(SETTINGS_PAYLOAD));
    expect(fromArray).toHaveLength(PROVIDERS.length);
    expect(fromArray.map((provider) => provider.id)).toEqual(PROVIDERS.map((provider) => provider.id));
    expect(fromArray.find((provider) => provider.id === 'openai')).toMatchObject({
      configured: true,
      base_url: 'https://api.openai.com/v1',
    });
    // Declared only in the settings payload, not in the inventory response.
    expect(fromArray.find((provider) => provider.id === 'ollama')?.configured).toBe(true);

    const fromRecord = normalizeProviders(
      { groq: { configured: 'true', base_url: 'https://api.groq.com/openai/v1' } },
      null,
    );
    expect(fromRecord.find((provider) => provider.id === 'groq')?.configured).toBe(true);

    const wrapped = normalizeProviders({ providers: PROVIDERS_PAYLOAD }, null);
    expect(wrapped.filter((provider) => provider.configured)).toHaveLength(3);

    expect(normalizeProviders(null, null).every((provider) => provider.configured === false)).toBe(true);
  });

  it('extracts discovered models from either response shape', () => {
    expect(extractFetchedModels({ models: ['a', 'b'] }, 'openai')).toEqual(['a', 'b']);
    expect(extractFetchedModels({ provider_available_models: { groq: ['x'] } }, 'groq')).toEqual(['x']);
    expect(extractFetchedModels({ models: [{ id: 'gpt-4.1' }, { name: 'o4-mini' }] }, 'openai')).toEqual([
      'gpt-4.1',
      'o4-mini',
    ]);
    expect(extractFetchedModels({ models: [] }, 'openai')).toEqual([]);

    const ok = normalizeTestOutcome({ ok: true, models: ['gpt-4.1'], message: 'verified' }, 'openai', 288);
    expect(ok).toMatchObject({ ok: true, message: 'verified', models: ['gpt-4.1'], latencyMs: 288 });

    const failed = normalizeTestOutcome({ status: 'invalid_credentials' }, 'openai', 120);
    expect(failed.ok).toBe(false);
  });

  it('derives the editor baseline from the active configuration', () => {
    const settings = normalizeLLMSettings(SETTINGS_PAYLOAD);
    const providers = normalizeProviders(PROVIDERS_PAYLOAD, settings);
    expect(initialFor('openai', settings, providers)).toEqual({
      base_url: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
    });
    expect(initialFor('anthropic', settings, providers).model).toBe('claude-sonnet-4-20250514');
    expect(providerMeta('groq').label).toBe('Groq');
    expect(providerMeta('unheard-of').id).toBe('unheard-of');
  });
});

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

describe('settings static rendering', () => {
  it('renders the provider grid, editor and client auth server-side', () => {
    const html = renderToStaticMarkup(
      <AuthProvider>
        <SettingsView />
      </AuthProvider>,
    );
    expect(html).toContain('Active configuration');
    expect(html).toContain('Settings</h1>');
    expect(html).toContain('OpenAI');
    expect(html).toContain('Client auth');
    expect(html).toContain('Test &amp; fetch models');
    expect(html).toContain('Client API key');
  });
});

describe('SettingsView', () => {
  it('renders every provider with configured state and the active chip', async () => {
    mount(<SettingsView />);
    await waitFor(() => document.body.textContent?.includes('openai') === true, 'settings loaded');

    const grid = document.querySelector('[aria-label="Provider selector"]');
    expect(grid).not.toBeNull();
    const cards = Array.from(grid?.querySelectorAll('button') ?? []);
    expect(cards).toHaveLength(7);

    const text = document.body.textContent ?? '';
    expect(text).toContain('Anthropic');
    expect(text).toContain('OpenRouter');
    expect(text).toContain('Ollama');
    expect(text).toContain('active');
    expect(cards.filter((card) => card.textContent?.includes('Configured')).length).toBe(3);

    const openaiCard = cards.find((button) => button.textContent?.includes('OpenAI'));
    expect(openaiCard?.getAttribute('aria-pressed')).toBe('true');
    expect(openaiCard?.textContent).toContain('Configured');
    expect(cards.find((button) => button.textContent?.includes('Groq'))?.textContent).toContain(
      'Not configured',
    );
  });

  it('masks credentials and starts a fresh draft per provider', async () => {
    mount(<SettingsView />);
    await waitFor(() => document.body.textContent?.includes('openai') === true, 'settings loaded');

    expect(field('OpenAI API key').value).toBe('');
    expect(field('OpenAI API key').type).toBe('password');
    expect(field('OpenAI API key').placeholder).toContain('blank keeps current');
    expect(document.body.textContent).toContain('Configured (masked)');

    const grid = document.querySelector('[aria-label="Provider selector"]');
    const anthropicCard = Array.from(grid?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('Anthropic'),
    );
    await click(anthropicCard);
    await flush(2);

    expect(document.body.textContent).toContain('Anthropic');
    expect(field('Anthropic API key').value).toBe('');
    expect(field('Anthropic base URL').value).toBe('https://api.anthropic.com/v1');
    expect(field('Anthropic model').value).toBe('claude-sonnet-4-20250514');
    // The previous provider's key never leaks into the next draft.
    expect(document.querySelector('input[aria-label="OpenAI API key"]')).toBeNull();
  });

  it('saves only the newly typed key', async () => {
    mount(<SettingsView />);
    await waitFor(() => document.body.textContent?.includes('openai') === true, 'settings loaded');

    const save = findButton('Save changes');
    expect(save.disabled).toBe(true);

    await typeInto(field('OpenAI API key'), 'sk-live-rotated');
    await flush(1);
    expect(findButton('Save changes').disabled).toBe(false);
    expect(document.body.textContent).toContain('Unsaved changes: API key');

    await click(findButton('Save changes'));
    await waitFor(
      () => document.body.textContent?.includes('Saved OpenAI settings') === true,
      'save confirmation',
    );

    const call = harness.find('/v1/settings/llm', 'POST');
    expect(call).toBeDefined();
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      provider: 'openai',
      api_key: 'sk-live-rotated',
    });
    // Reloaded after saving, and the credential field is blank again.
    expect(harness.paths().filter((path) => path === '/v1/settings/llm').length).toBeGreaterThan(1);
    expect(field('OpenAI API key').value).toBe('');
  });

  it('sends a changed base URL without the untouched credential', async () => {
    mount(<SettingsView />);
    await waitFor(() => document.body.textContent?.includes('openai') === true, 'settings loaded');

    await typeInto(field('OpenAI base URL'), 'https://gateway.internal/v1');
    await click(findButton('Save changes'));
    await waitFor(() => document.body.textContent?.includes('Saved OpenAI settings') === true, 'save');

    const payload = JSON.parse(String(harness.find('/v1/settings/llm', 'POST')?.init?.body));
    expect(payload).toEqual({ provider: 'openai', base_url: 'https://gateway.internal/v1' });
    expect(payload).not.toHaveProperty('api_key');
  });

  it('tests credentials, animates the model list in, and can route to a model', async () => {
    mount(<SettingsView />);
    await waitFor(() => document.body.textContent?.includes('openai') === true, 'settings loaded');

    expect(document.querySelector('select[aria-label="Available models"]')).toBeNull();

    await click(findButton('Test & fetch models'));
    await waitFor(
      () => document.querySelector('select[aria-label="Available models"]') !== null,
      'model dropdown',
    );

    const call = harness.find('/v1/settings/llm/test-and-fetch-models', 'POST');
    expect(call?.init?.method).toBe('POST');
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      provider: 'openai',
      base_url: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
    });

    const select = document.querySelector('select[aria-label="Available models"]') as HTMLSelectElement;
    expect(select.options).toHaveLength(4); // placeholder + 3 models
    expect(Array.from(select.options).map((option) => option.value)).toContain('o4-mini');
    expect(document.body.textContent).toContain('3 models discovered');

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(select, 'o4-mini');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await tick(0);
    });

    expect(field('OpenAI model').value).toBe('o4-mini');
    expect(document.body.textContent).toContain('Unsaved changes: Model');

    await click(findButton('Save changes'));
    await waitFor(() => document.body.textContent?.includes('Saved OpenAI settings') === true, 'save');
    expect(JSON.parse(String(harness.find('/v1/settings/llm', 'POST')?.init?.body))).toEqual({
      provider: 'openai',
      model: 'o4-mini',
    });
  });

  it('surfaces a rejected credential test', async () => {
    harness.handle(
      defaultRoutes({
        '/v1/settings/llm/test-and-fetch-models': () => {
          throw new ApiError('provider rejected the credential', 401, 'provider rejected the credential (401)');
        },
      }),
    );

    mount(<SettingsView />);
    await waitFor(() => document.body.textContent?.includes('openai') === true, 'settings loaded');

    await click(findButton('Test & fetch models'));
    await waitFor(
      () => document.body.textContent?.includes('provider rejected the credential (401)') === true,
      'test failure notice',
    );
    expect(document.querySelector('select[aria-label="Available models"]')).toBeNull();
  });

  it('tests the active configuration and reports the verdict', async () => {
    mount(<SettingsView />);
    await waitFor(() => document.body.textContent?.includes('openai') === true, 'settings loaded');

    await click(findButton('Test active configuration'));
    await waitFor(
      () => document.body.textContent?.includes('Active configuration reachable') === true,
      'active test result',
    );

    const call = harness.find('/v1/settings/llm/test', 'POST');
    expect(call?.init?.method).toBe('POST');
  });

  it('stores and clears the client API key and tenant scope', async () => {
    mount(<SettingsView />);
    await waitFor(() => document.body.textContent?.includes('openai') === true, 'settings loaded');

    expect(document.body.textContent).toContain('server key');

    await typeInto(field('Client API key'), 'sk-browser-scope');
    await click(findButton('Apply key'));
    await flush(2);

    expect(window.localStorage.getItem(STORAGE_KEYS.apiKey)).toBe('sk-browser-scope');
    expect(document.body.textContent).toContain('key override');
    expect(field('Client API key').value).toBe('');
    expect(field('Client API key').type).toBe('password');

    await typeInto(field('Tenant id'), 'acme-prod');
    await click(findButton('Apply tenant'));
    await flush(2);
    expect(window.localStorage.getItem(STORAGE_KEYS.tenantId)).toBe('acme-prod');
    expect(document.body.textContent).toContain('Tenant scope set to "acme-prod"');

    await click(findButton('Clear client API key'));
    await flush(2);
    expect(window.localStorage.getItem(STORAGE_KEYS.apiKey)).toBeNull();
    expect(document.body.textContent).toContain('server key');
  });

  it('shows a retryable banner when the gateway is unreachable', async () => {
    let failing = true;
    harness.handle(
      defaultRoutes({
        '/v1/settings/llm': () => {
          if (failing) throw new ApiError('gateway offline', 503, 'gateway offline');
          return SETTINGS_PAYLOAD;
        },
        '/v1/settings/providers': () => {
          if (failing) throw new ApiError('gateway offline', 503, 'gateway offline');
          return PROVIDERS_PAYLOAD;
        },
      }),
    );

    mount(<SettingsView />);
    await waitFor(() => document.body.textContent?.includes('gateway offline') === true, 'error banner');

    failing = false;
    await click(findButton('Retry'));
    await waitFor(() => document.body.textContent?.includes('gateway online') === true, 'recovered');
  });
});

/* -------------------------------------------------------------------------- */
/* Root assembly                                                              */
/* -------------------------------------------------------------------------- */

describe('App assembly', () => {
  it('paints Ask eagerly and lazy-loads the other views on demand', async () => {
    mount(<App />);
    await waitFor(
      () => document.querySelector('[aria-label="Ask Meridian a question"]') !== null,
      'eager Ask view',
    );

    expect(document.querySelector('[data-view="ask"]')).not.toBeNull();
    // AskView is eager: no Suspense fallback was ever required for it.
    expect(document.body.textContent).toContain('show their work');

    await click(document.querySelector('[aria-label="Settings"]'));
    await waitFor(
      () => document.body.textContent?.includes('Active configuration') === true,
      'lazy settings view',
    );
    expect(document.querySelector('[data-view="settings"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Ask Meridian a question"]')).toBeNull();

    await click(document.querySelector('[aria-label="Vault"]'));
    await waitFor(
      () => document.body.textContent?.includes('Knowledge vault') === true,
      'lazy vault view',
    );
    expect(document.querySelector('[data-view="vault"]')).not.toBeNull();
  });
});
