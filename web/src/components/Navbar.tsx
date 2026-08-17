import React, { useState } from 'react';
import {
  Bot,
  Database,
  Key,
  Layers,
  LineChart,
  ShieldAlert,
} from 'lucide-react';

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
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [tempKey, setTempKey] = useState(apiKey);

  const tabs = [
    { id: 'rag', label: 'Agentic RAG', icon: Bot },
    { id: 'ingest', label: 'Ingestion Studio', icon: Database },
    { id: 'guardrails', label: 'Guardrails Security', icon: ShieldAlert },
    { id: 'metrics', label: 'Observability & Costs', icon: LineChart },
  ];

  return (
    <header className="border-b border-meridian-border glass-panel sticky top-0 z-50 px-6 py-3.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Logo & Platform Name */}
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-meridian-primary to-meridian-blossom flex items-center justify-center shadow-glow">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-lg tracking-tight text-meridian-text">
                Meridian <span className="text-meridian-lavender">LLMOps</span>
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-meridian-primary/20 text-meridian-lavender border border-meridian-lavender/30">
                v0.1.0
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center space-x-1.5 bg-meridian-bg/80 p-1.5 rounded-xl border border-meridian-border">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-meridian-primary text-white shadow-glow'
                    : 'text-meridian-muted hover:text-meridian-text hover:bg-meridian-card'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-meridian-blossom' : ''}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Settings, Tenant & Health */}
        <div className="flex items-center space-x-3">
          {/* Tenant Selector */}
          <div className="flex items-center space-x-1.5 bg-meridian-card px-2.5 py-1.5 rounded-lg border border-meridian-border text-xs">
            <span className="text-meridian-muted font-medium">Tenant:</span>
            <input
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="bg-transparent text-meridian-lavender font-semibold outline-none w-20 text-xs"
              placeholder="tenant_id"
            />
          </div>

          {/* API Key Modal Button */}
          <button
            onClick={() => setShowKeyModal(true)}
            className="p-2 rounded-lg bg-meridian-card hover:bg-meridian-cardHover border border-meridian-border text-meridian-muted hover:text-meridian-lavender transition-colors"
            title="Configure API Key"
          >
            <Key className="w-4 h-4" />
          </button>

          {/* Health Status Indicator */}
          <div
            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${
              isBackendHealthy
                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-400'
                : 'bg-rose-950/40 border-rose-500/30 text-rose-400'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isBackendHealthy ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
              }`}
            />
            <span>{isBackendHealthy ? 'API Online' : 'Connecting...'}</span>
          </div>
        </div>
      </div>

      {/* API Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-meridian-card border border-meridian-border rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-base font-semibold text-meridian-text mb-2">
              Platform Authentication Key
            </h3>
            <p className="text-xs text-meridian-muted mb-4">
              Enter your <code className="text-meridian-lavender">X-API-Key</code> secret for authentication against the Gateway and RAG Engine.
            </p>
            <input
              type="text"
              value={tempKey}
              onChange={(e) => setTempKey(e.target.value)}
              className="w-full bg-meridian-bg border border-meridian-border rounded-xl px-4 py-2.5 text-xs text-meridian-text mb-5 outline-none focus:border-meridian-primary"
              placeholder="meridian-test-secret-key-2026"
            />
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setShowKeyModal(false)}
                className="px-4 py-2 rounded-xl text-xs text-meridian-muted hover:bg-meridian-cardHover"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setApiKey(tempKey);
                  setShowKeyModal(false);
                }}
                className="px-4 py-2 rounded-xl text-xs bg-meridian-primary hover:bg-meridian-secondary text-white font-medium shadow-glow"
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
