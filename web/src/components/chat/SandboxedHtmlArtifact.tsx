'use client';

import { useState, useRef, useEffect } from 'react';
import { Check, Copy } from 'lucide-react';
import { DoubleBezelCard } from './DoubleBezelCard';

export interface SandboxedHtmlArtifactProps {
  html: string;
  title?: string;
  className?: string;
}

export function generateArtifactSrcDoc(html: string): string {
  const tailwindScript = '<script src="https://cdn.tailwindcss.com"></script>';
  const meridianStyles = `<style>
  :root {
    --surface: #070809;
    --surface-raised: #121316;
    --surface-sunken: #000000;
    --border: rgba(255, 255, 255, 0.1);
    --text: #EDEDED;
    --text-muted: #A1A1AA;
    --accent: #38BDF8;
  }
  *, *::before, *::after {
    box-sizing: border-box;
  }
  body {
    margin: 0;
    padding: 1rem;
    background-color: #070809;
    color: #EDEDED;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
</style>`;

  const trimmed = html.trim();
  const isFullDoc = /<!doctype html>|<html[\s>]/i.test(trimmed);

  if (isFullDoc) {
    if (/<head[\s>]/i.test(trimmed)) {
      return trimmed.replace(/<head[\s>]/i, (match) => `${match}\n${tailwindScript}\n${meridianStyles}`);
    }
    return `${tailwindScript}\n${meridianStyles}\n${trimmed}`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${tailwindScript}
  ${meridianStyles}
</head>
<body>
${trimmed}
</body>
</html>`;
}

export function SandboxedHtmlArtifact({
  html,
  title = 'Interactive Widget',
  className = '',
}: SandboxedHtmlArtifactProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(html);
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Ignore clipboard write failures in sandboxed or unsupported environments
    }
  };

  const srcDoc = generateArtifactSrcDoc(html);

  return (
    <DoubleBezelCard className={`my-3 ${className}`}>
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-white/10 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-200">{title}</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-zinc-800 text-zinc-400 border border-zinc-700">
            HTML
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors focus-machined cursor-pointer"
          aria-label="Copy Code"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy Code</span>
            </>
          )}
        </button>
      </div>

      <iframe
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        title={title}
        className="w-full h-80 border-0 rounded-lg bg-zinc-950"
      />
    </DoubleBezelCard>
  );
}
