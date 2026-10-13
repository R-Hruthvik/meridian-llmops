import { useEffect, useState } from 'react';
import type { ApiFailureDetail } from '../types/api';

/** App-wide notice for API errors, including failures caught by a surface loader. */
export function ApiErrorNotice() {
  const [failure, setFailure] = useState<ApiFailureDetail | null>(null);

  useEffect(() => {
    const handleFailure = (event: Event) => {
      setFailure((event as CustomEvent<ApiFailureDetail>).detail);
    };
    window.addEventListener('meridian:api-error', handleFailure);
    return () => window.removeEventListener('meridian:api-error', handleFailure);
  }, []);

  if (!failure) return null;

  return (
    <div className="flex items-start justify-between gap-4 border-b border-fail bg-fail-wash px-4 py-3 text-sm text-ink" role="alert" aria-live="assertive">
      <div>
        <p className="font-semibold">{failure.message}</p>
        {failure.action && <p className="mt-1 text-muted">{failure.action}</p>}
      </div>
      <button
        type="button"
        onClick={() => setFailure(null)}
        className="shrink-0 rounded-sm px-2 py-1 text-muted hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label="Dismiss API error"
      >
        Dismiss
      </button>
    </div>
  );
}
