import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import './SignalDeskPreview.css';

type Page = 'Ask' | 'Sources' | 'Monitor' | 'Settings';

const events = [
  { time: '14:32:08.241', id: 'req_7f21', label: 'Cross-source answer', detail: '2 documents · retrieval 0.42s · generation 1.86s', duration: '2.28s', kind: 'ok' },
  { time: '14:31:54.090', id: 'req_7f20', label: 'Source indexed', detail: 'attention-is-all-you-need.pdf · 18 chunks', duration: '4.12s', kind: 'info' },
  { time: '14:31:20.617', id: 'req_7f1f', label: 'Answer returned', detail: '1 document · retrieval 0.31s · generation 2.04s', duration: '2.35s', kind: 'ok' },
  { time: '14:30:48.403', id: 'req_7f1e', label: 'Provider request failed', detail: 'Timeout while waiting for model response', duration: '30.00s', kind: 'error' },
  { time: '14:29:12.881', id: 'req_7f1d', label: 'Answer returned', detail: '3 documents · retrieval 0.67s · generation 3.12s', duration: '3.79s', kind: 'ok' },
];

const series = [
  { name: 'p50', color: '#68b9e8', values: [38, 34, 45, 42, 53, 48, 62, 55, 50, 60, 57, 70, 64, 68, 59, 63, 52, 61] },
  { name: 'p95', color: '#e9b45b', values: [67, 61, 73, 69, 80, 76, 91, 84, 78, 89, 84, 98, 90, 96, 85, 91, 79, 88] },
];

function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    Ask: <><path d="M4 5.5h16v11H9l-5 3v-14Z"/><path d="M8 9h8M8 12.5h5"/></>,
    Sources: <><path d="M5 4.5h12a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2v-13Z"/><path d="M5 7h12M9 4.5v13"/></>,
    Monitor: <><path d="M3.5 12h4l2.5-7 4 14 2.5-7h4"/></>,
    Settings: <><circle cx="8" cy="7" r="2"/><circle cx="16" cy="17" r="2"/><path d="M10 7h9M5 7h1M5 17h9M18 17h1"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function LatencyChart() {
  const points = (values: number[]) => values.map((v, i) => `${20 + i * 37},${156 - v}`).join(' ');
  return <div className="sd-chart-wrap">
    <div className="sd-chart-legend"><span><i className="sd-dot blue" />p50</span><span><i className="sd-dot amber" />p95</span><span className="sd-chart-unit">latency · seconds</span></div>
    <svg className="sd-chart" viewBox="0 0 670 190" role="img" aria-label="Preview sample latency line chart from 13:00 to 14:30">
      {[36, 76, 116, 156].map((y, i) => <g key={y}><line x1="20" x2="650" y1={y} y2={y} className="sd-gridline"/><text x="0" y={y + 4} className="sd-axis-label">{[4, 3, 2, 1][i]}s</text></g>)}
      <polyline points={points(series[1].values)} className="sd-line amber-line"/><polyline points={points(series[0].values)} className="sd-line blue-line"/>
      <text x="20" y="181" className="sd-axis-label">13:00</text><text x="315" y="181" className="sd-axis-label">13:45</text><text x="612" y="181" className="sd-axis-label">14:30</text>
    </svg>
  </div>;
}

