import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  HelpCircle,
  Key,
  RefreshCw,
  Server,
  X,
  Zap,
} from 'lucide-react';
import { api } from '../services/api';

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

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';

      // First populate from local cache if present
      const cachedProvider = localStorage.getItem('meridian_active_provider');
      const cachedModel = localStorage.getItem('meridian_default_model');
      const cachedGroq = localStorage.getItem('meridian_groq_key');
      const cachedOpenAI = localStorage.getItem('meridian_openai_key');
      const cachedAnthropic = localStorage.getItem('meridian_anthropic_key');

      if (cachedProvider) setProvider(cachedProvider);
      if (cachedModel) setDefaultModel(cachedModel);
      if (cachedGroq) setCustomKey(cachedGroq);
      if (cachedOpenAI) setOpenaiKey(cachedOpenAI);
      if (cachedAnthropic) setAnthropicKey(cachedAnthropic);

      api.getLLMSettings()
        .then((settings) => {
          if (settings.default_model && !cachedModel) {
            setDefaultModel(settings.default_model);
          }
          setLitellmUrl(settings.litellm_base_url || 'http://localhost:4000');
          if (settings.active_provider && !cachedProvider) {
            setProvider(settings.active_provider);
          }
          if (settings.openai_api_key && !cachedOpenAI && !settings.openai_api_key.includes('...')) {
            setOpenaiKey(settings.openai_api_key);
          }
          if (settings.openai_org_id) setOpenaiOrgId(settings.openai_org_id);
          if (settings.openai_proj_id) setOpenaiProjId(settings.openai_proj_id);
          if (settings.anthropic_api_key && !cachedAnthropic && !settings.anthropic_api_key.includes('...')) {
            setAnthropicKey(settings.anthropic_api_key);
          }
          if (settings.custom_api_key && !cachedGroq && !settings.custom_api_key.includes('...')) {
            setCustomKey(settings.custom_api_key);
          }
          if (settings.custom_base_url) setCustomBaseUrl(settings.custom_base_url);
        })
        .catch(() => {
          // Fall back to defaults
        });
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

    // Dynamic model recommendations
    if (newProvider === 'openai') {
      setModelList(['gpt-4o-mini', 'gpt-4o', 'o3-mini', 'o1', 'gpt-4-turbo', 'text-embedding-3-small']);
      setDefaultModel('gpt-4o-mini');
    } else if (newProvider === 'anthropic') {
      setModelList(['claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229']);
      setDefaultModel('claude-3-5-sonnet-20241022');
    } else if (newProvider === 'groq') {
      setCustomBaseUrl('https://api.groq.com/openai/v1');
      setModelList(['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768']);
      setDefaultModel('llama-3.3-70b-versatile');
    } else if (newProvider === 'openrouter') {
      setCustomBaseUrl('https://openrouter.ai/api/v1');
      setModelList(['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-chat']);
      setDefaultModel('meta-llama/llama-3.3-70b-instruct');
    } else if (newProvider === 'deepseek') {
      setCustomBaseUrl('https://api.deepseek.com/v1');
      setModelList(['deepseek-chat', 'deepseek-reasoner']);
      setDefaultModel('deepseek-chat');
    } else if (newProvider === 'ollama') {
      setModelList(['llama3:latest', 'mistral:latest', 'qwen2.5:latest', 'nomic-embed-text:latest']);
      setDefaultModel('llama3:latest');
    } else {
      setModelList(['llama-3.3-70b-versatile', 'deepseek-chat', 'gpt-4o-mini']);
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
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Connection test failed. Check API key or URL.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setSaveSuccess(false);
    onSavePlatformApiKey(platformKey);

    // Persist to browser local storage
    localStorage.setItem('meridian_active_provider', provider);
    localStorage.setItem('meridian_default_model', defaultModel);
    if (provider === 'groq' && customKey && !customKey.includes('...')) {
      localStorage.setItem('meridian_groq_key', customKey);
    }
    if (provider === 'openai' && openaiKey && !openaiKey.includes('...')) {
      localStorage.setItem('meridian_openai_key', openaiKey);
    }
    if (provider === 'anthropic' && anthropicKey && !anthropicKey.includes('...')) {
      localStorage.setItem('meridian_anthropic_key', anthropicKey);
    }

    try {
      await api.updateLLMSettings({
        active_provider: provider,
        openai_api_key: openaiKey,
        openai_org_id: openaiOrgId,
        openai_proj_id: openaiProjId,
        anthropic_api_key: anthropicKey,
        groq_api_key: provider === 'groq' ? customKey : undefined,
        openrouter_api_key: provider === 'openrouter' ? customKey : undefined,
        deepseek_api_key: provider === 'deepseek' ? customKey : undefined,
        custom_api_key: customKey,
        custom_base_url: customBaseUrl,
        default_model: defaultModel,
        litellm_base_url: litellmUrl,
      });
      setSaveSuccess(true);
      // Automatically close modal after brief visual confirmation
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 700);
    } catch {
      // Handled
    } finally {
      setLoading(false);
    }
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
      <div className="relative z-10 w-full max-w-xl bg-white border border-meridian-border rounded-3xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
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
            className="p-1.5 rounded-full text-meridian-textMuted hover:text-meridian-text hover:bg-meridian-lavenderLight transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div className="p-5 py-4 overflow-y-auto flex-1 space-y-4">
          {/* Row 1: LLM Provider Selection Dropdown */}
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

          {/* Row 2: Dynamic Provider Credentials */}
          <div className="p-4 rounded-2xl bg-meridian-bg/80 border border-meridian-border space-y-3">
            {/* OpenAI Configuration */}
            {provider === 'openai' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-meridian-text mb-1 flex items-center justify-between">
                    <span>OpenAI API Key (<code className="text-meridian-primary">OPENAI_API_KEY</code>)</span>
                    <span className="text-[10px] text-meridian-textMuted font-normal">Required</span>
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
                    placeholder="https://api.groq.com/openai/v1"
                    className="w-full bg-white border border-meridian-border rounded-xl px-3.5 py-2 text-xs text-meridian-text font-mono outline-none focus:border-meridian-primary transition-all"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-meridian-text mb-1 flex items-center justify-between">
                    <span>Provider API Key:</span>
                    <span className="text-[10px] text-meridian-textMuted font-normal">Required</span>
                  </label>
                  <input
                    type="password"
                    value={customKey}
                    onChange={(e) => setCustomKey(e.target.value)}
                    placeholder="gsk_... or sk-or-..."
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

          {/* Row 3: Model Selector & Dynamic Population */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-meridian-text">
                2. Active Target Model:
              </label>
              <span className="text-[11px] text-meridian-primary font-semibold">
                {modelList.length} models available
              </span>
            </div>

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
            <p className="text-[10px] text-meridian-textMuted mt-1">
              💡 Tip: Click <strong>"Test Connection & Fetch Models"</strong> below to validate your API key and auto-populate all available models in the dropdown.
            </p>
          </div>

          {/* Test Status Banner (Green for Success, Red for Error) */}
          {testResult && (
            <div
              className={`p-3 rounded-2xl text-xs flex items-center space-x-2.5 ${
                testResult.success
                  ? 'bg-emerald-50 border border-emerald-300 text-emerald-900'
                  : 'bg-rose-50 border border-rose-300 text-rose-900'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              )}
              <span className="font-semibold">{testResult.message}</span>
            </div>
          )}

          {saveSuccess && (
            <div className="p-3 rounded-2xl text-xs bg-emerald-50 border border-emerald-300 text-emerald-900 flex items-center space-x-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span className="font-bold">Settings and active model saved successfully!</span>
            </div>
          )}

          {/* Expandable Architecture Explanations: X-API-Key & LiteLLM */}
          <div className="pt-2 border-t border-meridian-border">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center justify-between w-full text-xs font-bold text-meridian-primary hover:text-meridian-primaryHover py-1"
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
                    This is your <strong>internal security token</strong>. It authenticates external AI agents and client applications against your local/hosted Meridian platform endpoints (<code>/v1/query</code>, <code>/v1/ingest</code>, <code>/v1/guardrails</code>) and enforces per-tenant rate limits.
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
                    The endpoint where the <strong>AI Gateway container</strong> runs (default <code>http://localhost:4000</code>). It handles upstream provider failover, load balancing, and rate limits across OpenAI, Anthropic, and open-source models.
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
            className="px-4 py-2 rounded-xl text-xs font-bold text-meridian-primary bg-white hover:bg-meridian-blossom border border-meridian-border flex items-center space-x-2 transition-all shadow-sm"
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
              className="px-4 py-2 rounded-xl text-xs font-semibold text-meridian-textMuted hover:bg-white transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || saveSuccess}
              className={`px-6 py-2 rounded-xl text-xs font-bold shadow-glow flex items-center space-x-1.5 transition-all ${
                saveSuccess
                  ? 'bg-emerald-600 text-white cursor-default'
                  : 'bg-meridian-primary hover:bg-meridian-primaryHover text-white'
              }`}
            >
              {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              {saveSuccess ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                  <span>Saved & Applied!</span>
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
