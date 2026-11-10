import React, { useMemo } from 'react';
import { Marked, type Token, type TokensList } from 'marked';
import { DynamicWidget } from './chat/DynamicWidgetRegistry';
import { SandboxedHtmlArtifact } from './chat/SandboxedHtmlArtifact';

export interface MarkdownRendererProps {
  content: string;
  onCitationClick?: (index: number) => void;
}

type RenderBlock =
  | { type: 'markdown'; html: string }
  | { type: 'widget'; name: string; content: string }
  | { type: 'artifact'; content: string };

const citationExtension = {
  name: 'citation',
  level: 'inline' as const,
  start(src: string) {
    return src.indexOf('[^');
  },
  tokenizer(src: string) {
    const match = /^\[\^(\d+)\]/.exec(src);
    if (!match) return undefined;
    return {
      type: 'citation',
      raw: match[0],
      number: Number.parseInt(match[1], 10),
    };
  },
  renderer(token: { number: number }) {
    const n = Number(token.number);
    return `<button type="button" class="citation-badge" data-citation-index="${n}" aria-label="Citation ${n}">[^${n}]</button>`;
  },
};

const markedEngine = new Marked({
  breaks: true,
  gfm: true,
  extensions: [citationExtension],
});

const sanitizeHtml = (html: string): string => {
  if (typeof DOMParser === 'undefined') {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/ on\w+="[^"]*"/gi, '')
      .replace(/ on\w+='[^']*'/gi, '')
      .replace(/javascript:/gi, '');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Remove dangerous element tags (allow button only if class is citation-badge)
  const forbiddenTags = [
    'script',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'select',
    'option',
    'style',
    'link',
    'meta',
  ];
  forbiddenTags.forEach((tag) => {
    const elements = doc.querySelectorAll(tag);
    elements.forEach((el) => el.remove());
  });

  // Remove inline event handlers, rogue buttons, and dangerous protocol URLs
  const allElements = doc.querySelectorAll('*');
  allElements.forEach((el) => {
    if (el.tagName.toLowerCase() === 'button' && !el.classList.contains('citation-badge')) {
      el.remove();
      return;
    }
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const val = attr.value.toLowerCase().trim();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
      } else if (['href', 'src', 'action'].includes(name)) {
        if (val.startsWith('javascript:') || (val.startsWith('data:') && !val.startsWith('data:image/'))) {
          el.removeAttribute(attr.name);
        }
      }
    });
  });

  return doc.body.innerHTML;
};

const PROSE_CLASS_NAMES = `answer-prose space-y-2
  [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-[15px] [&_h1]:font-bold [&_h1]:text-ink
  [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:border-b [&_h2]:border-hairline [&_h2]:pb-1 [&_h2]:text-body [&_h2]:font-bold [&_h2]:text-ink
  [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-body [&_h3]:font-bold [&_h3]:text-ink
  [&_p]:mb-2
  [&_strong]:font-bold [&_strong]:text-ink
  [&_a]:text-accent-ink [&_a]:underline
  [&_.citation-badge]:mx-0.5 [&_.citation-badge]:inline-flex [&_.citation-badge]:items-center [&_.citation-badge]:justify-center [&_.citation-badge]:rounded-sm [&_.citation-badge]:border [&_.citation-badge]:border-hairline [&_.citation-badge]:bg-surface-sunken [&_.citation-badge]:px-1.5 [&_.citation-badge]:py-0.5 [&_.citation-badge]:id-mono [&_.citation-badge]:text-micro [&_.citation-badge]:font-semibold [&_.citation-badge]:text-ink [&_.citation-badge]:cursor-pointer [&_.citation-badge:hover]:border-accent [&_.citation-badge:hover]:text-accent-ink [&_.citation-badge]:focus-machined
  [&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-4
  [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-4
  [&_li]:leading-relaxed
  [&_code]:id-mono [&_code]:rounded-sm [&_code]:border [&_code]:border-hairline [&_code]:bg-surface-sunken [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-ink
  [&_pre]:my-2.5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-hairline [&_pre]:bg-surface-sunken [&_pre]:p-3 [&_pre]:text-ink
  [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-ink
  [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-id
  [&_th]:border [&_th]:border-hairline [&_th]:bg-surface-sunken [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-bold [&_th]:text-ink
  [&_td]:border [&_td]:border-hairline [&_td]:bg-surface-raised [&_td]:px-3 [&_td]:py-1.5`;

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  onCitationClick,
}) => {
  const blocks = useMemo<RenderBlock[]>(() => {
    if (!content) return [];

    const tokens = markedEngine.lexer(content);
    const result: RenderBlock[] = [];
    let currentMarkdownTokens: Token[] = [];

    const flushMarkdown = () => {
      if (currentMarkdownTokens.length > 0) {
        const slice = [...currentMarkdownTokens] as TokensList;
        (slice as any).links = (tokens as any).links || {};
        const rawHtml = markedEngine.parser(slice) as string;
        const clean = sanitizeHtml(rawHtml);
        if (clean.trim()) {
          result.push({ type: 'markdown', html: clean });
        }
        currentMarkdownTokens = [];
      }
    };

    for (const token of tokens) {
      if (token.type === 'code' && token.lang) {
        const trimmedLang = token.lang.trim().split(/\s+/)[0];
        if (trimmedLang.startsWith('widget:')) {
          flushMarkdown();
          const widgetName = trimmedLang.slice('widget:'.length).trim();
          result.push({ type: 'widget', name: widgetName, content: token.text });
          continue;
        }
        if (trimmedLang === 'html:artifact' || trimmedLang === 'html:interactive') {
          flushMarkdown();
          result.push({ type: 'artifact', content: token.text });
          continue;
        }
      }
      currentMarkdownTokens.push(token);
    }
    flushMarkdown();
    return result;
  }, [content]);

  const hasGenerativeUi = useMemo(() => {
    return blocks.some((b) => b.type !== 'markdown');
  }, [blocks]);

  const cleanHtml = useMemo(() => {
    if (!content || hasGenerativeUi) return '';
    const rawHtml = markedEngine.parse(content) as string;
    return sanitizeHtml(rawHtml);
  }, [content, hasGenerativeUi]);

  if (!content) return null;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-citation-index]');
    if (target && onCitationClick) {
      const index = Number.parseInt(target.getAttribute('data-citation-index') || '', 10);
      if (Number.isFinite(index)) {
        e.preventDefault();
        onCitationClick(index);
      }
    }
  };

  if (!hasGenerativeUi) {
    return (
      <div
        onClick={handleClick}
        className={PROSE_CLASS_NAMES}
        dangerouslySetInnerHTML={{ __html: cleanHtml }}
      />
    );
  }

  return (
    <div onClick={handleClick} className={PROSE_CLASS_NAMES}>
      {blocks.map((block, idx) => {
        if (block.type === 'markdown') {
          return (
            <div
              key={idx}
              dangerouslySetInnerHTML={{ __html: block.html }}
            />
          );
        }
        if (block.type === 'widget') {
          return (
            <DynamicWidget
              key={idx}
              name={block.name}
              content={block.content}
            />
          );
        }
        if (block.type === 'artifact') {
          return (
            <SandboxedHtmlArtifact
              key={idx}
              html={block.content}
            />
          );
        }
        return null;
      })}
    </div>
  );
};
