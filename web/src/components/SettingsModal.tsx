import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Key,
  RefreshCw,
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
  const [platformKey, setPlatformKey] = useState(platformApiKey);
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('gpt-4o-mini');
  const [litellmUrl, setLitellmUrl] = useState('http://localhost:4000');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      api.getLLMSettings()
        .then((settings) => {
          setDefaultModel(settings.default_model || 'gpt-4o-mini');
          setLitellmUrl(settings.litellm_base_url || 'http://localhost:4000');
          if (settings.openai_api_key) setOpenaiKey(settings.openai_api_key);
          if (settings.anthropic_api_key) setAnthropicKey(settings.anthropic_api_key);
        })
        .catch(() => {
          // Fall back to default
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setLoading(true);
    setSaveSuccess(false);
    onSavePlatformApiKey(platformKey);

    try {
      await api.updateLLMSettings({
        openai_api_key: openaiKey,
        anthropic_api_key: anthropicKey,
        default_model: defaultModel,
        litellm_base_url: litellmUrl,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      // Handled
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testLLMConnection();
      setTestResult({ success: true, message: `${res.message} (${res.latency_ms.toFixed(0)} ms)` });
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-meridian-text/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-meridian-card border border-meridian-border rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full text-meridian-textMuted hover:text-meridian-text hover:bg-meridian-lavenderLight transition-all"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-meridian-primary to-meridian-secondary flex items-center justify-center shadow-glow">
            <Key className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-base font-bold text-meridian-text">
              Platform & Foundation LLM Settings
            </h3>
            <p className="text-xs text-meridian-textMuted">
              Configure upstream provider API keys and model routing.
            </p>
          </div>
        </div>

        {/* Settings Form */}
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {/* Platform X-API-Key */}
          <div>
            <label className="block text-xs font-semibold text-meridian-text mb-1">
              Meridian Platform Key (<code className="text-meridian-primary">X-API-Key</code>)
            </label>
            <input
              type="text"
              value={platformKey}
              onChange={(e) => setPlatformKey(e.target.value)}
              placeholder="meridian-test-secret-key-2026"
              className="w-full bg-meridian-bg border border-meridian-border rounded-xl px-3.5 py-2 text-xs text-meridian-text font-mono outline-none focus:border-meridian-primary transition-all"
            />
          </div>

          {/* OpenAI API Key */}
          <div>
            <label className="block text-xs font-semibold text-meridian-text mb-1">
              OpenAI API Key (<code className="text-meridian-primary">OPENAI_API_KEY</code>)
            </label>
            <input
              type="password"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder="sk-proj-..."
              className="w-full bg-meridian-bg border border-meridian-border rounded-xl px-3.5 py-2 text-xs text-meridian-text font-mono outline-none focus:border-meridian-primary transition-all"
            />
          </div>

          {/* Anthropic API Key */}
          <div>
            <label className="block text-xs font-semibold text-meridian-text mb-1">
              Anthropic API Key (<code className="text-meridian-primary">ANTHROPIC_API_KEY</code>)
            </label>
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full bg-meridian-bg border border-meridian-border rounded-xl px-3.5 py-2 text-xs text-meridian-text font-mono outline-none focus:border-meridian-primary transition-all"
            />
          </div>

          {/* Default Foundation Model */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-meridian-text mb-1">
                Active Foundation Model
              </label>
              <select
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                className="w-full bg-meridian-bg border border-meridian-border rounded-xl px-3 py-2 text-xs text-meridian-text font-medium outline-none focus:border-meridian-primary transition-all"
              >
                <option value="gpt-4o-mini">gpt-4o-mini (OpenAI)</option>
                <option value="gpt-4o">gpt-4o (OpenAI)</option>
                <option value="claude-3-5-sonnet">claude-3-5-sonnet (Anthropic)</option>
                <option value="claude-3-haiku">claude-3-haiku (Anthropic)</option>
                <option value="ollama/llama3">ollama/llama3 (Local)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-meridian-text mb-1">
                LiteLLM Gateway URL
              </label>
              <input
                type="text"
                value={litellmUrl}
                onChange={(e) => setLitellmUrl(e.target.value)}
                placeholder="http://localhost:4000"
                className="w-full bg-meridian-bg border border-meridian-border rounded-xl px-3 py-2 text-xs text-meridian-text font-mono outline-none focus:border-meridian-primary transition-all"
              />
            </div>
          </div>
        </div>

        {/* Test Result Message */}
        {testResult && (
          <div
            className={`mt-4 p-3 rounded-xl text-xs flex items-center space-x-2 ${
              testResult.success
                ? 'bg-emerald-50 border border-emerald-300 text-emerald-800'
                : 'bg-rose-50 border border-rose-300 text-rose-800'
            }`}
          >
            {testResult.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}

        {saveSuccess && (
          <div className="mt-4 p-3 rounded-xl text-xs bg-emerald-50 border border-emerald-300 text-emerald-800 flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Settings saved successfully!</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-6 pt-4 border-t border-meridian-border flex items-center justify-between">
          <button
            onClick={handleTestConnection}
            disabled={testing}
            className="px-4 py-2 rounded-xl text-xs font-medium text-meridian-primary bg-meridian-lavenderLight hover:bg-meridian-blossom border border-meridian-border flex items-center space-x-1.5 transition-all"
          >
            {testing ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            <span>Test Connection</span>
          </button>

          <div className="flex space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs text-meridian-textMuted hover:bg-meridian-lavenderLight transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="px-5 py-2 rounded-xl text-xs bg-meridian-primary hover:bg-meridian-primaryHover text-white font-semibold shadow-glow flex items-center space-x-1.5 transition-all"
            >
              {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>Save & Apply</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
