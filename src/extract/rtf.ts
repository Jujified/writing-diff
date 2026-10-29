/**
 * A deliberately small RTF reader: enough to recover paragraphs and the four
 * inline styles an essay uses (bold, italic, underline, strikethrough), plus
 * Unicode and legacy code-page text. Tables, images, and fonts are skipped.
 * See the README for why this beats bundling a full RTF renderer here.
 */

export interface RtfRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

export type RtfParagraph = RtfRun[];

interface State {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  skip: boolean;
  uc: number;
}

// Groups whose content is metadata, layout, or binary data rather than text.
const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'objdata',
  'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf',
  'footnote', 'annotation', 'atnid', 'atnauthor', 'fldinst', 'listtable',
  'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata',
  'colorschememapping', 'datastore', 'latentstyles', 'revtbl', 'pgdsctbl',
  'filetbl', 'bkmkstart', 'bkmkend', 'shppict', 'nonshppict', 'blipuid',
  'userprops', 'docvar', 'mmathPr', 'panose', 'falt', 'pnseclvl', 'shp',
  'shpinst', 'sp', 'sn', 'sv', 'wgrffmtfilter', 'xmlopen', 'xmlclose', 'template',
]);

const SYMBOLS: Record<string, string> = {
  emdash: '—', endash: '–', lquote: '‘', rquote: '’',
  ldblquote: '“', rdblquote: '”', bullet: '•', tab: '\t',
  emspace: '\u{2003}', enspace: '\u{2002}', qmspace: '\u{2005}',
};

const CODEPAGE_LABELS: Record<number, string> = {
  437: 'ibm866', 708: 'iso-8859-6', 874: 'windows-874', 932: 'shift_jis', 936: 'gbk',
  949: 'euc-kr', 950: 'big5', 10000: 'macintosh', 65001: 'utf-8',
};

function decoderFor(codepage: number): TextDecoder {
  const label = CODEPAGE_LABELS[codepage] ?? `windows-${codepage}`;
  try {
    return new TextDecoder(label);
  } catch {
    return new TextDecoder('windows-1252');
  }
}

export class RtfError extends Error {}

