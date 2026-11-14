/**
 * Meridian — Ask workspace.
 *
 * One surface, two states:
 *
 *   Launchpad  A calm hero canvas — editorial headline, three sample prompts,
 *              and the composer sitting in the middle of the page.
 *   Thread     The composer morphs (`layoutId="ask-composer"`) into a floating
 *              bottom capsule; answers arrive with a live pipeline ribbon,
 *              grounded Markdown and inline citation chips.
 *
 * Clicking a citation chip opens the Evidence Lens and highlights that chunk.
 */
import { AnimatePresence, motion } from 'framer-motion';
import DOMPurify from 'dompurify';
import {
  ArrowUp,
  Command,
  Files,
  FlaskConical,
  Loader2,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Wrench,
} from 'lucide-react';
import { marked } from 'marked';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { StatusBadge } from '../../components/shell/StatusBadge';
import SpotlightCard from '../../components/ui/SpotlightCard';
import { useAuth } from '../../core/auth';
import {
  prefersReducedMotion,
  SPRING_GENTLE,
  SPRING_SNAPPY,
  STAGGER_CONTAINER,
  STAGGER_ITEM,
} from '../../core/motion';
import type { QueryResponse, SearchResult, VerificationSummary } from '../../core/types';
import EvidenceLens, { verificationLabel, verificationTone } from './EvidenceLens';
import PipelinePulse from './PipelinePulse';
import {
  CONTROL_LIMITS,
  DEFAULT_ASK_CONTROLS,
  SAMPLE_PROMPTS,
  type AskControls,
  type AskMessage,
  type EvidenceLensState,
  type EvidenceTab,
} from './types';
import { useAskStream } from './useAskStream';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad|ipod/i.test(`${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`);

