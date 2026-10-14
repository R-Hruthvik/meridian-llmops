import { useState } from 'react';
import { Activity, ArrowRight, BookOpen, Check, ChevronDown, FileText, Gauge, LibraryBig, MessageSquareText, PanelLeftClose, PanelLeftOpen, Plus, Search, Send, Settings2, Waypoints, X } from 'lucide-react';
import './RouteMapPreview.css';

type Page = 'Ask' | 'Sources' | 'Monitor' | 'Settings';

const navigation: { label: Page; icon: typeof MessageSquareText }[] = [
  { label: 'Ask', icon: MessageSquareText },
  { label: 'Sources', icon: LibraryBig },
  { label: 'Monitor', icon: Activity },
  { label: 'Settings', icon: Settings2 },
];

const evidence = [
  { id: 1, color: 'blue', file: 'rag-survey-2024.pdf', page: 'p. 8 · § 3.2', quote: 'Retrieval augmented generation combines a parametric model with a non-parametric memory…' },
  { id: 2, color: 'red', file: 'vector-search-notes.pdf', page: 'p. 3 · § 1.4', quote: 'Retrieved passages are inserted into the prompt as contextual evidence before generation.' },
  { id: 3, color: 'amber', file: 'rag-survey-2024.pdf', page: 'p. 11 · § 4.1', quote: 'The retriever selects relevant passages; the generator uses them to construct a response.' },
];

