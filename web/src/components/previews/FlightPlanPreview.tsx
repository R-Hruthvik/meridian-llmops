import { useState } from 'react';
import { Activity, ArrowRight, BookOpen, Check, ChevronRight, FileText, MessageSquareText, Settings2 } from 'lucide-react';
import './FlightPlanPreview.css';

const nav = [['Ask', MessageSquareText], ['Sources', BookOpen], ['Monitor', Activity], ['Settings', Settings2]] as const;

export default function FlightPlanPreview() {
  const [section, setSection] = useState('Ask');
  const [sent, setSent] = useState(true);
  const [focus, setFocus] = useState(0);
  return <div className="fp-preview">
    <header className="fp-header"><a onClick={() => setSection('Ask')}><span>m</span> Meridian</a><nav aria-label="Preview navigation">{nav.map(([name, Icon]) => <button key={name} className={section === name ? 'is-active' : ''} onClick={() => setSection(name)}><Icon size={16}/>{name}</button>)}</nav><span className="fp-workspace">Workspace <strong>default</strong></span></header>
    {section === 'Ask' ? <main className="fp-content"><div className="fp-title"><h1>Ask</h1><span>Preview sample</span></div><section className="fp-composer"><label htmlFor="fp-query">Question</label><div><textarea id="fp-query" rows={2} defaultValue="How does retrieval connect search results to a grounded answer?"/><button onClick={() => setSent(true)} aria-label="Ask question"><ArrowRight size={18}/></button></div><small>Scope: all indexed sources</small></section>
      {sent && <section className="fp-answer"><div className="fp-answer-head"><span><Check size={15}/> Answer</span><small>Preview sample · 2 sources</small></div><h2>Retrieval supplies evidence before the model writes.</h2><p>The system searches indexed passages for relevant material, then includes those passages in the model’s context. The research paper describes the retrieval and generation stages; Meridian’s ingestion notes explain how source files become searchable chunks.</p>
        <div className="fp-flow" aria-label="Evidence path">{[['01','Research paper','Retrieval finds relevant passages','p. 6 · passage 04'],['02','Ingestion notes','Documents become indexed chunks','§ Passage sizing'],['03','Grounded response','Evidence is used in the prompt','2 supporting passages']].map(([n,title,desc,meta],i)=><button key={n} className={`fp-step${focus===i?' is-selected':''}`} onClick={()=>setFocus(i)}><span className="fp-step-num">{n}</span><span className="fp-step-copy"><strong>{title}</strong><small>{desc}</small><em>{meta}</em></span>{i<2&&<ChevronRight className="fp-chevron" size={16}/>}</button>)}</div>
        <div className="fp-detail"><FileText size={17}/><div><strong>{focus===0?'Research paper':focus===1?'Ingestion notes':'Answer construction'}</strong><p>{focus===0?'“The retrieved documents are then used to condition the language model.”':focus===1?'“Each source is split into passages that can be retrieved independently.”':'Both source passages support the answer above. Select a source step to inspect its contribution.'}</p></div><button onClick={()=>setSection('Sources')}>Open source <ArrowRight size={14}/></button></div>
      </section>}
    </main> : <main className="fp-content"><div className="fp-title"><h1>{section}</h1><span>Preview sample</span></div>{section==='Sources'?<FlightPlanSources onAsk={()=>setSection('Ask')}/>:section==='Monitor'?<FlightPlanMonitor/>:<FlightPlanSettings/>}</main>}
    <footer className="fp-footer"><span>Meridian · interface direction preview</span><a onClick={()=>setSection('Ask')}>Back to Ask</a></footer>
    <nav className="fp-mobile" aria-label="Mobile navigation">{nav.map(([name,Icon])=><button key={name} aria-current={section===name?'page':undefined} onClick={()=>setSection(name)}><Icon size={18}/><span>{name}</span></button>)}</nav>
  </div>;
}

function FlightPlanSources({onAsk}:{onAsk:()=>void}) {
  const [query,setQuery]=useState('');
  const [notice,setNotice]=useState('');
  const docs=['Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks','Meridian ingestion and chunking notes','Vector and graph retrieval design'].filter((item)=>item.toLowerCase().includes(query.toLowerCase()));
  return <section className="fp-library"><div className="fp-library-toolbar"><label><span className="fp-sr-only">Search sources</span><input aria-label="Search sources" placeholder="Search sources" value={query} onChange={(e)=>setQuery(e.target.value)}/></label><button onClick={()=>setNotice('Add source is available in the connected app. These documents are preview samples.')}>Add source <ArrowRight size={14}/></button></div>{notice&&<p role="status" className="fp-notice">{notice}</p>}<p className="fp-library-count">{docs.length} sample documents</p>{docs.map((doc,i)=><article className="fp-document" key={doc}><FileText size={18}/><div><strong>{doc}</strong><small>{i===0?'PDF · 12 pages':i===1?'Markdown · 8 pages':'PDF · 16 pages'}</small></div><span>Preview sample</span><button aria-label={`Ask about ${doc}`} onClick={onAsk}><ArrowRight size={15}/></button></article>)}</section>;
}

function FlightPlanMonitor() {
  const [range,setRange]=useState('24 hours');
  return <section className="fp-monitor"><div className="fp-monitor-toolbar"><span>Illustrative data · no live service connection</span><label>Time range<select value={range} onChange={(e)=>setRange(e.target.value)}><option>24 hours</option><option>7 days</option><option>30 days</option></select></label></div><div className="fp-monitor-stats"><div><span>Requests</span><strong>128</strong></div><div><span>Median response</span><strong>1.8 s</strong></div><div><span>Retrieval</span><strong>320 ms</strong></div></div><section className="fp-chart"><h2>Answer latency</h2><p>Seconds · {range}</p><svg viewBox="0 0 720 180" role="img" aria-label="Preview sample answer latency chart"><path d="M0 20H720 M0 85H720 M0 150H720"/><polyline points="0,122 90,103 180,110 270,70 360,80 450,38 540,73 630,57 720,32"/></svg><div><span>00:00</span><span>12:00</span><span>Now</span></div></section><div className="fp-request-list"><h2>Recent requests</h2><div><span>Answer returned</span><small>2 sources · 1.8 s</small></div><div><span>Answer returned</span><small>1 source · 2.1 s</small></div><div><span>No matching passages</span><small>retrieval · 420 ms</small></div></div></section>;
}

function FlightPlanSettings() {
  const [notice,setNotice]=useState('');
  return <section className="fp-settings"><div className="fp-settings-group"><h2>Language model</h2><p>Provider values come from the app configuration.</p><label>Provider<input value="Configured by the app" readOnly/></label><label>Model<input value="Configured by the app" readOnly/></label><label>API key<span>Stored in the environment · value hidden</span></label></div><div className="fp-settings-group"><h2>Answer behavior</h2><label>Request timeout<select defaultValue="60"><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="120">120 seconds</option></select></label><label className="fp-check"><input type="checkbox" defaultChecked/> Require source evidence</label></div><div className="fp-settings-actions"><button onClick={()=>setNotice('This preview is not connected to the app backend.')}>Test saved provider</button><button onClick={()=>setNotice('Preview settings saved for this page only.')}>Save settings</button></div>{notice&&<p role="status" className="fp-notice">{notice}</p>}</section>;
}
