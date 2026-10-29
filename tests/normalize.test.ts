import { describe, expect, it } from 'vitest';
import { countWords, normalizeText, splitBlocks, splitParagraphs } from '../src/diff/normalize';

const plain = { normalizeQuotes: false };
const quotes = { normalizeQuotes: true };

describe('normalizeText', () => {
  it('converts CRLF and CR line endings to LF', () => {
    expect(normalizeText('one\r\ntwo\rthree\n', plain)).toBe('one\ntwo\nthree\n');
  });

  it('composes Unicode to NFC so precomposed and combining forms match', () => {
    const decomposed = 'cafe\u{0301}';
    const composed = 'caf\u{00E9}';
    expect(decomposed).not.toBe(composed);
    expect(normalizeText(decomposed, plain)).toBe(composed);
  });

  it('turns non-breaking and other fixed-width spaces into plain spaces', () => {
    expect(normalizeText('a\u{00A0}b\u{202F}c\u{2007}d', plain)).toBe('a b c d');
  });

  it('strips zero-width characters and soft hyphens', () => {
    expect(normalizeText('co\u{00AD}operate\u{200B} now\u{FEFF}', plain)).toBe('cooperate now');
  });

  it('straightens smart quotes only when asked', () => {
    const text = '“It’s fine,” she said.';
    expect(normalizeText(text, plain)).toBe(text);
    expect(normalizeText(text, quotes)).toBe('"It\'s fine," she said.');
  });
});

describe('splitBlocks', () => {
  it('treats each line as a paragraph', () => {
    expect(splitParagraphs('First.\nSecond.\nThird.')).toEqual(['First.', 'Second.', 'Third.']);
  });

  it('collapses any run of blank lines into one paragraph break', () => {
    expect(splitBlocks('A\n\n\n\n  \nB')).toEqual([
      { type: 'para', text: 'A' },
      { type: 'gap' },
      { type: 'para', text: 'B' },
    ]);
    expect(splitBlocks('A\n\n\n\nB')).toEqual(splitBlocks('A\n\nB'));
  });

  it('drops leading and trailing blank lines and trailing spaces', () => {
    expect(splitBlocks('\n\n  A  \n\n')).toEqual([{ type: 'para', text: '  A' }]);
  });
});

describe('countWords', () => {
  it('counts contractions and hyphenated words once', () => {
    expect(countWords("Don't over-think it — 3.5 times.")).toBe(5);
  });
});
