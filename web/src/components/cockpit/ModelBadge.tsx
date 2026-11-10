export interface ModelBadgeProps {
  model: string | null;
  bm25Status: number | null;
  bm25Fallback: boolean;
}

export const ModelBadge: React.FC<ModelBadgeProps> = ({ model, bm25Status, bm25Fallback }) => {
  const bm25Chip = (() => {
    if (bm25Status === null) {
      return (
        <span className="num flex items-center gap-1 rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-micro text-faint">
          —
        </span>
      );
    }
    if (bm25Fallback) {
      return (
        <span className="num flex items-center gap-1 rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-micro text-warn">
          Fallback
        </span>
      );
    }
    return (
      <span className="num flex items-center gap-1 rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-micro text-ink">
        Indexed ({bm25Status.toLocaleString()})
      </span>
    );
  })();

  return (
    <div className="flex flex-col gap-1 rounded-sm border border-hairline bg-surface px-3 py-2.5">
      <span className="text-micro text-faint" aria-hidden="true">active model</span>
      <span
        className="num rounded-sm border border-hairline bg-accent-wash px-1.5 py-0.5 text-accent-ink"
        aria-label={model ? `Active model: ${model}` : 'Active model: not configured'}
      >
        {model ?? 'Not configured'}
      </span>
      <div className="flex items-center gap-1.5 pt-1">{bm25Chip}</div>
    </div>
  );
};