export function parseRtf(input: string): RtfParagraph[] {
  if (!/^\s*\{\\rtf/.test(input)) throw new RtfError('Missing the {\\rtf header.');

  const paragraphs: RtfParagraph[] = [];
  let current: RtfParagraph = [];
  let state: State = { bold: false, italic: false, underline: false, strike: false, skip: false, uc: 1 };
  const stack: State[] = [];
  let decoder = decoderFor(1252);
  let bytes: number[] = [];
  let skipChars = 0;
  // True right after "{" — the next control word may name a destination.
  let groupStart = false;
  let ignorable = false;

  const append = (text: string) => {
    if (state.skip || !text) return;
    const last = current[current.length - 1];
    if (
      last &&
      last.bold === state.bold &&
      last.italic === state.italic &&
      last.underline === state.underline &&
      last.strike === state.strike
    ) {
      last.text += text;
    } else {
      current.push({ text, bold: state.bold, italic: state.italic, underline: state.underline, strike: state.strike });
    }
  };
  const flushBytes = () => {
    if (bytes.length === 0) return;
    append(decoder.decode(new Uint8Array(bytes)));
    bytes = [];
  };
  const endParagraph = () => {
    flushBytes();
    if (state.skip) return;
    paragraphs.push(current);
    current = [];
  };

  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i];
    if (ch === '{') {
      flushBytes();
      stack.push(state);
      state = { ...state };
      groupStart = true;
      ignorable = false;
      i++;
      continue;
    }
    if (ch === '}') {
      flushBytes();
      state = stack.pop() ?? state;
      groupStart = false;
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      i++;
      continue;
    }
    if (ch !== '\\') {
      const wasStart = groupStart;
      groupStart = false;
      if (wasStart && ignorable) state.skip = true;
      flushBytes();
      if (skipChars > 0) {
        skipChars--;
      } else {
        append(ch);
      }
      i++;
      continue;
    }

    // Backslash: control symbol or control word.
    const next = input[i + 1] ?? '';
    if (next === "'") {
      const hex = input.slice(i + 2, i + 4);
      i += 4;
      groupStart = false;
      if (skipChars > 0) {
        skipChars--;
        continue;
      }
      const byte = Number.parseInt(hex, 16);
      if (!Number.isNaN(byte)) bytes.push(byte);
      continue;
    }
    if (!/[a-zA-Z]/.test(next)) {
      i += 2;
      if (next === '*') {
        ignorable = true;
        continue;
      }
      groupStart = false;
      flushBytes();
      if (next === '\\' || next === '{' || next === '}') append(next);
      else if (next === '~') append('\u{00A0}');
      else if (next === '_') append('\u{2011}');
      else if (next === '\n' || next === '\r') endParagraph();
      // "\-" (optional hyphen) and anything else: ignore.
      continue;
    }

    const match = /^([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(input.slice(i + 1, i + 50));
    if (!match) {
      i++;
      continue;
    }
    i += 1 + match[0].length;
    const word = match[1];
    const param = match[2] === undefined ? undefined : Number(match[2]);
    const isDestination = groupStart;
    const wasIgnorable = ignorable;
    groupStart = false;
    ignorable = false;

    if (isDestination && (wasIgnorable || SKIP_DESTINATIONS.has(word))) {
      flushBytes();
      state.skip = true;
      continue;
    }
    if (word === 'bin' && param !== undefined) {
      i += Math.max(0, param);
      continue;
    }
    if (word !== 'u') flushBytes();
    if (state.skip && word !== 'ansicpg') continue;

    switch (word) {
      case 'par':
      case 'sect':
      case 'row':
        endParagraph();
        break;
      case 'line':
        append('\n');
        break;
      case 'cell':
        append('\t');
        break;
      case 'b':
        state.bold = param !== 0;
        break;
      case 'i':
        state.italic = param !== 0;
        break;
      case 'ul':
      case 'uld':
      case 'uldb':
      case 'ulw':
      case 'uldash':
      case 'ulwave':
      case 'ulth':
        state.underline = param !== 0;
        break;
      case 'ulnone':
        state.underline = false;
        break;
      case 'strike':
      case 'striked':
        state.strike = param !== 0;
        break;
      case 'plain':
        state.bold = state.italic = state.underline = state.strike = false;
        break;
      case 'uc':
        state.uc = param ?? 1;
        break;
      case 'u': {
        flushBytes();
        if (param !== undefined) {
          const code = param < 0 ? param + 65536 : param;
          append(String.fromCharCode(code));
        }
        skipChars = state.uc;
        break;
      }
      case 'ansicpg':
        if (param !== undefined) decoder = decoderFor(param);
        break;
      default:
        if (word in SYMBOLS) append(SYMBOLS[word]);
    }
  }
  flushBytes();
  if (current.length) paragraphs.push(current);

  // Drop empty paragraphs at either end (a final \par is conventional).
  while (paragraphs.length && paragraphText(paragraphs[paragraphs.length - 1]).trim() === '') paragraphs.pop();
  while (paragraphs.length && paragraphText(paragraphs[0]).trim() === '') paragraphs.shift();
  return paragraphs;
}

function paragraphText(p: RtfParagraph): string {
  return p.map((r) => r.text).join('');
}

export function rtfToText(paragraphs: RtfParagraph[]): string {
  return paragraphs.map(paragraphText).join('\n');
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function rtfToHtml(paragraphs: RtfParagraph[]): string {
  return paragraphs
    .filter((p) => paragraphText(p).trim() !== '')
    .map((p) => {
      const inner = p
        .map((r) => {
          let html = escapeHtml(r.text).replace(/\n/g, '<br>');
          if (r.strike) html = `<s>${html}</s>`;
          if (r.underline) html = `<u>${html}</u>`;
          if (r.italic) html = `<em>${html}</em>`;
          if (r.bold) html = `<strong>${html}</strong>`;
          return html;
        })
        .join('');
      return `<p>${inner}</p>`;
    })
    .join('\n');
}
