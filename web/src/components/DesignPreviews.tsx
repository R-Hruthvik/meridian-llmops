import { useEffect, useState } from 'react';
import RouteMapPreview from './previews/RouteMapPreview';
import EvidenceJournalPreview from './previews/EvidenceJournalPreview';
import SignalDeskPreview from './previews/SignalDeskPreview';
import OpenLibraryPreview from './previews/OpenLibraryPreview';
import FlightPlanPreview from './previews/FlightPlanPreview';
import './DesignPreviews.css';

const directions = [
  { id: 'route-map', label: 'Route Map', View: RouteMapPreview },
  { id: 'evidence-journal', label: 'Evidence Journal', View: EvidenceJournalPreview },
  { id: 'signal-desk', label: 'Signal Desk', View: SignalDeskPreview },
  { id: 'open-library', label: 'Open Library', View: OpenLibraryPreview },
  { id: 'flight-plan', label: 'Flight Plan', View: FlightPlanPreview },
];

export function DesignPreviews() {
  const initial = new URLSearchParams(window.location.search).get('direction');
  const [selected, setSelected] = useState(directions.some((item) => item.id === initial) ? initial! : directions[0].id);
  const active = directions.find((item) => item.id === selected)!;
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `Meridian · ${active.label} preview`;
    const params = new URLSearchParams(window.location.search);
    params.set('ui-previews', '1');
    params.set('direction', selected);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`);
    return () => { document.title = previousTitle; };
  }, [selected, active.label]);
  return <div className="design-previews">
    <header className="design-preview-picker">
      <div className="picker-title"><span>UI directions</span><h2>{active.label}</h2></div>
      <nav aria-label="Design directions">{directions.map((item, index) => <button key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><span>{String(index + 1).padStart(2, '0')}</span>{item.label}</button>)}</nav>
    </header>
    <active.View />
  </div>;
}
