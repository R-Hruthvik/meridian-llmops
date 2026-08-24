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
      className="text-xs leading-relaxed text-meridian-text font-normal space-y-2
                 [&_h1]:text-sm [&_h1]:font-extrabold [&_h1]:text-meridian-primary [&_h1]:mt-3 [&_h1]:mb-1.5
                 [&_h2]:text-xs [&_h2]:font-bold [&_h2]:text-meridian-text [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:border-b [&_h2]:border-meridian-border/50 [&_h2]:pb-1
                 [&_h3]:text-xs [&_h3]:font-bold [&_h3]:text-meridian-primary [&_h3]:mt-2 [&_h3]:mb-1
                 [&_p]:mb-2 [&_p]:leading-relaxed
                 [&_strong]:font-bold [&_strong]:text-meridian-primary
                 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-2 [&_ul]:space-y-1
                 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:my-2 [&_ol]:space-y-1
                 [&_li]:text-xs [&_li]:leading-relaxed
                 [&_code]:font-mono [&_code]:text-[11px] [&_code]:bg-meridian-bg [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:border [&_code]:border-meridian-border [&_code]:text-meridian-primary
                 [&_pre]:bg-[#1E2050] [&_pre]:text-white [&_pre]:p-3 [&_pre]:rounded-2xl [&_pre]:overflow-x-auto [&_pre]:my-2.5 [&_pre_code]:bg-transparent [&_pre_code]:border-0 [&_pre_code]:text-white
                 [&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_table]:text-[11px]
                 [&_th]:border [&_th]:border-meridian-border [&_th]:bg-meridian-lavenderLight/70 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-bold [&_th]:text-meridian-text
                 [&_td]:border [&_td]:border-meridian-border/70 [&_td]:px-3 [&_td]:py-1.5 [&_td]:bg-white"
      dangerouslySetInnerHTML={{ __html: cleanHtml }}
    />
  );
};

