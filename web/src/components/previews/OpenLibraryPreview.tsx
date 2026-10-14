import { useMemo, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowUpRight, BookOpen, Check, ChevronDown, FileText, Library, MessageSquareText, Plus, Search, Settings2 } from 'lucide-react';
import { PREVIEW_ANSWER, PREVIEW_QUESTION, PREVIEW_SOURCES } from './previewData';
import './OpenLibraryPreview.css';

const books = PREVIEW_SOURCES.map((source) => ({ title: source.file, type: source.type, pages: `${source.chunks} sample chunks`, state: 'Preview sample' }));

export default function OpenLibraryPreview() {
  const [section, setSection] = useState('Sources');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(books[0].title);
  const [collapsed, setCollapsed] = useState(false);
  const [asked, setAsked] = useState(false);
  const [question, setQuestion] = useState(PREVIEW_QUESTION);
  const [notice, setNotice] = useState('');
  const [range, setRange] = useState('24 hours');
  const visible = useMemo(() => books.filter((book) => book.title.toLowerCase().includes(query.toLowerCase())), [query]);
  const selectedSource = PREVIEW_SOURCES.find((source) => source.file === selected) ?? PREVIEW_SOURCES[0];
  const destinations = [
    ['Ask', MessageSquareText], ['Sources', Library], ['Monitor', Activity], ['Settings', Settings2],
  ] as const;
  return <div className="ol-preview">
    <aside className={`ol-nav${collapsed ? ' ol-nav--small' : ''}`}>
      <div className="ol-brand"><span className="ol-mark">m</span>{!collapsed && <strong>Meridian</strong>}<button aria-label="Toggle navigation width" onClick={() => setCollapsed(!collapsed)}><ChevronDown size={15}/></button></div>
      <nav aria-label="Preview navigation">{destinations.map(([label, Icon]) => <button key={label} className={section === label ? 'is-current' : ''} onClick={() => setSection(label)} title={collapsed ? label : undefined}><Icon size={18}/>{!collapsed && <span>{label}</span>}</button>)}</nav>
      {!collapsed && <div className="ol-nav-note"><span className="ol-state-dot"/> Preview sample</div>}
    </aside>
    <main className="ol-main">
      <header className="ol-top"><span>Meridian <i>/</i> {section}</span><button onClick={() => setSection('Ask')}><MessageSquareText size={16}/> Ask a question</button></header>
      {section === 'Sources' ? <div className="ol-layout">
        <section className="ol-catalog" aria-label="Source catalog">
          <div className="ol-title-row"><h1>Sources</h1><button className="ol-add" onClick={() => setNotice('Source upload is available in the connected app. This preview uses sample documents.')}><Plus size={16}/> Add source</button></div>
          <label className="ol-search"><Search size={16}/><span className="sr-only">Search sources</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sources"/></label>
          <div className="ol-count">{visible.length} documents shown · preview sample</div>
          {notice && <p role="status" className="ol-feedback">{notice}</p>}
          <div className="ol-list">{visible.map((book) => <button key={book.title} className={`ol-book${selected === book.title ? ' is-selected' : ''}`} onClick={() => setSelected(book.title)}><FileText size={18}/><span><strong>{book.title}</strong><small>{book.type} · {book.pages}</small></span><span className="ol-ready"><Check size={13}/>{book.state}</span></button>)}</div>
          {visible.length === 0 && <p className="ol-empty">No documents match “{query}”.</p>}
        </section>
        <section className="ol-reader" aria-label="Selected source passage"><div className="ol-reader-head"><BookOpen size={18}/><span><strong>{selected}</strong><small>Selected document · preview sample</small></span><button aria-label="Download selected source"><ArrowDownToLine size={16}/></button></div><div className="ol-page"><small>{selectedSource.locator} · {selectedSource.chunks} sample chunks</small><h2>{selectedSource.title}</h2><p>{selectedSource.excerpt}</p><p className="ol-highlight">This passage supports the cross-document answer and remains linked to its citation.</p><button onClick={() => setSection('Ask')}>Ask about this passage <ArrowUpRight size={15}/></button></div></section>
      </div> : section === 'Ask' ? <section className="ol-ask"><h1>Ask your sources</h1><div className="ol-answer"><div className="ol-answer-label"><Check size={15}/> Preview sample answer</div><p>{PREVIEW_ANSWER}</p><div className="ol-evidence">{PREVIEW_SOURCES.slice(0, 2).map((source) => <button key={source.id} onClick={() => { setSection('Sources'); setSelected(source.file); }}>{source.file}<span>{source.locator}</span></button>)}</div></div><form onSubmit={(e) => { e.preventDefault(); setAsked(true); }}><input aria-label="Question" value={question} onChange={(e) => setQuestion(e.target.value)}/><button>Ask <ArrowUpRight size={16}/></button></form>{asked && <p className="ol-feedback" role="status">Preview answer shown. No live query was sent.</p>}</section> : section === 'Monitor' ? <section className="ol-ops"><div className="ol-title-row"><h1>Monitor</h1><label>Time range<select value={range} onChange={(e) => setRange(e.target.value)}><option>24 hours</option><option>7 days</option><option>30 days</option></select></label></div><p className="ol-ops-note">Preview sample · no live service data</p><div className="ol-metrics"><div><span>Requests</span><strong>128</strong></div><div><span>Median answer</span><strong>1.8 s</strong></div><div><span>Retrieval</span><strong>320 ms</strong></div></div><section className="ol-chart"><h2>Answer latency</h2><p>Seconds · {range}</p><svg viewBox="0 0 720 180" role="img" aria-label="Sample answer latency chart"><path d="M0 25H720 M0 85H720 M0 145H720"/><polyline points="0,118 90,100 180,112 270,64 360,78 450,40 540,71 630,54 720,34"/></svg><div><span>00:00</span><span>12:00</span><span>Now</span></div></section><div className="ol-events"><h2>Recent requests</h2><p>Returned answer <span>2 sources · 1.8 s</span></p><p>Returned answer <span>1 source · 2.1 s</span></p><p>No matching passages <span>retrieval · 420 ms</span></p></div></section> : <section className="ol-settings"><h1>Settings</h1><div className="ol-settings-group"><h2>Language model</h2><p>Live provider and model values come from the app configuration.</p><label>Provider<input value="Read from local environment" readOnly /></label><label>Model<input value="Configured by the app" readOnly /></label><label>API key<span className="ol-secret">Stored in environment · value hidden</span></label></div><div className="ol-settings-group"><h2>Answer behavior</h2><div className="ol-settings-inline"><label>Request timeout<select defaultValue="60"><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="120">120 seconds</option></select></label><label>Enforce answer guardrails<input type="checkbox" defaultChecked /></label></div></div><div className="ol-settings-actions"><button onClick={() => setNotice('This design preview is not connected to the app backend.')}>Test saved provider</button><button onClick={() => setNotice('This design preview is not connected to the app backend.')}>Validate endpoint</button><button className="ol-add" onClick={() => setNotice('Preview settings saved for this page only.')}>Save settings</button></div>{notice && <p role="status" className="ol-feedback">{notice}</p>}</section>}
      <nav className="ol-mobile" aria-label="Mobile navigation">{destinations.map(([label, Icon]) => <button key={label} aria-current={section === label ? 'page' : undefined} onClick={() => setSection(label)}><Icon size={18}/><span>{label}</span></button>)}</nav>
    </main>
  </div>;
}
