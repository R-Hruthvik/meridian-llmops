import React from 'react';

interface SurfaceFallbackProps {
  /** The surface being fetched, e.g. "Metrics". Names the wait, never a spinner alone. */
  label: string;
}

/**
 * The placeholder a lazily-loaded surface shows while its chunk is in flight.
 * Same visual language as every other loading state in the app (hairline box,
 * raised surface, muted label) so a deferred surface never reads as a broken or
 * empty one. `role="status"` announces the wait without moving focus.
 */
export const SurfaceFallback: React.FC<SurfaceFallbackProps> = ({ label }) => (
  <div
    data-testid="surface-fallback"
    role="status"
    className="rounded border border-hairline bg-surface-raised p-4 text-label font-semibold text-muted"
  >
    Loading {label}…
  </div>
);
