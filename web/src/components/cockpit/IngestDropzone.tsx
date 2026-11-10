import React, { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../services/api';
import type { DocumentUploadResult } from '../../types/api';
import { FilePreviewItem } from './FilePreviewItem';

const ACCEPTED = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const extensionFor = (mime: string): string | null => {
  switch (mime) {
    case 'application/pdf':
      return '.pdf';
    case 'text/plain':
      return '.txt';
    case 'text/markdown':
    case 'text/x-markdown':
      return '.md';
    case 'text/xml':
      return '.xml';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return '.docx';
    default:
      return null;
  }
};

export const IngestDropzone: React.FC<{ tenantId?: string }> = ({ tenantId = 'default' }) => {
  const [dragOver, setDragOver] = useState(false);
  const [items, setItems] = useState<DocumentUploadResult[]>([]);
  const [uploading, setUploading] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const cleanup = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
    };
    window.addEventListener('dragleave', cleanup);
    window.addEventListener('drop', cleanup);
    return () => {
      window.removeEventListener('dragleave', cleanup);
      window.removeEventListener('drop', cleanup);
    };
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!e.dataTransfer) return;
    const files = Array.from(e.dataTransfer.files);
    const anyAccepted = files.some((f) => ACCEPTED.includes(f.type) || extensionFor(f.type) !== null);
    if (anyAccepted) {
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }
  }, []);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const submitFiles = useCallback(
    async (files: File[]) => {
      setUploading((prev) => new Set(prev).add('batch'));
      setError(null);
      try {
        const res = await api.uploadDocuments(files, tenantId);
        setItems((prev) => [...res.results, ...prev]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setError(msg);
      } finally {
        setUploading((prev) => {
          const n = new Set(prev);
          n.delete('batch');
          return n;
        });
      }
    },
    [tenantId],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (!e.dataTransfer) return;
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        ACCEPTED.includes(f.type) || extensionFor(f.type) !== null,
      );
      if (files.length === 0) return;
      void submitFiles(files);
    },
    [submitFiles],
  );

  const onSubmitClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;
      void submitFiles(files);
      e.target.value = '';
    },
    [submitFiles],
  );

  return (
    <div className="mt-8">
      <div
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onSubmitClick}
        role="button"
        aria-label="Drop files to ground your answers"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSubmitClick();
          }
        }}
        className={[
          'cockpit-chip flex flex-col items-center justify-center gap-2 rounded-sm border-2 border-dashed px-8 py-6 text-center transition-colors duration-200',
          dragOver
            ? 'border-accent bg-accent-wash'
            : 'border-hair-strong bg-surface hover:border-accent hover:bg-surface-sunken',
        ].join(' ')}
      >
        <span className="text-body text-ink">📁 Drop files here to ground your answers</span>
        <span className="text-micro text-muted">PDF · MD · TXT · DOCX</span>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED.join(',')}
          multiple
          onChange={onFileSelect}
          className="hidden"
        />
        {!dragOver && (
          <span className="text-micro text-muted">
            {items.length} file{items.length === 1 ? '' : 's'} queued
          </span>
        )}
      </div>

      {error && (
        <p className="mt-3 text-micro text-fail" role="alert">
          {error}
        </p>
      )}

      {items.length > 0 && (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {items.map((item, i) => (
            <FilePreviewItem key={`${item.document_id ?? i}-${item.filename}`} result={item} />
          ))}
          {uploading.has('batch') && (
            <div className="flex items-center gap-2 rounded-sm border border-hairline bg-surface px-3 py-2 text-micro text-muted">
              Uploading...
            </div>
          )}
        </div>
      )}
    </div>
  );
};
