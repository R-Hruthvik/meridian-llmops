import React, { useEffect, useState } from 'react';
import {
  Bot,
  ClipboardCheck,
  Database,
  Layers,
  LineChart,
  Settings,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { SettingsModal } from './SettingsModal';
import { api } from '../services/api';
import type { BackendHealth } from '../App';
import type { LLMSettings } from '../types/api';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  tenantId: string;
  setTenantId: (tenant: string) => void;
  backendHealth: BackendHealth;
  apiKey: string;
  setApiKey: (key: string) => void;
}

const TABS = [
  { id: 'rag', label: 'Agentic RAG', icon: Bot },
  { id: 'ingest', label: 'Ingestion Studio', icon: Database },
  { id: 'guardrails', label: 'Guardrails Security', icon: ShieldAlert },
  { id: 'review', label: 'Review Queue', icon: ClipboardCheck },
  { id: 'metrics', label: 'Observability & Costs', icon: LineChart },
];

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  tenantId,
  setTenantId,
  backendHealth,
  apiKey,
  setApiKey,
}) => {
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [llmSettings, setLlmSettings] = useState<LLMSettings | null>(null);
  const [localTenant, setLocalTenant] = useState(tenantId);

  // Sync local tenant when parent prop changes
  useEffect(() => {
    setLocalTenant(tenantId);
  }, [tenantId]);

  // Debounce tenantId changes before propagating up
  useEffect(() => {
    const handler = setTimeout(() => {
      if (localTenant !== tenantId) {
        setTenantId(localTenant);
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [localTenant, tenantId, setTenantId]);

  const fetchSettings = () => {
    api.getLLMSettings()
      .then((s) => setLlmSettings(s))
      .catch(() => {});
  };

  useEffect(() => {
    fetchSettings();
  }, [showSettingsModal]);

  return (
    <header className="border-b border-meridian-border bg-white/80 backdrop-blur-md sticky top-0 z-50 px-6 py-3.5 shadow-card">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Logo & Platform Name */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-meridian-primary via-meridian-secondary to-meridian-blossom flex items-center justify-center shadow-glow">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-lg tracking-tight text-meridian-text">
                Meridian <span className="text-meridian-primary">LLMOps</span>
              </span>
              <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-meridian-blossom text-meridian-text border border-meridian-lavender">
                v0.1.0
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav
          role="tablist"
          aria-label="Main Navigation"
          className="flex items-center space-x-1.5 bg-meridian-lavenderLight/70 p-1.5 rounded-2xl border border-meridian-border"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-meridian-primary ${
                  isActive
                    ? 'bg-meridian-primary text-white shadow-glow'
                    : 'text-meridian-textMuted hover:text-meridian-text hover:bg-white/80'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-meridian-blossom' : ''}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Tenant, Active Engine Badge & Health */}
        <div className="flex items-center space-x-3">
          {/* Tenant Selector */}
          <div className="flex items-center space-x-1.5 bg-meridian-lavenderLight/60 hover:bg-meridian-lavenderLight focus-within:bg-white focus-within:border-meridian-primary/50 focus-within:ring-2 focus-within:ring-meridian-primary px-3 py-1.5 rounded-xl border border-meridian-border text-xs transition-all">
            <span className="text-meridian-textMuted font-medium select-none">Tenant:</span>
            <input
              type="text"
              value={localTenant}
              onChange={(e) => setLocalTenant(e.target.value)}
              className="bg-transparent text-meridian-primary font-bold outline-none w-20 text-xs focus-visible:outline-none"
              placeholder="tenant_id"
              aria-label="Tenant Identifier"
            />
          </div>

          {/* Active Provider & Model Pill */}
          <button
            onClick={() => setShowSettingsModal(true)}
            className="flex items-center space-x-2 px-3.5 py-1.5 rounded-xl bg-white hover:bg-meridian-blossom/50 border border-meridian-border hover:border-meridian-primary/50 text-meridian-text transition-all text-xs font-semibold shadow-sm group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-meridian-primary"
            title="Active Provider & Model Config - Click to Open Engine Settings"
            aria-label="Open LLM Engine Settings"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-meridian-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-meridian-primary" />
            </span>
            <Zap className="w-3.5 h-3.5 text-meridian-primary shrink-0" />
            <span className="capitalize">{llmSettings?.active_provider || 'OpenAI'}</span>
            <span className="text-meridian-textMuted">•</span>
            <span className="font-mono text-meridian-primary font-bold text-[11px]">
              {llmSettings?.default_model || 'gpt-4o-mini'}
            </span>
            <Settings className="w-3.5 h-3.5 text-meridian-textMuted group-hover:text-meridian-primary group-hover:rotate-45 transition-transform duration-300 ml-0.5 shrink-0" />
          </button>

          {/* Health Status Indicator (driven by /health services map) */}
          <div
            role="status"
            aria-live="polite"
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold ${
              backendHealth === 'online'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : backendHealth === 'degraded'
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                backendHealth === 'online'
                  ? 'bg-emerald-500 animate-pulse'
                  : backendHealth === 'degraded'
                    ? 'bg-amber-500 animate-pulse'
                    : 'bg-rose-500'
              }`}
            />
            <span>{backendHealth === 'online' ? 'Online' : backendHealth === 'degraded' ? 'Degraded' : 'Offline'}</span>
          </div>
        </div>
      </div>

      {/* Full Settings & LLM Key Modal */}
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => {
          setShowSettingsModal(false);
          fetchSettings();
        }}
        platformApiKey={apiKey}
        onSavePlatformApiKey={setApiKey}
      />
    </header>
  );
};

