import { useState, type CSSProperties } from 'react';
import { Activity, ArrowRight, BookOpen, Check, ChevronDown, FileText, Gauge, LibraryBig, MessageSquareText, PanelLeftClose, PanelLeftOpen, Plus, Search, Send, Settings2, Waypoints, X } from 'lucide-react';
import { api } from '../../services/api';
import { requestsForEventList, requestRangeNotice, formatDuration, formatProvider, formatRequestTime, latencyPolyline, latencyTicks, PREVIEW_ANSWER, PREVIEW_QUESTION, PREVIEW_SOURCES, requestsWithinRange, stageMilliseconds } from './previewData';
import { usePreviewRuntime } from './usePreviewRuntime';
import './RouteMapPreview.css';

type Page = 'Ask' | 'Sources' | 'Monitor' | 'Settings';

const navigation: { label: Page; icon: typeof MessageSquareText }[] = [
  { label: 'Ask', icon: MessageSquareText },
  { label: 'Sources', icon: LibraryBig },
  { label: 'Monitor', icon: Activity },
  { label: 'Settings', icon: Settings2 },
];

const evidence = [
  { ...PREVIEW_SOURCES[0], sourceId: PREVIEW_SOURCES[0].id, id: 1, color: 'blue', page: PREVIEW_SOURCES[0].locator, quote: PREVIEW_SOURCES[0].excerpt },
  { ...PREVIEW_SOURCES[1], sourceId: PREVIEW_SOURCES[1].id, id: 2, color: 'red', page: PREVIEW_SOURCES[1].locator, quote: PREVIEW_SOURCES[1].excerpt },
  { ...PREVIEW_SOURCES[2], sourceId: PREVIEW_SOURCES[2].id, id: 3, color: 'amber', page: PREVIEW_SOURCES[2].locator, quote: PREVIEW_SOURCES[2].excerpt },
];

