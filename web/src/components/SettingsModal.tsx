import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  HelpCircle,
  Key,
  Layers,
  Radio,
  RefreshCw,
  X,
  Zap,
} from 'lucide-react';
import { StatusChip } from './StatusChip';
import { api, ApiError } from '../services/api';
import { PROVIDER_DEFAULT_BASE_URLS, PROVIDER_MODELS } from '../constants/providerModels';
import type { MaskedKeyStatus, ProviderInfo, ProvidersResponse, UpdateLLMSettingsPayload } from '../types/api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  platformApiKey: string;
  onSavePlatformApiKey: (key: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  platformApiKey,
  onSavePlatformApiKey,
}) => {
  const [mounted, setMounted] = useState(false);
  const [platformKey, setPlatformKey] = useState(platformApiKey);
  const [provider, setProvider] = useState<string>('openai');
  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiOrgId, setOpenaiOrgId] = useState('');
  const [openaiProjId, setOpenaiProjId] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('https://api.groq.com/openai/v1');
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('http://localhost:11434');
  const [defaultModel, setDefaultModel] = useState('gpt-4o-mini');
  const [modelList, setModelList] = useState<string[]>([
    'gpt-4o-mini',
    'gpt-4o',
    'o3-mini',
    'o1',
    'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'llama-3.3-70b-versatile',
    'deepseek-chat',
  ]);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Pipeline execution tuning (UpdateLLMSettingsRequest: timeout 1-300s,
  // max_cycles 1-10, enforce_guardrails bool). Blank numeric inputs are
  // omitted so saved values are preserved server-side.
  const [showPipelineSettings, setShowPipelineSettings] = useState(false);
  const [timeoutSeconds, setTimeoutSeconds] = useState('');
  const [maxCycles, setMaxCycles] = useState('');
  const [enforceGuardrails, setEnforceGuardrails] = useState(true);
  // Snapshot of pipeline values taken when the modal opens. GET
  // /v1/settings/llm returns no pipeline fields (timeout/max_cycles/
  // enforce_guardrails), so the snapshot is the local defaults. Pipeline
  // fields are sent only when a current value differs from the snapshot —
  // expanding Advanced without editing must never clobber a server-side
  // `enforce_guardrails: false` back to true.
  const pipelineSnapshot = useRef({ timeoutSeconds: '', maxCycles: '', enforceGuardrails: true });
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<{ success: boolean; message: string } | null>(null);
  // Per-provider key status from providers_configured (GET booleans) merged
  // with POST masked-view hints. Never written into password inputs.
  const [keyStatus, setKeyStatus] = useState<Record<string, MaskedKeyStatus>>({});

  // Registry state
  const [providersData, setProvidersData] = useState<ProvidersResponse | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadAllSettings = async () => {
    try {
      const [settings, provs] = await Promise.all([
        api.getLLMSettings().catch(() => null),
        api.getProviders().catch(() => null),
      ]);

      if (provs) {
        setProvidersData(provs);
      }

      if (settings) {
        const activeProvider = settings.active_provider || 'openai';
        if (settings.active_provider) setProvider(activeProvider);
        if (settings.default_model) setDefaultModel(settings.default_model);
        if (settings.custom_base_url) setCustomBaseUrl(settings.custom_base_url);

        // Per-provider configured flags (booleans only — no key material).
        // Password inputs are intentionally never populated from the server.
        const configured = settings.providers_configured ?? {};
        setKeyStatus((prev) => {
          const next: Record<string, MaskedKeyStatus> = { ...prev };
          for (const [providerId, isConfigured] of Object.entries(configured)) {
            next[providerId] = { configured: Boolean(isConfigured), hint: next[providerId]?.hint };
          }
          next['ollama'] = { configured: true };
          return next;
        });

        // Restore the model list: fetched models for the active provider first, registry fallback
        const savedModels = settings.provider_available_models?.[activeProvider] ?? [];
        const list = savedModels.length > 0 ? [...savedModels] : (PROVIDER_MODELS[activeProvider] ?? PROVIDER_MODELS.custom);
        if (settings.default_model && !list.includes(settings.default_model)) {
          list.unshift(settings.default_model);
        }
        setModelList(list);
      }
    } catch {
      // Handled
    }
  };

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      pipelineSnapshot.current = { timeoutSeconds: '', maxCycles: '', enforceGuardrails: true };
      setTimeoutSeconds('');
      setMaxCycles('');
      setEnforceGuardrails(true);
      loadAllSettings();
    } else {
      document.body.style.overflow = 'unset';
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!mounted || !isOpen) return null;

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    setTestResult(null);

    // Source model list from PROVIDER_MODELS (single registry, frontend fallback)
    const models = PROVIDER_MODELS[newProvider] ?? PROVIDER_MODELS.custom;
    setModelList(models);
    // Prefer provider's curated default (from GET /v1/settings/providers) if available,
    // otherwise first entry of PROVIDER_MODELS.
    const providerInfo = providersData?.providers.find((p) => p.id === newProvider);
    if (providerInfo?.current_model) {
      setDefaultModel(providerInfo.current_model);
    } else {
      setDefaultModel(models[0]);
    }

    // Sync base URL for OpenAI-compatible providers via PROVIDER_DEFAULT_BASE_URLS map
    const defaultUrl = PROVIDER_DEFAULT_BASE_URLS[newProvider];
    if (defaultUrl) {
      const isCustomProvider = ['groq', 'openrouter', 'deepseek', 'custom'].includes(newProvider);
      if (isCustomProvider && (!customBaseUrl || customBaseUrl.includes('openai.com') || customBaseUrl.includes('localhost') || customBaseUrl.includes('groq.com'))) {
        // Only override when current URL looks like a placeholder from another provider
        setCustomBaseUrl(defaultUrl);
      }
    }
  };

  const getActiveApiKey = () => {
    if (provider === 'openai') return openaiKey;
    if (provider === 'anthropic') return anthropicKey;
    if (['groq', 'openrouter', 'deepseek', 'custom'].includes(provider)) return customKey;
    return '';
  };

  const getActiveBaseUrl = () => {
    if (['groq', 'openrouter', 'deepseek', 'custom'].includes(provider)) return customBaseUrl;
    if (provider === 'ollama') return ollamaBaseUrl;
    return '';
  };

  // Latency is only meaningful when something actually answered. A failed
  // check reports its reason alone — "(0 ms)" on a failure is noise.
  const withLatency = (success: boolean, message: string, latencyMs: number) =>
    success ? `${message} (${latencyMs.toFixed(0)} ms)` : message;

  const handleTestAndFetchModels = async () => {
    setTesting(true);
    setTestResult(null);
    if (platformKey) {
      api.setApiKey(platformKey);
      onSavePlatformApiKey(platformKey);
    }
    try {
      const res = await api.testAndFetchModels({
        provider,
        api_key: getActiveApiKey(),
        base_url: getActiveBaseUrl(),
        organization_id: openaiOrgId,
        project_id: openaiProjId,
        model: defaultModel,
      });

      if (res.models && res.models.length > 0) {
        setModelList(res.models);
        if (!res.models.includes(defaultModel)) {
          setDefaultModel(res.models[0]);
        }
      }

      setTestResult({
        success: res.success,
        message: withLatency(res.success, res.message, res.latency_ms),
      });

      // Refresh providers registry
      const updatedProvs = await api.getProviders().catch(() => null);
      if (updatedProvs) setProvidersData(updatedProvs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection test failed. Check API key or URL.';
      setTestResult({
        success: false,
        message: msg,
      });
    } finally {
      setTesting(false);
    }
  };

  // Checks the configuration already saved on the server — deliberately does
  // not read any field in this form.
  const handleCheckSavedConfig = async () => {
    setPinging(true);
    setPingResult(null);
    try {
      const res = await api.testLLMConnection();
      const success = res.status === 'success';
      setPingResult({
        success,
        message: withLatency(success, res.message, res.latency_ms),
      });
    } catch (err: unknown) {
      setPingResult({
        success: false,
        message: err instanceof Error ? err.message : 'Ping failed.',
      });
    } finally {
      setPinging(false);
    }
  };

  const handleSave = async (switchProvider?: string, switchModel?: string) => {
    setLoading(true);
    setSaveSuccess(false);
    setSaveError(null);
    if (platformKey) {
      onSavePlatformApiKey(platformKey);
      api.setApiKey(platformKey);
    }

    const targetProvider = switchProvider || provider;
    const targetModel = switchModel || defaultModel;

    localStorage.setItem('meridian_active_provider', targetProvider);
    localStorage.setItem('meridian_default_model', targetModel);

    // Backend accepts only UpdateLLMSettingsRequest fields (extra="forbid" → 422).
    // openai_proj_id is test-call-only; litellm_base_url is not a settings field.
    // custom_api_key/custom_base_url are sent only for the OpenAI-compatible
    // family (groq/openrouter/deepseek/custom); ollama sends custom_base_url
    // (backend fallback) but never a key. Blank strings are dropped so blanks
    // preserve saved values server-side.
    const isCustomFamily = ['groq', 'openrouter', 'deepseek', 'custom'].includes(targetProvider);
    const payload: UpdateLLMSettingsPayload = {
      active_provider: targetProvider,
      default_model: targetModel,
    };
    // Only include non-blank fields so blanks preserve saved values server-side
    // (and absent keys never appear on the wire at all).
    if (openaiKey) payload.openai_api_key = openaiKey;
    if (openaiOrgId) payload.openai_org_id = openaiOrgId;
    if (anthropicKey) payload.anthropic_api_key = anthropicKey;
    if (customKey) {
      if (targetProvider === 'groq') payload.groq_api_key = customKey;
      if (targetProvider === 'openrouter') payload.openrouter_api_key = customKey;
      if (targetProvider === 'deepseek') payload.deepseek_api_key = customKey;
      if (isCustomFamily) payload.custom_api_key = customKey;
    }
    if (targetProvider === 'ollama') {
      if (ollamaBaseUrl) payload.custom_base_url = ollamaBaseUrl;
    } else if (isCustomFamily && customBaseUrl) {
      payload.custom_base_url = customBaseUrl;
    }
    // Advanced pipeline settings — only send when a value differs from the
    // open-time snapshot; blank numerics are still omitted.
    const pipelineSnap = pipelineSnapshot.current;
    const pipelineChanged =
      timeoutSeconds !== pipelineSnap.timeoutSeconds ||
      maxCycles !== pipelineSnap.maxCycles ||
      enforceGuardrails !== pipelineSnap.enforceGuardrails;
    if (pipelineChanged) {
      const parsedTimeout = Number(timeoutSeconds);
      if (timeoutSeconds.trim() && Number.isFinite(parsedTimeout)) {
        payload.timeout_seconds = Math.min(300, Math.max(1, Math.round(parsedTimeout)));
      }
      const parsedCycles = Number(maxCycles);
      if (maxCycles.trim() && Number.isFinite(parsedCycles)) {
        payload.max_cycles = Math.min(10, Math.max(1, Math.round(parsedCycles)));
      }
      payload.enforce_guardrails = enforceGuardrails;
    }

    try {
      const saved = await api.updateLLMSettings(payload);

      // Merge POST masked-view hints ({configured, hint}) into status badges.
      setKeyStatus((prev) => {
        const next: Record<string, MaskedKeyStatus> = { ...prev };
        const masked = saved as unknown as Record<string, MaskedKeyStatus | undefined>;
        const keyByProvider: Record<string, string> = {
          openai: 'openai_api_key',
          anthropic: 'anthropic_api_key',
          groq: 'groq_api_key',
          openrouter: 'openrouter_api_key',
          deepseek: 'deepseek_api_key',
          custom: 'custom_api_key',
        };
        for (const [providerId, key] of Object.entries(keyByProvider)) {
          const entry = masked[key];
          if (entry && typeof entry === 'object' && 'configured' in entry) {
            next[providerId] = { configured: entry.configured, hint: entry.hint ?? next[providerId]?.hint };
          }
        }
        if (saved.providers_configured) {
          for (const [providerId, isConfigured] of Object.entries(saved.providers_configured)) {
            next[providerId] = { configured: Boolean(isConfigured), hint: next[providerId]?.hint };
          }
        }
        next['ollama'] = { configured: true };
        return next;
      });

      setSaveSuccess(true);
      await loadAllSettings();
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 600);
    } catch (err: unknown) {
      // Surface validation (422) and server errors inline — never swallow.
      const msg =
        err instanceof ApiError && err.detail
          ? `Save failed (HTTP ${err.status}): ${err.detail}`
          : err instanceof Error
            ? err.message
            : 'Settings save failed.';
      setSaveError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectProviderCard = (p: ProviderInfo) => {
    setProvider(p.id);
    handleProviderChange(p.id);
  };

  // Per-provider "Configured •••ab12" badge from providers_configured / POST hint.
  // Rendered as a StatusChip: the state word and the masked hint both ride the
  // chip's mono label, so the hint reads as a readout rather than prose.
  const renderKeyStatus = (providerId: string) => {
    const s = keyStatus[providerId];
    if (!s) return null;
    if (!s.configured) {
      return <StatusChip variant="faint">Not configured</StatusChip>;
    }
    const suffix = s.hint && s.hint !== '****' ? ` •••${s.hint}` : ' ••••';
    return <StatusChip variant="ok">{`Configured${suffix}`}</StatusChip>;
  };

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden p-3 sm:p-4">
      {/* Scrim — token-backed, same layer as the shared overlay shell. */}
      <div className="overlay-scrim backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      {/* Centered modal surface */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="relative z-50 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded border border-hairline bg-surface-raised shadow-overlay"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline bg-surface-raised px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-hairline bg-accent-wash">
              <Key className="size-4 text-accent-ink" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 id="settings-modal-title" className="text-readout font-bold text-ink">
                LLM Provider &amp; Platform Key Studio
              </h3>
              <p className="text-micro text-muted">
                Select provider, enter credentials, and test connection to auto-fetch models.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings modal"
            className="shrink-0 rounded-sm p-1.5 text-muted transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* Configured providers quick-selector */}
          {providersData && providersData.providers.length > 0 && (
            <div className="space-y-2.5 rounded-sm border border-hairline bg-surface-sunken p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="label-section flex items-center gap-1.5 text-ink">
                  <Layers className="size-3.5 text-accent" aria-hidden="true" />
                  <span>Configured providers</span>
                </h3>
                <span className="num text-readout font-semibold text-accent-ink">
                  {providersData.providers.filter((p) => p.configured).length} ready
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {providersData.providers.map((p) => {
                  const isSelected = provider === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectProviderCard(p)}
                      aria-pressed={isSelected}
                      className={`flex flex-col items-start justify-between gap-1.5 rounded-sm border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        isSelected
                          ? 'border-accent bg-accent-wash'
                          : p.configured
                            ? 'border-hairline bg-surface-raised hover:border-hairline-strong'
                            : 'border-hairline bg-surface-raised opacity-70 hover:opacity-100'
                      }`}
                    >
                      <span className="w-full truncate text-label font-semibold text-ink">
                        {p.name.split(' ')[0]}
                      </span>
                      <StatusChip variant={p.is_active ? 'accent' : p.configured ? 'ok' : 'faint'}>
                        {p.is_active ? 'Active' : p.configured ? 'Configured' : 'Unconfigured'}
                      </StatusChip>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 1 · Provider selection */}
          <div>
            <label htmlFor="provider-select" className="label-section mb-1.5 block text-muted">
              1 · Foundation LLM provider
            </label>
            <div className="relative">
              <select
                id="provider-select"
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full cursor-pointer rounded-sm border border-hairline bg-surface-raised px-3 py-2 text-body text-ink outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="openai">OpenAI (GPT-4o, GPT-4o-mini, o1, o3-mini)</option>
                <option value="anthropic">Anthropic (Claude 3.7 Sonnet, Claude 3.5)</option>
                <option value="groq">Groq Cloud (Fast Llama 3.3, Mixtral)</option>
                <option value="openrouter">OpenRouter (Multi-Model Router)</option>
                <option value="deepseek">DeepSeek (DeepSeek V3, DeepSeek R1)</option>
                <option value="ollama">Ollama (Local Offline Models)</option>
                <option value="custom">Custom OpenAI-Compatible / Local vLLM</option>
              </select>
            </div>
          </div>

          {/* Credentials for the selected provider */}
          <div className="space-y-3.5 rounded-sm border border-hairline bg-surface-sunken p-4">
            {/* OpenAI Configuration */}
            {provider === 'openai' && (
              <div className="space-y-3.5">
                <div>
                  <label
                    htmlFor="openai-key-input"
                    className="mb-1.5 flex items-center justify-between gap-2 text-label font-semibold text-ink"
                  >
                    <span className="flex items-center gap-2">
                      <span>OpenAI API Key (<code className="id-mono text-accent-ink">OPENAI_API_KEY</code>)</span>
                      {renderKeyStatus('openai')}
                    </span>
                    <span className="shrink-0 text-micro font-normal text-faint">Leave blank to keep existing</span>
                  </label>
                  <input
                    id="openai-key-input"
                    type="password"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder="sk-proj-..."
                    className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 id-mono text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
                  />
                </div>

                <div className="grid grid-cols-1 gap-2.5 border-t border-hairline pt-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="openai-org-input" className="mb-1.5 block text-label font-medium text-muted">
                      Organization ID (optional)
                    </label>
                    <input
                      id="openai-org-input"
                      type="text"
                      value={openaiOrgId}
                      onChange={(e) => setOpenaiOrgId(e.target.value)}
                      placeholder="org-..."
                      className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 id-mono text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
                    />
                  </div>

                  <div>
                    <label htmlFor="openai-proj-input" className="mb-1.5 block text-label font-medium text-muted">
                      Project ID (optional, test-call only — not saved)
                    </label>
                    <input
                      id="openai-proj-input"
                      type="text"
                      value={openaiProjId}
                      onChange={(e) => setOpenaiProjId(e.target.value)}
                      placeholder="proj-..."
                      className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 id-mono text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Anthropic Configuration */}
            {provider === 'anthropic' && (
              <div>
                <label
                  htmlFor="anthropic-key-input"
                  className="mb-1.5 flex items-center justify-between gap-2 text-label font-semibold text-ink"
                >
                  <span className="flex items-center gap-2">
                    <span>Anthropic API Key (<code className="id-mono text-accent-ink">ANTHROPIC_API_KEY</code>)</span>
                    {renderKeyStatus('anthropic')}
                  </span>
                  <span className="shrink-0 text-micro font-normal text-faint">Leave blank to keep existing</span>
                </label>
                <input
                  id="anthropic-key-input"
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 id-mono text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            )}

            {/* Groq / OpenRouter / DeepSeek / Custom Configuration */}
            {['groq', 'openrouter', 'deepseek', 'custom'].includes(provider) && (
              <div className="space-y-3.5">
                <div>
                  <label htmlFor="custom-base-url-input" className="mb-1.5 block text-label font-semibold text-ink">
                    API base endpoint URL
                  </label>
                  <input
                    id="custom-base-url-input"
                    type="text"
                    value={customBaseUrl}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                    placeholder="http://localhost:20128/v1 or https://api.groq.com/openai/v1"
                    className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 id-mono text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
                  />
                </div>

                <div>
                  <label
                    htmlFor="custom-key-input"
                    className="mb-1.5 flex items-center justify-between gap-2 text-label font-semibold text-ink"
                  >
                    <span className="flex items-center gap-2">
                      <span>Provider API Key</span>
                      {renderKeyStatus(provider)}
                    </span>
                    <span className="shrink-0 text-micro font-normal text-faint">
                      Leave blank to keep existing; optional for local endpoints
                    </span>
                  </label>
                  <input
                    id="custom-key-input"
                    type="password"
                    value={customKey}
                    onChange={(e) => setCustomKey(e.target.value)}
                    placeholder="Enter API key or leave blank for unauthenticated local endpoints"
                    className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 id-mono text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
                  />
                </div>
              </div>
            )}

            {/* Ollama Configuration */}
            {provider === 'ollama' && (
              <div>
                <label htmlFor="ollama-base-url-input" className="mb-1.5 block text-label font-semibold text-ink">
                  Local Ollama host endpoint
                </label>
                <input
                  id="ollama-base-url-input"
                  type="text"
                  value={ollamaBaseUrl}
                  onChange={(e) => setOllamaBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 id-mono text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
                />
                <p className="mt-1.5 text-micro text-muted">
                  Connects to your local Ollama daemon to fetch installed offline models.
                </p>
              </div>
            )}
          </div>

          {/* Connection checks — both connection actions, in one labelled block
              next to the provider and endpoint fields they read. */}
          <div data-testid="connection-group" className="space-y-3 rounded-sm border border-hairline bg-surface-raised p-4">
            <div>
              <h3 className="label-section flex items-center gap-1.5 text-ink">
                <Activity className="size-3.5 text-accent" aria-hidden="true" />
                <span>Connection checks</span>
              </h3>
              <p className="mt-1 text-micro text-muted">
                Two independent checks, and neither one saves — Save &amp; Apply does that.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col items-start gap-1.5 rounded-sm border border-hairline bg-surface-sunken p-3">
                <button
                  type="button"
                  onClick={handleCheckSavedConfig}
                  disabled={pinging}
                  className="flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 text-label font-semibold text-ink transition-colors hover:border-accent hover:bg-accent-wash hover:text-accent-ink disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {pinging ? (
                    <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Radio className="size-3.5 text-accent" aria-hidden="true" />
                  )}
                  <span>Check saved config</span>
                </button>
                <p className="text-micro text-muted">
                  Reads the configuration already stored on the server and pings it. Ignores the
                  values you just typed.
                </p>
              </div>

              <div className="flex flex-col items-start gap-1.5 rounded-sm border border-hairline bg-surface-sunken p-3">
                <button
                  type="button"
                  onClick={handleTestAndFetchModels}
                  disabled={testing}
                  className="flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-label font-bold text-white transition-colors hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {testing ? (
                    <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Zap className="size-3.5" aria-hidden="true" />
                  )}
                  <span>Validate typed values &amp; load models</span>
                </button>
                <p className="text-micro text-muted">
                  Tests the values you just typed against the endpoint and replaces the model list
                  with what that endpoint returns.
                </p>
              </div>
            </div>

            {pingResult && (
              <div
                role="status"
                aria-live="polite"
                className="flex items-start gap-2 border-t border-hairline pt-3"
              >
                <StatusChip variant={pingResult.success ? 'ok' : 'fail'}>
                  {pingResult.success ? 'Reachable' : 'Unreachable'}
                </StatusChip>
                <span className="text-label text-muted">{pingResult.message}</span>
              </div>
            )}

            {testResult && (
              <div
                role="alert"
                aria-live="polite"
                className="flex items-start gap-2 border-t border-hairline pt-3"
              >
                <StatusChip variant={testResult.success ? 'ok' : 'fail'}>
                  {testResult.success ? 'Endpoint valid' : 'Endpoint rejected'}
                </StatusChip>
                <span className="text-label text-muted">{testResult.message}</span>
              </div>
            )}
          </div>

          {/* 2 · Target model */}
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <label htmlFor="model-select" className="label-section text-muted">
                2 · Active target model
              </label>
              <span className="flex items-baseline gap-1.5">
                <span className="num text-readout font-semibold text-accent-ink">{modelList.length}</span>
                <span className="text-micro text-faint">models listed</span>
              </span>
            </div>

            <div className="space-y-2">
              <div className="relative">
                <select
                  id="model-select"
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  className="w-full cursor-pointer rounded-sm border border-hairline bg-surface-raised px-3 py-2 id-mono text-ink outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {modelList.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  placeholder="Or enter any custom model name..."
                  aria-label="Custom Model Name"
                  className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 id-mono text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            </div>

            <p className="mt-1.5 text-micro text-muted">
              Pick one of the listed models, or type any model name the endpoint accepts.
            </p>
          </div>

          {/* Advanced pipeline settings (timeout, guardrails, cycles) */}
          <div className="border-t border-hairline pt-4">
            <button
              type="button"
              onClick={() => setShowPipelineSettings((prev) => !prev)}
              aria-expanded={showPipelineSettings}
              className="flex w-full cursor-pointer items-center justify-between gap-2 py-1 text-label font-bold text-accent-ink transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="flex items-center gap-1.5">
                <Zap className="size-3.5 text-accent" aria-hidden="true" />
                <span>Advanced: timeout, guardrails &amp; agent cycles</span>
              </span>
              <ChevronDown className={`size-4 transition-transform ${showPipelineSettings ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            {showPipelineSettings && (
              <div className="mt-3 grid grid-cols-1 gap-2.5 rounded-sm border border-hairline bg-surface-sunken p-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="timeout-seconds-input" className="mb-1.5 block text-label font-medium text-muted">
                    Timeout (seconds, 1–300)
                  </label>
                  <input
                    id="timeout-seconds-input"
                    type="number"
                    min={1}
                    max={300}
                    value={timeoutSeconds}
                    onChange={(e) => setTimeoutSeconds(e.target.value)}
                    placeholder="e.g. 60"
                    className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 num text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
                  />
                </div>
                <div>
                  <label htmlFor="max-cycles-setting-input" className="mb-1.5 block text-label font-medium text-muted">
                    Max cycles (1–10)
                  </label>
                  <input
                    id="max-cycles-setting-input"
                    type="number"
                    min={1}
                    max={10}
                    value={maxCycles}
                    onChange={(e) => setMaxCycles(e.target.value)}
                    placeholder="e.g. 3"
                    className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 num text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label htmlFor="enforce-guardrails-input" className="flex cursor-pointer items-center gap-1.5 text-label font-medium text-ink">
                    <input
                      id="enforce-guardrails-input"
                      type="checkbox"
                      checked={enforceGuardrails}
                      onChange={(e) => setEnforceGuardrails(e.target.checked)}
                      className="cursor-pointer rounded-sm accent-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                    <span>Enforce guardrails</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Save outcome banners */}
          {saveSuccess && (
            <div
              role="alert"
              aria-live="polite"
              className="flex items-center gap-2 rounded-sm border border-hairline bg-ok-wash px-3 py-2 text-label font-semibold text-ok"
            >
              <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              <span>Settings and active model saved successfully!</span>
            </div>
          )}

          {saveError && (
            <div
              role="alert"
              aria-live="polite"
              className="flex items-start gap-2 rounded-sm border border-hairline bg-fail-wash px-3 py-2 text-label font-semibold text-fail"
            >
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <span className="leading-relaxed">{saveError}</span>
            </div>
          )}

          {/* Platform key — the disclosure is the field's single title. */}
          <div className="border-t border-hairline pt-4">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              aria-expanded={showAdvanced}
              className="flex w-full cursor-pointer items-center justify-between gap-2 py-1 text-label font-bold text-accent-ink transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="flex items-center gap-1.5">
                <HelpCircle className="size-3.5 text-accent" aria-hidden="true" />
                <span>What is the Meridian Platform Key?</span>
              </span>
              <ChevronDown className={`size-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            {showAdvanced && (
              <div data-testid="platform-key-panel" className="mt-3 rounded-sm border border-hairline bg-surface-sunken p-4">
                <p className="text-label leading-relaxed text-muted">
                  Internal security token that authenticates client requests against Meridian
                  platform endpoints. Sent as the <code className="id-mono text-ink">X-API-Key</code> header.
                </p>
                <input
                  id="platform-key-input"
                  type="text"
                  value={platformKey}
                  onChange={(e) => setPlatformKey(e.target.value)}
                  placeholder="meridian-test-secret-key-2026"
                  aria-label="Meridian Platform Key"
                  className="mt-2.5 w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 id-mono text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer — Cancel and Save & Apply only. The connection checks live
            with the fields they read, not here. */}
        <div
          data-testid="settings-modal-footer"
          className="flex shrink-0 items-center justify-end gap-2 border-t border-hairline bg-surface px-5 py-3"
        >
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-sm px-3.5 py-1.5 text-label font-medium text-muted transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleSave()}
            disabled={loading || saveSuccess}
            className={`flex cursor-pointer items-center gap-1.5 rounded-sm px-5 py-1.5 text-label font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              saveSuccess ? 'bg-ok' : 'bg-accent hover:bg-accent-ink'
            }`}
          >
            {loading ? (
              <>
                <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
                <span>Saving...</span>
              </>
            ) : (
              <span>Save &amp; Apply</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
