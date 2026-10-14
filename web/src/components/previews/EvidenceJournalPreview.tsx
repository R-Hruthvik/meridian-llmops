import { useState, type FormEvent } from 'react';
import { Activity, ArrowDownToLine, ArrowUpRight, BookOpenText, Check, ChevronDown, Clock3, FileText, LibraryBig, MessageSquareText, Plus, Search, Settings2, Sparkles, X } from 'lucide-react';
import './EvidenceJournalPreview.css';

type Page = 'Ask' | 'Sources' | 'Monitor' | 'Settings';

const nav: { label: Page; icon: typeof MessageSquareText }[] = [
  { label: 'Ask', icon: MessageSquareText },
  { label: 'Sources', icon: LibraryBig },
  { label: 'Monitor', icon: Activity },
  { label: 'Settings', icon: Settings2 },
];

const documents = [
  { name: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks', type: 'PDF · 11 pages', indexed: 'Indexed 4 min ago', status: 'Ready' },
  { name: 'Vector Search Operations Guide', type: 'Markdown · 8 pages', indexed: 'Indexed yesterday', status: 'Ready' },
  { name: 'Evaluation Notes — October', type: 'PDF · 6 pages', indexed: 'Indexed Oct 12', status: 'Ready' },
];

export default function EvidenceJournalPreview() {
  const [page, setPage] = useState<Page>('Ask');
  const [activeCitation, setActiveCitation] = useState(1);
  const [question, setQuestion] = useState('How does retrieval improve factual answers, and what are its limits?');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [range, setRange] = useState('24 hours');
  const [provider, setProvider] = useState('OpenAI compatible');
  const [model, setModel] = useState('Configured model');

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    if (question.trim()) setNotice('Preview answer shown below. Connect a provider in Settings to run a live request.');
  };

  const copyAnswer = async () => {
    const answer = 'Retrieval-augmented generation can improve factuality by supplying relevant passages at answer time. It also makes evidence inspectable, but its quality depends on retrieval coverage and the generator’s faithfulness.';
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
            <div className="ej-composer-row"><textarea id="ej-question" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} /><button className="ej-primary" type="submit"><Sparkles size={16} /> Ask</button></div>
            <div className="ej-composer-meta"><span><BookOpenText size={15} /> Searching all 3 preview documents</span><button type="button" className="ej-quiet" onClick={() => setNotice('Source scope is set to all indexed documents in this preview.')}>Change scope <ChevronDown size={14} /></button></div>
          </form>

          <div className="ej-answer-layout">
            <article className="ej-answer">
              <div className="ej-answer-top"><div><span className="ej-answer-label">ANSWER</span><span className="ej-answer-time"><Clock3 size={13} /> 1.8 s · preview sample</span></div><button type="button" className="ej-quiet" onClick={copyAnswer}><ArrowDownToLine size={15} /> Copy</button></div>
              <h2>Retrieval adds evidence at answer time</h2>
              <p>Retrieval-augmented generation (RAG) pairs a language model with an external document index. The system first finds passages relevant to a question, then uses those passages as context while composing a response. <button className="ej-cite" type="button" aria-label="Open citation 1" aria-pressed={activeCitation === 1} onClick={() => setActiveCitation(1)}>[1]</button></p>
              <p>This can improve factual accuracy and make answers easier to verify, because readers can inspect the passages behind individual claims. It does not guarantee correctness: results still depend on whether retrieval finds the right evidence and whether the model represents it faithfully. <button className="ej-cite" type="button" aria-label="Open citation 2" aria-pressed={activeCitation === 2} onClick={() => setActiveCitation(2)}>[2]</button></p>
              <p>The practical trade-off is therefore evidence quality, retrieval coverage, and added latency—not simply a larger context window. <button className="ej-cite" type="button" aria-label="Open citation 3" aria-pressed={activeCitation === 3} onClick={() => setActiveCitation(3)}>[3]</button></p>
              <div className="ej-answer-footer"><span>Grounded in 3 passages across 2 documents</span><button type="button" className="ej-quiet" onClick={() => setNotice('Answer feedback recorded for this preview.')}>Give feedback</button></div>
            </article>
            <aside className="ej-evidence" aria-live="polite">
              <div className="ej-evidence-heading"><div><span className="ej-section-number">01</span><h2>Evidence</h2></div><span>3 passages</span></div>
              <p className="ej-evidence-intro">Select a citation to inspect the passage supporting that claim.</p>
              <button type="button" className={`ej-source-note ${activeCitation === 1 ? 'selected' : ''}`} onClick={() => setActiveCitation(1)}><span className="ej-note-index">[1]</span><span><strong>Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks</strong><small>Page 1 · Abstract</small><em>“We combine pre-trained parametric and non-parametric memory for language generation.”</em></span><ArrowUpRight size={15} /></button>
              <button type="button" className={`ej-source-note ${activeCitation === 2 ? 'selected' : ''}`} onClick={() => setActiveCitation(2)}><span className="ej-note-index">[2]</span><span><strong>Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks</strong><small>Page 2 · Introduction</small><em>“The provenance of knowledge remains inspectable through retrieved documents.”</em></span><ArrowUpRight size={15} /></button>
              <button type="button" className={`ej-source-note ${activeCitation === 3 ? 'selected' : ''}`} onClick={() => setActiveCitation(3)}><span className="ej-note-index">[3]</span><span><strong>Vector Search Operations Guide</strong><small>Page 4 · Retrieval limits</small><em>“Missed or weak matches can limit the context available to generation.”</em></span><ArrowUpRight size={15} /></button>
              <div className="ej-crossref"><span className="ej-crossref-line" /><div><strong>Across 2 documents</strong><p>The answer links the research paper’s method to an operational note on retrieval quality.</p></div></div>
            </aside>
          </div>
          {notice && <div className="ej-notice" role="status">{notice}<button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={14} /></button></div>}
        </section>}

        {page === 'Sources' && <section className="ej-page">
          <div className="ej-page-heading"><div><h1>Sources</h1></div><button className="ej-primary" type="button" onClick={() => document.getElementById('ej-file')?.click()}><Plus size={16} /> Add source</button><input id="ej-file" type="file" hidden onChange={(e) => setNotice(e.target.files?.[0] ? `${e.target.files[0].name} selected. This preview does not upload files.` : '')} /></div>
          <div className="ej-source-toolbar"><label className="ej-search"><Search size={17} /><span className="ej-sr-only">Search sources</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sources" /></label><span className="ej-result-count">{shownDocs.length} preview documents</span></div>
          <div className="ej-library-list">{shownDocs.map((doc) => <button type="button" className="ej-library-row" key={doc.name} onClick={() => setNotice(`${doc.name} · ${doc.type} · ${doc.indexed}`)}><span className="ej-file-icon"><FileText size={19} /></span><span className="ej-library-name"><strong>{doc.name}</strong><small>{doc.type}</small></span><span className="ej-library-status"><i />{doc.status}</span><span className="ej-library-time">{doc.indexed}</span><ArrowUpRight size={16} /></button>)}</div>
          {shownDocs.length === 0 && <div className="ej-empty">No preview documents match “{query}”.</div>}
          <p className="ej-data-note">All entries here are sample content for this design preview.</p>
          {notice && <div className="ej-notice" role="status">{notice}<button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={14} /></button></div>}
        </section>}

        {page === 'Monitor' && <section className="ej-page">
          <div className="ej-page-heading"><div><h1>Monitor</h1><span className="ej-subheading">Preview sample · no live service data</span></div><label className="ej-range-label">Time range<select value={range} onChange={(e) => setRange(e.target.value)}><option>24 hours</option><option>7 days</option><option>30 days</option></select></label></div>
          <div className="ej-metrics"><div><span>Median answer time</span><strong>1.8 <small>s</small></strong><em>Preview sample</em></div><div><span>Retrieval time</span><strong>320 <small>ms</small></strong><em>Preview sample</em></div><div><span>Requests</span><strong>128</strong><em>Preview sample</em></div></div>
          <div className="ej-chart-block"><div className="ej-chart-heading"><h2>Answer latency</h2><span>Seconds · {range}</span></div><div className="ej-chart"><div className="ej-axis"><span>4 s</span><span>2 s</span><span>0 s</span></div><svg viewBox="0 0 720 170" preserveAspectRatio="none" role="img" aria-label="Sample answer latency over time"><path className="ej-gridline" d="M0 15H720 M0 84H720 M0 154H720"/><path className="ej-chart-area" d="M0 126 L64 109 L128 115 L192 66 L256 89 L320 54 L384 74 L448 38 L512 79 L576 61 L640 83 L720 42 L720 154 L0 154 Z"/><path className="ej-chart-line" d="M0 126 L64 109 L128 115 L192 66 L256 89 L320 54 L384 74 L448 38 L512 79 L576 61 L640 83 L720 42"/></svg></div><div className="ej-chart-x"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>Now</span></div></div>
          <div className="ej-events"><div className="ej-chart-heading"><h2>Recent requests</h2><span>Sample activity</span></div><div className="ej-event-row"><span className="ej-event-dot good"/><strong>Answer returned</strong><span>Retrieval + generation</span><time>1.8 s</time></div><div className="ej-event-row"><span className="ej-event-dot good"/><strong>Answer returned</strong><span>Retrieval + generation</span><time>2.1 s</time></div><div className="ej-event-row"><span className="ej-event-dot warn"/><strong>No matching passages</strong><span>Retrieval</span><time>420 ms</time></div></div>
          <p className="ej-data-note">Illustrative sample metrics only; no live service data is connected in this preview.</p>
        </section>}

        {page === 'Settings' && <section className="ej-page">
          <div className="ej-page-heading"><div><h1>Settings</h1></div><span className="ej-sample"><span /> Preview values</span></div>
          <section className="ej-settings-section"><div className="ej-setting-title"><h2>Provider</h2><p>Values are illustrative. Live settings come from the configured workspace.</p></div><div className="ej-setting-fields"><label>Provider<select value={provider} onChange={(e) => setProvider(e.target.value)}><option>OpenAI compatible</option><option>Ollama</option><option>Anthropic</option></select></label><label>Model<input value={model} onChange={(e) => setModel(e.target.value)} onFocus={(e) => { if (e.target.value === 'Configured model') e.target.select(); }} /></label><label className="ej-wide">Endpoint URL<input placeholder="https://your-provider.example/v1" /></label></div></section>
          <section className="ej-settings-section"><div className="ej-setting-title"><h2>Credentials</h2><p>Secret values stay hidden. Configure credentials in the local environment.</p></div><div className="ej-secret-line"><span><strong>Provider API key</strong><small>Configured in environment · value not displayed</small></span><span className="ej-configured"><Check size={14} /> Environment setting</span></div></section>
          <details className="ej-settings-section ej-disclosure"><summary><span><strong>Answer behavior</strong><small>Timeout, result limit, and guardrails</small></span><ChevronDown size={17} /></summary><div className="ej-setting-fields"><label>Request timeout<input type="number" defaultValue={60} min={1} max={300} /></label><label>Maximum retrieved passages<input type="number" defaultValue={5} min={1} max={20} /></label></div></details>
          <div className="ej-settings-actions"><button type="button" className="ej-secondary" onClick={() => setNotice('Provider connection check is a preview-only interaction.')}>Test connection</button><button type="button" className="ej-primary" onClick={() => setNotice('Preview settings saved for this session. No backend configuration changed.')}>Save settings</button></div>
          {notice && <div className="ej-notice" role="status">{notice}<button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={14} /></button></div>}
        </section>}
      </main>
      <footer className="ej-footer"><span>Meridian</span><span>Evidence Journal design direction</span><span>Preview sample · not live service data</span></footer>
    </div>
  );
}
