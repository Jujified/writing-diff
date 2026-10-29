import { describe, expect, it } from 'vitest';
import { findChanges, planItems } from '../src/diff/fold';
import type { Row } from '../src/diff/types';

const eq = (n: number): Row => ({ kind: 'equal', a: n, b: n, textA: `p${n}`, textB: `p${n}` });
const rows: Row[] = [
  ...Array.from({ length: 10 }, (_, i) => eq(i + 1)),
  { kind: 'del', a: 11, text: 'gone' },
  { kind: 'ins', b: 11, text: 'new' },
  ...Array.from({ length: 10 }, (_, i) => eq(i + 12)),
];

describe('context folding', () => {
  it('groups adjacent changed rows into one change', () => {
    expect(findChanges(rows)).toEqual([{ start: 10, end: 12, hasDel: true, hasIns: true }]);
  });

  it('keeps N unchanged paragraphs around a change and folds the rest', () => {
    expect(planItems(rows, 2).map((it) => (it.type === 'fold' ? `fold ${it.start}-${it.end}` : it.index))).toEqual([
      'fold 0-8', 8, 9, 10, 11, 12, 13, 'fold 14-22',
    ]);
  });

  it('shows everything for unlimited context or an expanded fold', () => {
    expect(planItems(rows, -1)).toHaveLength(rows.length);
    expect(planItems(rows, 2, new Set([0])).filter((i) => i.type === 'fold')).toHaveLength(1);
  });

  it('never folds a single paragraph', () => {
    const short: Row[] = [eq(1), eq(2), eq(3), { kind: 'ins', b: 4, text: 'x' }];
    expect(planItems(short, 2).every((i) => i.type === 'row')).toBe(true);
  });
});

describe('change stops', () => {
  it('makes each edited paragraph its own stop but groups a replaced passage', () => {
    const mod = (n: number): Row => ({ kind: 'mod', a: n, b: n, segments: [] });
    const r: Row[] = [mod(1), mod(2), { kind: 'del', a: 3, text: 'x' }, { kind: 'ins', b: 3, text: 'y' }, mod(4)];
    expect(findChanges(r).map((c) => [c.start, c.end])).toEqual([[0, 1], [1, 2], [2, 4], [4, 5]]);
  });
});
