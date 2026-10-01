import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ChartNoAxesColumn, Database, FileText, ListChecks, ShieldAlert } from 'lucide-react';
import { LensRail, TopBar, type LensId } from './components/Navbar';
import { Overlay } from './components/Overlay';
import { RagWorkspace } from './components/RagWorkspace';
import { SurfaceFallback } from './components/SurfaceFallback';
import { WorkbenchContext, type OpenOverlayOptions, type OverlayTarget } from './WorkbenchContext';
import { api } from './services/api';

// Only the Ask canvas ships with the first paint. Every other surface is
// reachable, but not by default: each is a separate chunk fetched the first time
// it is opened, so the initial bundle carries the lens the user lands on and
// nothing else.
const IngestionStudio = React.lazy(() =>
  import('./components/IngestionStudio').then((m) => ({ default: m.IngestionStudio })),
);
const GuardrailsStudio = React.lazy(() =>
  import('./components/GuardrailsStudio').then((m) => ({ default: m.GuardrailsStudio })),
);
const IndexStorageStudio = React.lazy(() =>
  import('./components/IndexStorageStudio').then((m) => ({ default: m.IndexStorageStudio })),
);
const ReviewQueue = React.lazy(() =>
  import('./components/ReviewQueue').then((m) => ({ default: m.ReviewQueue })),
);
const MetricsDashboard = React.lazy(() =>
  import('./components/MetricsDashboard').then((m) => ({ default: m.MetricsDashboard })),
);

export type BackendHealth = 'online' | 'degraded' | 'offline' | 'unknown';

/** Every non-lens capability, and where it is reachable from. */
const CAPABILITIES: readonly { target: OverlayTarget; label: string; icon: React.ElementType }[] = [
  { target: 'corpus', label: 'Corpus', icon: FileText },
  { target: 'index', label: 'Index & Storage', icon: Database },
  { target: 'guardrails', label: 'Guardrails', icon: ShieldAlert },
  { target: 'review', label: 'Review Queue', icon: ListChecks },
  { target: 'metrics', label: 'Metrics', icon: ChartNoAxesColumn },
];

/** The dialog's accessible name for each destination. */
const OVERLAY_TITLE: Record<OverlayTarget, string> = {
  corpus: 'Corpus',
  index: 'Index & Storage',
  guardrails: 'Guardrails',
  review: 'Review Queue',
  metrics: 'Metrics',
  settings: 'Settings',
};

/** Breadcrumb used when an overlay is opened without naming its origin. */
const LENS_LABEL: Record<LensId, string> = { ask: 'ASK', corpus: 'CORPUS', operate: 'OPERATE' };

