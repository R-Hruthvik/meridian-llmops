import React from 'react';

import type { DocumentUploadResult } from '../../types/api';

export interface FilePreviewItemProps {
  result: DocumentUploadResult;
}

export const FilePreviewItem: React.FC<FilePreviewItemProps> = ({ result }) => {
  const isFail = result.error !== null || result.status === 'rejected';
  const isWarn = result.status === 'indexed_with_warnings' || result.status === 'duplicate';

  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-hairline bg-surface-raised px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-body text-ink">{result.filename}</p>
        <p className="truncate text-micro text-muted">
          {result.chunks} chunks · {result.pages} pages
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className={[
            'num rounded-sm px-1.5 py-0.5',
            isFail
              ? 'border border-hairline bg-fail-wash text-fail'
              : isWarn
                ? 'border border-hairline bg-warn-wash text-warn'
                : 'border border-hairline bg-ok-wash text-ink',
          ].join(' ')}
        >
          {result.status.replace('_', ' ')}
        </span>
        {result.error && (
          <span className="truncate text-micro text-faint" title={result.error}>
            {result.error}
          </span>
        )}
      </div>
    </div>
  );
};
