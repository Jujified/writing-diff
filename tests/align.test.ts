import { describe, expect, it } from 'vitest';
import { alignParagraphs, computeDiff, intraDiff } from '../src/diff/engine';
import type { DiffOptions, Row } from '../src/diff/types';

const opts: DiffOptions = {
  granularity: 'word',
  ignoreWhitespace: false,
  ignoreCase: false,
  ignoreBlankLines: true,
  normalizeQuotes: false,
};

const kinds = (rows: Row[]) => rows.map((r) => r.kind);
const para = (text: string) => ({ type: 'para' as const, text });

const P1 = 'The committee met on Tuesday to review the proposal in detail.';
const P2 = 'Several members raised concerns about the projected costs of the plan.';
const P3 = 'After a long discussion, they agreed to postpone the final vote.';

describe('paragraph alignment', () => {
  it('shows a one-word edit as a modified paragraph, not a delete and insert', () => {
    const b = P2.replace('Several', 'Many');
    const { rows, stats } = computeDiff([P1, P2, P3].join('\n'), [P1, b, P3].join('\n'), opts);
    expect(kinds(rows)).toEqual(['equal', 'mod', 'equal']);
    const mod = rows[1];
    if (mod.kind !== 'mod') throw new Error('expected mod');
    expect(mod.segments).toEqual([
      { op: 'del', a: 'Several', b: '' },
      { op: 'ins', a: '', b: 'Many' },
      { op: 'eq', a: P2.slice('Several'.length), b: P2.slice('Several'.length) },
    ]);
    expect(stats).toMatchObject({ wordsAdded: 1, wordsRemoved: 1, paragraphsChanged: 1 });
  });

  it('keeps paragraph numbers in step when a paragraph is inserted', () => {
    const inserted = 'A brand new paragraph that did not exist before at all.';
    const { rows } = computeDiff([P1, P3].join('\n'), [P1, inserted, P3].join('\n'), opts);
    expect(rows).toEqual([
      { kind: 'equal', a: 1, b: 1, textA: P1, textB: P1 },
      { kind: 'ins', b: 2, text: inserted },
      { kind: 'equal', a: 2, b: 3, textA: P3, textB: P3 },
    ]);
  });

  it('pairs edited paragraphs with their counterparts inside a changed block', () => {
    const newcomer = 'Completely unrelated sentence about lunch plans and weather.';
    const a = [P1, P2, P3].join('\n');
    const b = [P1.replace('Tuesday', 'Wednesday'), newcomer, P2.replace('costs', 'expenses'), P3].join('\n');
    const { rows } = computeDiff(a, b, opts);
    expect(kinds(rows)).toEqual(['mod', 'ins', 'mod', 'equal']);
    expect(rows[2]).toMatchObject({ kind: 'mod', a: 2, b: 3 });
  });

  it('does not pair paragraphs that have nothing in common', () => {
    const pairs = alignParagraphs(
      [para('Apples are red and crunchy in the autumn months of the year.')],
      [para('Quantum computers use qubits for certain specialised workloads today.')],
      opts,
    );
    expect(pairs).toEqual([]);
  });

  it('pairs in document order, preferring the most similar match', () => {
    const pairs = alignParagraphs(
      [para(P1), para(P2)],
      [para('Totally new opening paragraph with no overlap whatsoever here.'), para(P2.replace('plan', 'scheme'))],
      opts,
    );
    expect(pairs).toEqual([[1, 1]]);
  });

  it('renders paired paragraphs as delete then insert at paragraph granularity', () => {
    const b = P2.replace('Several', 'Many');
    const { rows } = computeDiff(P2, b, { ...opts, granularity: 'paragraph' });
    expect(kinds(rows)).toEqual(['del', 'ins']);
  });

  it('reports identical texts', () => {
    const r = computeDiff('Same text.\nAgain.', 'Same text.\r\nAgain.\n', opts);
    expect(r.identical).toBe(true);
    expect(r.identicalAfterIgnoring).toBe(false);
  });
});

describe('inline diff', () => {
  it('folds the space between adjacent changed words into one change', () => {
    expect(intraDiff('the quick brown fox', 'the slow red fox', 'word', opts)).toEqual([
      { op: 'eq', a: 'the ', b: 'the ' },
      { op: 'del', a: 'quick brown', b: '' },
      { op: 'ins', a: '', b: 'slow red' },
      { op: 'eq', a: ' fox', b: ' fox' },
    ]);
  });

  it('highlights only the changed characters at character granularity', () => {
    expect(intraDiff('colour', 'color', 'char', opts)).toEqual([
      { op: 'eq', a: 'colo', b: 'colo' },
      { op: 'del', a: 'u', b: '' },
      { op: 'eq', a: 'r', b: 'r' },
    ]);
  });
});

describe('mark edges', () => {
  it('keeps surrounding spaces outside an inserted word', () => {
    const segs = intraDiff('the gap between places', 'the gap between the places', 'word', opts);
    expect(segs.filter((s) => s.op !== 'eq')).toEqual([{ op: 'ins', a: '', b: 'the' }]);
    expect(segs.map((s) => s.a).join('')).toBe('the gap between places');
    expect(segs.map((s) => s.b).join('')).toBe('the gap between the places');
  });

  it('keeps spaces outside a deleted word on the original side', () => {
    const segs = intraDiff('the big dog', 'the dog', 'word', opts);
    expect(segs.find((s) => s.op === 'del')).toEqual({ op: 'del', a: 'big', b: '' });
    expect(segs.map((s) => s.a).join('')).toBe('the big dog');
    expect(segs.map((s) => s.b).join('')).toBe('the dog');
  });
});
