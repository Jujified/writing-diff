import { describe, expect, it } from 'vitest';
import { parseRtf, rtfToHtml, rtfToText } from '../src/extract/rtf';

// Builds RTF \uN escapes without them being read as JavaScript escapes.
const U = '\\u';

const doc = String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\froman Times New Roman;}}{\colortbl;\red0\green0\blue0;}
{\*\generator Riched20 10.0;}\pard\f0\fs24 This is \b bold\b0 , \i italic\i0 , and \ul underlined\ulnone .\par
Caf\'e9 na\u239?ve ${U}8212? done\par
{\pict\wmetafile8 0102030405}\par
}`;

describe('parseRtf', () => {
  it('extracts paragraphs and skips font, colour, and picture tables', () => {
    expect(rtfToText(parseRtf(doc))).toBe('This is bold, italic, and underlined.\nCafé naïve — done');
  });

  it('keeps basic formatting for the preview', () => {
    expect(rtfToHtml(parseRtf(doc))).toContain('This is <strong>bold</strong>, <em>italic</em>, and <u>underlined</u>.');
  });

  it('honours \\uc when skipping Unicode fallback characters', () => {
    expect(rtfToText(parseRtf(String.raw`{\rtf1\uc2 a${U}8220\'93\'93b}`))).toBe('a\u{201C}b');
  });

  it('decodes surrogate pairs and escaped braces', () => {
    expect(rtfToText(parseRtf(String.raw`{\rtf1 ${U}-10179?${U}-8704? \{x\}}`))).toBe('\u{1F600} {x}');
  });

  it('rejects input without an RTF header', () => {
    expect(() => parseRtf('hello')).toThrow();
  });
});
