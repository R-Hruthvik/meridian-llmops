import React, { Suspense } from 'react';
import { SurfaceErrorBoundary } from './SurfaceErrorBoundary';
import { SurfaceFallback } from './SurfaceFallback';

interface LazySurfaceProps {
  /** The surface name, e.g. "Metrics". Used for both the wait and the failure. */
  label: string;
  children: React.ReactNode;
}

/**
 * The one way a deferred surface is mounted: pending and failed states included.
 * Going through this component is what makes it impossible to add a lazy studio
 * without a placeholder or a boundary — the two states that only ever appear
 * when something is wrong with the network.
 */
export const LazySurface: React.FC<LazySurfaceProps> = ({ label, children }) => (
  <SurfaceErrorBoundary label={label}>
    <Suspense fallback={<SurfaceFallback label={label} />}>{children}</Suspense>
  </SurfaceErrorBoundary>
);
