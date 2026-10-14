import { useMemo, useState, type FormEvent } from 'react';
import { Activity, ArrowRight, BookOpen, Menu, MessageSquareText, Plus, Settings2 } from 'lucide-react';
import { api } from '../../services/api';
import { requestsForEventList, requestRangeNotice, formatDuration, formatProvider, formatRequestTime, latencyPolyline, latencyTicks, PREVIEW_ANSWER, PREVIEW_QUESTION, PREVIEW_SOURCES, requestsWithinRange, stageMilliseconds } from './previewData';
import { usePreviewRuntime } from './usePreviewRuntime';
import './SignalDeskPreview.css';

type Page = 'Ask' | 'Sources' | 'Monitor' | 'Settings';
const navigation: { label: Page; icon: typeof MessageSquareText }[] = [
  { label: 'Ask', icon: MessageSquareText },
  { label: 'Sources', icon: BookOpen },
  { label: 'Monitor', icon: Activity },
  { label: 'Settings', icon: Settings2 },
];

export default function SignalDeskPreview() {
  const [page, setPage] = useState<Page>('Monitor');
  const [range, setRange] = useState('24 hours');
  const [filter, setFilter] = useState('All requests');
  const [sourceQuery, setSourceQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState<string>(PREVIEW_SOURCES[0].file);
  const [question, setQuestion] = useState(PREVIEW_QUESTION);
  const [answerReady, setAnswerReady] = useState(true);
  const [notice, setNotice] = useState('');
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [sourceScope, setSourceScope] = useState<string>('All 3 preview documents');
  const runtime = usePreviewRuntime(page === 'Monitor' || page === 'Settings', page === 'Monitor');
  const liveRequests = requestsWithinRange(runtime.metrics?.recent_requests ?? [], range);
  const eventRequests = requestsForEventList(runtime.metrics?.recent_requests ?? [], range);
  const filteredRequests = useMemo(() => eventRequests.filter((request) => (
    filter === 'All requests' || (filter === 'Errors' && request.error) || (filter === 'Answers' && !request.error)
  )), [filter, eventRequests]);
  const latestRequest = eventRequests[0];
  const retrievalMs = latestRequest ? stageMilliseconds(latestRequest.timings_ms, 'retrieval') : 0;
  const generationMs = latestRequest ? stageMilliseconds(latestRequest.timings_ms, 'generation') : 0;
  const stageTotal = Math.max(retrievalMs + generationMs, 1);
  const selectedDocument = PREVIEW_SOURCES.find((source) => source.file === selectedSource) ?? PREVIEW_SOURCES[0];
  const citationSources = sourceScope === 'All 3 preview documents'
    ? PREVIEW_SOURCES.slice(0, 2)
    : PREVIEW_SOURCES.filter((source) => source.file === sourceScope);

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    if (question.trim()) setAnswerReady(true);
  };

  return <div className={`signal-desk${navCollapsed ? ' sd-nav-collapsed' : ''}`}>
    <aside className="sd-sidebar">
      <a className="sd-brand" href="#monitor" onClick={(event) => { event.preventDefault(); setPage('Ask'); }}><span className="sd-brand-mark">m</span><span>Meridian</span></a>
      <nav aria-label="Main navigation" className="sd-nav">
        {navigation.map(({ label, icon: Icon }) => <button key={label} className={`sd-nav-item ${page === label ? 'active' : ''}`} aria-current={page === label ? 'page' : undefined} onClick={() => { setPage(label); setNotice(''); }}><Icon size={18} strokeWidth={1.8}/><span>{label}</span></button>)}
      </nav>
    </aside>
    <main className="sd-main">
      <header className="sd-topbar"><div className="sd-top-left"><button className="sd-nav-toggle" aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={() => setNavCollapsed((value) => !value)}><Menu size={17}/></button><div className="sd-crumb">Meridian <span>/</span> <b>{page}</b></div></div><div className="sd-top-meta"><span className="sd-sample-tag">SIGNAL DESK · PREVIEW</span><span className="sd-env-status"><i className={runtime.apiStatus}/>{runtime.apiStatus === 'ready' ? 'API ready' : runtime.apiStatus === 'offline' ? 'API unavailable' : 'Checking API'}</span>{runtime.apiStatus === 'offline' && <button className="sd-quiet-button" onClick={() => void runtime.refresh()}>Retry</button>}</div></header>
      <div className="sd-content">
        {page === 'Monitor' && <>
          <div className="sd-page-heading"><div><h1>Monitor</h1><p>Recorded service and request signals</p></div><label className="sd-range">Time range<select value={range} onChange={(event) => setRange(event.target.value)}><option>90 minutes</option><option>6 hours</option><option>24 hours</option><option>7 days</option></select></label></div>
          <section className="sd-metrics" aria-label="Live API metrics">
            <article className="sd-metric"><div className="sd-metric-label">REQUESTS <span>API</span></div><div className="sd-metric-value">{runtime.metrics?.request_count ?? '—'}</div><div className="sd-metric-note">Recorded by this service</div></article>
            <article className="sd-metric"><div className="sd-metric-label">P50 LATENCY <span>API</span></div><div className="sd-metric-value">{formatDuration(runtime.metrics?.latency_ms.p50)}</div><div className="sd-metric-note">All recorded requests</div></article>
            <article className="sd-metric"><div className="sd-metric-label">ERRORS <span>API</span></div><div className="sd-metric-value">{runtime.metrics?.error_count ?? '—'}</div><div className="sd-metric-note">Failed recorded requests</div></article>
            <article className="sd-metric"><div className="sd-metric-label">RETRIEVAL P50 <span>API</span></div><div className="sd-metric-value">{formatDuration(runtime.metrics?.retrieval_latency_ms.p50)}</div><div className="sd-metric-note">Embedding and search</div></article>
          </section>
          <section className="sd-panel sd-latency-panel"><div className="sd-panel-head"><div><h2>Answer latency</h2><p>Real request durations · {range}</p></div><button className="sd-quiet-button" onClick={() => void runtime.refresh()}>Refresh</button></div>
            <div className="sd-chart-wrap"><div className="sd-chart-legend"><span><i className="sd-dot blue"/> Latency · seconds</span><span>{liveRequests.length} timestamped requests in range</span></div><svg className="sd-chart" viewBox="0 0 670 190" role="img" aria-label={`Recorded request latency over ${range}, seconds`}>{[36,76,116,156].map((y, index) => <g key={y}><line x1="48" x2="650" y1={y} y2={y} className="sd-gridline"/><text x="2" y={y + 3} className="sd-axis-label">{liveRequests.length ? latencyTicks(liveRequests)[index] : index === 3 ? '0 ms' : ''}</text></g>)}{liveRequests.length > 0 && <polyline points={latencyPolyline(liveRequests, 602, 130)} className="sd-line blue-line"/>}<text x="48" y="181" className="sd-axis-label">Oldest</text><text x="596" y="181" className="sd-axis-label">Newest</text></svg>{liveRequests.length === 0 && <p role="status" className="sd-empty">{requestRangeNotice(runtime.metrics?.recent_requests ?? [], range, runtime.metricsError)}</p>}</div>
          </section>
          <div className="sd-lower-grid">
            <section className="sd-panel sd-stage-panel"><div className="sd-panel-head"><div><h2>Where time goes</h2><p>Latest recorded request</p></div></div>{latestRequest ? <><div className="sd-stage"><div className="sd-stage-title"><span>Retrieval</span><b>{formatDuration(retrievalMs)}</b></div><div className="sd-bar-track"><i className="sd-bar blue-bar" style={{ width: `${retrievalMs / stageTotal * 100}%` }}/></div><small>Embedding and document search</small></div><div className="sd-stage"><div className="sd-stage-title"><span>Generation</span><b>{formatDuration(generationMs)}</b></div><div className="sd-bar-track"><i className="sd-bar amber-bar" style={{ width: `${generationMs / stageTotal * 100}%` }}/></div><small>Recorded model generation spans</small></div><div className="sd-total"><span>Total response</span><b>{formatDuration(latestRequest.duration_ms)}</b></div></> : <p className="sd-empty">No request timing is available yet.</p>}</section>
            <section className="sd-panel sd-events-panel"><div className="sd-panel-head sd-events-head"><div><h2>Recent requests</h2><p>Live data · refreshed every 10 seconds</p></div><label className="sd-filter"><span className="sd-sr-only">Filter requests</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option>All requests</option><option>Answers</option><option>Errors</option></select></label></div>
              <div className="sd-events">{runtime.metricsError ? <div role="alert" className="sd-empty">{runtime.metricsError}</div> : filteredRequests.length ? filteredRequests.map((request) => <article className="sd-event" key={`${request.recorded_at}-${request.duration_ms}`}><i className={`sd-event-mark ${request.error ? 'error' : 'ok'}`}/><div className="sd-event-copy"><div className="sd-event-title">{request.error ? 'Request failed' : 'Answer returned'}<code>{formatRequestTime(request.recorded_at)}</code></div><p>Retrieval {formatDuration(stageMilliseconds(request.timings_ms, 'retrieval'))} · generation {formatDuration(stageMilliseconds(request.timings_ms, 'generation'))}</p><time>{request.error ? 'Error recorded' : 'Completed'}</time></div><b className="sd-event-duration">{formatDuration(request.duration_ms)}</b></article>) : <div className="sd-empty">No requests in this range and filter.</div>}</div>
            </section>
          </div>
        </>}
        {page === 'Ask' && <section className="sd-other-page"><h1>Ask your sources</h1><form className="sd-ask-form" onSubmit={submitQuestion}><label htmlFor="sd-question">Question</label><textarea id="sd-question" value={question} onChange={(event) => setQuestion(event.target.value)}/><div><label className="sd-scope-label">Source scope<select value={sourceScope} onChange={(event) => setSourceScope(event.target.value)}>{['All 3 preview documents', ...PREVIEW_SOURCES.map((source) => source.file)].map((source) => <option key={source}>{source}</option>)}</select></label><button>Ask Meridian <span aria-hidden="true">→</span></button></div></form>{answerReady && <article className="sd-preview-answer"><b>Preview answer · sample response</b><p>{PREVIEW_ANSWER}</p><div className="sd-citations">{citationSources.map((source) => <button key={source.id} onClick={() => { setSelectedSource(source.file); setPage('Sources'); }}>{source.file} · {source.locator}</button>)}</div><small>Submitting shows this shared sample response; no live question is sent.</small></article>}</section>}
        {page === 'Sources' && <section className="sd-other-page"><h1>Sources</h1><div className="sd-source-actions"><label><span className="sd-sr-only">Search sources</span><input aria-label="Search sources" placeholder="Search sources" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)}/></label><button onClick={() => document.getElementById('sd-file')?.click()}><Plus size={15}/> Add source</button><input id="sd-file" type="file" hidden onChange={(event) => setNotice(event.target.files?.[0] ? `${event.target.files[0].name} selected. This preview does not upload files.` : '')}/></div>{notice && <p role="status" className="sd-inline-note">{notice}</p>}<div className="sd-source-layout"><div>{PREVIEW_SOURCES.filter((source) => `${source.file} ${source.title}`.toLowerCase().includes(sourceQuery.toLowerCase())).map((source) => <button className="sd-source-row" key={source.id} aria-pressed={selectedSource === source.file} onClick={() => setSelectedSource(source.file)}><span className="sd-file-mark">{source.type.includes('PDF') ? 'PDF' : 'MD'}</span><span><b>{source.file}</b><small>{source.title}</small></span><span>{source.chunks} chunks</span></button>)}</div><article className="sd-source-detail"><b>{selectedDocument.file}</b><small>{selectedDocument.locator} · {selectedDocument.chunks} sample chunks</small><p>{selectedDocument.excerpt}</p><button onClick={() => setPage('Ask')}>Ask about these sources <ArrowRight size={14}/></button></article></div></section>}
        {page === 'Settings' && <section className="sd-other-page"><h1>Settings</h1><p className="sd-settings-caption">Saved provider values from the app configuration. Secret values are never returned.</p>{runtime.settingsError ? <p role="alert">{runtime.settingsError} <button onClick={() => void runtime.refresh()}>Retry</button></p> : runtime.settings ? <><div className="sd-setting-row"><div><b>Provider</b><small>Current saved provider</small></div><span>{formatProvider(runtime.settings.active_provider)}</span></div><div className="sd-setting-row"><div><b>Model</b><small>Current saved model</small></div><span>{runtime.settings.default_model}</span></div><div className="sd-setting-row"><div><b>Endpoint</b><small>Saved endpoint URL</small></div><span>{runtime.settings.base_url || runtime.settings.custom_base_url || 'No endpoint reported'}</span></div><div className="sd-setting-row"><div><b>API key</b><small>Secret value is never displayed</small></div><span>{runtime.settings.providers_configured[runtime.settings.active_provider] ? 'Configured · hidden' : 'Not configured'}</span></div></> : <p role="status">Loading saved settings…</p>}<div className="sd-setting-row"><label><b>Answer timeout</b><small>Preview control · does not change the app config.</small></label><select defaultValue="60"><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="120">120 seconds</option></select></div><label className="sd-guardrail"><input type="checkbox" defaultChecked/> Require source evidence</label><div className="sd-settings-actions"><button onClick={async () => { setNotice('Testing saved provider…'); try { const result = await api.testLLMConnection(); setNotice(`Provider responded in ${formatDuration(result.latency_ms)}.`); } catch { setNotice('Provider test failed. Check endpoint and provider credentials.'); } }}>Test saved provider</button><button onClick={() => { const endpoint = runtime.settings?.base_url || runtime.settings?.custom_base_url || ''; setNotice(endpoint && /^https?:\/\//i.test(endpoint) ? 'Endpoint format is valid. Network reachability is a separate provider test.' : 'Endpoint is missing or is not an HTTP URL. Check the saved provider URL.'); }}>Validate endpoint</button><button onClick={() => setNotice('Preview settings saved for this page only. App configuration was not changed.')}>Save preview settings</button></div>{notice && <p role="status" className="sd-inline-note">{notice}</p>}</section>}
      </div>
    </main>
  </div>;
}
