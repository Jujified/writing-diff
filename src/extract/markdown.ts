import DOMPurify from 'dompurify';
import { marked } from 'marked';

// Previews are for reading only: no scripts, frames, forms, or remote images.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof HTMLImageElement) {
    const src = node.getAttribute('src') ?? '';
    if (!/^data:image\//i.test(src)) node.removeAttribute('src');
  }
  if (node instanceof HTMLAnchorElement) {
    node.setAttribute('rel', 'noreferrer noopener');
    node.setAttribute('target', '_blank');
  }
});

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'video', 'audio', 'source'],
    FORBID_ATTR: ['style'],
  });
}

export function renderMarkdown(text: string): string {
  return sanitize(marked.parse(text, { async: false, gfm: true }));
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderPlain(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}