/* -------------------------------------------------------------------------- */
/* Markdown → safe HTML with interactive citation chips                       */
/* -------------------------------------------------------------------------- */

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'em',
    'b',
    'i',
    'del',
    's',
    'code',
    'pre',
    'ul',
    'ol',
    'li',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'h4',
    'hr',
    'a',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'sup',
    'sub',
  ],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'colspan', 'rowspan'],
  // No user-supplied buttons: the only buttons in an answer are ours.
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'img', 'svg'],
  FORBID_ATTR: ['style', 'onerror', 'onload', 'srcdoc'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

const CITATION_CHIP_CLASS =
  'relative mx-[1px] inline-flex h-[1.05rem] min-w-[1.05rem] -translate-y-[1px] items-center justify-center rounded-full border border-accent/30 bg-accent-soft px-[3px] text-[9.5px] font-semibold leading-none text-accent transition-colors hover:border-accent hover:bg-accent hover:text-accent-contrast focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 after:absolute after:-top-1 after:-bottom-1 after:left-0 after:right-0 after:content-[""]';

/** Id of the portalled preview, referenced by `aria-describedby` on the focused chip. */
const CITATION_PREVIEW_ID = 'ask-citation-preview';

const CITATION_PATTERN = /\[(\d+(?:\s*[,–—-]\s*\d+)*)\]/;

function createCitationChip(doc: Document, citation: number): HTMLButtonElement {
  const chip = doc.createElement('button');
  chip.type = 'button';
  chip.dataset.citation = String(citation);
  chip.className = CITATION_CHIP_CLASS;
  chip.setAttribute('aria-label', `Open evidence ${citation}`);
  chip.setAttribute('title', `Citation ${citation}`);
  chip.textContent = String(citation);
  return chip;
}

function replaceCitationsInText(doc: Document, node: Text): void {
  const value = node.nodeValue ?? '';
  const pattern = new RegExp(CITATION_PATTERN.source, 'g');
  const fragment = doc.createDocumentFragment();
  let cursor = 0;
  let match = pattern.exec(value);

  while (match) {
    if (match.index > cursor) {
      fragment.appendChild(doc.createTextNode(value.slice(cursor, match.index)));
    }
    const numbers = (match[1] ?? '')
      .split(/\s*[,–—-]\s*/)
      .map((part) => Number(part))
      .filter((part) => Number.isFinite(part) && part > 0);

    numbers.forEach((citation, index) => {
      if (index > 0) fragment.appendChild(doc.createTextNode(' '));
      fragment.appendChild(createCitationChip(doc, citation));
    });

    cursor = pattern.lastIndex;
    match = pattern.exec(value);
  }

  if (cursor < value.length) fragment.appendChild(doc.createTextNode(value.slice(cursor)));
  node.replaceWith(fragment);
}

/** Walk the sanitized DOM once and swap `[n]` markers for real buttons. */
function injectCitationChips(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const body = doc.body;
  if (!body) return html;

  body.querySelectorAll('a').forEach((anchor) => {
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  });

  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    if (!CITATION_PATTERN.test(text.nodeValue ?? '')) continue;
    const parent = text.parentElement;
    if (parent && parent.closest('pre, code, a')) continue;
    targets.push(text);
  }

  for (const target of targets) replaceCitationsInText(doc, target);

  // Wide answer tables must scroll inside the card, not push the page sideways.
  body.querySelectorAll('table').forEach((table) => {
    const wrapper = doc.createElement('div');
    wrapper.className = 'overflow-x-auto';
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });

  return body.innerHTML;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const markdownCache = new Map<string, string>();

/**
 * Markdown → sanitized HTML with `[n]` markers replaced by citation buttons.
 * Exported so the pipeline (including its XSS filtering) is unit-testable.
 */
export function renderAnswerMarkdown(markdown: string): string {
  if (!markdown.trim()) return '';
  const cached = markdownCache.get(markdown);
  if (cached !== undefined) return cached;

  let html: string;
  if (typeof window === 'undefined') {
    html = escapeHtml(markdown).replace(/\n/g, '<br/>');
  } else {
    const parsed = marked.parse(markdown, { async: false, gfm: true, breaks: true });
    const clean = DOMPurify.sanitize(String(parsed), SANITIZE_CONFIG);
    html = injectCitationChips(clean);
  }

  if (markdownCache.size > 80) markdownCache.clear();
  markdownCache.set(markdown, html);
  return html;
}

const PROSE_CLASSES = cx(
  'text-[14.5px] leading-[1.72] text-ink',
  '[&_p]:mb-3 [&_p:last-child]:mb-0',
  '[&_strong]:font-semibold [&_em]:italic [&_del]:opacity-70',
  '[&_a]:text-accent [&_a]:underline [&_a]:decoration-accent/40 [&_a]:underline-offset-2 [&_a:hover]:decoration-accent',
  '[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_li]:pl-0.5',
  '[&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-[19px] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em]',
  '[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:tracking-[-0.01em]',
  '[&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:text-[14px] [&_h3]:font-semibold',
  '[&_code]:rounded-[5px] [&_code]:bg-subtle [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:break-all [&_pre_code]:break-normal',
  '[&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-hairline [&_pre]:bg-subtle [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_blockquote]:mb-3 [&_blockquote]:border-l-2 [&_blockquote]:border-accent/30 [&_blockquote]:pl-3 [&_blockquote]:text-ink-muted',
  '[&_hr]:my-4 [&_hr]:border-hairline',
  '[&_table]:mb-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[13px]',
  '[&_th]:border [&_th]:border-hairline [&_th]:bg-subtle [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold',
  '[&_td]:border [&_td]:border-hairline [&_td]:px-2 [&_td]:py-1',
);

/** Floating hover preview for a citation chip — rendered via portal at body level. */
function CitationPreview({ x, y, source }: { x: number; y: number; source: SearchResult }) {
  const below = y < 160;
  const clampedX = Math.min(Math.max(x, 150), (window.innerWidth || 320) - 150);
  return createPortal(
    <div
      id={CITATION_PREVIEW_ID}
      role="tooltip"
      className="pointer-events-none fixed z-50 w-[280px] rounded-md border border-hairline bg-elevated/95 p-2.5 shadow-card backdrop-blur-xl"
      style={{
        left: clampedX,
        top: y,
        transform: below
          ? 'translate(-50%, calc(100% + 8px))'
          : 'translate(-50%, calc(-100% - 8px))',
      }}
    >
      <p className="flex items-baseline gap-1 truncate text-[10.5px] font-semibold text-ink">
        <span className="shrink-0 text-accent">{source.title || source.filename || 'Source'}</span>
        {source.filename ? (
          <span className="truncate font-mono text-[9px] font-normal text-ink-faint">
            {source.filename}
          </span>
        ) : null}
      </p>
      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-muted">{source.text}</p>
    </div>,
    document.body,
  );
}

const MarkdownAnswer = memo(function MarkdownAnswer({
  content,
  sources,
  onCitation,
}: {
  content: string;
  sources: SearchResult[];
  onCitation: (citation: number) => void;
}) {
  const html = useMemo(() => renderAnswerMarkdown(content), [content]);
  const [preview, setPreview] = useState<{ citation: number; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => setPreview(null), []);

  /* Pointer leave must not kill a preview a keyboard user is still reading. */
  const hidePreview = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active?.closest?.('[data-citation]')) return;
    setPreview(null);
  }, []);

  /* Dismiss on scroll anywhere in the document. */
  useEffect(() => {
    if (!preview) return undefined;
    window.addEventListener('scroll', dismiss, true);
    return () => window.removeEventListener('scroll', dismiss, true);
  }, [preview, dismiss]);

  /* Point the chip at the preview so screen readers announce the same text. */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll('[data-citation]').forEach((chip) => {
      const active = preview && chip.getAttribute('data-citation') === String(preview.citation);
      if (active) chip.setAttribute('aria-describedby', CITATION_PREVIEW_ID);
      else chip.removeAttribute('aria-describedby');
    });
  }, [preview, html]);

  /* Event delegation: one preview serves every chip in the answer, by pointer or focus. */
  const showPreviewForChip = (chip: HTMLElement | null) => {
    if (!chip) {
      setPreview(null);
      return;
    }
    const citation = Number(chip.dataset.citation);
    const source = Number.isFinite(citation) ? sources[citation - 1] : undefined;
    if (!source) {
      setPreview(null);
      return;
    }
    const rect = chip.getBoundingClientRect();
    setPreview({ citation, x: rect.left + rect.width / 2, y: rect.top });
  };

  const handlePointerOver = (event: ReactPointerEvent<HTMLDivElement>) => {
    showPreviewForChip(
      (event.target instanceof Element ? event.target : null)?.closest<HTMLElement>('[data-citation]') ?? null,
    );
  };

  const handleFocus = (event: ReactFocusEvent<HTMLDivElement>) => {
    showPreviewForChip(
      (event.target instanceof Element ? event.target : null)?.closest<HTMLElement>('[data-citation]') ?? null,
    );
  };

  const handleBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as HTMLElement | null;
    if (next?.closest?.('[data-citation]')) return;
    setPreview(null);
  };

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    setPreview(null);
    const target = event.target as HTMLElement | null;
    const chip = target?.closest<HTMLElement>('[data-citation]');
    if (!chip) return;
    event.preventDefault();
    const citation = Number(chip.dataset.citation);
    if (Number.isFinite(citation)) onCitation(citation);
  };

  return (
    <>
      <div
        ref={containerRef}
        className={PROSE_CLASSES}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerLeave={hidePreview}
        onFocus={handleFocus}
        onBlur={handleBlur}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {preview && sources[preview.citation - 1] ? (
        <CitationPreview x={preview.x} y={preview.y} source={sources[preview.citation - 1]} />
      ) : null}
    </>
  );
});

