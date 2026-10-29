import { describe, expect, it } from 'vitest';
import { itemsToLines, joinWrapped, linesToParagraphs, pdfItemsToText, type PdfLine } from '../src/extract/pdfText';

/** Build a page of lines at 14pt spacing, 72pt left margin, ~468pt measure. */
function page(lines: Array<string | { text: string; indent?: number; short?: boolean; gapBefore?: number; height?: number }>, top = 720): PdfLine[] {
  let y = top;
  return lines.map((spec, i) => {
    const s = typeof spec === 'string' ? { text: spec } : spec;
    if (i > 0) y -= 14 + (s.gapBefore ?? 0);
    const x = 72 + (s.indent ?? 0);
    return { text: s.text, x, y, right: s.short ? x + 200 : 540, height: s.height ?? 11 };
  });
}

describe('joinWrapped', () => {
  it('rejoins a word hyphenated across a line break', () => {
    expect(joinWrapped('an extra-', 'ordinary result')).toBe('an extraordinary result');
    expect(joinWrapped('the con-', 'clusion')).toBe('the conclusion');
  });

  it('keeps the hyphen before a capitalised word or number', () => {
    expect(joinWrapped('the pre-', 'Columbian era')).toBe('the pre- Columbian era');
  });

  it('joins ordinary wrapped lines with a single space', () => {
    expect(joinWrapped('it was the best', 'of times')).toBe('it was the best of times');
  });

  it('does not add a space after an em dash', () => {
    expect(joinWrapped('and then—', 'nothing')).toBe('and then—nothing');
  });
});

describe('linesToParagraphs', () => {
  it('merges wrapped lines and splits paragraphs at a blank-line gap', () => {
    const lines = page([
      'It was a bright cold day in April, and the clocks',
      { text: 'were striking thirteen.', short: true },
      { text: 'Winston Smith, his chin nuzzled into his breast, slipped', gapBefore: 10 },
      { text: 'quickly through the glass doors.', short: true },
    ]);
    expect(linesToParagraphs([lines])).toEqual([
      'It was a bright cold day in April, and the clocks were striking thirteen.',
      'Winston Smith, his chin nuzzled into his breast, slipped quickly through the glass doors.',
    ]);
  });

  it('splits paragraphs at a first-line indent with no extra spacing', () => {
    const lines = page([
      { text: 'First paragraph begins here and continues on to the', indent: 18 },
      'next line where it ends with a full stop and some more.',
      { text: 'Second paragraph starts with an indent and it wraps', indent: 18 },
      { text: 'onto a short last line.', short: true },
    ]);
    expect(linesToParagraphs([lines])).toHaveLength(2);
  });

  it('rejoins hyphenation while merging lines', () => {
    const lines = page(['The results were extra-', { text: 'ordinary in every respect.', short: true }]);
    expect(linesToParagraphs([lines])).toEqual(['The results were extraordinary in every respect.']);
  });

  it('starts a new paragraph after a short line ending in punctuation', () => {
    const lines = page([
      { text: 'A short closing line.', short: true },
      'A new paragraph that runs the full measure of the page and keeps',
      'going.',
    ]);
    expect(linesToParagraphs([lines])).toEqual([
      'A short closing line.',
      'A new paragraph that runs the full measure of the page and keeps going.',
    ]);
  });

  it('separates a heading set in a larger size', () => {
    const lines = page([
      { text: 'Introduction', short: true, height: 18 },
      'This essay considers the long history of the subject and the many',
      { text: 'ways it has been misunderstood.', short: true },
    ]);
    expect(linesToParagraphs([lines])[0]).toBe('Introduction');
  });

  it('drops page numbers and keeps a paragraph whole across a page break', () => {
    const p1 = page(['The argument continues at some length and does not', 'end at the bottom of this', { text: '1', short: true }]);
    const p2 = page(['page but carries straight on to the next one.', { text: '2', short: true }]);
    expect(linesToParagraphs([p1, p2])).toEqual([
      'The argument continues at some length and does not end at the bottom of this page but carries straight on to the next one.',
    ]);
  });

  it('starts a new paragraph for list bullets', () => {
    const lines = page([
      'The plan has three parts, listed in order of priority as follows here:',
      { text: '• gather the data', short: true },
      { text: '• clean the data', short: true },
    ]);
    expect(linesToParagraphs([lines])).toHaveLength(3);
  });
});

describe('itemsToLines', () => {
  it('groups fragments on the same baseline and inserts spaces at gaps', () => {
    const lines = itemsToLines([
      { str: 'Hello', x: 72, y: 700, width: 30, height: 11 },
      { str: 'world', x: 106, y: 700, width: 30, height: 11, hasEOL: true },
      { str: 'Next', x: 72, y: 686, width: 25, height: 11 },
    ]);
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'Next']);
  });

  it('does not insert a space between touching fragments', () => {
    const lines = itemsToLines([
      { str: 'para', x: 72, y: 700, width: 20, height: 11 },
      { str: 'graph', x: 92, y: 700, width: 25, height: 11 },
    ]);
    expect(lines[0].text).toBe('paragraph');
  });

  it('produces blank-line separated paragraphs end to end', () => {
    const text = pdfItemsToText([
      [
        { str: 'One line that wraps across the full width of the page and', x: 72, y: 700, width: 468, height: 11, hasEOL: true },
        { str: 'ends here.', x: 72, y: 686, width: 60, height: 11, hasEOL: true },
        { str: 'Another paragraph.', x: 72, y: 650, width: 100, height: 11 },
      ],
    ]);
    expect(text).toBe('One line that wraps across the full width of the page and ends here.\n\nAnother paragraph.');
  });
});
