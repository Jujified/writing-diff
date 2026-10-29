import { describe, expect, it } from 'vitest';
import { computeDiff, intraDiff } from '../src/diff/engine';
import type { DiffOptions } from '../src/diff/types';

const base: DiffOptions = {
  granularity: 'word',
  ignoreWhitespace: false,
  ignoreCase: false,
  ignoreBlankLines: false,
  normalizeQuotes: false,
};

describe('ignore whitespace', () => {
  const a = 'She  walked to the   store.';
  const b = 'She walked to the store. ';

  it('reports spacing changes by default', () => {
    expect(computeDiff(a, b, base).identical).toBe(false);
  });

  it('treats runs of spaces as equal when enabled', () => {
    const r = computeDiff(a, b, { ...base, ignoreWhitespace: true });
    expect(r.identical).toBe(true);
    expect(r.identicalAfterIgnoring).toBe(true);
  });

  it('hides whitespace-only edits inside a changed paragraph', () => {
    const segs = intraDiff('One  two three', 'One two four', 'word', { ignoreCase: false, ignoreWhitespace: true });
    expect(segs.filter((s) => s.op !== 'eq')).toEqual([
      { op: 'del', a: 'three', b: '' },
      { op: 'ins', a: '', b: 'four' },
    ]);
  });

  it('keeps each side’s own spacing in equal runs', () => {
    const segs = intraDiff('a  b c', 'a b d', 'word', { ignoreCase: false, ignoreWhitespace: true });
    expect(segs[0]).toEqual({ op: 'eq', a: 'a  b ', b: 'a b ' });
  });
});

describe('ignore case', () => {
  const a = 'The Quick Brown Fox.';
  const b = 'the quick brown fox.';

  it('reports case changes by default', () => {
    const r = computeDiff(a, b, base);
    expect(r.identical).toBe(false);
    expect(r.stats.wordsAdded).toBe(4);
  });

  it('treats case-only differences as equal when enabled, keeping both spellings', () => {
    const r = computeDiff(a, b, { ...base, ignoreCase: true });
    expect(r.identical).toBe(true);
    expect(r.rows[0]).toEqual({ kind: 'equal', a: 1, b: 1, textA: a, textB: b });
  });

  it('still reports real word changes alongside ignored case changes', () => {
    const r = computeDiff('The Quick Brown Fox.', 'the quick red fox.', { ...base, ignoreCase: true });
    const row = r.rows[0];
    expect(row.kind).toBe('mod');
    if (row.kind !== 'mod') return;
    expect(row.segments.filter((s) => s.op !== 'eq')).toEqual([
      { op: 'del', a: 'Brown', b: '' },
      { op: 'ins', a: '', b: 'red' },
    ]);
    expect(r.stats).toMatchObject({ wordsAdded: 1, wordsRemoved: 1 });
  });
});

describe('ignore blank lines', () => {
  const a = 'Intro.\nBody.';
  const b = 'Intro.\n\n\nBody.';

  it('reports an added paragraph break by default', () => {
    const r = computeDiff(a, b, base);
    expect(r.rows.map((x) => x.kind)).toEqual(['equal', 'gap-ins', 'equal']);
    expect(r.stats.paragraphsChanged).toBe(0);
  });

  it('ignores blank-line changes when enabled', () => {
    expect(computeDiff(a, b, { ...base, ignoreBlankLines: true }).identical).toBe(true);
  });
});

describe('quote normalization', () => {
  it('matches curly and straight quotes only when enabled', () => {
    const a = '“Hello,” she said.';
    const b = '"Hello," she said.';
    expect(computeDiff(a, b, base).identical).toBe(false);
    expect(computeDiff(a, b, { ...base, normalizeQuotes: true }).identical).toBe(true);
  });
});
