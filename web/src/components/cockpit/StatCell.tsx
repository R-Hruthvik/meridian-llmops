import React from 'react';

export interface StatCellProps {
  label: string;
  value: number | null;
  sub?: string;
  fallback?: boolean;
  detail?: string;
  ariaLabel: string;
}

/** One telemetry stat cell. Value is mono; `null` renders `— unavailable`.
 * Fallback is shown as a faint dot; color only decorates the state, never the
 * sole carrier of meaning (text + dot present in every state). */
export const StatCell: React.FC<StatCellProps> = ({ label, value, sub, fallback, detail, ariaLabel }) => (
  <div className="cockpit-stat flex min-w-0 flex-col gap-1 rounded-sm px-3 py-2.5">
    <span className="text-micro text-faint" aria-hidden="true">
      {label}
    </span>
    <div className="flex items-baseline gap-2">
      {value === null ? (
        <span className="num text-faint" aria-label={ariaLabel}>—</span>
      ) : (
        <>
          <span className="num text-ink" aria-label={ariaLabel}>
            {value.toLocaleString()}
          </span>
          {fallback && (
            <span className="size-1.5 rounded-full bg-faint" aria-label={detail ?? `${label} is served by fallback`} />
          )}
        </>
      )}
    </div>
    {sub && (
      <span className="text-micro text-faint" aria-hidden="true">
        {sub}
      </span>
    )}
    {detail && !fallback && value !== null && (
      <span className="text-micro text-muted" aria-hidden="true">
        {detail}
      </span>
    )}
  </div>
);
