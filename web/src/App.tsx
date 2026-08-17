import React, { useEffect, useState } from 'react';
import { GuardrailsStudio } from './components/GuardrailsStudio';
import { IngestionStudio } from './components/IngestionStudio';
import { MetricsDashboard } from './components/MetricsDashboard';
import { Navbar } from './components/Navbar';
import { RagWorkspace } from './components/RagWorkspace';
import { api } from './services/api';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('rag');
  const [tenantId, setTenantId] = useState('default');
  const [apiKey, setApiKey] = useState(api.getApiKey());
  const [isBackendHealthy, setIsBackendHealthy] = useState(true);

  // Health check polling
  useEffect(() => {
    const check = async () => {
      try {
        await api.checkHealth();
        setIsBackendHealthy(true);
      } catch {
        setIsBackendHealthy(false);
      }
    };

    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleSetApiKey = (key: string) => {
    setApiKey(key);
    api.setApiKey(key);
  };

  return (
    <div className="min-h-screen bg-meridian-bg text-meridian-text flex flex-col selection:bg-meridian-blossom selection:text-meridian-primary">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        tenantId={tenantId}
        setTenantId={setTenantId}
        isBackendHealthy={isBackendHealthy}
        apiKey={apiKey}
        setApiKey={handleSetApiKey}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8">
        {activeTab === 'rag' && <RagWorkspace tenantId={tenantId} />}
        {activeTab === 'ingest' && <IngestionStudio tenantId={tenantId} />}
        {activeTab === 'guardrails' && <GuardrailsStudio tenantId={tenantId} />}
        {activeTab === 'metrics' && <MetricsDashboard tenantId={tenantId} />}
      </main>

      <footer className="border-t border-meridian-border bg-white/60 backdrop-blur-sm py-4 px-6 text-center text-xs font-semibold text-meridian-textMuted">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <span className="text-meridian-text font-bold">Meridian Enterprise LLMOps Platform</span>
          <span className="text-meridian-primary font-bold">
            Self-Healing Agentic RAG • AI Gateway • Continuous Eval
          </span>
        </div>
      </footer>
    </div>
  );
};

export default App;
