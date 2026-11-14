/**
 * Meridian — Gateway settings.
 *
 * Four jobs in one surface:
 *   • provider inventory      `GET  /v1/settings/providers`
 *   • active configuration    `GET  /v1/settings/llm`
 *   • credential test         `POST /v1/settings/llm/test`
 *   • update / discover       `POST /v1/settings/llm`,
 *                             `POST /v1/settings/llm/test-and-fetch-models`
 *
 * Credentials are write-only: the API never returns a key, so the UI shows a
 * masked state and only ever sends a key the operator has just typed. The update
 * payload is built field-by-field: changed values only, a blank key is never
 * sent, and clearing the base URL or model removes the stored value.
 */
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Bot,
  Building2,
  Check,
  ChevronDown,
  Cpu,
  Eye,
  EyeOff,
  FlaskConical,
  HardDrive,
  KeyRound,
  Loader2,
  Plug,
  RefreshCw,
  Route,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';

import { StatusBadge, type StatusTone } from '../../components/shell/StatusBadge';
import SpotlightCard from '../../components/ui/SpotlightCard';
import { ApiError, apiFetch } from '../../core/api';
import { useAuth } from '../../core/auth';
import { FADE_UP, SPRING_SNAPPY, STAGGER_CONTAINER, STAGGER_ITEM } from '../../core/motion';
import type { LLMSettingsResponse } from '../../core/types';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return /^(true|1|yes|configured|set|ok)$/i.test(value.trim());
  return fallback;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.detailMessage ?? error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry): string[] => {
      if (typeof entry === 'string' && entry.trim().length > 0) return [entry.trim()];
      if (isRecord(entry)) {
        const id = firstString(entry['id'], entry['name'], entry['model']);
        return id ? [id] : [];
      }
      return [];
    })
    .filter((entry, index, all) => all.indexOf(entry) === index);
}

/* -------------------------------------------------------------------------- */
/* Providers                                                                  */
/* -------------------------------------------------------------------------- */

export interface ProviderMeta {
  id: string;
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}

export const PROVIDERS: ProviderMeta[] = [
  { id: 'openai', label: 'OpenAI', hint: 'GPT-4.1 · o-series', icon: Sparkles },
  { id: 'anthropic', label: 'Anthropic', hint: 'Claude 4 family', icon: Bot },
  { id: 'groq', label: 'Groq', hint: 'LPU inference', icon: Zap },
  { id: 'openrouter', label: 'OpenRouter', hint: 'Multi-provider router', icon: Route },
  { id: 'deepseek', label: 'DeepSeek', hint: 'Reasoning models', icon: Cpu },
  { id: 'ollama', label: 'Ollama', hint: 'Local runtime', icon: HardDrive },
  { id: 'custom', label: 'Custom', hint: 'OpenAI-compatible', icon: Plug },
];

const FALLBACK_META: ProviderMeta = {
  id: 'custom',
  label: 'Custom',
  hint: 'OpenAI-compatible',
  icon: Plug,
};

export function providerMeta(id: string): ProviderMeta {
  return PROVIDERS.find((provider) => provider.id === id) ?? { ...FALLBACK_META, id, label: id };
}

export interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  base_url: string | null;
  models: string[];
  detail: string | null;
}

