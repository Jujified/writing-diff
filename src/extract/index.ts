import { ExtractError, type Preview } from './errors';

export { ExtractError, type Preview };

export type FileKind = 'txt' | 'md' | 'rtf' | 'docx' | 'pdf';

export interface Extracted {
  kind: FileKind;
  text: string;
  preview: Preview;
}

const EXTENSIONS: Record<string, FileKind> = {
  txt: 'txt',
  text: 'txt',
  md: 'md',
  markdown: 'md',
  rtf: 'rtf',
  docx: 'docx',
  pdf: 'pdf',
};

export const ACCEPT = '.txt,.md,.markdown,.rtf,.docx,.pdf,text/plain,text/markdown,application/rtf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function kindOf(file: File): FileKind | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSIONS[ext] ?? null;
}

export async function extractFile(file: File): Promise<Extracted> {
  const kind = kindOf(file);
  const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : 'this kind of file';
  if (!kind) {
    if (/\.(doc|pages|odt)$/i.test(file.name)) {
      throw new ExtractError(`${ext} files can’t be read here. Save it as .docx, .rtf, or .pdf from your word processor, then load that.`);
    }
    throw new ExtractError(`${ext} isn’t supported. Load a .txt, .md, .rtf, .docx, or .pdf file, or paste the text.`);
  }
  if (file.size === 0) throw new ExtractError('This file is empty.');

  try {
    switch (kind) {
      case 'txt':
      case 'md': {
        const text = await readText(file);
        const { renderMarkdown, renderPlain } = await import('./markdown');
        return { kind, text, preview: { type: 'html', html: kind === 'md' ? renderMarkdown(text) : renderPlain(text) } };
      }
      case 'rtf': {
        const { parseRtf, rtfToHtml, rtfToText } = await import('./rtf');
        const { sanitize } = await import('./markdown');
        // RTF is 7-bit with escapes; latin1 keeps any stray 8-bit bytes intact.
        const source = new TextDecoder('latin1').decode(await file.arrayBuffer());
        const paragraphs = parseRtf(source);
        const text = rtfToText(paragraphs);
        if (!text.trim()) throw new ExtractError('This RTF file has no readable text.');
        return { kind, text, preview: { type: 'html', html: sanitize(rtfToHtml(paragraphs)) } };
      }
      case 'docx': {
        const { extractDocx } = await import('./docx');
        return { kind, ...(await extractDocx(await file.arrayBuffer())) };
      }
      case 'pdf': {
        const { extractPdf } = await import('./pdf');
        return { kind, ...(await extractPdf(await file.arrayBuffer())) };
      }
    }
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    const label = { txt: 'text', md: 'Markdown', rtf: 'RTF', docx: 'Word', pdf: 'PDF' }[kind];
    throw new ExtractError(`“${file.name}” couldn’t be read. It may be damaged, or not really a ${label} file.`, { cause: err });
  }
}

async function readText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    // Not valid UTF-8: most likely an older Windows-encoded file.
    return new TextDecoder('windows-1252').decode(buffer);
  }
}