export default function RouteMapPreview() {
  const [page, setPage] = useState<Page>('Ask');
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState(1);
  const [evidenceOpen, setEvidenceOpen] = useState(true);
  const [question, setQuestion] = useState('How do retrieval and generation work together across these papers?');
  const [reply, setReply] = useState('');
  const [sourceQuery, setSourceQuery] = useState('');
  const [saved, setSaved] = useState(false);
  const [range, setRange] = useState('24 hours');
  const [notice, setNotice] = useState('');

  const ask = () => {
    if (!question.trim()) return;
    setReply(question.trim());
    setSelected(1);
  };

  return (
    <div className={`rm-app${collapsed ? ' rm-collapsed' : ''}`}>
      <aside className="rm-sidebar">
        <div className="rm-brand-row">
          <a href="#ask" className="rm-brand" onClick={(event) => { event.preventDefault(); setPage('Ask'); }}><span className="rm-mark"><Waypoints size={20} /></span><span>Meridian</span></a>
          <button className="rm-icon-button rm-collapse" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</button>
        </div>
        <nav className="rm-nav" aria-label="Main navigation">
          {navigation.map(({ label, icon: Icon }) => <button key={label} type="button" className={page === label ? 'active' : ''} aria-current={page === label ? 'page' : undefined} title={label} onClick={() => { setPage(label); setNotice(''); }}><Icon size={18} strokeWidth={1.8} /><span>{label}</span></button>)}
        </nav>
      </aside>

      <main className="rm-main">
        <header className="rm-topbar"><div className="rm-breadcrumb">Meridian <span>/</span> {page}</div><span className="rm-preview-label"><i /> Interactive preview · sample data</span></header>
        {page === 'Ask' && <div className={`rm-work-area${!evidenceOpen ? ' rm-evidence-hidden' : ''}`}>
          <section className="rm-content">
            <div className="rm-page-heading"><h1>Ask</h1></div>
            <div className="rm-scope"><BookOpen size={15} /><span>Searching</span><strong>All 3 sample sources</strong><ChevronDown size={14} /></div>
            <div className="rm-composer"><label htmlFor="rm-question">Your question</label><textarea id="rm-question" rows={2} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask(); } }} /><div className="rm-compose-foot"><span>Enter to ask · Shift + Enter for a new line</span><button onClick={ask} type="button"><Send size={15} /> Ask</button></div></div>

            <article className="rm-answer">
              <div className="rm-answer-head"><div className="rm-answer-title"><span className="rm-answer-mark"><Waypoints size={17} /></span><strong>Answer</strong><span className="rm-answer-tag">Preview sample</span></div><div className="rm-answer-meta">Retrieved in <b>0.82s</b></div></div>
              <div className="rm-answer-copy"><p>{reply ? `For “${reply}” — ` : ''}Retrieval finds relevant passages in the indexed documents; generation uses those passages as context to compose an answer. The two stages work together: retrieval supplies evidence, then the language model synthesizes it into a response.</p><p>In this sample, the survey explains the retrieval stage while the search notes describe how retrieved text reaches the generator.</p></div>
              <div className="rm-citations" aria-label="Answer citations">
                {evidence.slice(0, 2).map((item) => <button key={item.id} type="button" className={`rm-citation ${item.color}${selected === item.id ? ' selected' : ''}`} onClick={() => { setSelected(item.id); setEvidenceOpen(true); }}><span>{item.id}</span>{item.file}<ArrowRight size={13} /></button>)}
              </div>
            </article>
            <div className="rm-route-caption"><span className="rm-route-line" />Evidence route <span>question → claim → passages → documents</span><button type="button" onClick={() => setEvidenceOpen(!evidenceOpen)}>{evidenceOpen ? 'Hide evidence' : 'Show evidence'}</button></div>
          </section>

          {evidenceOpen && <aside className="rm-evidence" aria-label="Evidence details">
            <div className="rm-evidence-heading"><div><h2>Evidence route</h2><p>Two papers support this answer</p></div><button className="rm-icon-button rm-evidence-close" aria-label="Close evidence" onClick={() => setEvidenceOpen(false)}><X size={17} /></button></div>
            <div className="rm-route-map" aria-label="Question, claim, and source route">
              <div className="rm-route-node rm-question-node"><span className="rm-node-dot" /><div><small>QUESTION</small><strong>How retrieval informs generation</strong></div></div>
              <div className="rm-route-branch">
                {evidence.map((item) => <button key={item.id} className={`rm-route-node rm-source-node ${item.color}${selected === item.id ? ' selected' : ''}`} onClick={() => setSelected(item.id)} type="button"><span className="rm-node-dot" /><span className="rm-node-id">{item.id}</span><div><small>{item.id === 2 ? 'PASSAGE · NOTES' : 'PASSAGE · SURVEY'}</small><strong>{item.id === 1 ? 'Retriever selects evidence' : item.id === 2 ? 'Context enters the prompt' : 'Generator synthesizes'}</strong></div><ArrowRight size={14} /></button>)}
              </div>
            </div>
            <div className="rm-passage"><div className="rm-passage-top"><span>SELECTED PASSAGE</span><span>{evidence.find((item) => item.id === selected)?.page}</span></div><h3>{evidence.find((item) => item.id === selected)?.file}</h3><blockquote>“{evidence.find((item) => item.id === selected)?.quote}”</blockquote><button type="button" onClick={() => setNotice('Passage opened in this preview.')}>Open passage <ArrowRight size={14} /></button></div>
            <div className="rm-source-key"><span><i className="blue" />Survey paper</span><span><i className="red" />Search notes</span><span><i className="amber" />Synthesis claim</span></div>
            {notice && <p role="status" className="rm-notice">{notice}</p>}
          </aside>}
        </div>}

        {page === 'Sources' && <section className="rm-generic-page"><div className="rm-page-heading"><h1>Sources</h1></div><div className="rm-source-actions"><label><Search size={16} /><span className="rm-sr-only">Search sources</span><input aria-label="Search sources" placeholder="Search sources" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} /></label><button type="button" onClick={() => setNotice('Add source is available in the full app. This preview uses sample documents.')}><Plus size={16} /> Add source</button></div><div className="rm-source-list">{['rag-survey-2024.pdf', 'vector-search-notes.pdf', 'grounded-generation-review.pdf'].filter((name) => name.includes(sourceQuery.toLowerCase())).map((name, index) => <button key={name} type="button" onClick={() => { setPage('Ask'); setSelected(index + 1); setEvidenceOpen(true); }}><FileText size={20} /><span><strong>{name}</strong><small>PDF · Sample source · {index === 1 ? '6' : '12'} passages</small></span><span className="rm-indexed">Sample indexed</span><ArrowRight size={16} /></button>)}</div>{notice && <p role="status" className="rm-notice">{notice}</p>}</section>}

        {page === 'Monitor' && <section className="rm-generic-page"><div className="rm-page-heading rm-heading-inline"><div><h1>Monitor</h1><p>Request timing and activity · illustrative sample</p></div><label className="rm-range">Time range<select value={range} onChange={(event) => setRange(event.target.value)}><option>24 hours</option><option>7 days</option><option>30 days</option></select></label></div><div className="rm-monitor-state"><Gauge size={18} /><div><strong>Sample telemetry</strong><span>This chart is illustrative and is not live service data.</span></div></div><div className="rm-monitor-chart"><div><h2>Answer latency</h2><span>Seconds · {range}</span></div><svg viewBox="0 0 680 190" role="img" aria-label="Illustrative answer latency chart"><path d="M30 145 C95 130 98 78 157 92 S227 137 278 104 S340 41 390 65 S445 125 500 90 S584 106 650 35" fill="none" stroke="#367bba" strokeWidth="3"/><path d="M30 160H650M30 115H650M30 70H650M30 25H650" stroke="#dbe2e4" strokeWidth="1"/><text x="30" y="182">00:00</text><text x="304" y="182">12:00</text><text x="610" y="182">24:00</text></svg><div className="rm-legend"><span><i className="blue" />Retrieval</span><span><i className="amber" />Generation</span></div></div><div className="rm-monitor-events"><h2>Recent activity</h2><p>No live events in this preview. Sample query above shows an illustrative retrieval time.</p></div></section>}

        {page === 'Settings' && <section className="rm-generic-page"><div className="rm-page-heading"><h1>Settings</h1><p>Provider choices shown here are preview-only and do not change your configuration.</p></div><div className="rm-settings-section"><h2>Answer provider</h2><label>Provider<select defaultValue="configured"><option value="configured">From app configuration</option><option>OpenAI compatible</option><option>Local endpoint</option></select></label><label>Model<input defaultValue="Configured by the app" readOnly /></label><p>Credentials are managed by the app and are never shown in this preview.</p></div><div className="rm-settings-section"><h2>Answer behavior</h2><label className="rm-check"><input type="checkbox" defaultChecked /> Include source citations</label><label className="rm-check"><input type="checkbox" defaultChecked /> Require evidence for answers</label></div><div className="rm-settings-actions"><button type="button" className={saved ? 'saved' : ''} onClick={() => setSaved(true)}>{saved ? <><Check size={15} /> Preview saved</> : 'Save preview settings'}</button></div></section>}

        <nav className="rm-bottom-nav" aria-label="Main navigation">{navigation.map(({ label, icon: Icon }) => <button type="button" key={label} className={page === label ? 'active' : ''} aria-current={page === label ? 'page' : undefined} onClick={() => setPage(label)}><Icon size={17} /><span>{label}</span></button>)}</nav>
      </main>
    </div>
  );
}