export default function SignalDeskPreview() {
  const [page, setPage] = useState<Page>('Monitor');
  const [range, setRange] = useState('90 minutes');
  const [filter, setFilter] = useState('All events');
  const [sourceQuery, setSourceQuery] = useState('');
  const [answerReady, setAnswerReady] = useState(false);
  const [notice, setNotice] = useState('');
  const filteredEvents = useMemo(() => events.filter((event) => filter === 'All events' || (filter === 'Errors' && event.kind === 'error') || (filter === 'Answers' && event.label.toLowerCase().includes('answer'))), [filter]);

  return <div className="signal-desk">
    <aside className="sd-sidebar">
      <a className="sd-brand" href="#monitor" onClick={(e) => { e.preventDefault(); setPage('Monitor'); }}><span className="sd-brand-mark">m</span><span>Meridian</span></a>
      <nav aria-label="Main navigation" className="sd-nav">{(['Ask', 'Sources', 'Monitor', 'Settings'] as Page[]).map((item) => <button key={item} className={`sd-nav-item ${page === item ? 'active' : ''}`} aria-current={page === item ? 'page' : undefined} onClick={() => setPage(item)}><Icon name={item}/><span>{item}</span>{item === 'Monitor' && <span className="sd-nav-count">04</span>}</button>)}</nav>
    </aside>
    <main className="sd-main">
      <header className="sd-topbar"><div className="sd-crumb">Meridian <span>/</span> <b>{page}</b></div><div className="sd-top-meta"><span className="sd-sample-tag">PREVIEW · SAMPLE DATA</span><span className="sd-env-status"><i/> API status not connected</span></div></header>
      <div className="sd-content">
        {page === 'Monitor' ? <>
          <div className="sd-page-heading"><div><h1>Monitor</h1><p>Illustrative preview data · not live service metrics</p></div><label className="sd-range">Time range<select value={range} onChange={(e) => setRange(e.target.value)}><option>90 minutes</option><option>6 hours</option><option>24 hours</option></select></label></div>
          <section className="sd-metrics" aria-label="Preview sample summary metrics">
            <article className="sd-metric"><div className="sd-metric-label">REQUESTS <span>PREVIEW SAMPLE</span></div><div className="sd-metric-value">1,284</div><div className="sd-metric-note">illustrative activity · {range}</div></article>
            <article className="sd-metric"><div className="sd-metric-label">MEDIAN LATENCY <span>PREVIEW SAMPLE</span></div><div className="sd-metric-value">2.4<span className="sd-unit">s</span></div><div className="sd-metric-note"><i className="sd-dot blue"/> retrieval 0.4s <i className="sd-dot amber"/> generation 2.0s</div></article>
            <article className="sd-metric"><div className="sd-metric-label">ERROR RATE <span>PREVIEW SAMPLE</span></div><div className="sd-metric-value">0.8<span className="sd-unit">%</span></div><div className="sd-metric-note sd-error-note">10 illustrative failed requests</div></article>
            <article className="sd-metric"><div className="sd-metric-label">INDEXED SOURCES <span>PREVIEW SAMPLE</span></div><div className="sd-metric-value">24</div><div className="sd-metric-note">sample documents · 1,920 chunks</div></article>
          </section>
          <section className="sd-panel sd-latency-panel"><div className="sd-panel-head"><div><h2>Answer latency</h2><p>Illustrative percentiles over the selected range</p></div><button className="sd-quiet-button" onClick={() => setRange('90 minutes')}>Reset range</button></div><LatencyChart/><div className="sd-chart-footer"><span>Lower values mean faster responses</span><span>Sample interval · 5 min</span></div></section>
          <div className="sd-lower-grid">
            <section className="sd-panel sd-stage-panel"><div className="sd-panel-head"><div><h2>Where time goes</h2><p>Median answer duration · preview sample</p></div></div><div className="sd-stage"><div className="sd-stage-title"><span>Retrieval</span><b>0.42s</b></div><div className="sd-bar-track"><i className="sd-bar blue-bar" style={{ width: '18%' }}/></div><small>Search and assemble relevant passages</small></div><div className="sd-stage"><div className="sd-stage-title"><span>Generation</span><b>1.96s</b></div><div className="sd-bar-track"><i className="sd-bar amber-bar" style={{ width: '82%' }}/></div><small>Model response time</small></div><div className="sd-total"><span>Total median</span><b>2.38s</b></div></section>
            <section className="sd-panel sd-events-panel"><div className="sd-panel-head sd-events-head"><div><h2>Recent events</h2><p>Illustrative event feed · not connected to your API</p></div><label className="sd-filter"><span className="sd-sr-only">Filter events</span><select value={filter} onChange={(e) => setFilter(e.target.value)}><option>All events</option><option>Answers</option><option>Errors</option></select></label></div>
              <div className="sd-events">{filteredEvents.length ? filteredEvents.map((event) => <article className="sd-event" key={event.id}><i className={`sd-event-mark ${event.kind}`}/><div className="sd-event-copy"><div className="sd-event-title">{event.label}<code>{event.id}</code></div><p>{event.detail}</p><time>{event.time}</time></div><b className="sd-event-duration">{event.duration}</b></article>) : <div className="sd-empty">No sample events match this filter.</div>}</div>
            </section>
          </div>
        </> : <section className="sd-other-page"><h1>{page}</h1>{page === 'Ask' ? <><form className="sd-ask-form" onSubmit={(e) => { e.preventDefault(); setAnswerReady(true); }}><textarea aria-label="Question" placeholder="Ask a question about your sources…"/><div><span>Preview sample response</span><button>Ask Meridian <span aria-hidden="true">→</span></button></div></form>{answerReady && <article className="sd-preview-answer"><b>Preview answer</b><p>Attention mechanisms let the model weigh relationships between tokens across the input sequence. This illustrative response is not generated by your configured provider.</p><a href="#sample-source" onClick={(e) => e.preventDefault()}>attention-is-all-you-need.pdf · sample citation</a></article>}</> : page === 'Sources' ? <><div className="sd-source-actions"><label><span className="sd-sr-only">Search sources</span><input aria-label="Search sources" placeholder="Search sources" value={sourceQuery} onChange={(e) => setSourceQuery(e.target.value)}/></label><button onClick={() => document.getElementById('sd-file')?.click()}><Plus size={15}/> Add source</button><input id="sd-file" type="file" hidden onChange={(e) => setNotice(e.target.files?.[0] ? `${e.target.files[0].name} selected. This preview does not upload files.` : '')}/></div><div className="sd-source-row"><span className="sd-file-mark">PDF</span><div><b>Attention Is All You Need</b><small>Vaswani et al. · indexed sample</small></div><span>18 chunks</span><span>Sample only</span></div>{sourceQuery&&!('attention is all you need'.includes(sourceQuery.toLowerCase()))&&<p className="sd-inline-note">No sample source matches “{sourceQuery}”.</p>}</> : <><p className="sd-settings-caption">The live provider and model values are read by the connected app from its environment.</p><div className="sd-setting-row"><div><b>Provider</b><small>Credentials are kept in the app environment and never shown here.</small></div><span>Environment</span></div><div className="sd-setting-row"><div><b>Model</b><small>Uses the model selected in the configured app settings.</small></div><span>Configured</span></div><div className="sd-setting-row"><label><b>Answer timeout</b><small>Maximum time to wait for a response.</small></label><select defaultValue="60"><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="120">120 seconds</option></select></div><label className="sd-guardrail"><input type="checkbox" defaultChecked/> Require source evidence</label><div className="sd-settings-actions"><button onClick={() => setNotice('This design preview is not connected to the API.')}>Test saved provider</button><button onClick={() => setNotice('Preview settings saved for this page only.')}>Save settings</button></div>{notice&&<p role="status" className="sd-inline-note">{notice}</p>}</>}</section>}
      </div>
    </main>
  </div>;
}
