import { useState, type FormEvent } from 'react';
import { Activity, ArrowDownToLine, ArrowUpRight, BookOpenText, Check, ChevronDown, FileText, LibraryBig, MessageSquareText, Plus, Search, Settings2, Sparkles, X } from 'lucide-react';
import { api } from '../../services/api';
import { requestsForEventList, requestRangeNotice, formatDuration, formatProvider, formatRequestTime, latencyPolyline, latencyTicks, PREVIEW_ANSWER, PREVIEW_CLAIMS, PREVIEW_QUESTION, PREVIEW_SOURCES, requestsWithinRange, stageMilliseconds } from './previewData';
import { usePreviewRuntime } from './usePreviewRuntime';
import RequestStageBreakdown from './RequestStageBreakdown';
import './RequestStageBreakdown.css';
import './EvidenceJournalPreview.css';

type Page = 'Ask' | 'Sources' | 'Monitor' | 'Settings';

const nav: { label: Page; icon: typeof MessageSquareText }[] = [
  { label: 'Ask', icon: MessageSquareText },
  { label: 'Sources', icon: LibraryBig },
  { label: 'Monitor', icon: Activity },
  { label: 'Settings', icon: Settings2 },
];

const documents = PREVIEW_SOURCES.map((source) => ({
  name: source.file,
  type: `${source.type} · ${source.chunks} sample chunks`,
  indexed: 'Preview sample',
  status: 'Sample',
}));

