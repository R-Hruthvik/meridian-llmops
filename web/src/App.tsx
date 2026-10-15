import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, LibraryBig, MessageSquareText, PanelLeftClose, PanelLeftOpen, Settings2 } from 'lucide-react';
import { RagWorkspace } from './components/RagWorkspace';
import { LazySurface } from './components/LazySurface';
import { WorkbenchContext, type OpenOverlayOptions, type OverlayTarget } from './WorkbenchContext';
import { api } from './services/api';
import { StatusChip } from './components/StatusChip';
import './WorkbenchShell.css';

const IngestionStudio = React.lazy(() => import('./components/IngestionStudio').then((m) => ({ default: m.IngestionStudio })));
const GuardrailsStudio = React.lazy(() => import('./components/GuardrailsStudio').then((m) => ({ default: m.GuardrailsStudio })));
const IndexStorageStudio = React.lazy(() => import('./components/IndexStorageStudio').then((m) => ({ default: m.IndexStorageStudio })));
const ReviewQueue = React.lazy(() => import('./components/ReviewQueue').then((m) => ({ default: m.ReviewQueue })));
const MetricsDashboard = React.lazy(() => import('./components/MetricsDashboard').then((m) => ({ default: m.MetricsDashboard })));
const SettingsModal = React.lazy(() => import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })));

