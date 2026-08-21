import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  HelpCircle,
  Key,
  Layers,
  RefreshCw,
  Server,
  X,
  Zap,
} from 'lucide-react';
import { api } from '../services/api';
import { PROVIDER_DEFAULT_BASE_URLS, PROVIDER_MODELS } from '../constants/providerModels';
import type { ProviderInfo, ProvidersResponse } from '../types/api';

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
  const [litellmUrl, setLitellmUrl] = useState('http://localhost:4000');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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
        if (settings.active_provider) setProvider(settings.active_provider);
        if (settings.default_model) setDefaultModel(settings.default_model);
        if (settings.litellm_base_url) setLitellmUrl(settings.litellm_base_url);
        if (settings.openai_org_id) setOpenaiOrgId(settings.openai_org_id);
        if (settings.openai_proj_id) setOpenaiProjId(settings.openai_proj_id);
        if (settings.custom_base_url) setCustomBaseUrl(settings.custom_base_url);
      }
    } catch {
      // Handled
    }
  };

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      loadAllSettings();
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

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
        message: `${res.message} (${res.latency_ms.toFixed(0)} ms)`,
      });

      // Refresh providers registry
      const updatedProvs = await api.getProviders().catch(() => null);
      if (updatedProvs) setProvidersData(updatedProvs);
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Connection test failed. Check API key or URL.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (switchProvider?: string, switchModel?: string) => {
    setLoading(true);
    setSaveSuccess(false);
    if (platformKey) {
      onSavePlatformApiKey(platformKey);
      api.setApiKey(platformKey);
    }

    const targetProvider = switchProvider || provider;
    const targetModel = switchModel || defaultModel;

    localStorage.setItem('meridian_active_provider', targetProvider);
    localStorage.setItem('meridian_default_model', targetModel);

    try {
      await api.updateLLMSettings({
        active_provider: targetProvider,
        openai_api_key: openaiKey || undefined,
        openai_org_id: openaiOrgId || undefined,
        openai_proj_id: openaiProjId || undefined,
        anthropic_api_key: anthropicKey || undefined,
        groq_api_key: targetProvider === 'groq' && customKey ? customKey : undefined,
        openrouter_api_key: targetProvider === 'openrouter' && customKey ? customKey : undefined,
        deepseek_api_key: targetProvider === 'deepseek' && customKey ? customKey : undefined,
        custom_api_key: customKey || undefined,
        custom_base_url: customBaseUrl || undefined,
        default_model: targetModel,
        litellm_base_url: litellmUrl || undefined,
      });

      setSaveSuccess(true);
      await loadAllSettings();
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 600);
    } catch {
      // Handled
    } finally {
      setLoading(false);
    }
  };

  const handleSelectProviderCard = (p: ProviderInfo) => {
    setProvider(p.id);
    handleProviderChange(p.id);
  };

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 overflow-hidden">
      {/* Absolute Backdrop covering entire viewport */}
      <div
        className="fixed inset-0 bg-[#1E2050]/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Centered Modal Card */}
      <div className="relative z-10 w-full max-w-2xl bg-white border border-meridian-border rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Fixed Header */}
        <div className="flex items-center justify-between p-5 pb-3 border-b border-meridian-border shrink-0 bg-white">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-meridian-primary to-meridian-secondary flex items-center justify-center shadow-glow shrink-0">
              <Key className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-meridian-text">
                LLM Provider & Platform Key Studio
              </h3>
              <p className="text-[11px] text-meridian-textMuted font-medium">
                Select provider, enter credentials, and test connection to auto-fetch models.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-meridian-textMuted hover:text-meridian-text hover:bg-meridian-bg transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Section 0: Configured Providers Quick-Selector Pills */}
          {providersData && providersData.providers.length > 0 && (
            <div className="p-3.5 rounded-2xl bg-meridian-bg/70 border border-meridian-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-meridian-text flex items-center space-x-1.5">
                  <Layers className="w-3.5 h-3.5 text-meridian-primary" />
                  <span>Configured Providers Status ({providersData.providers.filter((p) => p.configured).length} ready)</span>
                </span>
                <span className="text-[10px] text-meridian-textMuted font-medium">Click to configure</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {providersData.providers.map((p) => {
                  const isSelected = provider === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectProviderCard(p)}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'bg-meridian-blossom border-meridian-primary ring-2 ring-meridian-primary/20 shadow-sm'
                          : p.configured
                          ? 'bg-white border-meridian-border hover:border-meridian-lavender'
                          : 'bg-white/60 border-meridian-border/60 opacity-70 hover:opacity-100'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className="text-[11px] font-bold text-meridian-text truncate">{p.name.split(' ')[0]}</span>
                        {p.is_active ? (
                          <span className="w-2 h-2 rounded-full bg-meridian-primary animate-pulse" />
                        ) : p.configured ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        ) : null}
                      </div>
                      <span className="text-[9px] text-meridian-textMuted font-mono truncate block">
                        {p.is_active ? 'Active' : p.configured ? 'Configured' : 'Unconfigured'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 1: LLM Provider Selection Dropdown */}
          <div>
            <label className="block text-xs font-bold text-meridian-text mb-1">
              1. Foundation LLM Provider:
            </label>
            <div className="relative">
              <select
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full bg-meridian-bg border border-meridian-border rounded-xl px-3.5 py-2 text-xs text-meridian-text font-bold outline-none focus:border-meridian-primary focus:bg-white transition-all cursor-pointer"
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

          {/* Section 2: Dynamic Provider Credentials */}
          <div className="p-4 rounded-2xl bg-meridian-bg/80 border border-meridian-border space-y-3">
            {/* OpenAI Configuration */}
            {provider === 'openai' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-meridian-text mb-1 flex items-center justify-between">
                    <span>OpenAI API Key (<code className="text-meridian-primary">OPENAI_API_KEY</code>)</span>
                    <span className="text-[10px] text-meridian-textMuted font-normal">Leave blank to keep existing</span>
                  </label>
                  <input
                    type="password"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder="sk-proj-..."
                    className="w-full bg-white border border-meridian-border rounded-xl px-3.5 py-2 text-xs text-meridian-text font-mono outline-none focus:border-meridian-primary transition-all"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <div>
                    <label className="block text-[10px] font-semibold text-meridian-textMuted mb-1">
                      Organization ID (Optional):
                    </label>
                    <input
                      type="text"
                      value={openaiOrgId}
                      onChange={(e) => setOpenaiOrgId(e.target.value)}
                      placeholder="org-..."
                      className="w-full bg-white border border-meridian-border rounded-xl px-3 py-1.5 text-xs text-meridian-text font-mono outline-none focus:border-meridian-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold text-meridian-textMuted mb-1">
                      Project ID (Optional):
                    </label>
                    <input
                      type="text"
                      value={openaiProjId}
                      onChange={(e) => setOpenaiProjId(e.target.value)}
                      placeholder="proj-..."
                      className="w-full bg-white border border-meridian-border rounded-xl px-3 py-1.5 text-xs text-meridian-text font-mono outline-none focus:border-meridian-primary"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Anthropic Configuration */}
            {provider === 'anthropic' && (
              <div>
                <label className="block text-[11px] font-bold text-meridian-text mb-1 flex items-center justify-between">
                  <span>Anthropic API Key (<code className="text-meridian-primary">ANTHROPIC_API_KEY</code>)</span>
                  <span className="text-[10px] text-meridian-textMuted font-normal">For Claude 3.5 & 3.7</span>
                </label>
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full bg-white border border-meridian-border rounded-xl px-3.5 py-2 text-xs text-meridian-text font-mono outline-none focus:border-meridian-primary transition-all"
                />
              </div>
            )}

            {/* Groq / OpenRouter / DeepSeek / Custom Configuration */}
            {['groq', 'openrouter', 'deepseek', 'custom'].includes(provider) && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-meridian-text mb-1">
                    API Base Endpoint URL:
                  </label>
                  <input
                    type="text"
                    value={customBaseUrl}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                    placeholder="http://localhost:20128/v1 or https://api.groq.com/openai/v1"
                    className="w-full bg-white border border-meridian-border rounded-xl px-3.5 py-2 text-xs text-meridian-text font-mono outline-none focus:border-meridian-primary transition-all"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-meridian-text mb-1 flex items-center justify-between">
                    <span>Provider API Key:</span>
                    <span className="text-[10px] text-meridian-textMuted font-normal">Optional for local vLLM / LMStudio</span>
                  </label>
                  <input
                    type="password"
                    value={customKey}
                    onChange={(e) => setCustomKey(e.target.value)}
                    placeholder="Enter API key or leave blank for unauthenticated local endpoints"
                    className="w-full bg-white border border-meridian-border rounded-xl px-3.5 py-2 text-xs text-meridian-text font-mono outline-none focus:border-meridian-primary transition-all"
                  />
                </div>
              </div>
            )}

            {/* Ollama Configuration */}
            {provider === 'ollama' && (
              <div>
                <label className="block text-[11px] font-bold text-meridian-text mb-1">
                  Local Ollama Host Endpoint:
                </label>
                <input
                  type="text"
                  value={ollamaBaseUrl}
                  onChange={(e) => setOllamaBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="w-full bg-white border border-meridian-border rounded-xl px-3.5 py-2 text-xs text-meridian-text font-mono outline-none focus:border-meridian-primary transition-all"
                />
                <p className="text-[10px] text-meridian-textMuted mt-1">
                  Connects to your local Ollama daemon to fetch installed offline models.
                </p>
              </div>
            )}
          </div>

          {/* Section 3: Model Selector & Dynamic Population */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-meridian-text">
                2. Active Target Model:
              </label>
              <span className="text-[11px] text-meridian-primary font-semibold">
                {modelList.length} models available
              </span>
            </div>

            <div className="space-y-2">
              <div className="relative">
                <select
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  className="w-full bg-meridian-bg border border-meridian-border rounded-xl px-3.5 py-2 text-xs text-meridian-text font-bold outline-none focus:border-meridian-primary focus:bg-white transition-all cursor-pointer"
                >
                  {modelList.map((m, idx) => (
                    <option key={idx} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  placeholder="Or enter any custom model name..."
                  className="flex-1 bg-white border border-meridian-border rounded-xl px-3 py-1.5 text-xs text-meridian-text font-mono outline-none focus:border-meridian-primary"
                />
              </div>
            </div>

            <p className="text-[11px] text-meridian-textMuted mt-1">
              💡 Tip: Click <strong>"Test Connection & Fetch Models"</strong> below to validate endpoint and auto-populate available models.
            </p>
          </div>

          {/* Test Result Banner */}
          {testResult && (
            <div
              className={`p-3.5 rounded-2xl border text-xs flex items-center space-x-2.5 animate-in fade-in duration-150 ${
                testResult.success
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-rose-50 border-rose-300 text-rose-900'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              )}
              <span className="font-medium leading-relaxed">{testResult.message}</span>
            </div>
          )}

          {/* Success Banner */}
          {saveSuccess && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs flex items-center space-x-2 animate-in fade-in duration-150">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span className="font-bold">Settings and active model saved successfully!</span>
            </div>
          )}

          {/* Expandable Architecture Explanations: X-API-Key & LiteLLM */}
          <div className="pt-2 border-t border-meridian-border">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center justify-between w-full text-xs font-bold text-meridian-primary hover:text-meridian-primaryHover py-1 cursor-pointer"
            >
              <span className="flex items-center space-x-1.5">
                <HelpCircle className="w-4 h-4 text-meridian-secondary" />
                <span>What are Meridian Platform Key & LiteLLM Gateway URL?</span>
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3 p-4 rounded-2xl bg-meridian-lavenderLight/50 border border-meridian-border text-xs text-meridian-text">
                <div>
                  <h4 className="font-bold text-meridian-primary flex items-center space-x-1.5">
                    <Key className="w-3.5 h-3.5" />
                    <span>Meridian Platform Key (<code>X-API-Key</code>)</span>
                  </h4>
                  <p className="text-[11px] text-meridian-textMuted mt-0.5 leading-relaxed">
                    Internal security token that authenticates client requests against Meridian platform endpoints.
                  </p>
                  <input
                    type="text"
                    value={platformKey}
                    onChange={(e) => setPlatformKey(e.target.value)}
                    placeholder="meridian-test-secret-key-2026"
                    className="w-full mt-1.5 bg-white border border-meridian-border rounded-xl px-3 py-1.5 text-xs text-meridian-text font-mono outline-none focus:border-meridian-primary"
                  />
                </div>

                <div className="pt-2 border-t border-meridian-border/60">
                  <h4 className="font-bold text-meridian-primary flex items-center space-x-1.5">
                    <Server className="w-3.5 h-3.5" />
                    <span>LiteLLM Gateway URL</span>
                  </h4>
                  <p className="text-[11px] text-meridian-textMuted mt-0.5 leading-relaxed">
                    The endpoint where the AI Gateway container runs (default <code>http://localhost:4000</code>).
                  </p>
                  <input
                    type="text"
                    value={litellmUrl}
                    onChange={(e) => setLitellmUrl(e.target.value)}
                    placeholder="http://localhost:4000"
                    className="w-full mt-1.5 bg-white border border-meridian-border rounded-xl px-3 py-1.5 text-xs text-meridian-text font-mono outline-none focus:border-meridian-primary"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Fixed Footer */}
        <div className="p-4 sm:p-5 pt-3 border-t border-meridian-border shrink-0 flex items-center justify-between bg-meridian-lavenderLight/40">
          <button
            type="button"
            onClick={handleTestAndFetchModels}
            disabled={testing}
            className="px-4 py-2 rounded-xl text-xs font-bold text-meridian-primary bg-white hover:bg-meridian-blossom border border-meridian-border flex items-center space-x-2 transition-all shadow-sm cursor-pointer disabled:opacity-50"
          >
            {testing ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5 text-meridian-primary" />
            )}
            <span>Test Connection & Fetch Models</span>
          </button>

          <div className="flex space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-meridian-textMuted hover:bg-white transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSave()}
              disabled={loading || saveSuccess}
              className={`px-6 py-2 rounded-xl text-xs font-bold shadow-glow flex items-center space-x-1.5 transition-all cursor-pointer ${
                saveSuccess
                  ? 'bg-emerald-600 text-white cursor-default'
                  : 'bg-meridian-primary hover:bg-meridian-primaryHover text-white'
              }`}
            >
              {loading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save & Apply</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
