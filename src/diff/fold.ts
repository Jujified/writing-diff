import type { Row } from './types';

/**
 * One stop for next/previous: an edited paragraph on its own, or a run of
 * adjacent added/removed paragraphs (a replaced passage reads as one change).
 */
export interface Change {
  start: number;
  /** Exclusive. */
  end: number;
  hasDel: boolean;
  hasIns: boolean;
}

export type Item = { type: 'row'; index: number } | { type: 'fold'; start: number; end: number };

export function findChanges(rows: Row[]): Change[] {
  const changes: Change[] = [];
  let current: Change | null = null;
  rows.forEach((row, i) => {
    if (row.kind === 'equal') {
      current = null;
      return;
    }
    // An edited paragraph is always its own stop.
    if (row.kind === 'mod' || (current && rows[current.end - 1].kind === 'mod')) current = null;
    if (!current) {
      current = { start: i, end: i + 1, hasDel: false, hasIns: false };
      changes.push(current);
    }
    current.end = i + 1;
    if (row.kind === 'del' || row.kind === 'gap-del' || row.kind === 'mod') current.hasDel = true;
    if (row.kind === 'ins' || row.kind === 'gap-ins' || row.kind === 'mod') current.hasIns = true;
  });
  return changes;
}

/**
 * Decide which rows to show: every changed row, `context` unchanged rows on
 * each side of a change, and folds for the rest. A fold never hides a single
 * row, since the fold button would take as much room as the row itself.
 * `context < 0` shows everything.
 */
export function planItems(rows: Row[], context: number, expanded: ReadonlySet<number> = new Set()): Item[] {
  const items: Item[] = [];
  const pushRows = (from: number, to: number) => {
    for (let i = from; i < to; i++) items.push({ type: 'row', index: i });
  };
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind !== 'equal') {
      items.push({ type: 'row', index: i++ });
      continue;
    }
    const start = i;
    while (i < rows.length && rows[i].kind === 'equal') i++;
    const end = i;
    if (context < 0) {
      pushRows(start, end);
      continue;
    }
    const keepBefore = start === 0 ? 0 : context;
    const keepAfter = end === rows.length ? 0 : context;
    const hideFrom = start + keepBefore;
    const hideTo = end - keepAfter;
    if (hideTo - hideFrom < 2 || expanded.has(hideFrom)) {
      pushRows(start, end);
      continue;
    }
    pushRows(start, hideFrom);
    items.push({ type: 'fold', start: hideFrom, end: hideTo });
    pushRows(hideTo, end);
  }
  return items;
}
