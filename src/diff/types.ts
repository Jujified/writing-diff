export type Granularity = 'paragraph' | 'word' | 'char';

export interface DiffOptions {
  granularity: Granularity;
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
  ignoreBlankLines: boolean;
  normalizeQuotes: boolean;
}

/** One inline run inside a modified paragraph. */
export interface Segment {
  op: 'eq' | 'del' | 'ins';
  /** Text as it appears on the side the run belongs to (eq runs carry both). */
  a: string;
  b: string;
}

/**
 * One row of the aligned diff. Paragraph numbers are 1-based and count only
 * real paragraphs (blank-line markers have no number).
 */
export type Row =
  | { kind: 'equal'; a: number; b: number; textA: string; textB: string }
  | { kind: 'del'; a: number; text: string }
  | { kind: 'ins'; b: number; text: string }
  | { kind: 'mod'; a: number; b: number; segments: Segment[] }
  | { kind: 'gap-del' }
  | { kind: 'gap-ins' };

export interface DiffStats {
  wordsAdded: number;
  wordsRemoved: number;
  paragraphsChanged: number;
  paragraphsA: number;
  paragraphsB: number;
}

export interface DiffResult {
  rows: Row[];
  stats: DiffStats;
  identical: boolean;
  /** True when the raw texts differ but the ignore options made them match. */
  identicalAfterIgnoring: boolean;
}

export interface DiffRequest {
  id: number;
  a: string;
  b: string;
  options: DiffOptions;
}

export type DiffResponse =
  | { id: number; ok: true; result: DiffResult; ms: number }
  | { id: number; ok: false; error: string };