export default function EvidenceJournalPreview() {
  const [page, setPage] = useState<Page>('Ask');
  const [activeCitation, setActiveCitation] = useState(1);
  const [selectedSourceId, setSelectedSourceId] = useState<string>(PREVIEW_SOURCES[0].id);
  const [question, setQuestion] = useState(PREVIEW_QUESTION);
  const [sourceScope, setSourceScope] = useState('All 3 preview documents');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [range, setRange] = useState('24 hours');
  const runtime = usePreviewRuntime(page === 'Monitor' || page === 'Settings', page === 'Monitor');
  const liveRequests = requestsWithinRange(runtime.metrics?.recent_requests ?? [], range);
  const eventRequests = requestsForEventList(runtime.metrics?.recent_requests ?? [], range);

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    if (question.trim()) setNotice('Sample answer displayed below. This preview does not send the question to a model.');
  };

  const copyAnswer = async () => {
    const answer = PREVIEW_ANSWER;
    try { await navigator.clipboard.writeText(answer); setNotice('Answer copied.'); }
    catch { setNotice('Select and copy the answer text.'); }
  };

  const shownDocs = documents.filter((doc) => doc.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="ej-preview">
      <header className="ej-topbar">
        <a className="ej-brand" href="#ask" onClick={(e) => { e.preventDefault(); setPage('Ask'); }} aria-label="Meridian home">
          <span className="ej-brand-mark">m</span><span>Meridian</span>
        </a>
        <nav className="ej-nav" aria-label="Main navigation">
          {nav.map(({ label, icon: Icon }) => <button type="button" key={label} className={page === label ? 'is-active' : ''} aria-current={page === label ? 'page' : undefined} onClick={() => { setPage(label); setNotice(''); }}><Icon size={17} strokeWidth={1.8} /><span>{label}</span></button>)}
        </nav>
        <span className="ej-preview-tag">Design preview</span>
      </header>

      <main className="ej-main">
        {page === 'Ask' && <section className="ej-ask">
          <div className="ej-page-heading"><div><h1>Ask</h1></div><span className="ej-sample"><span /> Preview sample</span></div>
          <form className="ej-composer" onSubmit={submitQuestion}>
            <label htmlFor="ej-question">Ask your documents</label>
            <div className="ej-composer-row"><textarea id="ej-question" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} /><button className="ej-primary" type="submit"><Sparkles size={16} /> Show sample answer</button></div>
            <div className="ej-composer-meta"><label className="ej-scope"><BookOpenText size={15} /> Search in<select value={sourceScope} onChange={(event) => setSourceScope(event.target.value)}>{['All 3 preview documents', ...PREVIEW_SOURCES.map((source) => source.file)].map((source) => <option key={source}>{source}</option>)}</select></label><span>Scope is for preview only</span></div>
          </form>

          <div className="ej-answer-layout">
            <article className="ej-answer">
              <div className="ej-answer-top"><div><span className="ej-answer-label">SAMPLE ANSWER</span><span className="ej-answer-time">Example only · not generated from your question</span></div><button type="button" className="ej-quiet" onClick={copyAnswer}><ArrowDownToLine size={15} /> Copy</button></div>
              <h2>Retrieval adds evidence at answer time</h2>
              {PREVIEW_CLAIMS.map((claim, index) => <p key={claim}>{claim} <button className="ej-cite" type="button" aria-label={`Open citation ${index + 1}`} aria-pressed={activeCitation === index + 1} onClick={() => { setActiveCitation(index + 1); setSelectedSourceId(PREVIEW_SOURCES[index].id); }}>[{index + 1}]</button></p>)}
              <div className="ej-answer-footer"><span>Example citations point to the passages shown alongside.</span></div>
            </article>
            <aside className="ej-evidence" aria-live="polite">
              <div className="ej-evidence-heading"><div><span className="ej-section-number">01</span><h2>Evidence</h2></div><span>3 passages</span></div>
              <p className="ej-evidence-intro">Select a citation to inspect the passage supporting that claim.</p>
              {PREVIEW_SOURCES.map((source, index) => <button key={source.id} type="button" className={`ej-source-note ${activeCitation === index + 1 ? 'selected' : ''}`} onClick={() => { setActiveCitation(index + 1); setSelectedSourceId(source.id); }}><span className="ej-note-index">[{index + 1}]</span><span><strong>{source.file}</strong><small>{source.locator} · {source.chunks} sample chunks</small><em>“{source.excerpt}”</em></span><ArrowUpRight size={15} /></button>)}
              {PREVIEW_SOURCES.filter((source) => source.id === selectedSourceId).map((source) => <div className="ej-selected-passage" key={source.id} aria-live="polite"><span>SELECTED PASSAGE · {source.locator}</span><strong>{source.title}</strong><blockquote>“{source.excerpt}”</blockquote><small>{source.file} · sample passage · {source.chunks} sample chunks in document</small></div>)}
              <div className="ej-crossref"><span className="ej-crossref-line" /><div><strong>Citation [1]–[3]</strong><p>Each marker opens its corresponding sample passage, with the file and location shown here.</p></div></div>
            </aside>
          </div>
          {notice && <div className="ej-notice" role="status">{notice}<button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={14} /></button></div>}
        </section>}

        {page === 'Sources' && <section className="ej-page">
          <div className="ej-page-heading"><div><h1>Sources</h1></div><button className="ej-primary" type="button" onClick={() => document.getElementById('ej-file')?.click()}><Plus size={16} /> Add source</button><input id="ej-file" type="file" hidden onChange={(e) => setNotice(e.target.files?.[0] ? `${e.target.files[0].name} selected. This preview does not upload files.` : '')} /></div>
          <div className="ej-source-toolbar"><label className="ej-search"><Search size={17} /><span className="ej-sr-only">Search sources</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sources" /></label><span className="ej-result-count">{shownDocs.length} preview documents</span></div>
          <div className="ej-library-list">{shownDocs.map((doc) => <button type="button" className={`ej-library-row ${selectedSourceId === PREVIEW_SOURCES.find((source) => source.file === doc.name)?.id ? 'selected' : ''}`} key={doc.name} aria-pressed={selectedSourceId === PREVIEW_SOURCES.find((source) => source.file === doc.name)?.id} onClick={() => { const source = PREVIEW_SOURCES.find((item) => item.file === doc.name); if (source) setSelectedSourceId(source.id); }}><span className="ej-file-icon"><FileText size={19} /></span><span className="ej-library-name"><strong>{doc.name}</strong><small>{doc.type}</small></span><span className="ej-library-status"><i />{doc.status}</span><span className="ej-library-time">{doc.indexed}</span><ArrowUpRight size={16} /></button>)}</div>
          {shownDocs.some((doc) => PREVIEW_SOURCES.some((source) => source.file === doc.name && source.id === selectedSourceId)) && PREVIEW_SOURCES.filter((source) => source.id === selectedSourceId).map((source) => <section className="ej-source-detail" key={source.id} aria-live="polite"><div><span className="ej-answer-label">SELECTED SOURCE</span><h2>{source.title}</h2><p>{source.file} · {source.type} · {source.chunks} sample chunks</p></div><div><strong>Passage preview · {source.locator}</strong><blockquote>“{source.excerpt}”</blockquote><p>This is sample evidence for the design preview, not content loaded from the live source index.</p></div></section>)}
          {shownDocs.length === 0 && <div className="ej-empty">No preview documents match “{query}”.</div>}
          <p className="ej-data-note">All entries here are sample content for this design preview.</p>
          {notice && <div className="ej-notice" role="status">{notice}<button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={14} /></button></div>}
        </section>}

        {page === 'Monitor' && <section className="ej-page">
          <div className="ej-page-heading"><div><h1>Monitor</h1><span className="ej-subheading">Live API data · recent request window</span></div><label className="ej-range-label">Time range<select value={range} onChange={(e) => setRange(e.target.value)}><option>90 minutes</option><option>6 hours</option><option>24 hours</option><option>7 days</option></select></label></div>
          <div className="ej-metrics"><div><span>Median answer time</span><strong>{formatDuration(runtime.metrics?.latency_ms.p50)}</strong><em>API recorded</em></div><div><span>Retrieval p50</span><strong>{formatDuration(runtime.metrics?.retrieval_latency_ms.p50)}</strong><em>API recorded</em></div><div><span>Requests</span><strong>{runtime.metrics?.request_count ?? '—'}</strong><em>{runtime.apiStatus === 'ready' ? 'API ready' : runtime.apiStatus === 'offline' ? 'API unavailable' : 'Checking API'}</em></div></div>
          <div className="ej-chart-block"><div className="ej-chart-heading"><h2>Answer latency</h2><span>Seconds · {range}</span></div><div className="ej-chart"><div className="ej-axis"><span>{liveRequests.length ? latencyTicks(liveRequests)[0] : '—'}</span><span>{liveRequests.length ? latencyTicks(liveRequests)[1] : '—'}</span><span>{liveRequests.length ? latencyTicks(liveRequests)[3] : '0 ms'}</span><span>Seconds</span></div><svg viewBox="0 0 720 170" preserveAspectRatio="none" role="img" aria-label={`Recorded answer latency over ${range}`}><path className="ej-gridline" d="M0 15H720 M0 84H720 M0 154H720"/>{liveRequests.length > 0 && <polyline className="ej-chart-line" points={latencyPolyline(liveRequests, 700, 139)}/>}</svg></div>{liveRequests.length === 0 && <p role="status" className="ej-data-note">{requestRangeNotice(runtime.metrics?.recent_requests ?? [], range, runtime.metricsError)}</p>}<div className="ej-chart-x"><span>{liveRequests.length ? formatRequestTime(liveRequests.at(-1)!.recorded_at) : 'Oldest'}</span><span>{liveRequests.length ? formatRequestTime(liveRequests[0].recorded_at) : 'Newest'}</span></div></div>
          <RequestStageBreakdown request={eventRequests[0]} /><div className="ej-events"><div className="ej-chart-heading"><h2>Recent requests</h2><button type="button" className="ej-quiet" onClick={() => void runtime.refresh()}>Refresh</button></div>{eventRequests.length ? eventRequests.map((request) => <div className="ej-event-row" key={`${request.recorded_at}-${request.duration_ms}`}><span className={`ej-event-dot ${request.error ? 'warn' : 'good'}`}/><strong>{request.error ? 'Request failed' : 'Answer returned'}</strong><span>{formatRequestTime(request.recorded_at)} · retrieval {formatDuration(stageMilliseconds(request.timings_ms, 'retrieval'))} · generation {formatDuration(stageMilliseconds(request.timings_ms, 'generation'))}</span><time>{formatDuration(request.duration_ms)}</time></div>) : <p className="ej-data-note">{requestRangeNotice(runtime.metrics?.recent_requests ?? [], range, runtime.metricsError)}</p>}</div>
        </section>}

        {page === 'Settings' && <section className="ej-page">
          <div className="ej-page-heading"><div><h1>Settings</h1></div><span className="ej-sample"><span /> Saved app values</span></div>
          <section className="ej-settings-section"><div className="ej-setting-title"><h2>Provider</h2><p>Read-only values from the active app configuration.</p></div>{runtime.settingsError ? <p role="alert">{runtime.settingsError} <button onClick={() => void runtime.refresh()}>Retry</button></p> : runtime.settings ? <div className="ej-setting-fields"><label>Provider<input value={formatProvider(runtime.settings.active_provider)} readOnly /></label><label>Model<input value={runtime.settings.default_model} readOnly /></label><label className="ej-wide">Endpoint URL<input value={runtime.settings.base_url || runtime.settings.custom_base_url || 'No endpoint reported'} readOnly /></label></div> : <p role="status">Loading saved settings…</p>}</section>
          <section className="ej-settings-section"><div className="ej-setting-title"><h2>Credentials</h2><p>Secret values stay hidden.</p></div><div className="ej-secret-line"><span><strong>Provider API key</strong><small>{runtime.settings?.providers_configured[runtime.settings.active_provider] ? 'Configured · key value never returned by the API' : 'No credential reported for this provider'}</small></span><span className="ej-configured"><Check size={14} /> {runtime.settings?.providers_configured[runtime.settings.active_provider] ? 'Configured' : 'Not configured'}</span></div></section>
          <details className="ej-settings-section ej-disclosure"><summary><span><strong>Answer behavior</strong><small>Timeout, result limit, and guardrails</small></span><ChevronDown size={17} /></summary><div className="ej-setting-fields"><label>Request timeout<input type="number" defaultValue={60} min={1} max={300} /></label><label>Maximum retrieved passages<input type="number" defaultValue={5} min={1} max={20} /></label></div></details>
          <div className="ej-settings-actions"><button type="button" className="ej-secondary" onClick={async () => { setNotice('Testing the saved provider…'); try { const result = await api.testLLMConnection(); setNotice(`Saved provider responded in ${formatDuration(result.latency_ms)}.`); } catch { setNotice('Provider test failed. Check the saved endpoint and provider credentials.'); } }}>Test saved provider</button><button type="button" className="ej-secondary" onClick={() => setNotice(runtime.settings?.base_url ? 'Endpoint is present. Use Test saved provider to check reachability.' : 'Endpoint is missing from saved settings.')}>Validate endpoint</button><button type="button" className="ej-primary" onClick={() => setNotice('Preview settings saved for this page only. App configuration was not changed.')}>Save preview settings</button></div>
          {notice && <div className="ej-notice" role="status">{notice}<button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={14} /></button></div>}
        </section>}
      </main>
      <footer className="ej-footer"><span>Meridian</span><span>Evidence Journal design direction</span><span>Preview sample · not live service data</span></footer>
    </div>
  );
}
