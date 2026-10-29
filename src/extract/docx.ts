import mammoth from 'mammoth';
import { ExtractError, type Preview } from './errors';
import { sanitize } from './markdown';

export async function extractDocx(arrayBuffer: ArrayBuffer): Promise<{ text: string; preview: Preview }> {
  // mammoth reads the buffer each time, so give each call its own copy.
  const [raw, html] = await Promise.all([
    mammoth.extractRawText({ arrayBuffer: arrayBuffer.slice(0) }),
    mammoth.convertToHtml({ arrayBuffer: arrayBuffer.slice(0) }),
  ]);
  // extractRawText ends every paragraph with a blank line.
  const text = raw.value.replace(/\n{2,}/g, '\n\n').trim();
  if (!text) throw new ExtractError('This Word document has no text in it.');
  return { text, preview: { type: 'html', html: sanitize(html.value) } };
}
