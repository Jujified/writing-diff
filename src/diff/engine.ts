import { diffArrays } from 'diff';
import { countWords, normalizeText, splitBlocks, type Block } from './normalize';
import { isWhitespace, tokenizeChars, tokenizeWords } from './tokens';
import type { DiffOptions, DiffResult, Row, Segment } from './types';

/** Paragraph pairs below this similarity are shown as a delete plus an insert. */
export const PAIR_THRESHOLD = 0.4;
/** Above this many candidate pairs in one changed block, fall back to positional pairing. */
const MAX_PAIR_MATRIX = 250_000;
/** jsdiff gives up on a single paragraph after this long and we fall back. */
const INTRA_TIMEOUT_MS = 1500;

const GAP_KEY = '\u0000gap';

export function computeDiff(rawA: string, rawB: string, opts: DiffOptions): DiffResult {
  const blocksA = prepare(rawA, opts);
  const blocksB = prepare(rawB, opts);
  const keysA = blocksA.map((b) => blockKey(b, opts));
  const keysB = blocksB.map((b) => blockKey(b, opts));

  const rows: Row[] = [];
  const stats = {
    wordsAdded: 0,
    wordsRemoved: 0,
    paragraphsChanged: 0,
    paragraphsA: blocksA.filter((b) => b.type === 'para').length,
    paragraphsB: blocksB.filter((b) => b.type === 'para').length,
  };
  let ia = 0;
  let ib = 0;
  let numA = 0;
  let numB = 0;

  const emitDel = (block: Block) => {
    if (block.type === 'gap') return void rows.push({ kind: 'gap-del' });
    numA++;
    stats.paragraphsChanged++;
    stats.wordsRemoved += countWords(block.text);
    rows.push({ kind: 'del', a: numA, text: block.text });
  };
  const emitIns = (block: Block) => {
    if (block.type === 'gap') return void rows.push({ kind: 'gap-ins' });
    numB++;
    stats.paragraphsChanged++;
    stats.wordsAdded += countWords(block.text);
    rows.push({ kind: 'ins', b: numB, text: block.text });
  };
  const emitPair = (a: string, b: string) => {
    numA++;
    numB++;
    const words = intraDiff(a, b, 'word', opts);
    const segments = opts.granularity === 'char' ? intraDiff(a, b, 'char', opts) : words;
    if (!segments.some((s) => s.op !== 'eq')) {
      rows.push({ kind: 'equal', a: numA, b: numB, textA: a, textB: b });
      return;
    }
    stats.paragraphsChanged++;
    for (const s of words) {
      if (s.op === 'del') stats.wordsRemoved += countWords(s.a);
      if (s.op === 'ins') stats.wordsAdded += countWords(s.b);
    }
    if (opts.granularity === 'paragraph') {
      rows.push({ kind: 'del', a: numA, text: a }, { kind: 'ins', b: numB, text: b });
    } else {
      rows.push({ kind: 'mod', a: numA, b: numB, segments });
    }
  };

  const changes = diffArrays(keysA, keysB);
  for (let c = 0; c < changes.length; c++) {
    const change = changes[c];
    if (!change.added && !change.removed) {
      for (let k = 0; k < change.count; k++) {
        const a = blocksA[ia++];
        const b = blocksB[ib++];
        if (a.type === 'para' && b.type === 'para') {
          numA++;
          numB++;
          rows.push({ kind: 'equal', a: numA, b: numB, textA: a.text, textB: b.text });
        }
      }
      continue;
    }
    // Gather one contiguous changed region: removals, then additions.
    const removed: Block[] = [];
    const added: Block[] = [];
    while (c < changes.length && (changes[c].added || changes[c].removed)) {
      const ch = changes[c];
      const src = ch.removed ? blocksA : blocksB;
      const start = ch.removed ? ia : ib;
      const target = ch.removed ? removed : added;
      for (let k = 0; k < ch.count; k++) target.push(src[start + k]);
      if (ch.removed) ia += ch.count;
      else ib += ch.count;
      c++;
    }
    c--;

    const pairs = alignParagraphs(removed, added, opts);
    let ri = 0;
    let ai = 0;
    for (const [pi, pj] of [...pairs, [removed.length, added.length] as const]) {
      while (ri < pi) emitDel(removed[ri++]);
      while (ai < pj) emitIns(added[ai++]);
      if (pi === removed.length && pj === added.length) break;
      const a = removed[ri++];
      const b = added[ai++];
      if (a.type === 'para' && b.type === 'para') emitPair(a.text, b.text);
    }
  }

  const identical = rows.every((r) => r.kind === 'equal');
  return {
    rows,
    stats,
    identical,
    identicalAfterIgnoring: identical && lightlyNormalized(rawA) !== lightlyNormalized(rawB),
  };
}

