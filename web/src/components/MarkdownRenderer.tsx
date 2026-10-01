import React from 'react';
import { marked } from 'marked';

interface MarkdownRendererProps {
  content: string;
}

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

  // Remove dangerous element tags
  const forbiddenTags = ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'option', 'style', 'link', 'meta'];
  forbiddenTags.forEach((tag) => {
    const elements = doc.querySelectorAll(tag);
    elements.forEach((el) => el.remove());
  });

  // Remove inline event handlers and dangerous protocol URLs
  const allElements = doc.querySelectorAll('*');
  allElements.forEach((el) => {
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

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  if (!content) return null;

  // Parse markdown into HTML string with GFM enabled and sanitize HTML
  const rawHtml = marked.parse(content, { breaks: true, gfm: true }) as string;
  const cleanHtml = sanitizeHtml(rawHtml);

  return (
    <div
      className="answer-prose space-y-2
                 [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-[15px] [&_h1]:font-bold [&_h1]:text-ink
                 [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:border-b [&_h2]:border-hairline [&_h2]:pb-1 [&_h2]:text-body [&_h2]:font-bold [&_h2]:text-ink
                 [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-body [&_h3]:font-bold [&_h3]:text-ink
                 [&_p]:mb-2
                 [&_strong]:font-bold [&_strong]:text-ink
                 [&_a]:text-accent-ink [&_a]:underline
                 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-4
                 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-4
                 [&_li]:leading-relaxed
                 [&_code]:id-mono [&_code]:rounded-sm [&_code]:border [&_code]:border-hairline [&_code]:bg-surface-sunken [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-ink
                 [&_pre]:my-2.5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-hairline [&_pre]:bg-surface-sunken [&_pre]:p-3 [&_pre]:text-ink
                 [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-ink
                 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-id
                 [&_th]:border [&_th]:border-hairline [&_th]:bg-surface-sunken [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-bold [&_th]:text-ink
                 [&_td]:border [&_td]:border-hairline [&_td]:bg-surface-raised [&_td]:px-3 [&_td]:py-1.5"
      dangerouslySetInnerHTML={{ __html: cleanHtml }}
    />
  );
};