/* -------------------------------------------------------------------------- */
/* Query controls popover                                                     */
/* -------------------------------------------------------------------------- */

function ControlRow({
  label,
  value,
  min,
  max,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-[10.5px] font-medium text-ink-muted">
        <span>{label}</span>
        <span className="tabular text-[11px] font-semibold text-ink">
          {value}
          {suffix ? <span className="ml-0.5 font-normal text-ink-muted">{suffix}</span> : null}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-hairline [accent-color:var(--accent)]"
      />
    </label>
  );
}

function QueryControls({
  value,
  onChange,
  disabled = false,
}: {
  value: AskControls;
  onChange: (next: AskControls) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="true"
        disabled={disabled}
        title="Query controls"
        className={cx(
          'inline-flex h-7 items-center gap-1.5 rounded-pill border px-2 text-[10.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          open
            ? 'border-accent/30 bg-accent-soft text-accent'
            : 'border-hairline bg-subtle/70 text-ink-muted hover:text-ink',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <SlidersHorizontal className="h-3 w-3 shrink-0" strokeWidth={2.2} />
        <span className="tabular">{value.top_k} chunks</span>
        <span className="opacity-40">·</span>
        <span className="tabular">{value.max_cycles} attempts</span>
        {value.enforce_guardrails ? (
          <span
            aria-label="Guardrails on"
            title="Guardrails on"
            className="ml-0.5 h-1 w-1 rounded-full bg-ok"
          />
        ) : null}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={SPRING_SNAPPY}
            role="dialog"
            aria-label="Query controls"
            className="absolute bottom-full left-0 z-30 mb-2 w-[248px] rounded-lg border border-hairline bg-elevated p-3 shadow-card"
          >
            <p className="mb-2 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              Query controls
            </p>

            <div className="flex flex-col gap-2.5">
              <ControlRow
                label="Chunks to retrieve"
                value={value.top_k}
                min={CONTROL_LIMITS.top_k.min}
                max={CONTROL_LIMITS.top_k.max}
                onChange={(topK) => onChange({ ...value, top_k: topK })}
                suffix="chunks"
              />
              <ControlRow
                label="Answer attempts"
                value={value.max_cycles}
                min={CONTROL_LIMITS.max_cycles.min}
                max={CONTROL_LIMITS.max_cycles.max}
                onChange={(cycles) => onChange({ ...value, max_cycles: cycles })}
                suffix="attempts"
              />

              <div className="flex items-center justify-between gap-2 border-t border-hairline pt-2">
                <span className="text-[10.5px] font-medium text-ink-muted">Enforce guardrails</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={value.enforce_guardrails}
                  aria-label="Enforce guardrails"
                  onClick={() => onChange({ ...value, enforce_guardrails: !value.enforce_guardrails })}
                  className={cx(
                    'relative h-[18px] w-[32px] shrink-0 rounded-pill border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    value.enforce_guardrails
                      ? 'border-accent/40 bg-accent'
                      : 'border-hairline bg-subtle',
                  )}
                >
                  <motion.span
                    layout
                    transition={SPRING_SNAPPY}
                    className={cx(
                      'absolute top-[2px] h-[12px] w-[12px] rounded-full bg-white shadow-hairline',
                      value.enforce_guardrails ? 'right-[2px]' : 'left-[2px]',
                    )}
                  />
                </button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Composer                                                                   */
/* -------------------------------------------------------------------------- */

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onAbort: () => void;
  streaming: boolean;
  controls: AskControls;
  onControlsChange: (next: AskControls) => void;
  compact?: boolean;
}

function Composer({
  value,
  onChange,
  onSubmit,
  onAbort,
  streaming,
  controls,
  onControlsChange,
  compact = false,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSubmit = value.trim().length > 0 && !streaming;

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, compact ? 116 : 188)}px`;
  }, [value, compact]);

  return (
    <motion.form
      layoutId="ask-composer"
      layout
      transition={SPRING_GENTLE}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit();
      }}
      className="relative flex w-full flex-col rounded-[24px] border border-hairline bg-elevated/85 p-2 shadow-card backdrop-blur-xl"
    >
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (canSubmit) onSubmit();
            }
          }}
          rows={1}
          aria-label="Ask Meridian a question"
          placeholder={compact ? 'Ask a follow-up…' : 'Ask anything about your corpus…'}
          className={cx(
            'min-h-[40px] w-full resize-none bg-transparent px-2 py-2 text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-faint',
            compact ? 'max-h-[116px]' : 'max-h-[188px]',
          )}
        />
      </div>

      <div className="flex items-center justify-between gap-2 px-0.5 pt-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <QueryControls value={controls} onChange={onControlsChange} disabled={streaming} />
          {!compact ? (
            <span className="hidden items-center gap-1 text-[10px] text-ink-faint sm:flex">
              {IS_MAC ? (
                <Command className="h-2.5 w-2.5" strokeWidth={2.4} />
              ) : (
                <span className="font-semibold">Ctrl</span>
              )}
              <span>K for commands</span>
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {!compact ? (
            <span className="hidden text-[10px] text-ink-faint sm:inline">
              <kbd className="rounded-[4px] border border-hairline bg-subtle px-1 py-[1px] font-sans text-[9.5px] font-semibold">
                ↵
              </kbd>{' '}
              ask ·{' '}
              <kbd className="rounded-[4px] border border-hairline bg-subtle px-1 py-[1px] font-sans text-[9.5px] font-semibold">
                ⇧↵
              </kbd>{' '}
              newline
            </span>
          ) : null}

          <AnimatePresence mode="popLayout" initial={false}>
            {streaming ? (
              <motion.button
                key="abort"
                type="button"
                onClick={onAbort}
                aria-label="Abort query"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={SPRING_SNAPPY}
                className="grid h-8 w-8 place-items-center rounded-full border border-fail/30 bg-fail-soft text-fail-ink transition-colors hover:border-fail/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fail/40"
              >
                <Square className="h-3 w-3 fill-current" strokeWidth={0} />
              </motion.button>
            ) : (
              <motion.button
                key="submit"
                type="submit"
                disabled={!canSubmit}
                aria-label="Ask Meridian"
                whileTap={{ scale: 0.97 }}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={SPRING_SNAPPY}
                className="grid h-8 w-8 place-items-center rounded-full bg-accent text-accent-contrast transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={2.6} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.form>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                       */
/* -------------------------------------------------------------------------- */

function Hero({
  composer,
  onPick,
  disabled,
}: {
  composer: ReactNode;
  onPick: (prompt: string) => void;
  disabled: boolean;
}) {
  return (
    <motion.div
      variants={STAGGER_CONTAINER}
      initial="initial"
      animate="animate"
      className="relative isolate mx-auto flex w-full max-w-3xl flex-col items-center gap-7 pt-2 sm:gap-8 sm:pt-10"
    >
      {/* Ambient light pools — purely decorative, drift slowly behind the hero.
          The wrapper is masked so the blurred pools dissolve before the box
          edge instead of showing a straight rectangular cut. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        style={{
          maskImage: 'radial-gradient(ellipse 72% 68% at 50% 42%, #000 28%, transparent 76%)',
          WebkitMaskImage: 'radial-gradient(ellipse 72% 68% at 50% 42%, #000 28%, transparent 76%)',
        }}
      >
        <div
          className="animate-drift-a absolute -left-24 -top-40 h-[34rem] w-[34rem] rounded-full"
          style={{
            filter: 'blur(72px)',
            background: 'radial-gradient(circle at 50% 50%, var(--ambient-1), transparent 66%)',
          }}
        />
        <div
          className="animate-drift-b absolute -right-20 top-24 h-[28rem] w-[28rem] rounded-full"
          style={{
            filter: 'blur(72px)',
            background: 'radial-gradient(circle at 50% 50%, var(--ambient-2), transparent 64%)',
          }}
        />
      </div>

      <motion.div variants={STAGGER_ITEM} className="flex flex-col items-center gap-3 text-center">
        <h1 className="max-w-2xl text-balance text-[clamp(1.9rem,4.2vw,3rem)] font-semibold leading-[1.06] tracking-[-0.045em] text-ink">
          Answers that{' '}
          <span className="bg-gradient-to-r from-accent to-accent/60 bg-clip-text text-transparent">
            show their work
          </span>
          .
        </h1>

        <p className="max-w-xl text-balance text-[13.5px] leading-relaxed text-ink-muted">
          Meridian retrieves, re-reads and verifies before it answers. Open any citation to inspect
          the exact chunk it came from.
        </p>
      </motion.div>

      <motion.div variants={STAGGER_ITEM} className="w-full">
        {composer}
      </motion.div>

      <motion.div variants={STAGGER_ITEM} className="grid w-full gap-2 sm:grid-cols-3">
        {SAMPLE_PROMPTS.map((prompt) => (
          <SpotlightCard
            key={prompt.id}
            as="button"
            type="button"
            disabled={disabled}
            onClick={() => onPick(prompt.prompt)}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            transition={SPRING_SNAPPY}
            className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-elevated/80 p-3.5 text-left shadow-hairline backdrop-blur-xl transition-colors hover:border-accent/30 hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              <span className="h-1 w-1 rounded-full bg-accent/60 transition-colors group-hover:bg-accent" />
              {prompt.title}
            </span>
            <span className="text-[12.5px] leading-snug text-ink-muted transition-colors group-hover:text-ink">
              {prompt.prompt}
            </span>
          </SpotlightCard>
        ))}
      </motion.div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Turns                                                                      */
/* -------------------------------------------------------------------------- */

function UserTurn({ message }: { message: AskMessage }) {
  return (
    <motion.div
      variants={STAGGER_ITEM}
      initial="initial"
      animate="animate"
      className="flex flex-col gap-1.5 border-l-2 border-accent/40 pl-3"
    >
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        Question
      </span>
      <p className="text-[15px] font-medium leading-relaxed text-ink">{message.content}</p>
    </motion.div>
  );
}

function SkeletonAnswer() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {[92, 78, 64].map((width, index) => (
        <div
          key={index}
          className="h-2.5 rounded-full"
          style={{
            width: `${width}%`,
            backgroundColor: 'var(--bg-subtle)',
            backgroundImage:
              'linear-gradient(90deg, transparent, rgb(var(--text-primary-rgb) / 0.07) 50%, transparent)',
            backgroundSize: '200% 100%',
            backgroundRepeat: 'no-repeat',
            animation: `meridian-shimmer 1.8s linear ${index * 140}ms infinite`,
          }}
        />
      ))}
    </div>
  );
}

interface AssistantTurnProps {
  message: AskMessage;
  onCitation: (messageId: string, citation: number) => void;
  onOpenLens: (messageId: string, tab: EvidenceTab) => void;
  onAbort: () => void;
}

function AssistantTurn({ message, onCitation, onOpenLens, onAbort }: AssistantTurnProps) {
  const response: QueryResponse | null = message.response;
  const sources: SearchResult[] =
    message.sources.length > 0 ? message.sources : (response?.source_chunks ?? []);
  const verification: VerificationSummary | null = message.verification ?? response?.verification ?? null;
  const streaming = message.status === 'streaming';
  const model = response?.serving.model ?? response?.serving_model ?? null;
  const latency = message.elapsedMs ?? null;

  return (
    <motion.div
      variants={STAGGER_ITEM}
      initial="initial"
      animate="animate"
      className="flex flex-col gap-2.5"
    >
      <PipelinePulse
        stages={message.pipeline}
        streaming={streaming}
        startedAt={message.startedAt}
        elapsedMs={latency}
        cycles={response?.cycle_count ?? null}
        degradedReason={message.degradedReason}
        onAbort={onAbort}
        className="self-start"
      />

      <div className="rounded-lg border border-hairline bg-elevated/80 p-3.5 shadow-hairline backdrop-blur-xl">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <StatusBadge
            tone={verificationTone(verification)}
            size="sm"
            label={verificationLabel(verification)}
          />
          {message.refusal ? <StatusBadge tone="warn" size="sm" label="refusal" /> : null}
          {message.status === 'aborted' ? (
            <StatusBadge tone="warn" size="sm" label="aborted" />
          ) : null}
          {message.usedFallback ? (
            <StatusBadge tone="neutral" size="sm" label="non-stream fallback" />
          ) : null}

          <div className="ml-auto flex items-center gap-2 text-[10px] text-ink-faint">
            {response ? (
              <>
                <span className="tabular">{response.cycle_count} cycles</span>
                <span className="opacity-40">·</span>
                <span className="tabular">{latency ?? response.execution_time_ms}ms</span>
                {model ? (
                  <>
                    <span className="opacity-40">·</span>
                    <span className="max-w-[10rem] truncate font-mono">{model}</span>
                  </>
                ) : null}
              </>
            ) : streaming ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={2.6} />
                streaming
              </span>
            ) : null}
          </div>
        </div>

        {message.degradedReason ? (
          <p className="mb-3 rounded-[7px] border border-warn/30 bg-warn-soft px-2.5 py-1.5 text-[11px] text-warn-ink">
            {message.degradedReason}
          </p>
        ) : null}

        <div role="status" aria-live="polite">
          {message.content.length > 0 ? (
            <MarkdownAnswer
              content={message.content}
              sources={sources}
              onCitation={(citation) => onCitation(message.id, citation)}
            />
          ) : streaming ? (
            <SkeletonAnswer />
          ) : (
            <p className="text-[13px] text-ink-muted">
              {message.error ? 'No answer was produced.' : 'The model returned an empty answer.'}
            </p>
          )}
        </div>

        {message.error ? (
          <p className="mt-3 rounded-[7px] border border-fail/30 bg-fail-soft px-2.5 py-1.5 text-[11.5px] text-fail-ink">
            {message.error}
          </p>
        ) : null}

        <div className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t border-hairline pt-2.5">
          <LensButton
            icon={Files}
            label={`Evidence · ${sources.length}`}
            onClick={() => onOpenLens(message.id, 'cited')}
            accent
          />
          <LensButton
            icon={FlaskConical}
            label="Retrieval lab"
            onClick={() => onOpenLens(message.id, 'lab')}
          />
          <LensButton
            icon={ShieldCheck}
            label="Guardrails"
            onClick={() => onOpenLens(message.id, 'guardrails')}
          />
          {response?.trace_id ? (
            <span className="ml-auto truncate font-mono text-[9.5px] text-ink-faint">
              trace {response.trace_id}
            </span>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

function LensButton({
  icon: Icon,
  label,
  onClick,
  accent = false,
}: {
  icon: typeof Files;
  label: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex h-6 items-center gap-1 rounded-pill border px-2 text-[10.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        accent
          ? 'border-accent/25 bg-accent-soft text-accent hover:border-accent/50'
          : 'border-hairline bg-subtle/60 text-ink-muted hover:text-ink',
      )}
    >
      <Icon className="h-2.5 w-2.5" strokeWidth={2.4} />
      {label}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Ask view                                                                   */
/* -------------------------------------------------------------------------- */

export function AskView() {
  const { tenantId } = useAuth();
  const { messages, isStreaming, submit, abort, reset } = useAskStream();

  const [controls, setControls] = useState<AskControls>(DEFAULT_ASK_CONTROLS);
  const [draft, setDraft] = useState('');
  const [lens, setLens] = useState<EvidenceLensState>({
    open: false,
    tab: 'cited',
    messageId: null,
    citation: null,
  });

  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const hasThread = messages.length > 0;
  const [composerHeight, setComposerHeight] = useState(0);

  const assistantMessages = useMemo(
    () => messages.filter((message) => message.role === 'assistant'),
    [messages],
  );
  const lastAssistant = assistantMessages[assistantMessages.length - 1] ?? null;

  /* Streamed length drives the scroll-follow: the answer grows without a new message. */
  const streamedLength = lastAssistant?.content.length ?? 0;

  /* Measure the floating composer so the thread clears exactly that much. */
  useEffect(() => {
    const node = composerRef.current;
    if (!node) return undefined;
    const measure = () => setComposerHeight(node.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasThread]);

  /* Composer bottom offset (6.25rem) plus a gap under it. */
  const composerClearance = composerHeight + 124;

  const lensMessage = useMemo(() => {
    if (!lens.messageId) return lastAssistant;
    return messages.find((message) => message.id === lens.messageId) ?? lastAssistant;
  }, [lens.messageId, lastAssistant, messages]);

  const lensQuestion = useMemo(() => {
    if (!lensMessage) return '';
    const index = messages.findIndex((message) => message.id === lensMessage.id);
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = messages[cursor];
      if (candidate && candidate.role === 'user') return candidate.content;
    }
    return '';
  }, [lensMessage, messages]);

  const lensSources = lensMessage?.sources ?? [];
  const highlightedChunkId =
    lens.citation !== null ? (lensSources[lens.citation - 1]?.chunk_id ?? null) : null;
  const flaggedChunkIds = lensMessage?.response?.review_status.flagged_chunk_ids ?? [];

  const openLens = useCallback((messageId: string, tab: EvidenceTab, citation: number | null = null) => {
    setLens({ open: true, tab, messageId, citation });
  }, []);

  const handleCitation = useCallback((messageId: string, citation: number) => {
    setLens({ open: true, tab: 'cited', messageId, citation });
  }, []);

  const closeLens = useCallback(() => {
    setLens((current) => ({ ...current, open: false }));
  }, []);

  const changeTab = useCallback((tab: EvidenceTab) => {
    setLens((current) => ({ ...current, tab }));
  }, []);

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || isStreaming) return;
      setDraft('');
      submit(trimmed, controls);
    },
    [controls, isStreaming, submit],
  );

  const handleSubmit = useCallback(() => {
    ask(draft);
  }, [ask, draft]);

  /* Keep the newest turn in view. */
  useEffect(() => {
    if (!hasThread) return;
    const frame = window.requestAnimationFrame(() => {
      const node = endRef.current;
      // `scrollIntoView` is absent in jsdom and some embedded webviews.
      if (node && typeof node.scrollIntoView === 'function') {
        // Smooth scrolling is skipped while text streams (it queues one
        // animation per flush) and whenever reduced motion is requested.
        const behavior: ScrollBehavior = prefersReducedMotion() || isStreaming ? 'auto' : 'smooth';
        node.scrollIntoView({ behavior, block: 'end' });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasThread, messages.length, streamedLength, isStreaming]);

  const composer = (
    <Composer
      value={draft}
      onChange={setDraft}
      onSubmit={handleSubmit}
      onAbort={abort}
      streaming={isStreaming}
      controls={controls}
      onControlsChange={setControls}
      compact={hasThread}
    />
  );

  return (
    <div className="relative">
      {!hasThread ? (
        <Hero
          composer={composer}
          onPick={(prompt) => ask(prompt)}
          disabled={isStreaming}
        />
      ) : (
        <>
          <motion.div
            variants={STAGGER_CONTAINER}
            initial="initial"
            animate="animate"
            className="mx-auto flex w-full max-w-3xl flex-col gap-7"
            style={{ paddingBottom: `${composerClearance}px` }}
          >
            <motion.div
              variants={STAGGER_ITEM}
              className="flex items-center justify-between gap-2"
            >
              <p className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                <Wrench className="h-3 w-3" strokeWidth={2.2} />
                Session · tenant {tenantId}
              </p>
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-6 items-center gap-1 rounded-pill border border-hairline bg-elevated/70 px-2 text-[10.5px] font-medium text-ink-muted transition-colors hover:border-accent/30 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <Plus className="h-2.5 w-2.5" strokeWidth={2.6} />
                New question
              </button>
            </motion.div>

            {messages.map((message) =>
              message.role === 'user' ? (
                <UserTurn key={message.id} message={message} />
              ) : (
                <AssistantTurn
                  key={message.id}
                  message={message}
                  onCitation={handleCitation}
                  onOpenLens={(messageId, tab) => openLens(messageId, tab)}
                  onAbort={abort}
                />
              ),
            )}

            <div
              ref={endRef}
              aria-hidden="true"
              className="h-px w-full"
              style={{ scrollMarginBottom: `${composerClearance}px` }}
            />
          </motion.div>

          {typeof document !== 'undefined'
            ? createPortal(
                <div className="pointer-events-none fixed inset-x-0 bottom-[6.25rem] z-40 flex justify-center px-4 sm:bottom-[6.75rem]">
                  <div
                    ref={composerRef}
                    className="pointer-events-auto w-full max-w-3xl"
                  >
                    {composer}
                  </div>
                </div>,
                document.body,
              )
            : null}
        </>
      )}

      <EvidenceLens
        open={lens.open}
        onClose={closeLens}
        tab={lens.tab}
        onTabChange={changeTab}
        sources={lensSources}
        verification={lensMessage?.verification ?? lensMessage?.response?.verification ?? null}
        query={lensQuestion}
        highlightedChunkId={highlightedChunkId}
        flaggedChunkIds={flaggedChunkIds}
        sampleText={lensMessage?.content ?? ''}
      />
    </div>
  );
}

export default AskView;