function prepare(raw: string, opts: DiffOptions): Block[] {
  const blocks = splitBlocks(normalizeText(raw, opts));
  return opts.ignoreBlankLines ? blocks.filter((b) => b.type === 'para') : blocks;
}

function lightlyNormalized(raw: string): string {
  return splitBlocks(raw.replace(/\r\n?/g, '\n'))
    .map((b) => (b.type === 'gap' ? '' : b.text))
    .join('\n');
}

export function comparisonKey(text: string, opts: Pick<DiffOptions, 'ignoreCase' | 'ignoreWhitespace'>): string {
  let key = text;
  if (opts.ignoreWhitespace) key = key.replace(/\s+/g, ' ').trim();
  if (opts.ignoreCase) key = key.toLocaleLowerCase();
  return key;
}

function blockKey(block: Block, opts: DiffOptions): string {
  return block.type === 'gap' ? GAP_KEY : comparisonKey(block.text, opts);
}

/* ------------------------------------------------------------------------ */
/* Stage 1b: pair up paragraphs inside a changed region                      */
/* ------------------------------------------------------------------------ */

type Profile = { words: Map<string, number>; size: number; bigrams: Map<string, number>; bigramSize: number };

function profile(text: string): Profile {
  const words = new Map<string, number>();
  let size = 0;
  for (const t of tokenizeWords(text.toLocaleLowerCase())) {
    if (isWhitespace(t)) continue;
    words.set(t, (words.get(t) ?? 0) + 1);
    size++;
  }
  const bigrams = new Map<string, number>();
  const compact = text.toLocaleLowerCase().replace(/\s+/g, ' ');
  for (let i = 0; i < compact.length - 1; i++) {
    const g = compact.slice(i, i + 2);
    bigrams.set(g, (bigrams.get(g) ?? 0) + 1);
  }
  return { words, size, bigrams, bigramSize: Math.max(0, compact.length - 1) };
}

function dice(a: Map<string, number>, aSize: number, b: Map<string, number>, bSize: number): number {
  if (aSize + bSize === 0) return 1;
  let shared = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [k, n] of small) shared += Math.min(n, large.get(k) ?? 0);
  return (2 * shared) / (aSize + bSize);
}

/** Similarity in [0, 1]: word overlap for prose, character bigrams for short lines. */
export function paragraphSimilarity(a: Profile | string, b: Profile | string): number {
  const pa = typeof a === 'string' ? profile(a) : a;
  const pb = typeof b === 'string' ? profile(b) : b;
  if (pa.size + pb.size < 12) return dice(pa.bigrams, pa.bigramSize, pb.bigrams, pb.bigramSize);
  return dice(pa.words, pa.size, pb.words, pb.size);
}

/**
 * Choose which removed paragraph corresponds to which added paragraph.
 * Pairs keep document order (no crossings) and maximize total similarity,
 * which is a small Needleman–Wunsch alignment over the changed region.
 * Returns index pairs into `removed` and `added`, ascending.
 */
export function alignParagraphs(removed: Block[], added: Block[], opts: Pick<DiffOptions, 'granularity'>): Array<readonly [number, number]> {
  const m = removed.length;
  const n = added.length;
  if (m === 0 || n === 0) return [];
  const pa = removed.map((b) => (b.type === 'para' ? profile(b.text) : null));
  const pb = added.map((b) => (b.type === 'para' ? profile(b.text) : null));
  // At paragraph granularity a pair is still worth making: it keeps the old and
  // new versions next to each other instead of far apart.
  const threshold = opts.granularity === 'paragraph' ? PAIR_THRESHOLD * 0.75 : PAIR_THRESHOLD;
  const sim = (i: number, j: number): number => {
    const x = pa[i];
    const y = pb[j];
    if (!x || !y) return -1;
    const s = paragraphSimilarity(x, y);
    return s >= threshold ? s : -1;
  };

  if (m * n > MAX_PAIR_MATRIX) {
    const pairs: Array<readonly [number, number]> = [];
    for (let k = 0; k < Math.min(m, n); k++) if (sim(k, k) > 0) pairs.push([k, k]);
    return pairs;
  }

  const width = n + 1;
  const score = new Float64Array((m + 1) * width);
  const move = new Uint8Array((m + 1) * width); // 1 = skip removed, 2 = skip added, 3 = pair
  for (let i = 1; i <= m; i++) move[i * width] = 1;
  for (let j = 1; j <= n; j++) move[j] = 2;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      let best = score[(i - 1) * width + j];
      let dir = 1;
      const left = score[i * width + j - 1];
      if (left > best) {
        best = left;
        dir = 2;
      }
      const s = sim(i - 1, j - 1);
      if (s > 0) {
        const diag = score[(i - 1) * width + j - 1] + s;
        if (diag > best) {
          best = diag;
          dir = 3;
        }
      }
      score[i * width + j] = best;
      move[i * width + j] = dir;
    }
  }
  const pairs: Array<readonly [number, number]> = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const dir = move[i * width + j];
    if (dir === 3) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (dir === 1) i--;
    else j--;
  }
  return pairs.reverse();
}

