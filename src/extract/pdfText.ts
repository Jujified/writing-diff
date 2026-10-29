/**
 * PDF text arrives as positioned fragments, wrapped at the page's line width.
 * These pure helpers rebuild lines from fragments, then paragraphs from lines,
 * undoing end-of-line hyphenation along the way.
 */

export interface PdfTextItem {
  str: string;
  /** Left edge, in PDF units (origin bottom-left). */
  x: number;
  /** Baseline, in PDF units; larger is higher on the page. */
  y: number;
  width: number;
  height: number;
  hasEOL?: boolean;
}

export interface PdfLine {
  text: string;
  x: number;
  y: number;
  right: number;
  height: number;
}

export function itemsToLines(items: PdfTextItem[]): PdfLine[] {
  const lines: PdfLine[] = [];
  let line: PdfLine | null = null;
  let breakNext = false;

  for (const item of items) {
    const blank = item.str.trim() === '';
    if (blank && !line) {
      breakNext ||= Boolean(item.hasEOL);
      continue;
    }
    const sameLine =
      line !== null && !breakNext && (blank || Math.abs(item.y - line.y) <= Math.max(line.height, item.height, 1) * 0.5);
    if (!sameLine) {
      if (line) lines.push(line);
      line = blank ? null : { text: item.str, x: item.x, y: item.y, right: item.x + item.width, height: item.height };
    } else if (line) {
      if (!blank) {
        const gap = item.x - line.right;
        const needsSpace = gap > Math.max(line.height, item.height) * 0.15 && !/\s$/.test(line.text) && !/^\s/.test(item.str);
        line.text += (needsSpace ? ' ' : '') + item.str;
        line.right = Math.max(line.right, item.x + item.width);
        line.height = Math.max(line.height, item.height);
      } else {
        line.text += item.str;
      }
    }
    breakNext = Boolean(item.hasEOL);
  }
  if (line) lines.push(line);
  return lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text !== '');
}

const PAGE_NUMBER = /^(?:page\s+)?[-–—]?\s*\d{1,4}\s*[-–—]?(?:\s*(?:of|\/)\s*\d{1,4})?$/i;
const TERMINAL = /[.!?:…"”’)\]]$/;
const BULLET = /^(?:[•●▪◦‣■□\-–—*]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s/;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** Join two wrapped lines, repairing a word split by a hyphen at the break. */
export function joinWrapped(left: string, right: string): string {
  if (/[\p{L}]-$/u.test(left) && /^\p{Ll}/u.test(right)) return left.slice(0, -1) + right;
  if (/\u{00AD}$/u.test(left)) return left.slice(0, -1) + right;
  if (/[\u{2014}\u{2010}\u{2011}]$/u.test(left) || /^\u{2014}/u.test(right)) return left + right;
  return `${left} ${right}`;
}

/**
 * Merge lines into paragraphs. A new paragraph starts at a larger-than-usual
 * vertical gap, a first-line indent, a change in font size, a bullet, or after
 * a line that ends early with closing punctuation. Page numbers are dropped,
 * and a paragraph that runs over a page break is kept whole.
 */
export function linesToParagraphs(pages: PdfLine[][]): string[] {
  const cleaned = pages.map((lines) =>
    lines.filter((l, idx) => !((idx === 0 || idx === lines.length - 1) && PAGE_NUMBER.test(l.text))),
  );
  const all = cleaned.flat();
  if (all.length === 0) return [];

  const left = median(all.map((l) => l.x));
  const right = percentile(all.map((l) => l.right), 0.75);
  const textWidth = Math.max(1, right - left);
  const gaps: number[] = [];
  for (const lines of cleaned) {
    for (let k = 1; k < lines.length; k++) {
      const g = lines[k - 1].y - lines[k].y;
      if (g > 0) gaps.push(g);
    }
  }
  const lineGap = median(gaps);

  const paragraphs: string[] = [];
  let text = '';
  let prev: PdfLine | null = null;

  for (const lines of cleaned) {
    lines.forEach((line, idx) => {
      const newPage = idx === 0;
      let breakHere = prev === null;
      if (prev) {
        const indent = line.x - left;
        const prevIndent = prev.x - left;
        const em = Math.max(line.height, 1);
        const endedShort = prev.right < right - textWidth * 0.12;
        const sizeChanged = Math.abs(line.height - prev.height) > Math.max(line.height, prev.height) * 0.2;
        breakHere =
          (!newPage && lineGap > 0 && prev.y - line.y > lineGap * 1.45) ||
          (indent > em * 0.8 && (prevIndent <= em * 0.8 || endedShort)) ||
          (endedShort && TERMINAL.test(prev.text)) ||
          sizeChanged ||
          BULLET.test(line.text);
      }
      if (breakHere) {
        if (text) paragraphs.push(text);
        text = line.text;
      } else {
        text = joinWrapped(text, line.text);
      }
      prev = line;
    });
  }
  if (text) paragraphs.push(text);
  return paragraphs;
}

export function pdfItemsToText(pages: PdfTextItem[][]): string {
  return linesToParagraphs(pages.map(itemsToLines)).join('\n\n');
}