/** Fills the 7 canonical providers from either shape of `/v1/settings/providers`. */
export function normalizeProviders(
  raw: unknown,
  settings: LLMSettingsResponse | null = null,
): ProviderStatus[] {
  const entries: Array<[string, unknown]> = Array.isArray(raw)
    ? raw.flatMap((entry): Array<[string, unknown]> => {
        if (typeof entry === 'string') return [[entry, {}]];
        if (!isRecord(entry)) return [];
        const id = firstString(entry['provider'], entry['id'], entry['name']);
        return id ? [[id, entry]] : [];
      })
    : isRecord(raw)
      ? Array.isArray(raw['providers'])
        ? raw['providers'].flatMap((entry): Array<[string, unknown]> => {
            if (!isRecord(entry)) return [];
            const id = firstString(entry['provider'], entry['id'], entry['name']);
            return id ? [[id, entry]] : [];
          })
        : Object.entries(raw).filter(([key]) => key !== 'providers')
      : [];

  const parsed = new Map<string, { configured: boolean; base_url: string | null; models: string[]; detail: string | null }>();
  for (const [id, value] of entries) {
    if (typeof value === 'string') {
      parsed.set(id, {
        configured: asBool(value, true),
        base_url: null,
        models: [],
        detail: null,
      });
      continue;
    }
    if (!isRecord(value)) continue;
    parsed.set(id, {
      configured: asBool(
        value['configured'] ?? value['is_configured'] ?? value['has_key'] ?? value['api_key_set'],
      ),
      base_url: firstString(value['base_url'], value['endpoint'], value['url']),
      models: stringArray(value['models'] ?? value['available_models']),
      detail: firstString(value['detail'], value['status']),
    });
  }

  return PROVIDERS.map((meta) => {
    const entry = parsed.get(meta.id);
    const configured = entry?.configured ?? settings?.providers_configured?.[meta.id] ?? false;
    const baseUrl =
      entry?.base_url ??
      (meta.id === 'custom'
        ? (firstString(settings?.custom_base_url) ?? null)
        : settings?.active_provider === meta.id
          ? (firstString(settings?.base_url) ?? null)
          : null);

    return {
      id: meta.id,
      label: meta.label,
      configured,
      base_url: baseUrl,
      models: entry?.models ?? stringArray(settings?.provider_available_models?.[meta.id]) ?? [],
      detail: entry?.detail ?? null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Settings normalizer                                                        */
/* -------------------------------------------------------------------------- */

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

function arrayMap(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(value)) out[key] = stringArray(entry);
  return out;
}

export function normalizeLLMSettings(raw: unknown): LLMSettingsResponse | null {
  if (!isRecord(raw)) return null;

  const configuredRaw = isRecord(raw['providers_configured']) ? raw['providers_configured'] : {};
  const providersConfigured: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(configuredRaw)) {
    providersConfigured[key] = asBool(value);
  }

  return {
    active_provider: asString(raw['active_provider'] ?? raw['provider'], 'unknown'),
    default_model: asString(raw['default_model'] ?? raw['model'], ''),
    base_url: asString(raw['base_url'], ''),
    litellm_base_url: firstString(raw['litellm_base_url']),
    custom_base_url: firstString(raw['custom_base_url']),
    provider_models: stringMap(raw['provider_models']),
    provider_available_models: arrayMap(raw['provider_available_models']),
    providers_configured: providersConfigured,
  };
}

/* -------------------------------------------------------------------------- */
/* Payload builders                                                           */
/* -------------------------------------------------------------------------- */

export interface SettingsDraft {
  provider: string;
  api_key: string;
  base_url: string;
  model: string;
}

export interface SettingsBaseline {
  base_url: string;
  model: string;
}

export type SettingsField = 'api_key' | 'base_url' | 'model';

export function fieldLabel(field: SettingsField): string {
  if (field === 'api_key') return 'API key';
  if (field === 'base_url') return 'Base URL';
  return 'Model';
}

/** The only keys the gateway accepts — unknown fields are never sent. */
export interface SettingsPayload {
  provider: string;
  api_key?: string;
  base_url?: string;
  model?: string;
}

export function changedFields(draft: SettingsDraft, baseline: SettingsBaseline): SettingsField[] {
  const changed: SettingsField[] = [];
  if (draft.api_key.trim().length > 0) changed.push('api_key');
  if (draft.base_url.trim() !== baseline.base_url.trim()) changed.push('base_url');
  if (draft.model.trim() !== baseline.model.trim()) changed.push('model');
  return changed;
}

/**
 * Changed fields only. A typed API key is sent; a blank key is never sent.
 * Clearing the base URL or model (changed to empty) sends an empty value so the
 * server can remove the stored value. Unchanged fields are omitted.
 */
export function buildSettingsPayload(
  draft: SettingsDraft,
  baseline: SettingsBaseline,
  provider: string = draft.provider,
): SettingsPayload {
  const payload: SettingsPayload = { provider };

  const apiKey = draft.api_key.trim();
  if (apiKey.length > 0) payload.api_key = apiKey;

  const baseUrl = draft.base_url.trim();
  if (baseUrl !== baseline.base_url.trim()) payload.base_url = baseUrl;

  const model = draft.model.trim();
  if (model !== baseline.model.trim()) payload.model = model;

  return payload;
}

export function hasPayloadChanges(payload: SettingsPayload): boolean {
  return Object.keys(payload).some((key) => key !== 'provider');
}

/** `{ provider, api_key?, base_url?, model? }` — every value non-empty. */
export function buildTestPayload(
  draft: SettingsDraft,
  provider: string = draft.provider,
): SettingsPayload {
  const payload: SettingsPayload = { provider };
  const apiKey = draft.api_key.trim();
  if (apiKey.length > 0) payload.api_key = apiKey;
  const baseUrl = draft.base_url.trim();
  if (baseUrl.length > 0) payload.base_url = baseUrl;
  const model = draft.model.trim();
  if (model.length > 0) payload.model = model;
  return payload;
}

/* -------------------------------------------------------------------------- */
/* Test results                                                               */
/* -------------------------------------------------------------------------- */

export interface TestOutcome {
  ok: boolean;
  message: string;
  models: string[];
  latencyMs: number;
}

export function extractFetchedModels(raw: unknown, provider: string | null): string[] {
  if (Array.isArray(raw)) return stringArray(raw);
  if (!isRecord(raw)) return [];

  const byProvider = isRecord(raw['provider_available_models'])
    ? provider
      ? raw['provider_available_models'][provider]
      : undefined
    : undefined;

  const candidates: unknown[] = [
    byProvider,
    raw['models'],
    raw['available_models'],
    raw['fetched_models'],
  ];

  for (const candidate of candidates) {
    const models = stringArray(candidate);
    if (models.length > 0) return models.slice(0, 200);
  }
  return [];
}

export function normalizeTestOutcome(
  raw: unknown,
  provider: string | null,
  latencyMs: number,
): TestOutcome {
  const record = isRecord(raw) ? raw : {};
  const models = extractFetchedModels(raw, provider);

  const explicit =
    typeof record['ok'] === 'boolean'
      ? record['ok']
      : typeof record['success'] === 'boolean'
        ? record['success']
        : null;
  const statusWord = firstString(record['status'], record['state']);
  const ok =
    explicit ??
    (statusWord ? !/(fail|error|invalid|unauthor|denied)/i.test(statusWord) : models.length > 0);

  const message =
    firstString(record['message'], record['detail'], record['error']) ??
    (ok
      ? `Credentials accepted${models.length > 0 ? ` · ${models.length} models` : ''}`
      : 'Credential test failed');

  return { ok, message, models, latencyMs };
}

/* -------------------------------------------------------------------------- */
/* Baseline helpers                                                           */
/* -------------------------------------------------------------------------- */

export function initialFor(
  provider: string,
  settings: LLMSettingsResponse | null,
  providers: ProviderStatus[],
): SettingsBaseline {
  const entry = providers.find((candidate) => candidate.id === provider);
  const fromSettings =
    provider === 'custom'
      ? settings?.custom_base_url ?? ''
      : settings?.active_provider === provider
        ? settings?.base_url ?? ''
        : '';

  const storedModel =
    settings?.provider_models?.[provider] ??
    (settings?.active_provider === provider ? settings?.default_model ?? '' : '');

  return {
    base_url: entry?.base_url ?? fromSettings ?? '',
    model: storedModel ?? '',
  };
}

/* -------------------------------------------------------------------------- */
/* Small pieces                                                               */
/* -------------------------------------------------------------------------- */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
          {label}
        </span>
        {hint ? <span className="truncate text-[9.5px] text-ink-faint">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function ProviderCard({
  meta,
  status,
  active,
  selected,
  onSelect,
}: {
  meta: ProviderMeta;
  status: ProviderStatus;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = meta.icon;
  const detailId = `provider-${meta.id}-detail`;
  const stateId = `provider-${meta.id}-state`;
  return (
    <SpotlightCard
      as="button"
      type="button"
      variants={STAGGER_ITEM}
      onClick={onSelect}
      aria-pressed={selected}
      aria-describedby={`${detailId} ${stateId}`}
      className={cx(
        'flex items-center gap-2.5 overflow-hidden rounded-lg border bg-elevated/80 p-3.5 text-left shadow-hairline backdrop-blur-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        selected ? 'border-accent/30' : 'border-hairline hover:border-accent/25',
      )}
    >
      {selected ? (
        <motion.span
          layoutId="settings-provider-ring"
          transition={SPRING_SNAPPY}
          className="pointer-events-none absolute inset-0 rounded-lg border border-accent/50 bg-accent-soft/40"
        />
      ) : null}

      <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-sm border border-hairline bg-subtle text-ink-muted transition-colors group-hover:text-accent">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      </span>

      <span className="relative min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="truncate text-[12.5px] font-semibold text-ink">{meta.label}</span>
          {active ? (
            <span className="shrink-0 rounded-sm border border-accent/25 bg-accent-soft px-1 text-[9px] font-bold uppercase tracking-[0.08em] text-accent">
              active
            </span>
          ) : null}
        </span>
        <span id={detailId} className="mt-0.5 block truncate font-mono text-[9px] text-ink-faint">
          {status.base_url ?? meta.hint}
        </span>
      </span>

      <span id={stateId} className="relative shrink-0">
        <StatusBadge
          tone={status.configured ? 'ok' : 'neutral'}
          size="sm"
          label={status.configured ? 'Configured' : 'Not configured'}
        />
      </span>
    </SpotlightCard>
  );
}

/* -------------------------------------------------------------------------- */
/* View                                                                       */
/* -------------------------------------------------------------------------- */

type LoadStatus = 'loading' | 'ready' | 'error';

interface Snapshot {
  settings: LLMSettingsResponse | null;
  providersRaw: unknown;
  ok: boolean;
  error: string | null;
}

export function SettingsView() {
  const { setApiKey, hasApiKeyOverride, tenantId, setTenantId } = useAuth();

  const [settings, setSettings] = useState<LLMSettingsResponse | null>(null);
  const [providersRaw, setProvidersRaw] = useState<unknown>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [selected, setSelected] = useState<string>(PROVIDERS[0]?.id ?? 'openai');
  const [edits, setEdits] = useState<{ api_key: string; base_url?: string; model?: string }>({
    api_key: '',
  });
  const [revealKey, setRevealKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [testingActive, setTestingActive] = useState(false);
  const [testedModels, setTestedModels] = useState<Record<string, string[]>>({});
  const [testedProviders, setTestedProviders] = useState<Record<string, boolean>>({});
  const [activeTest, setActiveTest] = useState<{ tone: StatusTone; message: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: StatusTone; message: string } | null>(null);

  const [keyDraft, setKeyDraft] = useState('');
  const [tenantDraft, setTenantDraft] = useState(tenantId);
  const [revealClientKey, setRevealClientKey] = useState(false);

  const noticeTimer = useRef<number | null>(null);
  const bootstrapped = useRef(false);

  /* ---------------- notices ---------------- */
  const flash = useCallback((tone: StatusTone, message: string) => {
    setNotice({ tone, message });
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 5200);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  useEffect(() => {
    setTenantDraft(tenantId);
  }, [tenantId]);

  /* ---------------- loading ---------------- */
  const load = useCallback(async (): Promise<Snapshot> => {
    const [settingsResult, providersResult] = await Promise.allSettled([
      apiFetch<unknown>('/v1/settings/llm'),
      apiFetch<unknown>('/v1/settings/providers'),
    ]);

    const nextSettings =
      settingsResult.status === 'fulfilled' ? normalizeLLMSettings(settingsResult.value) : null;
    const nextProviders = providersResult.status === 'fulfilled' ? providersResult.value : null;

    const failures: string[] = [];
    if (settingsResult.status === 'rejected') {
      failures.push(errorMessage(settingsResult.reason, 'settings unavailable'));
    }
    if (providersResult.status === 'rejected') {
      failures.push(errorMessage(providersResult.reason, 'providers unavailable'));
    }

    return {
      settings: nextSettings,
      providersRaw: nextProviders,
      ok: failures.length === 0,
      error: failures[0] ?? null,
    };
  }, []);

  const applySnapshot = useCallback((snapshot: Snapshot) => {
    setSettings(snapshot.settings);
    setProvidersRaw(snapshot.providersRaw);
    if (snapshot.providersRaw !== null || snapshot.settings !== null) {
      setStatus('ready');
      setError(snapshot.ok ? null : snapshot.error);
    } else {
      setStatus('error');
      setError(snapshot.error ?? 'Could not load gateway settings');
    }
  }, []);

  const refresh = useCallback(
    async (mode: 'initial' | 'manual') => {
      if (mode === 'initial') setStatus('loading');
      else setRefreshing(true);
      try {
        const snapshot = await load();
        applySnapshot(snapshot);
      } finally {
        setRefreshing(false);
      }
    },
    [applySnapshot, load],
  );

  useEffect(() => {
    void refresh('initial');
  }, [refresh]);

  /* ---------------- derived ---------------- */
  const providers = useMemo(() => normalizeProviders(providersRaw, settings), [providersRaw, settings]);
  const activeProvider = settings?.active_provider ?? null;
  const selectedStatus = providers.find((provider) => provider.id === selected) ?? null;
  const selectedMeta = providerMeta(selected);
  const baseline = useMemo(() => initialFor(selected, settings, providers), [selected, settings, providers]);

  const baseUrlValue = edits.base_url ?? baseline.base_url;
  const modelValue = edits.model ?? baseline.model;
  const draft: SettingsDraft = {
    provider: selected,
    api_key: edits.api_key,
    base_url: baseUrlValue,
    model: modelValue,
  };

  const changed = changedFields(draft, baseline);
  const models = testedModels[selected] ?? selectedStatus?.models ?? [];
  const canSave = changed.length > 0 && !saving;

  /* Selecting a different provider starts a fresh, empty credential draft. */
  useEffect(() => {
    setEdits({ api_key: '' });
    setRevealKey(false);
  }, [selected]);

  /* Adopt the server's active provider once, after the first successful load. */
  useEffect(() => {
    if (bootstrapped.current || !settings) return;
    bootstrapped.current = true;
    const known = PROVIDERS.some((provider) => provider.id === settings.active_provider);
    const next = known ? settings.active_provider : 'custom';
    setSelected((current) => (current === next ? current : next));
  }, [settings]);

  /* ---------------- actions ---------------- */
  const save = useCallback(async () => {
    const payload = buildSettingsPayload(draft, baseline, selected);
    if (!hasPayloadChanges(payload)) {
      flash('warn', 'Nothing to save - change a field or paste a new key first');
      return;
    }

    setSaving(true);
    try {
      await apiFetch<unknown>('/v1/settings/llm', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const snapshot = await load();
      applySnapshot(snapshot);
      setEdits({ api_key: '' });

      flash('ok', `Saved ${selectedMeta.label} settings`);
    } catch (cause) {
      flash('fail', errorMessage(cause, 'Could not save provider settings'));
    } finally {
      setSaving(false);
    }
  }, [applySnapshot, baseline, draft, flash, load, selected, selectedMeta.label]);

  const testAndFetch = useCallback(async () => {
    setFetching(true);
    try {
      const payload = buildTestPayload(draft, selected);
      const started = performance.now();
      const raw = await apiFetch<unknown>('/v1/settings/llm/test-and-fetch-models', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const outcome = normalizeTestOutcome(raw, selected, Math.round(performance.now() - started));

      if (outcome.models.length > 0) {
        setTestedModels((current) => ({ ...current, [selected]: outcome.models }));
      }
      setTestedProviders((current) => ({ ...current, [selected]: true }));
      flash(
        outcome.ok ? 'ok' : 'fail',
        `${outcome.message} · ${outcome.latencyMs} ms`,
      );
    } catch (cause) {
      flash('fail', errorMessage(cause, 'Credential test failed'));
    } finally {
      setFetching(false);
    }
  }, [draft, flash, selected]);

  const testActive = useCallback(async () => {
    setTestingActive(true);
    setActiveTest(null);
    try {
      const started = performance.now();
      const raw = await apiFetch<unknown>('/v1/settings/llm/test', { method: 'POST' });
      const outcome = normalizeTestOutcome(raw, activeProvider, Math.round(performance.now() - started));
      setActiveTest({
        tone: outcome.ok ? 'ok' : 'fail',
        message: `${outcome.message} · ${outcome.latencyMs} ms`,
      });
    } catch (cause) {
      setActiveTest({ tone: 'fail', message: errorMessage(cause, 'Active configuration test failed') });
    } finally {
      setTestingActive(false);
    }
  }, [activeProvider]);

  const applyClientKey = useCallback(() => {
    const trimmed = keyDraft.trim();
    if (!trimmed) {
      flash('warn', 'Paste an API key before applying');
      return;
    }
    setApiKey(trimmed);
    setKeyDraft('');
    setRevealClientKey(false);
    flash('ok', 'API key stored in this browser');
  }, [flash, keyDraft, setApiKey]);

  const clearClientKey = useCallback(() => {
    setApiKey(null);
    setKeyDraft('');
    flash('neutral', 'API key override cleared - falling back to the server key');
  }, [flash, setApiKey]);

  const applyTenant = useCallback(() => {
    const trimmed = tenantDraft.trim();
    if (!trimmed) {
      flash('warn', 'Tenant id cannot be empty');
      return;
    }
    setTenantId(trimmed);
    flash('ok', `Tenant scope set to "${trimmed}"`);
  }, [flash, setTenantId, tenantDraft]);

  /* ---------------- render ---------------- */
  return (
    <div className="flex flex-col gap-4">
      {/* header */}
      <motion.header
        variants={STAGGER_ITEM}
        initial="initial"
        animate="animate"
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.035em] text-ink">
            Settings
          </h1>
          <p className="max-w-xl text-[12.5px] leading-relaxed text-ink-muted">
            Route the gateway at a provider, rotate credentials, and scope this browser to a tenant.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void refresh('manual')}
          disabled={refreshing || status === 'loading'}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-pill border border-hairline bg-elevated/80 px-3 text-[11px] font-semibold text-ink-muted shadow-hairline backdrop-blur-xl transition-colors hover:text-ink disabled:cursor-progress disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {refreshing || status === 'loading' ? (
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.6} />
          ) : (
            <RefreshCw className="h-3 w-3" strokeWidth={2.6} />
          )}
          {refreshing ? 'Reloading…' : 'Reload'}
        </button>
      </motion.header>

      {/* notice / error */}
      <AnimatePresence initial={false}>
        {notice ? (
          <motion.div
            key="notice"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={SPRING_SNAPPY}
            role="status"
            aria-live="polite"
            className={cx(
              'flex items-center gap-2 rounded-sm border px-2.5 py-1.5',
              notice.tone === 'ok'
                ? 'border-ok/30 bg-ok-soft'
                : notice.tone === 'fail'
                  ? 'border-fail/30 bg-fail-soft'
                  : notice.tone === 'warn'
                    ? 'border-warn/30 bg-warn-soft'
                    : 'border-hairline bg-subtle',
            )}
          >
            {notice.tone === 'ok' ? (
              <Check className="h-3 w-3 shrink-0 text-ok-ink" strokeWidth={3} />
            ) : notice.tone === 'neutral' ? (
              <ShieldCheck className="h-3 w-3 shrink-0 text-ink-muted" strokeWidth={2.4} />
            ) : (
              <AlertTriangle
                className={cx(
                  'h-3 w-3 shrink-0',
                  notice.tone === 'fail' ? 'text-fail-ink' : 'text-warn-ink',
                )}
                strokeWidth={2.4}
              />
            )}
            <p
              className={cx(
                'min-w-0 flex-1 truncate text-[11px] font-medium',
                notice.tone === 'ok'
                  ? 'text-ok-ink'
                  : notice.tone === 'fail'
                    ? 'text-fail-ink'
                    : notice.tone === 'warn'
                      ? 'text-warn-ink'
                      : 'text-ink-muted',
              )}
              title={notice.message}
            >
              {notice.message}
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-fail/30 bg-fail-soft px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[11.5px] text-fail-ink">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
            {error}
          </p>
          <button
            type="button"
            onClick={() => void refresh('manual')}
            className="inline-flex h-6 items-center gap-1 rounded-pill border border-fail/30 bg-elevated px-2 text-[10.5px] font-semibold text-fail-ink transition-colors hover:border-fail/60"
          >
            <RefreshCw className="h-2.5 w-2.5" strokeWidth={2.6} />
            Retry
          </button>
        </div>
      ) : null}

      {/* active configuration + client auth */}
      <div className="grid gap-2.5 xl:grid-cols-[1.25fr_1fr]">
        <motion.section
          variants={FADE_UP}
          initial="initial"
          animate="animate"
          className="flex flex-col gap-2.5 rounded-lg border border-hairline bg-elevated/80 p-3.5 shadow-hairline backdrop-blur-xl"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                Active configuration
              </p>
              {settings ? (
                <p className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[13px] font-semibold text-ink">
                    {activeProvider ?? '—'}
                  </span>
                  <span className="text-ink-faint">·</span>
                  <span className="truncate font-mono text-[12px] text-ink-muted">
                    {settings.default_model || 'No model set - choose one below'}
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-[12px] text-ink-muted">No provider configured yet.</p>
              )}
            </div>
            <StatusBadge
              tone={settings ? 'ok' : 'neutral'}
              size="sm"
              label={settings ? 'gateway online' : 'Not checked'}
              pulse={Boolean(settings)}
            />
          </div>

          {settings ? (
            <dl className="grid gap-1 border-t border-hairline pt-2 font-mono text-[10.5px]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-ink-faint">Base URL</dt>
                <dd className="truncate text-ink-muted">{settings.base_url || '—'}</dd>
              </div>
              {settings.litellm_base_url ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-ink-faint">LiteLLM gateway</dt>
                  <dd className="truncate text-ink-muted">{settings.litellm_base_url}</dd>
                </div>
              ) : null}
              {settings.custom_base_url ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-ink-faint">Custom endpoint</dt>
                  <dd className="truncate text-ink-muted">{settings.custom_base_url}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          <div className="mt-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void testActive()}
              disabled={testingActive}
              className="inline-flex h-7 items-center gap-1.5 rounded-pill border border-accent/25 bg-accent-soft px-2.5 text-[10.5px] font-semibold text-accent transition-colors hover:border-accent/50 disabled:cursor-progress disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {testingActive ? (
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.6} />
              ) : (
                <FlaskConical className="h-3 w-3" strokeWidth={2.4} />
              )}
              Test active configuration
            </button>

            {activeTest ? (
              <StatusBadge
                tone={activeTest.tone}
                size="sm"
                label={activeTest.message}
                className="max-w-full [&>span:last-child]:whitespace-normal [&>span:last-child]:break-words"
              />
            ) : null}
          </div>
        </motion.section>

        {/* client auth & tenant */}
        <motion.section
          variants={FADE_UP}
          initial="initial"
          animate="animate"
          className="flex flex-col gap-2.5 rounded-lg border border-hairline bg-elevated/80 p-3.5 shadow-hairline backdrop-blur-xl"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                Client auth &amp; tenant
              </p>
              <p className="mt-1 text-[12px] text-ink-muted">
                Scoped to this browser only. Requests carry your API key and tenant automatically.
              </p>
            </div>
            <StatusBadge
              tone={hasApiKeyOverride ? 'ok' : 'neutral'}
              size="sm"
              label={hasApiKeyOverride ? 'key override' : 'server key'}
            />
          </div>

          <Field
            label="Client API key"
            hint={hasApiKeyOverride ? 'Configured (masked)' : 'Not set'}
          >
            <div className="flex items-center gap-1.5">
              <div className="relative min-w-0 flex-1">
                <KeyRound
                  className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-faint"
                  strokeWidth={2.2}
                />
                <input
                  type={revealClientKey ? 'text' : 'password'}
                  value={keyDraft}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') applyClientKey();
                  }}
                  placeholder={hasApiKeyOverride ? '•••••••••••• (enter to replace)' : 'paste an API key'}
                  aria-label="Client API key"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-8 w-full rounded-sm border border-hairline bg-elevated pl-7 pr-7 font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent/40"
                />
                <button
                  type="button"
                  onClick={() => setRevealClientKey((value) => !value)}
                  aria-label={revealClientKey ? 'Hide client API key' : 'Show client API key'}
                  className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-ink-faint transition-colors hover:text-ink"
                >
                  {revealClientKey ? (
                    <EyeOff className="h-3 w-3" strokeWidth={2.4} />
                  ) : (
                    <Eye className="h-3 w-3" strokeWidth={2.4} />
                  )}
                </button>
              </div>

              <button
                type="button"
                onClick={applyClientKey}
                className="inline-flex h-8 shrink-0 items-center rounded-sm bg-accent px-2.5 text-[10.5px] font-semibold text-accent-contrast transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                Apply key
              </button>

              <button
                type="button"
                onClick={clearClientKey}
                disabled={!hasApiKeyOverride && keyDraft.length === 0}
                aria-label="Clear client API key"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-hairline bg-elevated text-ink-muted transition-colors hover:border-fail/30 hover:bg-fail-soft hover:text-fail-ink disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fail/40"
              >
                <Trash2 className="h-3 w-3" strokeWidth={2.4} />
              </button>
            </div>
          </Field>

          <Field label="Tenant id" hint={`active: ${tenantId}`}>
            <div className="flex items-center gap-1.5">
              <div className="relative min-w-0 flex-1">
                <Building2
                  className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-faint"
                  strokeWidth={2.2}
                />
                <input
                  value={tenantDraft}
                  onChange={(event) => setTenantDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') applyTenant();
                  }}
                  placeholder="default"
                  aria-label="Tenant id"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-8 w-full rounded-sm border border-hairline bg-elevated pl-7 pr-2 font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent/40"
                />
              </div>
              <button
                type="button"
                onClick={applyTenant}
                disabled={tenantDraft.trim() === tenantId}
                className="inline-flex h-8 shrink-0 items-center rounded-sm border border-hairline bg-elevated px-2.5 text-[10.5px] font-semibold text-ink-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                Apply tenant
              </button>
            </div>
          </Field>
        </motion.section>
      </div>

      {/* providers */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Providers
        </p>
      </div>

      {status === 'loading' && !settings ? (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
          {PROVIDERS.map((meta) => (
            <div
              key={meta.id}
              className="h-[62px] animate-pulse rounded-lg border border-hairline bg-subtle/50"
            />
          ))}
          <span className="sr-only">Loading providers…</span>
        </div>
      ) : (
        <motion.div
          variants={STAGGER_CONTAINER}
          initial="initial"
          animate="animate"
          className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4"
          role="group"
          aria-label="Provider selector"
        >
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              meta={providerMeta(provider.id)}
              status={provider}
              active={activeProvider === provider.id}
              selected={selected === provider.id}
              onSelect={() => setSelected(provider.id)}
            />
          ))}
        </motion.div>
      )}

      {/* editor */}
      <motion.section
        variants={FADE_UP}
        initial="initial"
        animate="animate"
        className="flex flex-col gap-3 rounded-lg border border-hairline bg-elevated/80 p-3.5 shadow-hairline backdrop-blur-xl"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-hairline bg-subtle text-ink-muted">
              <selectedMeta.icon className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                Provider configuration
              </p>
              <p className="flex items-center gap-1.5">
                <span className="truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">
                  {selectedMeta.label}
                </span>
                {selectedStatus?.configured ? (
                  <StatusBadge tone="ok" size="sm" label="Configured (masked)" />
                ) : (
                  <StatusBadge tone="neutral" size="sm" label="Not configured" />
                )}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {changed.length > 0 ? (
              <span className="font-mono text-[9.5px] text-warn-ink">
                Unsaved changes: {changed.map(fieldLabel).join(' · ')}
              </span>
            ) : null}
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => void save()}
              disabled={!canSave}
              className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-accent px-3 text-[11px] font-semibold text-accent-contrast shadow-hairline transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.6} />
              ) : (
                <Save className="h-3 w-3" strokeWidth={2.6} />
              )}
              {saving ? 'Saving…' : 'Save changes'}
            </motion.button>
          </div>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field
            label="API key"
            hint={selectedStatus?.configured ? 'Stored on the server. Leave blank to keep it.' : 'Paste a key to enable this provider.'}
          >
            <div className="relative">
              <KeyRound
                className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-faint"
                strokeWidth={2.2}
              />
              <input
                type={revealKey ? 'text' : 'password'}
                value={edits.api_key}
                onChange={(event) =>
                  setEdits((current) => ({ ...current, api_key: event.target.value }))
                }
                placeholder={
                  selectedStatus?.configured ? '•••••••••••• (blank keeps current)' : 'sk-…'
                }
                aria-label={`${selectedMeta.label} API key`}
                autoComplete="off"
                spellCheck={false}
                className="h-8 w-full rounded-sm border border-hairline bg-elevated pl-7 pr-7 font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent/40"
              />
              <button
                type="button"
                onClick={() => setRevealKey((value) => !value)}
                aria-label={revealKey ? 'Hide provider API key' : 'Show provider API key'}
                className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-ink-faint transition-colors hover:text-ink"
              >
                {revealKey ? (
                  <EyeOff className="h-3 w-3" strokeWidth={2.4} />
                ) : (
                  <Eye className="h-3 w-3" strokeWidth={2.4} />
                )}
              </button>
            </div>
          </Field>

          <Field label="Base URL" hint="Leave blank to remove the saved URL">
            <input
              value={baseUrlValue}
              onChange={(event) =>
                setEdits((current) => ({ ...current, base_url: event.target.value }))
              }
              placeholder="https://api.openai.com/v1"
              aria-label={`${selectedMeta.label} base URL`}
              autoComplete="off"
              spellCheck={false}
              className="h-8 w-full rounded-sm border border-hairline bg-elevated px-2 font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent/40"
            />
          </Field>
        </div>

        <Field label="Default model" hint={models.length > 0 ? `${models.length} discovered` : 'Leave blank to remove the saved model'}>
          <div className="flex items-center gap-1.5">
            <input
              value={modelValue}
              onChange={(event) =>
                setEdits((current) => ({ ...current, model: event.target.value }))
              }
              placeholder="gpt-4.1-mini"
              aria-label={`${selectedMeta.label} model`}
              autoComplete="off"
              spellCheck={false}
              className="h-8 min-w-0 flex-1 rounded-sm border border-hairline bg-elevated px-2 font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent/40"
            />
            <button
              type="button"
              onClick={() => void testAndFetch()}
              disabled={fetching}
              className="inline-flex h-8 items-center gap-1.5 rounded-pill border border-accent/25 bg-accent-soft px-2 text-[10.5px] font-semibold whitespace-nowrap text-accent transition-colors hover:border-accent/50 disabled:cursor-progress disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:px-3"
            >
              {fetching ? (
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.6} />
              ) : (
                <FlaskConical className="h-3 w-3" strokeWidth={2.4} />
              )}
              {fetching ? 'Testing…' : 'Test & fetch models'}
            </button>
          </div>
        </Field>

        {/* discovered models */}
        <AnimatePresence initial={false}>
          {models.length > 0 ? (
            <motion.div
              key="models"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={SPRING_SNAPPY}
              className="overflow-hidden"
            >
              <div className="rounded-sm border border-accent/25 bg-accent-soft/50 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <p className="flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-accent">
                    <Sparkles className="h-2.5 w-2.5" strokeWidth={2.6} />
                    {models.length} models discovered
                  </p>
                  <p className="font-mono text-[9px] text-ink-faint">
                    {testedProviders[selected] ? 'from the last credential test' : 'reported by the gateway'}
                  </p>
                </div>

                <div className="relative mt-1.5">
                  <select
                    value={models.includes(modelValue) ? modelValue : ''}
                    onChange={(event) =>
                      setEdits((current) => ({ ...current, model: event.target.value }))
                    }
                    aria-label="Available models"
                    className="h-8 w-full appearance-none rounded-sm border border-hairline bg-elevated px-2 pr-7 font-mono text-[11px] text-ink outline-none focus:border-accent/40"
                  >
                    <option value="">Select a model…</option>
                    {models.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-faint"
                    strokeWidth={2.4}
                  />
                </div>

                <p className="mt-1 font-mono text-[9px] text-ink-faint">
                  Pick a model, then <span className="text-accent">Save changes</span> to route the
                  gateway at it.
                </p>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <p className="border-t border-hairline pt-2 font-mono text-[9.5px] leading-relaxed text-ink-faint">
          Saving sends changed fields only. A blank key is never sent. Clearing the
          base URL or model removes the stored value.
        </p>
      </motion.section>
    </div>
  );
}

export default SettingsView;
