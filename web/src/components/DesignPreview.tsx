import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, Check, ChevronDown, CircleHelp, Command, Database, FileText, Search, Settings2, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import './DesignPreview.css';

type Section = 'Ask' | 'Sources' | 'Operations' | 'Settings';

const destinations: { name: Section; icon: typeof BookOpen }[] = [
  { name: 'Ask', icon: CircleHelp },
  { name: 'Sources', icon: BookOpen },
  { name: 'Operations', icon: SlidersHorizontal },
  { name: 'Settings', icon: Settings2 },
];

const sectionFromHash = (): Section => {
  const name = window.location.hash.slice(2).split('/')[0];
  return destinations.find(({ name: section }) => section.toLowerCase() === name)?.name ?? 'Ask';
};

export function DesignPreview() {
  const [section, setSection] = useState<Section>(sectionFromHash);
  const [question, setQuestion] = useState('How does Meridian keep answers grounded in source documents?');
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    const followHistory = () => setSection(sectionFromHash());
    window.addEventListener('popstate', followHistory);
    window.addEventListener('hashchange', followHistory);
    return () => {
      window.removeEventListener('popstate', followHistory);
      window.removeEventListener('hashchange', followHistory);
    };
  }, []);

  const navigate = (next: Section) => {
    setSection(next);
    window.history.pushState(null, '', `?design-preview=1#/${next.toLowerCase()}`);
  };

  return (
    <div className="preview-shell">
      <aside className="preview-sidebar">
        <a className="preview-brand" href="?design-preview=1#/ask" onClick={(event) => { event.preventDefault(); navigate('Ask'); }}>
          <span className="brand-mark">m</span><span>Meridian</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Main navigation" className="preview-nav">
          {destinations.map(({ name, icon: Icon }) => (
            <a key={name} href={`?design-preview=1#/${name.toLowerCase()}`} aria-current={section === name ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigate(name); }}>
              <Icon size={18} strokeWidth={1.7} /><span>{name}</span>{name === 'Sources' && <span className="nav-count">12</span>}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-switch"><span className="workspace-avatar">N</span><span className="workspace-name">Northstar Labs<small>Personal workspace</small></span><ChevronDown size={15} /></div>
          <div className="connection-state"><span className="state-dot" /> Demo workspace <span>Preview</span></div>
        </div>
      </aside>

      <div className="preview-main">
        <header className="preview-header">
          <div className="mobile-brand"><span className="brand-mark">m</span> Meridian</div>
          <div className="breadcrumb"><span>Northstar Labs</span><span className="crumb-divider">/</span><strong>{section}</strong></div>
          <button className="search-trigger" type="button" aria-label="Search workspace"><Search size={16} /><span>Search anything</span><kbd>⌘ K</kbd></button>
          <button className="avatar-button" type="button" aria-label="Workspace profile">AR</button>
        </header>

        <main className="preview-content">
          {section === 'Ask' && <AskPage question={question} setQuestion={setQuestion} answered={answered} setAnswered={setAnswered} navigate={navigate} />}
          {section === 'Sources' && <SourcesPage />}
          {section === 'Operations' && <OperationsPage />}
          {section === 'Settings' && <SettingsPage />}
        </main>
        <nav aria-label="Mobile navigation" className="preview-mobile-nav">
          {destinations.map(({ name, icon: Icon }) => <button key={name} type="button" aria-current={section === name ? 'page' : undefined} onClick={() => navigate(name)}><Icon size={19} /><span>{name}</span></button>)}
        </nav>
      </div>
    </div>
  );
}

function AskPage({ question, setQuestion, answered, setAnswered, navigate }: { question: string; setQuestion: (value: string) => void; answered: boolean; setAnswered: (value: boolean) => void; navigate: (section: Section) => void }) {
  return <>
    <div className="page-heading"><div><p className="eyebrow">YOUR REFERENCE WORKSPACE</p><h1>Ask Meridian</h1><p className="page-intro">Clear answers, grounded in the documents you trust.</p></div><button className="quiet-button" type="button"><Command size={16} /> Shortcuts</button></div>
    <section className="ask-panel" aria-label="Ask a question">
      <label htmlFor="preview-question">What would you like to know?</label>
      <textarea id="preview-question" value={question} onChange={(event) => { setQuestion(event.target.value); setAnswered(false); }} rows={3} />
      <div className="composer-footer"><button className="source-scope" type="button" onClick={() => navigate('Sources')}><BookOpen size={15} /> All 12 sources <ChevronDown size={14} /></button><button className="ask-button" type="button" onClick={() => setAnswered(true)}>Ask question <span>↗</span></button></div>
    </section>
    {answered ? <section className="answer-section" aria-live="polite"><div className="answer-meta"><span className="answer-check"><Check size={14} /></span><span>ANSWERED FROM YOUR SOURCES</span><span className="answer-time">Just now</span></div><h2>Answers are tied back to the documents that support them.</h2><p>Meridian retrieves relevant passages from your source library, then uses that evidence to shape the response. You can open each citation to check the original context.</p><div className="citation-row"><button className="citation" type="button" onClick={() => navigate('Sources')}><span>1</span><span><strong>Retrieval overview</strong><small>Section 2 · Grounded responses</small></span><ArrowUpRight size={15} /></button><button className="citation" type="button" onClick={() => navigate('Sources')}><span>2</span><span><strong>Product handbook</strong><small>Section 4 · Source attribution</small></span><ArrowUpRight size={15} /></button></div></section> : <div className="ask-hint"><span className="hint-rule" />Try asking about a process, a policy, or a specific detail in your documents.</div>}
    <div className="recent-heading"><h2>Recently added</h2><button type="button" className="text-link" onClick={() => navigate('Sources')}>Browse sources <ArrowUpRight size={14} /></button></div>
    <div className="recent-list"><div className="recent-row"><span className="file-icon"><FileText size={17} /></span><span className="recent-name">Product handbook<small>Updated today · 18 pages</small></span><span className="source-status">Ready</span></div><div className="recent-row"><span className="file-icon"><FileText size={17} /></span><span className="recent-name">Retrieval overview<small>Updated yesterday · 9 pages</small></span><span className="source-status">Ready</span></div></div>
  </>;
}

function SourcesPage() {
  const [filter, setFilter] = useState('All sources');
  return <><div className="page-heading"><div><p className="eyebrow">YOUR KNOWLEDGE LIBRARY</p><h1>Sources</h1><p className="page-intro">Documents Meridian can use to answer your questions.</p></div><button className="ask-button add-source" type="button">Add sources <span>＋</span></button></div><div className="sources-toolbar"><div className="tabs" role="tablist" aria-label="Source filters">{['All sources', 'Recently added', 'Needs attention'].map((item) => <button type="button" role="tab" aria-selected={filter === item} onClick={() => setFilter(item)} key={item}>{item}</button>)}</div><button className="quiet-button" type="button"><Search size={16} /> Search sources</button></div><div className="source-table"><div className="source-table-head"><span>DOCUMENT</span><span>ADDED</span><span>STATUS</span></div>{[['Product handbook','Today','Ready'],['Retrieval overview','Yesterday','Ready'],['Security and privacy guide','Oct 10','Ready'],['Customer onboarding notes','Oct 08','Processing']].filter((row) => filter !== 'Needs attention' || row[2] === 'Processing').map(([title,date,status], index) => <button className="source-table-row" type="button" key={title}><span className="table-document"><span className="file-icon"><FileText size={17} /></span><span>{title}<small>{index % 2 ? 'PDF · 9 pages' : 'PDF · 18 pages'}</small></span></span><span>{date}</span><span className={`source-status ${status === 'Processing' ? 'processing' : ''}`}>{status}</span></button>)}</div><div className="library-foot"><span>12 sources · 246 passages</span><button type="button" className="text-link"><Database size={14} /> Index details</button></div></>;
}

function OperationsPage() {
  const [tab, setTab] = useState('Overview');
  return <><div className="page-heading"><div><p className="eyebrow">WORKSPACE HEALTH</p><h1>Operations</h1><p className="page-intro">A quiet view of how your knowledge workspace is running.</p></div></div><div className="tabs operations-tabs" role="tablist" aria-label="Operations sections">{['Overview','Safety rules','Review queue','Usage'].map((item) => <button type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} key={item}>{item}</button>)}</div><section className="operation-summary"><div className="operation-intro"><span className="operation-icon"><ShieldCheck size={20} /></span><div><h2>{tab === 'Overview' ? 'Everything is in good shape' : tab}</h2><p>{tab === 'Overview' ? 'Your sources are indexed and ready to use.' : 'This section is part of the interactive design preview.'}</p></div></div><span className="source-status">All systems ready</span></section><div className="operation-list"><div><span>Source index</span><strong>12 documents <small>· Updated recently</small></strong></div><div><span>Review queue</span><strong>All caught up</strong></div><div><span>Safety rules</span><strong>3 active rules</strong></div></div></>;
}

function SettingsPage() {
  return <><div className="page-heading"><div><p className="eyebrow">WORKSPACE PREFERENCES</p><h1>Settings</h1><p className="page-intro">Manage how Meridian connects to your language model.</p></div></div><section className="settings-section"><div className="settings-copy"><h2>Language model</h2><p>Choose the provider Meridian uses to write answers.</p></div><div className="settings-field"><label htmlFor="provider">Provider</label><select id="provider" defaultValue="openai"><option value="openai">OpenAI</option><option value="custom">Custom endpoint</option></select><label htmlFor="model">Model</label><input id="model" defaultValue="gpt-4o-mini" /><button className="quiet-button" type="button">Test connection</button></div></section><section className="settings-section"><div className="settings-copy"><h2>Workspace access</h2><p>API credentials stay private to this browser session.</p></div><div className="access-state"><span className="state-dot" /> Demo access enabled</div></section></>;
}