/* ------------------------------------------------------------------------ */
/* Stage 2: inline diff inside a paired paragraph                            */
/* ------------------------------------------------------------------------ */

export function intraDiff(
  a: string,
  b: string,
  granularity: 'word' | 'char',
  opts: Pick<DiffOptions, 'ignoreCase' | 'ignoreWhitespace'>,
): Segment[] {
  const ta = granularity === 'char' ? tokenizeChars(a) : tokenizeWords(a);
  const tb = granularity === 'char' ? tokenizeChars(b) : tokenizeWords(b);
  const key = (t: string): string => {
    if (isWhitespace(t)) return opts.ignoreWhitespace ? ' ' : t;
    return opts.ignoreCase ? t.toLocaleLowerCase() : t;
  };
  const ka = ta.map(key);
  const kb = tb.map(key);
  const changes = diffArrays(ka, kb, { timeout: INTRA_TIMEOUT_MS });
  if (!changes) {
    if (granularity === 'char') return intraDiff(a, b, 'word', opts);
    return [
      { op: 'del', a, b: '' },
      { op: 'ins', a: '', b },
    ];
  }

  const raw: Segment[] = [];
  let ia = 0;
  let ib = 0;
  for (const ch of changes) {
    if (ch.removed) {
      const text = ta.slice(ia, (ia += ch.count)).join('');
      raw.push(opts.ignoreWhitespace && isWhitespace(text) ? { op: 'eq', a: text, b: '' } : { op: 'del', a: text, b: '' });
    } else if (ch.added) {
      const text = tb.slice(ib, (ib += ch.count)).join('');
      raw.push(opts.ignoreWhitespace && isWhitespace(text) ? { op: 'eq', a: '', b: text } : { op: 'ins', a: '', b: text });
    } else {
      raw.push({
        op: 'eq',
        a: ta.slice(ia, (ia += ch.count)).join(''),
        b: tb.slice(ib, (ib += ch.count)).join(''),
      });
    }
  }
  return consolidate(raw);
}

/**
 * Make inline changes read like an editor's marks: a lone space between two
 * changed words is folded into the change ("quick brown" → "slow red" rather
 * than four fragments), and every run of changes becomes one deletion
 * followed by one insertion.
 */
function consolidate(segments: Segment[]): Segment[] {
  const isChange = (s: Segment | undefined) => s !== undefined && s.op !== 'eq';
  const marked = segments.map((s, i) =>
    s.op === 'eq' && isWhitespace(s.a + s.b) && isChange(segments[i - 1]) && isChange(segments[i + 1])
      ? { ...s, op: 'glue' as const }
      : s,
  );
  const out: Segment[] = [];
  let del = '';
  let ins = '';
  const pushEq = (a: string, b: string) => {
    if (!a && !b) return;
    const prev = out[out.length - 1];
    if (prev?.op === 'eq') {
      prev.a += a;
      prev.b += b;
    } else out.push({ op: 'eq', a, b });
  };
  const flush = () => {
    // Keep spaces at the edges of a change outside the highlight, so a mark
    // covers "the" rather than "the ".
    const [leadD, coreD, trailD] = splitEdges(del);
    const [leadI, coreI, trailI] = splitEdges(ins);
    pushEq(leadD, leadI);
    if (coreD) out.push({ op: 'del', a: coreD, b: '' });
    if (coreI) out.push({ op: 'ins', a: '', b: coreI });
    pushEq(trailD, trailI);
    del = '';
    ins = '';
  };
  for (const s of marked) {
    if (s.op === 'eq') {
      flush();
      pushEq(s.a, s.b);
      continue;
    }
    del += s.a;
    ins += s.b;
  }
  flush();
  return out;
}

/** Split leading and trailing whitespace off a changed run, unless it is all whitespace. */
function splitEdges(text: string): [string, string, string] {
  if (text.trim() === '') return ['', text, ''];
  const lead = /^\s*/.exec(text)?.[0] ?? '';
  const trail = /\s*$/.exec(text)?.[0] ?? '';
  return [lead, text.slice(lead.length, text.length - trail.length), trail];
}
