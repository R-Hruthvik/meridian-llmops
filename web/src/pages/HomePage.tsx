import { useCallback, useRef, useState } from 'react';

import { useCockpitTelemetry } from '../hooks/useCockpitTelemetry';
import { FluidMembraneInput } from '../components/canvas/FluidMembraneInput';
import { FluidPointerCanvas } from '../components/canvas/FluidPointerCanvas';
import { EditorialMasthead } from '../components/cockpit/EditorialMasthead';
import { TelemetryHud } from '../components/cockpit/TelemetryHud';
import { PromptStarterBento } from '../components/cockpit/PromptStarterBento';
import { IngestDropzone } from '../components/cockpit/IngestDropzone';

const TENANT_ID = 'default';

export function HomePage(): React.JSX.Element {
  const { telemetry } = useCockpitTelemetry();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChipFill = useCallback(
    (q: string) => {
      setQuery(q);
      inputRef.current?.focus();
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    const text = query.trim();
    if (!text) return;
    setQuery('');
    document.dispatchEvent(
      new CustomEvent('meridian:home-query', {
        bubbles: true,
        detail: { query: text },
      }),
    );
  }, [query]);

  return (
    <>
      <a href="#main-content" className="skip-to-main">
        Skip to main content
      </a>
      <main id="main-content" className="relative min-h-screen bg-surface pb-32">
        <FluidPointerCanvas />
        <EditorialMasthead />

        <div className="mx-auto max-w-[1200px] px-6 border-t border-hairline">
          <div className="rounded-sm border border-hairline bg-surface-raised p-4">
            <TelemetryHud telemetry={telemetry} />
          </div>
        </div>

        <section
          aria-label="Input"
          className="mx-auto mt-2 max-w-[1200px] px-6 border-t border-hairline"
          style={{ minHeight: 'calc(52vh - 140px)' }}
        >
          <FluidMembraneInput
            inputRef={inputRef}
            isCenter
            value={query}
            placeholder="Ask anything about your corpus..."
            ariaLabel="Ask Meridian"
            onChange={setQuery}
            onSubmit={handleSubmit}
            colorRgb="37 99 235"
          />
        </section>

        <PromptStarterBento onChipFill={handleChipFill} />

        <IngestDropzone tenantId={TENANT_ID} />
      </main>
    </>
  );
}

export default HomePage;
