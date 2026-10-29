export interface NormalizeOptions {
  /** Turn curly quotes and apostrophes into their straight equivalents. */
  normalizeQuotes: boolean;
}

// No-break space, narrow no-break space, figure space, and the other fixed-width
// spaces word processors like to insert.
const ODD_SPACES = /[\u{00A0}\u{2007}\u{202F}\u{2000}-\u{200A}\u{205F}\u{3000}]/gu;
const ZERO_WIDTH = /[\u{200B}\u{2060}\u{FEFF}]/gu;
const SINGLE_QUOTES = /[\u{2018}\u{2019}\u{201A}\u{201B}\u{2032}\u{02BC}]/gu;
const DOUBLE_QUOTES = /[\u{201C}\u{201D}\u{201E}\u{201F}\u{2033}]/gu;

/**
 * Canonicalize text before it is split into paragraphs. Applied to both sides
 * so that differences in encoding or typing habits never show up as edits.
 */
export function normalizeText(input: string, opts: NormalizeOptions): string {
  let text = input.replace(/\r\n?/g, '\n').replace(/[\u{2028}\u{2029}]/gu, '\n');
  text = text.normalize('NFC');
  text = text.replace(ODD_SPACES, ' ').replace(ZERO_WIDTH, '');
  // Soft hyphens are invisible formatting hints, not content.
  text = text.replace(/\u{00AD}/gu, '');
  if (opts.normalizeQuotes) {
    text = text.replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"');
  }
  return text;
}

/** A paragraph entry, or a blank-line marker between paragraphs. */
export type Block = { type: 'para'; text: string } | { type: 'gap' };

/**
 * Split normalized text into paragraphs. Every line break ends a paragraph
 * (prose editors emit one line per paragraph); any run of blank lines becomes
 * a single `gap` block, so "a\n\n\n\nb" and "a\n\nb" are the same document.
 * Leading and trailing blank lines are dropped.
 */
export function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let pendingGap = false;
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      pendingGap = blocks.length > 0;
      continue;
    }
    if (pendingGap) blocks.push({ type: 'gap' });
    pendingGap = false;
    blocks.push({ type: 'para', text: line.replace(/\s+$/, '') });
  }
  return blocks;
}

export function splitParagraphs(text: string): string[] {
  const out: string[] = [];
  for (const b of splitBlocks(text)) if (b.type === 'para') out.push(b.text);
  return out;
}

const WORD = /[\p{L}\p{N}]+(?:['’\-.][\p{L}\p{N}]+)*/gu;

export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}
