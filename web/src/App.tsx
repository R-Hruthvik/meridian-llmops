import React, { useEffect, useState } from 'react';
import { GuardrailsStudio } from './components/GuardrailsStudio';
import { IndexStorageStudio } from './components/IndexStorageStudio';
import { IngestionStudio } from './components/IngestionStudio';
import { MetricsDashboard } from './components/MetricsDashboard';
import { Navbar } from './components/Navbar';
import { RagWorkspace } from './components/RagWorkspace';
import { ReviewQueue } from './components/ReviewQueue';
import { api } from './services/api';

export type BackendHealth = 'online' | 'degraded' | 'offline';

/** The three primary workbench areas. */
export type AreaId = 'ask' | 'corpus' | 'operate';

/** The sub-sections the composite areas are split into. */
export type SubSectionId = 'sources' | 'index' | 'guardrails' | 'review' | 'metrics';

/**
 * Shared workbench context. The areas are connected, not merely adjacent:
 * `focusedDocumentId`/`focusedChunkId` carry an answer's citation over from the
 * Ask spine into the Corpus sources it came from.
 *
 * The sub-section is remembered per area, so leaving Corpus for Ask and coming
 * back returns you to the section you were reading. `ask` has no sub-sections.
 */
export interface WorkbenchContext {
  activeArea: AreaId;
  subSection: {
    ask: null;
    corpus: SubSectionId;
    operate: SubSectionId;
  };
  focusedDocumentId: string | null;
  focusedChunkId: string | null;
}

/** The sub-section tabs shown under the header, per composite area. */
const AREA_SECTIONS: Record<Exclude<AreaId, 'ask'>, { id: SubSectionId; label: string }[]> = {
  corpus: [
    { id: 'sources', label: 'Sources' },
    { id: 'index', label: 'Index & Storage' },
  ],
  operate: [
    { id: 'guardrails', label: 'Guardrails' },
    { id: 'review', label: 'Review Queue' },
    { id: 'metrics', label: 'Metrics' },
  ],
};

const SECTION_AREA_LABEL: Record<Exclude<AreaId, 'ask'>, string> = {
  corpus: 'Corpus Sections',
  operate: 'Operate Sections',
};

export const App: React.FC = () => {
  const [activeArea, setActiveArea] = useState<AreaId>('ask');
  const [subSection, setSubSection] = useState<WorkbenchContext['subSection']>({
    ask: null,
    corpus: 'sources',
    operate: 'guardrails',
  });
  const [focusedDocumentId, setFocusedDocumentId] = useState<string | null>(null);
  const [focusedChunkId, setFocusedChunkId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState('default');
  const [apiKey, setApiKey] = useState(api.getApiKey());
  const [backendHealth, setBackendHealth] = useState<BackendHealth>('offline');

  // Health check polling (driven by /health services map)
  useEffect(() => {
    const check = async () => {
      try {
        const h = await api.checkHealth();
        const services = h.services ?? {};
        const anyDegraded = Object.values(services).some((s) => !s.reachable);
        setBackendHealth(anyDegraded ? 'degraded' : 'online');
      } catch {
        setBackendHealth('offline');
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

  const selectArea = (area: AreaId) => setActiveArea(area);

  const selectSection = (id: SubSectionId) =>
    setSubSection((prev) => ({ ...prev, [activeArea]: id }));

  // Drill-through: an answer's citation takes you to the exact source chunk
  // that produced it, inside Corpus → Sources.
  const focusCitation = (documentId: string, chunkId: string) => {
    setFocusedDocumentId(documentId);
    setFocusedChunkId(chunkId);
    setSubSection((prev) => ({ ...prev, corpus: 'sources' }));
    setActiveArea('corpus');
  };

  const clearCitationFocus = () => {
    setFocusedDocumentId(null);
    setFocusedChunkId(null);
  };

  const sectionArea = activeArea === 'ask' ? null : activeArea;
  const sections = sectionArea ? AREA_SECTIONS[sectionArea] : null;
  const activeSection = sectionArea ? subSection[sectionArea] : null;

  return (
    <div className="min-h-screen bg-meridian-bg text-meridian-text flex flex-col selection:bg-meridian-blossom selection:text-meridian-primary">
      <Navbar
        activeArea={activeArea}
        onSelectArea={selectArea}
        tenantId={tenantId}
        setTenantId={setTenantId}
        backendHealth={backendHealth}
        apiKey={apiKey}
        setApiKey={handleSetApiKey}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8">
        {/* Sub-section switcher — only for the composite areas */}
        {sectionArea && sections && (
          <div
            role="tablist"
            aria-label={SECTION_AREA_LABEL[sectionArea]}
            className="flex items-center gap-2 mb-6 pb-3 border-b border-meridian-border"
          >
            {sections.map((section) => (
              <button
                key={section.id}
                role="tab"
                aria-selected={activeSection === section.id}
                onClick={() => selectSection(section.id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all focus-visible:ring-2 focus-visible:ring-meridian-primary focus-visible:outline-none ${
                  activeSection === section.id
                    ? 'bg-meridian-primary text-white shadow-glow'
                    : 'bg-white text-meridian-textMuted hover:text-meridian-text hover:bg-meridian-bg border border-meridian-border'
                }`}
              >
                {section.label}
              </button>
            ))}
          </div>
        )}

        {/* B5: only the active area's studio is mounted, so inactive studios
            never fetch and their DOM is genuinely gone. */}
        {activeArea === 'ask' && (
          <RagWorkspace tenantId={tenantId} onCitationSelect={focusCitation} />
        )}

        {activeArea === 'corpus' && subSection.corpus === 'sources' && (
          <IngestionStudio
            tenantId={tenantId}
            focusedDocumentId={focusedDocumentId}
            focusedChunkId={focusedChunkId}
            onDismissFocus={clearCitationFocus}
          />
        )}
        {activeArea === 'corpus' && subSection.corpus === 'index' && (
          <IndexStorageStudio tenantId={tenantId} />
        )}

        {activeArea === 'operate' && subSection.operate === 'guardrails' && (
          <GuardrailsStudio tenantId={tenantId} />
        )}
        {activeArea === 'operate' && subSection.operate === 'review' && (
          <ReviewQueue tenantId={tenantId} />
        )}
        {activeArea === 'operate' && subSection.operate === 'metrics' && (
          <MetricsDashboard tenantId={tenantId} />
        )}
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