export const App: React.FC = () => {
  const [activeLens, setActiveLens] = useState<LensId>('ask');
  const [activeOverlay, setActiveOverlay] = useState<OverlayTarget | null>(null);
  const [overlayOpts, setOverlayOpts] = useState<OpenOverlayOptions>({});
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
        // No evidence is not good news. `services` is optional in HealthStatus,
        // and an empty map made `some()` false — which read as "nothing is
        // down" and put a green Online on a backend that had told us nothing.
        const checked = Object.values(services);
        if (checked.length === 0) {
          setBackendHealth('unknown');
          return;
        }
        setBackendHealth(checked.some((s) => !s.reachable) ? 'degraded' : 'online');
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

  const clearCitationFocus = useCallback(() => {
    setFocusedDocumentId(null);
    setFocusedChunkId(null);
  }, []);

  const openOverlay = useCallback((target: OverlayTarget, opts?: OpenOverlayOptions) => {
    if (opts?.documentId !== undefined) setFocusedDocumentId(opts.documentId);
    if (opts?.chunkId !== undefined) setFocusedChunkId(opts.chunkId);
    setOverlayOpts(opts ?? {});
    setActiveOverlay(target);
  }, []);

  const closeOverlay = useCallback(() => {
    setActiveOverlay(null);
    setOverlayOpts({});
    clearCitationFocus();
  }, [clearCitationFocus]);

  const workbench = useMemo(
    () => ({ openOverlay, closeOverlay, activeOverlay }),
    [openOverlay, closeOverlay, activeOverlay],
  );

  // Changing lens dismisses the overlay: the two hosts share a canvas, and
  // leaving the surface underneath would mount it twice.
  const selectLens = (lens: LensId) => {
    setActiveLens(lens);
    closeOverlay();
  };

  // A citation is a jump, not a screen change: the canvas asks for the Corpus
  // overlay and the canvas stays where it is underneath it.
  const openCapability = (target: OverlayTarget) =>
    openOverlay(target, { breadcrumb: LENS_LABEL[activeLens] });

  // B5: only the active lens's studio is mounted, so inactive studios never
  // fetch and their DOM is genuinely gone. Each one is also a lazy chunk, so
  // "not mounted" also means "not downloaded". Same rule for the overlay host.
  const canvas = (() => {
    switch (activeLens) {
      case 'corpus':
        return (
          <Suspense fallback={<SurfaceFallback label="Corpus" />}>
            <IngestionStudio
              tenantId={tenantId}
              focusedDocumentId={focusedDocumentId}
              focusedChunkId={focusedChunkId}
              onDismissFocus={clearCitationFocus}
            />
          </Suspense>
        );
      case 'operate':
        return (
          <Suspense fallback={<SurfaceFallback label="Guardrails" />}>
            <GuardrailsStudio tenantId={tenantId} />
          </Suspense>
        );
      case 'ask':
      default:
        // The canvas drives the overlay through WorkbenchContext itself; the
        // shell only hosts the surface it asks for.
        return <RagWorkspace tenantId={tenantId} />;
    }
  })();

  const overlaySurface = (() => {
    if (!activeOverlay) return null;
    switch (activeOverlay) {
      case 'corpus':
        return (
          <Suspense fallback={<SurfaceFallback label="Corpus" />}>
            <IngestionStudio
              tenantId={tenantId}
              focusedDocumentId={focusedDocumentId}
              focusedChunkId={focusedChunkId}
              onDismissFocus={clearCitationFocus}
            />
          </Suspense>
        );
      case 'index':
        return (
          <Suspense fallback={<SurfaceFallback label="Index & Storage" />}>
            <IndexStorageStudio tenantId={tenantId} />
          </Suspense>
        );
      case 'guardrails':
        return (
          <Suspense fallback={<SurfaceFallback label="Guardrails" />}>
            <GuardrailsStudio tenantId={tenantId} />
          </Suspense>
        );
      case 'review':
        return (
          <Suspense fallback={<SurfaceFallback label="Review Queue" />}>
            <ReviewQueue tenantId={tenantId} />
          </Suspense>
        );
      case 'metrics':
        return (
          <Suspense fallback={<SurfaceFallback label="Metrics" />}>
            <MetricsDashboard tenantId={tenantId} />
          </Suspense>
        );
      default:
        return null;
    }
  })();

  return (
    <WorkbenchContext.Provider value={workbench}>
      <div className="flex min-h-screen flex-col bg-surface text-ink">
        <TopBar
          tenantId={tenantId}
          setTenantId={setTenantId}
          backendHealth={backendHealth}
          apiKey={apiKey}
          setApiKey={handleSetApiKey}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          <LensRail activeLens={activeLens} onSelectLens={selectLens} />

          <main className="min-w-0 flex-1 overflow-y-auto bg-surface p-4 md:p-6">
            {/* Capability destinations. These are the rail's second tier: the
                lenses change the canvas, these slide a surface over it. */}
            <nav
              aria-label="Capability overlays"
              className="mb-4 flex flex-wrap items-center gap-1.5 border-b border-hairline pb-3"
            >
              {CAPABILITIES.map(({ target, label, icon: Icon }) => (
                <button
                  key={target}
                  type="button"
                  onClick={() => openCapability(target)}
                  className="label-section flex items-center gap-1.5 rounded-sm border border-hairline px-2 py-1 text-muted transition-colors hover:border-hairline-strong hover:bg-accent-wash hover:text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </nav>

            {canvas}
          </main>
        </div>

        {/* The single overlay host: one sheet at a time, over the canvas. */}
        <Overlay
          open={activeOverlay !== null}
          onClose={closeOverlay}
          title={activeOverlay ? OVERLAY_TITLE[activeOverlay] : ''}
          breadcrumb={overlayOpts.breadcrumb ?? (activeOverlay ? LENS_LABEL[activeLens] : undefined)}
        >
          {overlaySurface}
        </Overlay>
      </div>
    </WorkbenchContext.Provider>
  );
};

export default App;