export default function RouteMapPreview() {
  const [page, setPage] = useState<Page>('Ask');
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState(1);
  const [selectedSourceId, setSelectedSourceId] = useState<string>(PREVIEW_SOURCES[0].id);
  const [evidenceOpen, setEvidenceOpen] = useState(true);
  const [question, setQuestion] = useState(PREVIEW_QUESTION);
  const [reply, setReply] = useState('');
  const [sourceQuery, setSourceQuery] = useState('');
  const [sourceScope, setSourceScope] = useState('all');
  const [saved, setSaved] = useState(false);
  const [range, setRange] = useState('24 hours');
  const [notice, setNotice] = useState('');
  const [navWidth, setNavWidth] = useState(244);
  const selectedSource = PREVIEW_SOURCES.find((source) => source.id === selectedSourceId) ?? PREVIEW_SOURCES[0];
  const runtime = usePreviewRuntime(page === 'Monitor' || page === 'Settings', page === 'Monitor');
  const liveRequests = requestsWithinRange(runtime.metrics?.recent_requests ?? [], range);
  const eventRequests = requestsForEventList(runtime.metrics?.recent_requests ?? [], range);

  const ask = () => {
    if (!question.trim()) return;
    setReply(question.trim());
    setSelected(1);
  };

  return (
    <div className={`rm-app${collapsed ? ' rm-collapsed' : ''}`} style={{ '--rm-nav-width': `${collapsed ? 70 : navWidth}px` } as CSSProperties}>
      <aside className="rm-sidebar" onPointerDown={(event) => { if ((event.target as HTMLElement).closest('.rm-nav-resizer')) { event.currentTarget.setPointerCapture(event.pointerId); } }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setNavWidth(Math.max(180, Math.min(320, event.clientX - event.currentTarget.getBoundingClientRect().left))); }}>
        <div className="rm-brand-row">
          <a href="#ask" className="rm-brand" onClick={(event) => { event.preventDefault(); setPage('Ask'); }}><span className="rm-mark"><Waypoints size={20} /></span><span>Meridian</span></a>
          <button className="rm-icon-button rm-collapse" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</button>
        </div>
        <nav className="rm-nav" aria-label="Main navigation">
          {navigation.map(({ label, icon: Icon }) => <button key={label} type="button" className={page === label ? 'active' : ''} aria-current={page === label ? 'page' : undefined} title={label} onClick={() => { setPage(label); setNotice(''); }}><Icon size={18} strokeWidth={1.8} /><span>{label}</span></button>)}
        </nav>
      </aside>
      <div className="rm-nav-resizer" role="separator" aria-label="Resize navigation" aria-orientation="vertical" aria-valuemin={180} aria-valuemax={320} aria-valuenow={navWidth} tabIndex={0} onKeyDown={(event) => { if (event.key === 'ArrowLeft') setNavWidth((width) => Math.max(180, width - 12)); if (event.key === 'ArrowRight') setNavWidth((width) => Math.min(320, width + 12)); }} />

      <main className="rm-main">
        <header className="rm-topbar"><div className="rm-breadcrumb">Meridian <span>/</span> {page}</div><span className="rm-preview-label"><i /> Interactive preview · sample data</span></header>
        {page === 'Ask' && <div className={`rm-work-area${!evidenceOpen ? ' rm-evidence-hidden' : ''}`}>
          <section className="rm-content">
            <div className="rm-page-heading"><h1>Ask your sources</h1></div>
            <label className="rm-scope"><BookOpen size={15} /><span>Search scope</span><select aria-label="Source scope" value={sourceScope} onChange={(event) => setSourceScope(event.target.value)}><option value="all">All 3 sample sources</option>{PREVIEW_SOURCES.map((source) => <option key={source.id} value={source.id}>{source.file}</option>)}</select><ChevronDown size={14} /></label>
            <div className="rm-composer"><label htmlFor="rm-question">Your question</label><textarea id="rm-question" rows={2} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask(); } }} /><div className="rm-compose-foot"><span>Enter to ask · Shift + Enter for a new line</span><button onClick={ask} type="button"><Send size={15} /> Ask</button></div></div>

            <article className="rm-answer">
              <div className="rm-answer-head"><div className="rm-answer-title"><span className="rm-answer-mark"><Waypoints size={17} /></span><strong>Answer</strong><span className="rm-answer-tag">Preview sample</span></div><button type="button" className="rm-copy-answer" onClick={async () => { try { await navigator.clipboard.writeText(PREVIEW_ANSWER); setNotice('Sample answer copied.'); } catch { setNotice('Select and copy the sample answer text.'); } }}>Copy answer</button></div>
              <div className="rm-answer-copy"><p>{reply ? `For “${reply}” ` : ''}{PREVIEW_ANSWER}</p><small>This sample answer is illustrative; no live query was sent. Scope: {sourceScope === 'all' ? 'all sample sources' : PREVIEW_SOURCES.find((source) => source.id === sourceScope)?.file}.</small></div>
              <div className="rm-citations" aria-label="Answer citations">
                {evidence.slice(0, 2).map((item) => <button key={item.id} type="button" className={`rm-citation ${item.color}${selected === item.id ? ' selected' : ''}`} onClick={() => { setSelected(item.id); setEvidenceOpen(true); }}><span>{item.id}</span>{item.file}<ArrowRight size={13} /></button>)}
              </div>
            </article>
            <div className="rm-route-caption"><span className="rm-route-line" />Evidence route <span>question → claim → passages → documents</span><button type="button" onClick={() => setEvidenceOpen(!evidenceOpen)}>{evidenceOpen ? 'Hide evidence' : 'Show evidence'}</button></div>
          </section>

          {evidenceOpen && <aside className="rm-evidence" aria-label="Evidence details">
            <div className="rm-evidence-heading"><div><h2>Evidence route</h2><p>Selected claim and supporting passages</p></div><button className="rm-icon-button rm-evidence-close" aria-label="Close evidence" onClick={() => setEvidenceOpen(false)}><X size={17} /></button></div>
            <div className="rm-route-map" aria-label="Question, claim, and source route">
              <div className="rm-route-node rm-question-node"><span className="rm-node-dot" /><div><small>QUESTION</small><strong>{PREVIEW_QUESTION}</strong></div></div>
              <div className="rm-route-branch">
                {evidence.map((item) => <button key={item.id} className={`rm-route-node rm-source-node ${item.color}${selected === item.id ? ' selected' : ''}`} onClick={() => setSelected(item.id)} type="button"><span className="rm-node-dot" /><span className="rm-node-id">{item.id}</span><div><small>PASSAGE · {item.file.toUpperCase()}</small><strong>{item.id === 1 ? 'Retrieval selects evidence' : item.id === 2 ? 'Source text becomes passages' : 'Passages ground the response'}</strong></div><ArrowRight size={14} /></button>)}
              </div>
            </div>
            <div className="rm-passage"><div className="rm-passage-top"><span>SELECTED PASSAGE</span><span>{evidence.find((item) => item.id === selected)?.page}</span></div><h3>{evidence.find((item) => item.id === selected)?.file}</h3><blockquote>“{evidence.find((item) => item.id === selected)?.quote}”</blockquote><button type="button" onClick={() => { setSelectedSourceId(evidence.find((item) => item.id === selected)?.sourceId ?? PREVIEW_SOURCES[0].id); setPage('Sources'); }}>Open passage <ArrowRight size={14} /></button></div>
            <div className="rm-source-key"><span><i className="blue" />Survey paper</span><span><i className="red" />Chunking notes</span><span><i className="amber" />Vector search</span></div>
            {notice && <p role="status" className="rm-notice">{notice}</p>}
          </aside>}
        </div>}

        {page === 'Sources' && <section className="rm-generic-page"><div className="rm-page-heading"><h1>Sources</h1></div><div className="rm-source-actions"><label><Search size={16} /><span className="rm-sr-only">Search sources</span><input aria-label="Search sources" placeholder="Search sources" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} /></label><button type="button" onClick={() => document.getElementById('rm-file')?.click()}><Plus size={16} /> Add source</button><input id="rm-file" type="file" hidden onChange={(event) => setNotice(event.target.files?.[0] ? `${event.target.files[0].name} selected. This preview does not upload files.` : '')} /></div><div className="rm-source-list">{PREVIEW_SOURCES.filter(({ file, title }) => `${file} ${title}`.toLowerCase().includes(sourceQuery.toLowerCase())).map((source) => <button key={source.id} type="button" aria-pressed={selectedSourceId === source.id} onClick={() => setSelectedSourceId(source.id)}><FileText size={20} /><span><strong>{source.file}</strong><small>{source.type} · {source.chunks} sample passages</small></span><span className="rm-indexed">Preview sample</span><ArrowRight size={16} /></button>)}</div>{PREVIEW_SOURCES.every(({ file, title }) => !`${file} ${title}`.toLowerCase().includes(sourceQuery.toLowerCase())) && <p className="rm-empty">No sample sources match “{sourceQuery}”.</p>}<article className="rm-selected-source"><h2>{selectedSource.file}</h2><p>{selectedSource.locator} · {selectedSource.chunks} sample chunks</p><blockquote>{selectedSource.excerpt}</blockquote><button type="button" onClick={() => { setSelected(PREVIEW_SOURCES.findIndex((source) => source.id === selectedSource.id) + 1); setPage('Ask'); setEvidenceOpen(true); }}>Open in evidence route <ArrowRight size={14} /></button></article>{notice && <p role="status" className="rm-notice">{notice}</p>}</section>}

        {page === 'Monitor' && <section className="rm-generic-page"><div className="rm-page-heading rm-heading-inline"><div><h1>Monitor</h1><p>Live API status and recorded request timings</p></div><label className="rm-range">Time range<select value={range} onChange={(event) => setRange(event.target.value)}><option>90 minutes</option><option>6 hours</option><option>24 hours</option><option>7 days</option></select></label></div><div className="rm-monitor-state"><Gauge size={18} /><div><strong>{runtime.apiStatus === 'ready' ? 'API ready' : runtime.apiStatus === 'offline' ? 'API unavailable' : 'Checking API'}</strong><span>{runtime.metrics?.request_count ?? '—'} recorded requests · updates every 10 seconds</span></div><button type="button" onClick={() => void runtime.refresh()}>Refresh</button></div><div className="rm-monitor-chart"><div><h2>Answer latency</h2><span>Seconds · {range}</span></div><svg viewBox="0 0 680 190" role="img" aria-label={`Recorded answer latency over ${range}`}><path d="M30 160H650M30 115H650M30 70H650M30 25H650" stroke="#dbe2e4" strokeWidth="1"/><text x="0" y="29">{liveRequests.length ? latencyTicks(liveRequests)[0] : '—'}</text><text x="0" y="74">{liveRequests.length ? latencyTicks(liveRequests)[1] : '—'}</text><text x="0" y="164">0 ms</text>{liveRequests.length > 0 && <><polyline points={latencyPolyline(liveRequests, 620, 130)} fill="none" stroke="#367bba" strokeWidth="3"/><text x="30" y="182">Oldest request</text><text x="560" y="182">Latest request</text></>}</svg>{liveRequests.length === 0 && <p role="status">{requestRangeNotice(runtime.metrics?.recent_requests ?? [], range, runtime.metricsError)}</p>}<div className="rm-legend"><span>Median total {formatDuration(runtime.metrics?.latency_ms.p50)} · all recorded requests</span><span>Retrieval p50 {formatDuration(runtime.metrics?.retrieval_latency_ms.p50)} · all recorded requests</span></div></div><div className="rm-monitor-events"><h2>Recent requests</h2>{runtime.metricsError ? <p>{runtime.metricsError}</p> : eventRequests.length ? eventRequests.map((request) => <p key={`${request.recorded_at}-${request.duration_ms}`}><span>{request.error ? 'Failed request' : 'Answer returned'} · {formatRequestTime(request.recorded_at)}</span><span>{formatDuration(request.duration_ms)} · retrieval {formatDuration(stageMilliseconds(request.timings_ms, 'retrieval'))} · generation {formatDuration(stageMilliseconds(request.timings_ms, 'generation'))}</span></p>) : <p>No requests were recorded in this time range.</p>}</div></section>}

        {page === 'Settings' && <section className="rm-generic-page"><div className="rm-page-heading"><h1>Settings</h1><p>Provider details are read from the active app configuration. Preview edits stay local.</p></div><div className="rm-settings-section"><h2>Provider and model</h2>{runtime.settingsError ? <p role="alert">{runtime.settingsError} <button onClick={() => void runtime.refresh()}>Retry</button></p> : runtime.settings ? <><label>Provider<input value={formatProvider(runtime.settings.active_provider)} readOnly /></label><label>Model<input value={runtime.settings.default_model} readOnly /></label><label>Endpoint<input value={runtime.settings.base_url || runtime.settings.custom_base_url || 'No endpoint reported'} readOnly /></label><p>{runtime.settings.providers_configured[runtime.settings.active_provider] ? 'Credential configured · value hidden' : 'No credential reported for this provider'}</p></> : <p role="status">Loading saved provider settings…</p>}</div><div className="rm-settings-section"><h2>Answer behavior</h2><label className="rm-check"><input type="checkbox" defaultChecked /> Include source citations</label><label className="rm-check"><input type="checkbox" defaultChecked /> Require evidence for answers</label></div><div className="rm-settings-actions"><button type="button" onClick={async () => { setNotice('Testing saved provider…'); try { const result = await api.testLLMConnection(); setNotice(`Provider responded in ${formatDuration(result.latency_ms)}.`); } catch { setNotice('Provider test failed. Check endpoint and provider credentials.'); } }}>Test saved provider</button><button type="button" onClick={() => setNotice(runtime.settings?.base_url ? 'Endpoint is present. Test saved provider checks reachability.' : 'Endpoint is missing from saved settings.')}>Validate endpoint</button><button type="button" className={saved ? 'saved' : ''} onClick={() => setSaved(true)}>{saved ? <><Check size={15} /> Preview settings saved</> : 'Save preview settings'}</button></div>{notice && <p role="status" className="rm-notice">{notice} · App configuration was not changed.</p>}</section>}

        <nav className="rm-bottom-nav" aria-label="Main navigation">{navigation.map(({ label, icon: Icon }) => <button type="button" key={label} className={page === label ? 'active' : ''} aria-current={page === label ? 'page' : undefined} onClick={() => setPage(label)}><Icon size={17} /><span>{label}</span></button>)}</nav>
      </main>
    </div>
  );
}