type Route = '/ask' | '/sources' | '/sources/index' | '/operations/rules' | '/operations/review' | '/operations/usage' | '/settings';
export type BackendHealth = 'online' | 'degraded' | 'offline' | 'unknown';
const NAV = [
  { label: 'Ask', path: '/ask' as Route, Icon: MessageSquareText },
  { label: 'Sources', path: '/sources' as Route, Icon: LibraryBig },
  { label: 'Monitor', path: '/operations/usage' as Route, Icon: Activity },
  { label: 'Settings', path: '/settings' as Route, Icon: Settings2 },
];
const parseRoute = (): Route => {
  const path = window.location.hash.replace(/^#/, '');
  const valid: Route[] = ['/ask', '/sources', '/sources/index', '/operations/rules', '/operations/review', '/operations/usage', '/settings'];
  return valid.includes(path as Route) ? path as Route : '/ask';
};
const TARGET_ROUTE: Record<OverlayTarget, Route> = {
  corpus: '/sources', index: '/sources/index', guardrails: '/operations/rules',
  review: '/operations/review', metrics: '/operations/usage', settings: '/settings',
};

export const App: React.FC = () => {
  const [route, setRoute] = useState<Route>(parseRoute);
  const [tenantId, setTenantId] = useState('default');
  const [tenantDraft, setTenantDraft] = useState(tenantId);
  const [tenantSubmitAttempted, setTenantSubmitAttempted] = useState(false);
  const [health, setHealth] = useState<BackendHealth>('offline');
  const [sidebarWidth, setSidebarWidth] = useState(248);
  const [collapsed, setCollapsed] = useState(false);
  const [focus, setFocus] = useState<OpenOverlayOptions>({});

  useEffect(() => {
    const sync = () => setRoute(parseRoute());
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    if (!window.location.hash) window.history.replaceState(null, '', '#/ask');
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); };
  }, []);

  useEffect(() => setTenantDraft(tenantId), [tenantId]);

  useEffect(() => {
    let live = true;
    const check = async () => {
      try { const result = await api.checkHealth(); if (live) setHealth(typeof result.ready !== 'boolean' ? 'unknown' : result.ready ? 'online' : 'degraded'); }
      catch { if (live) setHealth('offline'); }
    };
    void check();
    const timer = window.setInterval(check, 15000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);

  const navigate = useCallback((next: Route, replace = false) => {
    if (replace) window.history.replaceState(null, '', `#${next}`);
    else if (window.location.hash !== `#${next}`) window.history.pushState(null, '', `#${next}`);
    setRoute(next);
  }, []);
  const openOverlay = useCallback((target: OverlayTarget, opts?: OpenOverlayOptions) => {
    setFocus(opts ?? {});
    navigate(TARGET_ROUTE[target]);
  }, [navigate]);
  const closeOverlay = useCallback(() => { setFocus({}); navigate('/ask'); }, [navigate]);
  const activeTarget: OverlayTarget | null = route === '/sources' ? 'corpus' : route === '/sources/index' ? 'index' : route === '/operations/rules' ? 'guardrails' : route === '/operations/review' ? 'review' : route === '/operations/usage' ? 'metrics' : route === '/settings' ? 'settings' : null;
  const workbench = useMemo(() => ({ openOverlay, closeOverlay, activeOverlay: activeTarget }), [openOverlay, closeOverlay, activeTarget]);
  const onResizeKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') setSidebarWidth((width) => Math.min(320, width + 16));
    else if (event.key === 'ArrowLeft') setSidebarWidth((width) => Math.max(200, width - 16));
    else if (event.key === 'Home') setSidebarWidth(200);
    else if (event.key === 'End') setSidebarWidth(320);
    else return;
    event.preventDefault();
  };
  const onResizePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => setSidebarWidth(Math.max(200, Math.min(320, e.clientX)));
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true });
  };

  const operations = route.startsWith('/operations');
  const tenantInvalid = tenantDraft.trim() === '';
  const submitTenant = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTenantSubmitAttempted(true);
    if (!tenantInvalid) setTenantId(tenantDraft.trim());
  };
  const sectionTitle = route === '/ask' ? 'Ask' : route.startsWith('/sources') ? 'Sources' : operations ? 'Monitor' : 'Settings';
  return (
    <WorkbenchContext.Provider value={workbench}>
      <div className={`workbench-shell${collapsed ? ' sidebar-collapsed' : ''}`} style={{ '--sidebar-width': collapsed ? '72px' : `${sidebarWidth}px` } as React.CSSProperties}>
        <aside className={`workbench-sidebar${collapsed ? ' is-collapsed' : ''}`}>
          <div className="sidebar-top">
            <a className="brand-mark" href="#/ask" onClick={(e) => { e.preventDefault(); navigate('/ask'); }} aria-label="Meridian home"><span className="brand-glyph">m</span><span className="brand-name">Meridian</span></a>
            <button className="sidebar-toggle" type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen/> : <PanelLeftClose/>}</button>
          </div>
          <nav aria-label="Primary navigation" className="primary-nav">
            {NAV.map(({ label, path, Icon }) => <a key={label} href={`#${path}`} aria-current={(label === 'Monitor' ? operations : route === path || (label === 'Sources' && route === '/sources/index')) ? 'page' : undefined} title={collapsed ? label : undefined} onClick={(e) => { e.preventDefault(); navigate(path); }}><span className="nav-icon"><Icon aria-hidden="true"/></span><span className="nav-label">{label}</span></a>)}
          </nav>
        </aside>
        {!collapsed && <div className="sidebar-resizer" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={200} aria-valuemax={320} aria-valuenow={sidebarWidth} tabIndex={0} onKeyDown={onResizeKey} onPointerDown={onResizePointer} />}
        <div className="workbench-main">
          <header className="workbench-header">
            <div className="header-title"><span className="header-breadcrumb"><span>Meridian</span><span aria-hidden="true"> / </span><strong>{sectionTitle}</strong></span></div>
            <div className="header-tools"><form className="tenant-form" onSubmit={submitTenant} noValidate>
              <label htmlFor="workspace-tenant">Workspace</label>
              <input id="workspace-tenant" aria-label="Workspace identifier" value={tenantDraft} onChange={(event) => setTenantDraft(event.target.value)} aria-invalid={tenantSubmitAttempted && tenantInvalid} aria-describedby={tenantSubmitAttempted && tenantInvalid ? 'workspace-tenant-error' : undefined} />
              <button type="submit">Apply</button>
              {tenantSubmitAttempted && tenantInvalid && <span id="workspace-tenant-error" className="tenant-error" role="alert">Enter a workspace identifier.</span>}
            </form><StatusChip variant={health === 'online' ? 'ok' : health === 'degraded' ? 'warn' : health === 'offline' ? 'fail' : 'faint'}>{health === 'online' ? 'Online' : health === 'degraded' ? 'Degraded' : health === 'unknown' ? 'Checking' : 'Offline'}</StatusChip></div>
          </header>
          {operations && <nav className="section-nav" aria-label="Monitor sections">
            {[['Usage', '/operations/usage'], ['Safety checks', '/operations/rules'], ['Review queue', '/operations/review']].map(([label, path]) => <a key={path} href={`#${path}`} aria-current={route === path ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigate(path as Route); }}>{label}</a>)}
          </nav>}
          {route.startsWith('/sources') && <nav className="section-nav" aria-label="Sources sections">
            {[['Catalog', '/sources'], ['Index & storage', '/sources/index']].map(([label, path]) => <a key={path} href={`#${path}`} aria-current={route === path ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigate(path as Route); }}>{label}</a>)}
          </nav>}
          <main className="workbench-content">
            <div className="route-view" hidden={route !== '/ask'}><RagWorkspace tenantId={tenantId}/></div>
            {route === '/sources' && <LazySurface label="Sources"><IngestionStudio tenantId={tenantId} focusedDocumentId={focus.documentId ?? null} focusedChunkId={focus.chunkId ?? null} onDismissFocus={() => setFocus({})}/></LazySurface>}
            {route === '/sources/index' && <LazySurface label="Index and storage"><IndexStorageStudio tenantId={tenantId}/></LazySurface>}
            {route === '/operations/rules' && <LazySurface label="Safety checks"><GuardrailsStudio tenantId={tenantId}/></LazySurface>}
            {route === '/operations/review' && <LazySurface label="Review queue"><ReviewQueue tenantId={tenantId}/></LazySurface>}
            {route === '/operations/usage' && <LazySurface label="Usage"><MetricsDashboard tenantId={tenantId}/></LazySurface>}
            {route === '/settings' && <LazySurface label="Settings"><SettingsModal isOpen presentation="page" onClose={closeOverlay}/></LazySurface>}
          </main>
          <nav className="mobile-nav" aria-label="Primary navigation">
            {NAV.map(({ label, path, Icon }) => <a key={label} href={`#${path}`} aria-current={(label === 'Monitor' ? operations : route === path || (label === 'Sources' && route === '/sources/index')) ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigate(path); }}><Icon aria-hidden="true"/><span>{label}</span></a>)}
          </nav>
        </div>
      </div>
    </WorkbenchContext.Provider>
  );
};

export default App;
