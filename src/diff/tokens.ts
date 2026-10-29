// Words keep internal apostrophes and hyphens ("don't", "well-known") so a
// changed word highlights as one unit. Whitespace runs are single tokens.
const WORD_TOKENS = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*|\s+|[\s\S]/gu;

export function tokenizeWords(text: string): string[] {
  return text.match(WORD_TOKENS) ?? [];
}

const graphemes =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** Grapheme clusters, with each whitespace run kept as one token. */
export function tokenizeChars(text: string): string[] {
  const chars = graphemes
    ? Array.from(graphemes.segment(text), (s) => s.segment)
    : Array.from(text);
  const out: string[] = [];
  for (const c of chars) {
    const last = out.length - 1;
    if (last >= 0 && isWhitespace(c) && isWhitespace(out[last])) out[last] += c;
    else out.push(c);
  }
  return out;
}

export function isWhitespace(token: string): boolean {
  return token.length > 0 && token.trim() === '';
}
