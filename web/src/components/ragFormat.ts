export const formatLatency = (ms: number): { value: string; unit: string } => {
  if (!Number.isFinite(ms)) return { value: '—', unit: 'ms' };
  const rounded = Math.round(ms);
  if (Math.abs(rounded) < 1000) return { value: String(rounded), unit: 'ms' };
  return { value: (ms / 1000).toFixed(1), unit: 's' };
};

export const shortId = (id: string | undefined | null, keep = 8): string => {
  if (!id) return '—';
  if (id.length <= keep) return id;
  return `${id.slice(0, keep)}…`;
};
