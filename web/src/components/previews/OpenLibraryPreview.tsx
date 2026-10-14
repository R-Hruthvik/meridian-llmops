import { useMemo, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowUpRight, BookOpen, Check, ChevronDown, FileText, Library, MessageSquareText, Plus, Search, Settings2 } from 'lucide-react';
import './OpenLibraryPreview.css';

const books = [
  { title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks', type: 'Research paper · PDF', pages: '12 pages', state: 'Indexed' },
  { title: 'Meridian ingestion and chunking notes', type: 'Technical note · MD', pages: '8 pages', state: 'Indexed' },
  { title: 'Vector and graph retrieval design', type: 'Architecture · PDF', pages: '16 pages', state: 'Preview sample' },
];

export default function OpenLibraryPreview() {
  const [section, setSection] = useState('Sources');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(books[0].title);
  const [collapsed, setCollapsed] = useState(false);
  const [asked, setAsked] = useState(false);
  const [notice, setNotice] = useState('');
  const [range, setRange] = useState('24 hours');
  const visible = useMemo(() => books.filter((book) => book.title.toLowerCase().includes(query.toLowerCase())), [query]);
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
        <section className="ol-reader" aria-label="Selected source passage"><div className="ol-reader-head"><BookOpen size={18}/><span><strong>{selected}</strong><small>Selected document · preview sample</small></span><button aria-label="Download selected source"><ArrowDownToLine size={16}/></button></div><div className="ol-page"><small>PASSAGE 04 · PAGE 6</small><h2>Retrieval grounds generated answers in source evidence</h2><p>Rather than relying only on a model’s stored parameters, a retrieval system searches an external collection and provides relevant passages as context for the response.</p><p className="ol-highlight">The retrieved documents are then used to condition the language model and make the answer traceable to its supporting evidence.</p><button onClick={() => setSection('Ask')}>Ask about this passage <ArrowUpRight size={15}/></button></div></section>
      </div> : section === 'Ask' ? <section className="ol-ask"><h1>Ask your sources</h1><div className="ol-answer"><div className="ol-answer-label"><Check size={15}/> Preview sample answer</div><p>Retrieval finds relevant passages first, then supplies them as context for the model’s response. This answer connects the research paper’s retrieval step with Meridian’s chunking notes, which describe how documents are divided into passages for indexing.</p><div className="ol-evidence"><button onClick={() => { setSection('Sources'); setSelected(books[0].title); }}>Research paper <span>p. 6, passage 04</span></button><button onClick={() => { setSection('Sources'); setSelected(books[1].title); }}>Chunking notes <span>section “Passage sizing”</span></button></div></div><form onSubmit={(e) => { e.preventDefault(); setAsked(true); }}><input placeholder="Ask a question about your sources"/><button>Ask <ArrowUpRight size={16}/></button></form>{asked && <p className="ol-feedback" role="status">This preview uses sample content; it does not send a live query.</p>}</section> : section === 'Monitor' ? <section className="ol-ops"><div className="ol-title-row"><h1>Monitor</h1><label>Time range<select value={range} onChange={(e) => setRange(e.target.value)}><option>24 hours</option><option>7 days</option><option>30 days</option></select></label></div><p className="ol-ops-note">Preview sample · no live service data</p><div className="ol-metrics"><div><span>Requests</span><strong>128</strong></div><div><span>Median answer</span><strong>1.8 s</strong></div><div><span>Retrieval</span><strong>320 ms</strong></div></div><section className="ol-chart"><h2>Answer latency</h2><p>Seconds · {range}</p><svg viewBox="0 0 720 180" role="img" aria-label="Sample answer latency chart"><path d="M0 25H720 M0 85H720 M0 145H720"/><polyline points="0,118 90,100 180,112 270,64 360,78 450,40 540,71 630,54 720,34"/></svg><div><span>00:00</span><span>12:00</span><span>Now</span></div></section><div className="ol-events"><h2>Recent requests</h2><p>Returned answer <span>2 sources · 1.8 s</span></p><p>Returned answer <span>1 source · 2.1 s</span></p><p>No matching passages <span>retrieval · 420 ms</span></p></div></section> : <section className="ol-settings"><h1>Settings</h1><div className="ol-settings-group"><h2>Language model</h2><p>Live provider and model values come from the app configuration.</p><label>Provider<input value="Read from local environment" readOnly /></label><label>Model<input value="Configured by the app" readOnly /></label><label>API key<span className="ol-secret">Stored in environment · value hidden</span></label></div><div className="ol-settings-group"><h2>Answer behavior</h2><div className="ol-settings-inline"><label>Request timeout<select defaultValue="60"><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="120">120 seconds</option></select></label><label>Enforce answer guardrails<input type="checkbox" defaultChecked /></label></div></div><div className="ol-settings-actions"><button onClick={() => setNotice('This design preview is not connected to the app backend.')}>Test saved provider</button><button onClick={() => setNotice('This design preview is not connected to the app backend.')}>Validate endpoint</button><button className="ol-add" onClick={() => setNotice('Preview settings saved for this page only.')}>Save settings</button></div>{notice && <p role="status" className="ol-feedback">{notice}</p>}</section>}
      <nav className="ol-mobile" aria-label="Mobile navigation">{destinations.map(([label, Icon]) => <button key={label} aria-current={section === label ? 'page' : undefined} onClick={() => setSection(label)}><Icon size={18}/><span>{label}</span></button>)}</nav>
    </main>
  </div>;
}
