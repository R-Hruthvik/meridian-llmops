import React from 'react';

interface SurfaceErrorBoundaryProps {
  /** The surface that failed, e.g. "Metrics". Names the failure. */
  label: string;
  children: React.ReactNode;
}

interface SurfaceErrorBoundaryState {
  error: Error | null;
}

/**
 * Contains a failure inside one surface. Every studio is a dynamic import, and
 * a dynamic import can fail for reasons that have nothing to do with the app: a
 * deploy that renames chunks, a proxy that 404s an old index.html, a tab that
 * went offline. Without a boundary React unmounts the entire tree on that throw
 * — the operator loses the top bar, the lens rail and the Ask canvas because one
 * dialog would not open.
 *
 * Remount it with a `key` to clear the failure.
 */
export class SurfaceErrorBoundary extends React.Component<
  SurfaceErrorBoundaryProps,
  SurfaceErrorBoundaryState
> {
  state: SurfaceErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): SurfaceErrorBoundaryState {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        data-testid="surface-error"
        role="alert"
        className="rounded border border-hairline bg-surface-raised p-4"
      >
        <div className="flex items-center gap-2">
          <span
            data-variant="fail"
            className="inline-flex items-center gap-1.5 rounded-pill bg-fail-wash px-2 py-0.5 font-mono text-[13px] font-bold uppercase tracking-[0.08em] text-fail"
          >
            {this.props.label} unavailable
          </span>
        </div>
        <p className="mt-2 break-words text-label text-muted">{error.message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 rounded-sm border border-hairline px-2.5 py-1 text-label font-semibold text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Reload workbench
        </button>
      </div>
    );
  }
}
