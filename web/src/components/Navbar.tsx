import React, { useEffect, useState } from 'react';
import {
  Bot,
  Database,
  Layers,
  LineChart,
  Settings,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { SettingsModal } from './SettingsModal';
import { api } from '../services/api';
import type { LLMSettings } from '../types/api';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  tenantId: string;
  setTenantId: (tenant: string) => void;
  isBackendHealthy: boolean;
  apiKey: string;
  setApiKey: (key: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  tenantId,
  setTenantId,
  isBackendHealthy,
  apiKey,
  setApiKey,
}) => {
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [llmSettings, setLlmSettings] = useState<LLMSettings | null>(null);

  const fetchSettings = () => {
    api.getLLMSettings()
      .then((s) => setLlmSettings(s))
      .catch(() => {});
  };

  useEffect(() => {
    fetchSettings();
  }, [showSettingsModal]);

  const tabs = [
    { id: 'rag', label: 'Agentic RAG', icon: Bot },
    { id: 'ingest', label: 'Ingestion Studio', icon: Database },
    { id: 'guardrails', label: 'Guardrails Security', icon: ShieldAlert },
    { id: 'metrics', label: 'Observability & Costs', icon: LineChart },
  ];

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
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-meridian-blossom text-meridian-primary border border-meridian-lavender">
                v0.1.0
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center space-x-1.5 bg-meridian-lavenderLight/70 p-1.5 rounded-2xl border border-meridian-border">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
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
          <div className="flex items-center space-x-1.5 bg-meridian-lavenderLight/60 px-3 py-1.5 rounded-xl border border-meridian-border text-xs">
            <span className="text-meridian-textMuted font-medium">Tenant:</span>
            <input
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="bg-transparent text-meridian-primary font-bold outline-none w-20 text-xs"
              placeholder="tenant_id"
            />
          </div>

          {/* Active Provider & Model Pill */}
          <button
            onClick={() => setShowSettingsModal(true)}
            className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-white hover:bg-meridian-blossom border border-meridian-border text-meridian-text transition-all text-xs font-semibold shadow-sm group"
            title="Active LLM Engine - Click to Configure"
          >
            <div className="w-2 h-2 rounded-full bg-meridian-primary group-hover:animate-ping" />
            <Zap className="w-3.5 h-3.5 text-meridian-primary" />
            <span className="capitalize">{llmSettings?.active_provider || 'OpenAI'}</span>
            <span className="text-meridian-textMuted">•</span>
            <span className="font-mono text-meridian-primary font-bold text-[11px]">
              {llmSettings?.default_model || 'gpt-4o-mini'}
            </span>
            <Settings className="w-3 h-3 text-meridian-textMuted group-hover:text-meridian-primary ml-0.5" />
          </button>

          {/* Health Status Indicator */}
          <div
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold ${
              isBackendHealthy
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isBackendHealthy ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
              }`}
            />
            <span>{isBackendHealthy ? 'Online' : 'Offline'}</span>
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
